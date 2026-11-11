//! Compiles the shim against the headers of LiveKit's prebuilt libwebrtc (webrtc-sys links the
//! archive itself), and refuses, loudly, a prebuilt without the FFmpeg the player relies on.

use std::env;
use std::fs;
use std::path::Path;

/// What `shim/player.c` decodes and demuxes with. All of it is in Chromium's "Chrome" FFmpeg
/// configuration, which LiveKit's build selects with `ffmpeg_branding = "Chrome"`.
const COMPONENTS: &[&str] = &[
    "CONFIG_MOV_DEMUXER",
    "CONFIG_MATROSKA_DEMUXER",
    "CONFIG_OGG_DEMUXER",
    "CONFIG_WAV_DEMUXER",
    "CONFIG_MP3_DEMUXER",
    "CONFIG_FLAC_DEMUXER",
    "CONFIG_H264_DECODER",
    "CONFIG_AAC_DECODER",
    "CONFIG_MP3_DECODER",
    "CONFIG_VORBIS_DECODER",
    "CONFIG_LIBOPUS_DECODER",
    "CONFIG_FLAC_DECODER",
    "CONFIG_PCM_S16LE_DECODER",
];

/// `args.gn` lines without which libwebrtc carries no FFmpeg at all (Chromium builds its FFmpeg
/// only for the H.264 decoder) or only the Chromium-branded one (no H.264, no AAC).
const ARGS: &[&str] = &["rtc_use_h264 = true", "ffmpeg_branding = \"Chrome\""];

fn main() {
    println!("cargo:rerun-if-changed=shim");
    println!("cargo:rerun-if-env-changed=LK_CUSTOM_WEBRTC");
    // scripts/check-webrtc-windows.sh type-checks Rust with no prebuilt; webrtc-sys skips too.
    if env::var_os("DOCS_RS").is_some() {
        return;
    }

    let os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let arch = env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default();
    let platform = match os.as_str() {
        "linux" => "linux",
        "windows" => "win",
        other => fail(&format!(
            "target OS `{other}` is not supported: LiveKit's libwebrtc carries FFmpeg on Linux and \
             Windows only (Android builds with rtc_use_h264 = false); mobile uses platform players"
        )),
    };
    let cpu = match arch.as_str() {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        other => fail(&format!("target arch `{other}` is not supported")),
    };

    let dir = webrtc_sys_build::webrtc_dir();
    if !dir.exists() {
        // Locked and idempotent: the same call webrtc-sys's build script makes.
        if let Err(error) = webrtc_sys_build::download_webrtc() {
            fail(&format!("cannot download libwebrtc: {error:#}"));
        }
    }

    let args_gn = dir.join("args.gn");
    let args = read(&args_gn);
    for want in ARGS {
        if !args.lines().any(|line| line.trim() == *want) {
            fail(&format!(
                "{} has no `{want}`, so its libwebrtc has no FFmpeg the player can use. LiveKit \
                 changed its build: see docs/player.md before going further",
                args_gn.display()
            ));
        }
    }

    let include = dir.join("include");
    let config = include.join(format!(
        "third_party/ffmpeg/chromium/config/Chrome/{platform}/{cpu}"
    ));
    let components_h = config.join("config_components.h");
    let components = read(&components_h);
    for name in COMPONENTS {
        let line = format!("#define {name} 1");
        if !components.lines().any(|l| l.trim() == line) {
            fail(&format!(
                "{} lacks `{line}`: LiveKit's FFmpeg configuration changed, see docs/player.md",
                components_h.display()
            ));
        }
    }

    let mut build = cc::Build::new();
    build
        .file("shim/player.c")
        .include("shim")
        .include(include.join("third_party/ffmpeg"))
        .include(&config)
        .include(include.join("third_party/libvpx/source/libvpx"))
        .include(include.join("third_party/dav1d/libdav1d/include"));
    if os == "linux" {
        // LiveKit renames FFmpeg's symbols on Linux only: shim/lk_prefix.h.
        build.define("SP_LK_PREFIX", None);
    }
    if env::var_os("CARGO_FEATURE_AAC").is_some() {
        build.define("SP_ENABLE_AAC", None);
    }
    build.compile("semaphore_player_shim");
}

fn read(path: &Path) -> String {
    fs::read_to_string(path)
        .unwrap_or_else(|error| fail(&format!("cannot read {}: {error}", path.display())))
}

fn fail(message: &str) -> ! {
    panic!("\n\nsemaphore-player: {message}\n\n");
}
