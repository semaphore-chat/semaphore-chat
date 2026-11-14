// Copyright 2025 LiveKit, Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use std::path::PathBuf;
use std::{
    collections::HashSet,
    env,
    fs::{self, File},
    io::{self, BufRead, Read, Seek, Write},
    path,
    process::Command,
};

use anyhow::{anyhow, Context, Result};
use fs2::FileExt;
use regex::Regex;
use reqwest::StatusCode;

pub const SCRATH_PATH: &str = "livekit_webrtc";

// Semaphore Chat patch: the prebuilt is checked against a pinned sha256 before it is extracted,
// and the build fails if it differs or if this target has no pin. The release asset could be
// replaced after publishing, and nothing else (Cargo.lock, cargo-deny) covers it.
//
// From https://github.com/livekit/rust-sdks/releases/tag/webrtc-a545de4 (assets uploaded
// 2026-10-23), pinned 2026-11-13: each value is the sha256 of the zip downloaded that day and
// equals the digest GitHub lists for the asset; the linux-x64 contents also equal a copy
// extracted on 2026-11-12. A new WEBRTC_TAG needs new pins.
pub const PINNED_SHA256: &[(&str, &str)] = &[
    // https://github.com/livekit/rust-sdks/releases/download/webrtc-a545de4/webrtc-linux-x64-release.zip
    ("linux-x64-release", "2ece73b9a72a2cacd73d0c62ac3a414e202f37885c3c8f49dddb43c1443ac0bd"),
    // https://github.com/livekit/rust-sdks/releases/download/webrtc-a545de4/webrtc-linux-arm64-release.zip
    ("linux-arm64-release", "e87dff71422c5cb1470f6cf00ecc4ad6964e746c5039831b7206b946b5d13c5f"),
    // https://github.com/livekit/rust-sdks/releases/download/webrtc-a545de4/webrtc-win-x64-release.zip
    ("win-x64-release", "862403fcb248c7d8803487e4c22b8821c6130e89100cb9c69be95ef45ff46146"),
];

/// The pinned sha256 of the prebuilt for `triple`, if it has one.
pub fn pinned_sha256(triple: &str) -> Option<&'static str> {
    PINNED_SHA256.iter().find(|(pinned, _)| *pinned == triple).map(|(_, sha)| *sha)
}

/// Reads `reader` to the end and fails unless its sha256 is `expected` (lowercase hex).
pub fn verify_sha256(mut reader: impl Read, expected: &str) -> Result<()> {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1 << 16];
    loop {
        let read = reader.read(&mut buffer).context("Failed to read the WebRTC download")?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    let actual: String = hasher.finalize().iter().map(|byte| format!("{byte:02x}")).collect();
    if actual != expected {
        return Err(anyhow!(
            "the WebRTC download's sha256 is {actual}, not the pinned {expected}: refusing to build with it"
        ));
    }
    Ok(())
}
pub const WEBRTC_TAG: &str = "webrtc-a545de4";
pub const IGNORE_DEFINES: [&str; 2] = ["CR_CLANG_REVISION", "CR_XCODE_VERSION"];

pub fn target_os() -> String {
    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap();
    let target = env::var("TARGET").unwrap();
    let is_simulator = target.ends_with("-sim");

    match target_os.as_str() {
        "windows" => "win",
        "macos" => "mac",
        "ios" => {
            if is_simulator {
                "ios-simulator"
            } else {
                "ios-device"
            }
        }
        _ => &target_os,
    }
    .to_string()
}

pub fn target_arch() -> String {
    let target_arch = env::var("CARGO_CFG_TARGET_ARCH").unwrap();
    match target_arch.as_str() {
        "aarch64" => "arm64",
        "x86_64" => "x64",
        _ => &target_arch,
    }
    .to_owned()
}

/// The full name of the webrtc library
/// e.g. mac-x64-release (Same name on GH releases)
pub fn webrtc_triple() -> String {
    let profile = if use_debug() { "debug" } else { "release" };
    format!("{}-{}-{}", target_os(), target_arch(), profile)
}

/// Using debug builds of webrtc is still experimental for now
/// On Windows, Rust doesn't link against libcmtd on debug, which is an issue
/// Default to false (even on cargo debug)
pub fn use_debug() -> bool {
    let var = env::var("LK_DEBUG_WEBRTC");
    var.is_ok() && var.unwrap() == "true"
}

/// The location of the custom build is defined by the user
pub fn custom_dir() -> Option<path::PathBuf> {
    if let Ok(path) = env::var("LK_CUSTOM_WEBRTC") {
        return Some(path::PathBuf::from(path));
    }
    None
}

/// Location of the downloaded webrtc binaries
/// The reason why we don't use OUT_DIR is because we sometimes need to share the same binaries
/// across multiple crates without dependencies constraints
/// This also has the benefit of not re-downloading the binaries for each crate
pub fn prebuilt_dir() -> path::PathBuf {
    let target_dir = scratch::path(SCRATH_PATH);
    // Semaphore patch: the pin is part of the path, so a copy extracted before pinning (never
    // checked) is not reused; only a verified download creates this directory.
    let pin = pinned_sha256(&webrtc_triple()).map_or("unpinned", |sha| &sha[..12]);
    path::Path::new(&target_dir).join(format!(
        "livekit/{}-{}-{}/{}",
        webrtc_triple(),
        WEBRTC_TAG,
        pin,
        webrtc_triple()
    ))
}

pub fn download_url() -> String {
    format!(
        "https://github.com/livekit/rust-sdks/releases/download/{}/{}.zip",
        WEBRTC_TAG,
        format!("webrtc-{}", webrtc_triple())
    )
}

/// Used location of libwebrtc depending on whether it's a custom build or not
pub fn webrtc_dir() -> path::PathBuf {
    if let Some(path) = custom_dir() {
        return path;
    }

    prebuilt_dir()
}

pub fn webrtc_defines() -> Vec<(String, Option<String>)> {
    // read preprocessor definitions from webrtc.ninja
    let defines_re = Regex::new(r"-D(\w+)(?:=([^\s]+))?").unwrap();
    let mut files = vec![webrtc_dir().join("webrtc.ninja")];
    // include desktop_capture.ninja to avoid ABI mismatch for DesktopCaptureOptions due to WEBRTC_USE_X11 missing
    // libwebrtc does not implement desktop capture on Android
    if env::var("CARGO_CFG_TARGET_OS").unwrap() != "android" {
        files.push(webrtc_dir().join("desktop_capture.ninja"));
    }

    let mut seen = HashSet::new();
    let mut vec = Vec::new();

    for path in files {
        let gni = fs::File::open(&path)
            .unwrap_or_else(|e| panic!("Could not open ninja file: {path:?}\n{e:?}"));

        let mut defines_line = String::default();
        io::BufReader::new(gni).read_line(&mut defines_line).unwrap();
        for cap in defines_re.captures_iter(&defines_line) {
            let define_name = &cap[1];
            let define_value = cap.get(2).map(|m| m.as_str());
            if IGNORE_DEFINES.contains(&define_name) {
                continue;
            }
            let value = define_value.map(str::to_string);
            let name = define_name.to_owned();
            if seen.insert((name.clone(), value.clone())) {
                vec.push((name, value));
            }
        }
    }

    vec
}

pub fn configure_jni_symbols() -> Result<()> {
    download_webrtc().context("Failed to download WebRTC binaries for JNI configuration")?;

    let toolchain = android_ndk_toolchain().context("Failed to locate Android NDK toolchain")?;
    let toolchain_bin = toolchain.join("bin");

    let webrtc_dir = webrtc_dir();
    let webrtc_lib = webrtc_dir.join("lib");

    let out_dir = path::PathBuf::from(env::var("OUT_DIR").unwrap());

    // Find JNI symbols
    let readelf_output = Command::new(toolchain_bin.join("llvm-readelf"))
        .arg("-Ws")
        .arg(webrtc_lib.join("libwebrtc.a"))
        .output()
        .expect("failed to run llvm-readelf");

    let jni_regex = Regex::new(r"(Java_livekit_org_webrtc.*)").unwrap();
    let content = String::from_utf8_lossy(&readelf_output.stdout);
    let jni_symbols: Vec<&str> =
        jni_regex.captures_iter(&content).map(|cap| cap.get(1).unwrap().as_str()).collect();

    if jni_symbols.is_empty() {
        return Err(anyhow!("No JNI symbols found")); // Shouldn't happen
    }

    // Keep JNI symbols
    for symbol in &jni_symbols {
        println!("cargo:rustc-link-arg=-Wl,--undefined={}", symbol);
    }

    // Version script
    let vs_path = out_dir.join("webrtc_jni.map");
    let mut vs_file = fs::File::create(&vs_path).context("Failed to create version script file")?;

    let jni_symbols = jni_symbols.join("; ");
    write!(vs_file, "JNI_WEBRTC {{\n\tglobal: {}; \n}};", jni_symbols)
        .context("Failed to write version script")?;

    println!("cargo:rustc-link-arg=-Wl,--version-script={}", vs_path.display());

    Ok(())
}

pub fn download_webrtc() -> Result<()> {
    let dir = scratch::path(SCRATH_PATH);
    // temporary fix to avoid github workflow issue
    fs::create_dir_all(&dir).context("Failed to create scratch_path")?;
    let flock = File::create(dir.join(".lock"))
        .context("Failed to create lock file for WebRTC download")?;
    flock.lock_exclusive().context("Failed to acquire exclusive lock for WebRTC download")?;

    let webrtc_dir = webrtc_dir();
    if webrtc_dir.exists() {
        return Ok(());
    }

    let expected = pinned_sha256(&webrtc_triple()).ok_or_else(|| {
        anyhow!("no pinned sha256 for the WebRTC prebuilt {}: add one before building", webrtc_triple())
    })?;

    let mut resp = reqwest::blocking::get(download_url());
    for attempt in 1..3 {
        let transient = match &resp {
            Ok(resp) => {
                resp.status().is_server_error() || resp.status() == StatusCode::TOO_MANY_REQUESTS
            }
            Err(_) => true,
        };
        if !transient {
            break;
        }
        println!("cargo:warning=webrtc download attempt {} failed, retrying in 5s...", attempt);
        std::thread::sleep(std::time::Duration::from_secs(5));
        resp = reqwest::blocking::get(download_url());
    }
    let mut resp = resp.context("Failed to send HTTP request to download WebRTC")?;
    if resp.status() != StatusCode::OK {
        return Err(anyhow!("failed to download webrtc: {}", resp.status()));
    }

    let out_dir = env::var("OUT_DIR").unwrap();
    let tmp_path = PathBuf::from(out_dir).join("webrtc.zip");
    let mut file = fs::File::options()
        .write(true)
        .read(true)
        .create(true)
        .open(&tmp_path)
        .context("Failed to create temporary file for WebRTC download")?;
    resp.copy_to(&mut file).context("Failed to write WebRTC download to temporary file")?;

    file.seek(io::SeekFrom::Start(0)).context("Failed to rewind the WebRTC download")?;
    if let Err(error) = verify_sha256(&mut file, expected) {
        drop(file);
        let _ = fs::remove_file(&tmp_path);
        return Err(error);
    }
    file.seek(io::SeekFrom::Start(0)).context("Failed to rewind the WebRTC download")?;

    // Extract into a sibling temp dir, then atomically rename into place so concurrent
    // observers see either no `webrtc_dir` or a fully-populated one — never the partially-
    // extracted state that made `fs::copy(webrtc_dir/LICENSE.md, …)` in callers flaky.
    let tmp_extract = webrtc_dir.parent().unwrap().join(format!(".{}.tmp", webrtc_triple()));
    let _ = fs::remove_dir_all(&tmp_extract); // clean up leftover from a crashed build
    fs::create_dir_all(&tmp_extract).context("Failed to create temp extraction dir")?;

    let mut archive = zip::ZipArchive::new(file).context("Failed to open WebRTC zip archive")?;
    archive.extract(&tmp_extract).context("Failed to extract WebRTC archive")?;
    drop(archive);

    // The zip root is `{triple}/`, so extracted content sits at `tmp_extract/{triple}/`.
    fs::rename(tmp_extract.join(webrtc_triple()), &webrtc_dir)
        .context("Failed to move extracted WebRTC into place")?;
    let _ = fs::remove_dir_all(&tmp_extract);

    #[cfg(unix)]
    ensure_owner_readable(&webrtc_dir).context("Failed to normalize libwebrtc file permissions")?;

    fs::remove_file(&tmp_path).context("Failed to remove temporary WebRTC zip file")?;
    Ok(())
}

#[cfg(unix)]
fn ensure_owner_readable(root: &path::Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fn walk(p: &path::Path) -> Result<()> {
        let meta = fs::symlink_metadata(p)?;
        // Don't try to chmod through symlinks — follow them only via the
        // entries we walk into normally. set_permissions on a symlink may
        // affect the target on some platforms; just skip.
        if meta.file_type().is_symlink() {
            return Ok(());
        }
        let mut perms = meta.permissions();
        let mut mode = perms.mode();
        mode |= 0o600; // owner read+write
        if meta.is_dir() {
            mode |= 0o100; // owner traverse
        }
        perms.set_mode(mode);
        // Best-effort: if the file is on a read-only mount or owned by another
        // user (shouldn't happen here), we just skip rather than failing the
        // build over a permission tweak.
        let _ = fs::set_permissions(p, perms);
        if meta.is_dir() {
            for entry in fs::read_dir(p)? {
                walk(&entry?.path())?;
            }
        }
        Ok(())
    }
    walk(root)
}

pub fn android_ndk_toolchain() -> Result<path::PathBuf> {
    let host_os = host_os();

    let home = env::var("HOME");
    let local = env::var("LOCALAPPDATA");

    let home = if host_os == Some("linux") {
        path::PathBuf::from(home.unwrap())
    } else if host_os == Some("darwin") {
        path::PathBuf::from(home.unwrap()).join("Library")
    } else if host_os == Some("windows") {
        path::PathBuf::from(local.unwrap())
    } else {
        return Err(anyhow!("Unsupported host OS"));
    };

    let ndk_dir = || -> Option<path::PathBuf> {
        let ndk_env = env::var("ANDROID_NDK_HOME");
        if let Ok(ndk_env) = ndk_env {
            return Some(path::PathBuf::from(ndk_env));
        }

        let ndk_dir = home.join("Android/sdk/ndk");
        if !ndk_dir.exists() {
            return None;
        }

        // Find the highest version
        let versions = fs::read_dir(ndk_dir.clone());
        if versions.is_err() {
            return None;
        }

        let version = versions
            .unwrap()
            .filter_map(Result::ok)
            .filter_map(|dir| dir.file_name().to_str().map(ToOwned::to_owned))
            .filter_map(|dir| semver::Version::parse(&dir).ok())
            .max_by(semver::Version::cmp);

        version.as_ref()?;

        let version = version.unwrap();
        Some(ndk_dir.join(version.to_string()))
    }();

    if let Some(ndk_dir) = ndk_dir {
        let llvm_dir = if host_os == Some("linux") {
            "linux-x86_64"
        } else if host_os == Some("darwin") {
            "darwin-x86_64"
        } else if host_os == Some("windows") {
            "windows-x86_64"
        } else {
            return Err(anyhow!("Unsupported host OS"));
        };

        Ok(ndk_dir.join(format!("toolchains/llvm/prebuilt/{}", llvm_dir)))
    } else {
        Err(anyhow!("Android NDK not found, please set ANDROID_NDK_HOME to your NDK path"))
    }
}

fn host_os() -> Option<&'static str> {
    let host = env::var("HOST").unwrap();
    if host.contains("darwin") {
        Some("darwin")
    } else if host.contains("linux") {
        Some("linux")
    } else if host.contains("windows") {
        Some("windows")
    } else {
        None
    }
}

#[cfg(test)]
mod pin_tests {
    use super::*;

    const EMPTY_SHA256: &str = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

    #[test]
    fn the_desktop_targets_are_pinned_with_full_lowercase_hashes() {
        for triple in ["linux-x64-release", "linux-arm64-release", "win-x64-release"] {
            let sha = pinned_sha256(triple).unwrap();
            assert_eq!(sha.len(), 64, "{triple}");
            assert!(sha.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)), "{triple}");
        }
        assert_eq!(pinned_sha256("mac-arm64-release"), None);
        assert_eq!(pinned_sha256("linux-x64-debug"), None);
        assert_eq!(pinned_sha256(""), None);
    }

    #[test]
    fn matching_bytes_pass_and_any_change_fails() {
        verify_sha256(&b""[..], EMPTY_SHA256).unwrap();
        let abc = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
        verify_sha256(&b"abc"[..], abc).unwrap();
        // One flipped bit, one byte more, one byte less: refused.
        assert!(verify_sha256(&b"abd"[..], abc).is_err());
        assert!(verify_sha256(&b"abcd"[..], abc).is_err());
        assert!(verify_sha256(&b"ab"[..], abc).is_err());
        // The pin must be compared exactly: uppercase or truncated pins don't match.
        assert!(verify_sha256(&b"abc"[..], &abc.to_uppercase()).is_err());
        assert!(verify_sha256(&b"abc"[..], &abc[..63]).is_err());
        // Longer than one read buffer.
        let big = vec![7u8; (1 << 16) * 3 + 5];
        use sha2::{Digest, Sha256};
        let sha: String = Sha256::digest(&big).iter().map(|b| format!("{b:02x}")).collect();
        verify_sha256(&big[..], &sha).unwrap();
        let mut corrupted = big.clone();
        corrupted[(1 << 16) * 2] ^= 1;
        assert!(verify_sha256(&corrupted[..], &sha).is_err());
    }
}
