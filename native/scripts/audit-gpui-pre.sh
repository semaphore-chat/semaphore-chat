#!/usr/bin/env bash
# Supply-chain audit for the gpui-pre* snapshot crates in native/Cargo.lock.
#
#   bash native/scripts/audit-gpui-pre.sh
#
# What it does: reads every gpui-pre* name and version from native/Cargo.lock, downloads
# the published .crate files to a temp directory, verifies each against the lockfile
# checksum, shallow-fetches the Zed commit the crate claims (from its
# [package.metadata.gpui-pre] zed-rev), and byte-compares every packaged source file with
# the matching Zed crate directory. Cargo-generated packaging differences are counted
# separately; every other change is listed line by line. Writes
# native/results/gpui-pre-audit.json and native/results/gpui-pre-audit.md.
#
# The host only orchestrates Docker. Everything else runs in the pinned native build
# image, which has git, curl, tar and python3. No Docker network is created, nothing is
# installed on the host, and downloaded source is only read and diffed -- never built,
# sourced or executed. The repo is mounted read-only and only native/results is written.

set -euo pipefail

NATIVE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$NATIVE_DIR/.." && pwd)"

if [ "${GPUI_PRE_AUDIT_IN_CONTAINER:-0}" != "1" ]; then
  HOST_UID="$(id -u)"
  HOST_GID="$(id -g)"
  tag="$(cat "$NATIVE_DIR/docker/Dockerfile.build" "$NATIVE_DIR/rust-toolchain.toml" \
    | { cat; echo "$HOST_UID"; } | sha256sum | cut -c1-12)"
  IMAGE="semaphore-native-build:$tag"
  if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
    echo "audit-gpui-pre: building $IMAGE (first use of this toolchain) ..." >&2
    docker build -q -f "$NATIVE_DIR/docker/Dockerfile.build" \
      --build-arg "HOST_UID=$HOST_UID" -t "$IMAGE" "$NATIVE_DIR" >/dev/null
  fi
  mkdir -p "$NATIVE_DIR/results"
  exec docker run --rm --init \
    --name "gpui-pre-audit-$$" \
    --network bridge \
    --user "$HOST_UID:$HOST_GID" \
    -e GPUI_PRE_AUDIT_IN_CONTAINER=1 \
    -e HOME=/tmp/gpui-pre-audit-home \
    -e GIT_TERMINAL_PROMPT=0 \
    -v "$ROOT:$ROOT:ro" \
    -v "$NATIVE_DIR/results:$NATIVE_DIR/results" \
    -w "$NATIVE_DIR" \
    "$IMAGE" bash "$NATIVE_DIR/scripts/audit-gpui-pre.sh" "$@"
fi

mkdir -p "$HOME"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/gpui-pre-audit.XXXXXX")"
cleanup() {
  chmod -R u+w "$WORK" 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT

mkdir -p "$WORK/tools" "$WORK/downloads/crates" "$WORK/zed"
cat > "$WORK/tools/audit.py" <<'PY'
import datetime
import difflib
import hashlib
import json
import os
import posixpath
import re
import subprocess
import sys
import tomllib

WORK = os.environ["AUDIT_WORK"]
NATIVE = os.environ["AUDIT_NATIVE"]
ROOT = os.environ["AUDIT_ROOT"]
DL = os.path.join(WORK, "downloads")
CRATE_ROOT = os.path.join(DL, "crates")
ZED = os.path.join(WORK, "zed")
ZED_REPO = "https://github.com/zed-industries/zed"
OUT_DIR = os.path.join(NATIVE, "results")
OUT_JSON = os.path.join(OUT_DIR, "gpui-pre-audit.json")
OUT_MD = os.path.join(OUT_DIR, "gpui-pre-audit.md")

# Files cargo writes into every .crate. They are packaging, not upstream source.
PACKAGING_FILES = {
    "Cargo.toml",           # cargo-normalized manifest (paths and deps rewritten)
    "Cargo.toml.orig",      # the publisher's manifest, before normalization
    "Cargo.lock",           # generated at package time
    ".cargo_vcs_info.json", # generated when publishing from a git checkout
    ".cargo-ok",
}

SIGNAL_PATTERNS = {
    "process_spawn": re.compile(
        r"(?:std::process|process::Command|Command::new|\.spawn\(|\bfork\s*\(|"
        r"\bexecv|/bin/(?:sh|bash)\b|\bsystem\s*\()"
    ),
    "network": re.compile(
        r"(?:TcpStream|TcpListener|UdpSocket|std::net|reqwest|hyper::|libcurl|"
        r"\bcurl\b|https?://|WebSocket|socket2?::|getaddrinfo)"
    ),
    "unsafe": re.compile(r"\bunsafe\b"),
    "proc_macro": re.compile(r"\bproc_macro\b|proc-macro"),
    "dynamic_loading": re.compile(r"libloading|dlopen|dlsym|LoadLibrary"),
}


class AuditError(Exception):
    pass


def run(args, cwd=None, check=True):
    proc = subprocess.run(
        args, cwd=cwd, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE
    )
    if check and proc.returncode != 0:
        raise AuditError(
            "command failed (%d): %s\n%s"
            % (proc.returncode, " ".join(args), proc.stderr.strip())
        )
    return proc


def git(*args, check=True):
    return run(["git", "-C", ZED, *args], check=check)


def git_blob(commit, path):
    """Read a blob by path from the fetched commit, outside the sparse checkout."""
    proc = subprocess.run(
        ["git", "-C", ZED, "cat-file", "blob", "%s:%s" % (commit, path)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if proc.returncode != 0:
        raise AuditError(
            "cannot read %s at %s: %s"
            % (path, commit, proc.stderr.decode("utf-8", "replace").strip())
        )
    return proc.stdout


def resolve_repo_symlink(zed_path, rel, target):
    """Resolve a Zed symlink to a repo-relative path, or None if it escapes."""
    if os.path.isabs(target):
        return None
    link_path = posixpath.join(zed_path, rel)
    resolved = posixpath.normpath(
        posixpath.join(posixpath.dirname(link_path), target)
    )
    if resolved == ".." or resolved.startswith("../"):
        return None
    return resolved


def nested_package_dir(zed_files, rel):
    """The nested workspace member containing rel, if there is one."""
    parts = rel.split("/")
    for index in range(1, len(parts)):
        prefix = "/".join(parts[:index])
        if prefix + "/Cargo.toml" in zed_files:
            return prefix
    return None


def dependency_keys(manifest):
    """Dependency table keys, including target-specific tables.

    Dev-dependencies are excluded on purpose: cargo removes them when publishing, so
    their absence only reflects packaging. Dependency renames keep the table key, so a
    key present on one side only is a real dependency-set change, not a rename.
    """
    keys = set()
    for table in ("dependencies", "build-dependencies"):
        keys.update(manifest.get(table, {}))
    for target in manifest.get("target", {}).values():
        for table in ("dependencies", "build-dependencies"):
            keys.update(target.get(table, {}))
    return keys


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_toml(path):
    with open(path, "rb") as fh:
        return tomllib.load(fh)


def read_bytes(path):
    if os.path.islink(path):
        return ("symlink", os.readlink(path))
    with open(path, "rb") as fh:
        return ("file", fh.read())


def walk_files(root):
    """Relative posix path -> absolute path. Does not follow symlinks."""
    found = {}
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        dirnames.sort()
        for name in list(dirnames):
            full = os.path.join(dirpath, name)
            if os.path.islink(full):
                found[os.path.relpath(full, root).replace(os.sep, "/")] = full
                dirnames.remove(name)
        for name in sorted(filenames):
            full = os.path.join(dirpath, name)
            found[os.path.relpath(full, root).replace(os.sep, "/")] = full
    return found


def is_binary(data):
    return b"\x00" in data[:8192]


def decode_text(data):
    try:
        return data.decode("utf-8"), None
    except UnicodeDecodeError:
        return None, "not valid UTF-8"


def signals_for(rel, changed_text):
    signals = set()
    if os.path.basename(rel) == "build.rs":
        signals.add("build_script")
    for name, pattern in SIGNAL_PATTERNS.items():
        if pattern.search(changed_text):
            signals.add(name)
    return sorted(signals)


def line_entries(lines, start=1):
    return [{"line": index, "text": text} for index, text in enumerate(lines, start)]


def diff_lines(upstream, published):
    """Changed lines with their line numbers on each side."""
    a = upstream.splitlines()
    b = published.splitlines()
    matcher = difflib.SequenceMatcher(None, a, b, autojunk=False)
    removed = []
    added = []
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag in ("replace", "delete"):
            removed.extend(
                {"line": i + 1, "text": a[i]} for i in range(i1, i2)
            )
        if tag in ("replace", "insert"):
            added.extend({"line": j + 1, "text": b[j]} for j in range(j1, j2))
    return removed, added


def text_diff_entry(rel, upstream_bytes, published_bytes):
    upstream_text, upstream_error = decode_text(upstream_bytes)
    published_text, published_error = decode_text(published_bytes)
    if upstream_error or published_error or is_binary(upstream_bytes) or is_binary(published_bytes):
        return {
            "file": rel,
            "kind": "modified_binary",
            "upstream_sha256": hashlib.sha256(upstream_bytes).hexdigest(),
            "published_sha256": hashlib.sha256(published_bytes).hexdigest(),
            "upstream_bytes": len(upstream_bytes),
            "published_bytes": len(published_bytes),
            "signals": ["binary_changed"],
        }
    removed, added = diff_lines(upstream_text, published_text)
    if not removed and not added:
        # Bytes differ but no line does, e.g. a trailing newline or line endings.
        return {
            "file": rel,
            "kind": "modified_bytes",
            "detail": "bytes differ but no line does (trailing newline or encoding)",
            "upstream_sha256": hashlib.sha256(upstream_bytes).hexdigest(),
            "published_sha256": hashlib.sha256(published_bytes).hexdigest(),
            "upstream_bytes": len(upstream_bytes),
            "published_bytes": len(published_bytes),
            "signals": ["bytes_changed"],
        }
    changed_text = "\n".join(
        [entry["text"] for entry in removed] + [entry["text"] for entry in added]
    )
    return {
        "file": rel,
        "kind": "modified",
        "lines_removed": len(removed),
        "lines_added": len(added),
        "removed_lines": removed,
        "added_lines": added,
        "signals": signals_for(rel, changed_text),
    }


def added_file_entry(rel, path, zed_root, commit):
    kind, payload = read_bytes(path)
    if kind == "symlink":
        return {
            "file": rel,
            "kind": "added_symlink",
            "target": payload,
            "signals": ["added_file", "symlink"],
        }
    data = payload
    if is_binary(data):
        entry = {
            "file": rel,
            "kind": "added_binary",
            "sha256": hashlib.sha256(data).hexdigest(),
            "bytes": len(data),
            "signals": ["added_file", "binary_added"],
        }
    else:
        text, error = decode_text(data)
        if error:
            entry = {
                "file": rel,
                "kind": "added_binary",
                "sha256": hashlib.sha256(data).hexdigest(),
                "bytes": len(data),
                "signals": ["added_file", "binary_added"],
            }
        else:
            added = line_entries(text.splitlines())
            entry = {
                "file": rel,
                "kind": "added_file",
                "lines_added": len(added),
                "lines_removed": 0,
                "added_lines": added,
                "removed_lines": [],
                "signals": signals_for(rel, text),
            }
            entry["signals"] = sorted(set(entry["signals"]) | {"added_file"})
    # A vendored copy is easier to judge when we say whether it is an unmodified copy of
    # the same file in the Zed checkout.
    if rel.startswith("vendor/"):
        upstream_rel = rel[len("vendor/"):]
        upstream_path = os.path.join(ZED, "crates", upstream_rel)
        if os.path.isfile(upstream_path):
            up_kind, up_payload = read_bytes(upstream_path)
            if up_kind == "file":
                entry["vendor_upstream_path"] = "crates/" + upstream_rel
                entry["vendor_same_as_upstream"] = up_payload == data
    return entry


def omission_reason(zed_manifest, rel):
    """Why cargo may legitimately leave a Zed file out of the published package."""
    if not zed_manifest:
        return None
    package = zed_manifest.get("package", {})
    checks = (
        ("examples/", "autoexamples", "example", "[[example]]"),
        ("tests/", "autotests", "test", "[[test]]"),
        ("benches/", "autobenches", "bench", "[[bench]]"),
    )
    for prefix, flag, table, label in checks:
        if not rel.startswith(prefix):
            continue
        if package.get(flag, True) is False:
            declared = {
                target.get("path")
                for target in zed_manifest.get(table, [])
                if isinstance(target, dict)
            }
            if rel not in declared:
                return (
                    "%s = false in the Zed manifest and no %s target names this path"
                    % (flag, label)
                )
    return None


def packaging_entry(rel, pkg_root, manifest, vcs_info):
    if rel == "Cargo.toml":
        lib = manifest.get("lib", {})
        package = manifest.get("package", {})
        return {
            "file": rel,
            "kind": "cargo_manifest_rewrite",
            "detail": (
                "cargo-normalized manifest for package %s %s; workspace paths and "
                "dependency packages renamed for the snapshot"
                % (package.get("name"), package.get("version"))
            ),
            "build_script": package.get("build"),
            "lib_proc_macro": bool(lib.get("proc-macro")),
        }
    if rel == "Cargo.toml.orig":
        return {
            "file": rel,
            "kind": "cargo_manifest_orig",
            "detail": "publisher manifest as packaged by cargo, before normalization",
        }
    if rel == "Cargo.lock":
        return {
            "file": rel,
            "kind": "cargo_generated_lockfile",
            "detail": "generated at package time; the Zed crate directory has no lockfile",
        }
    if rel == ".cargo_vcs_info.json":
        detail = "generated by cargo when publishing from git"
        if vcs_info:
            detail += "; git sha1=%s dirty=%s path_in_vcs=%s" % (
                vcs_info.get("sha1"),
                vcs_info.get("dirty"),
                vcs_info.get("path_in_vcs"),
            )
        return {"file": rel, "kind": "cargo_vcs_info", "detail": detail}
    return {"file": rel, "kind": "cargo_artifact", "detail": "cargo packaging artifact"}


def tree_paths(commit):
    out = git("ls-tree", "-r", "--name-only", commit, "crates/").stdout
    return set(out.splitlines())


def resolve_zed_dir(commit, zed_crate, all_paths):
    suffix = "/%s/Cargo.toml" % zed_crate
    candidates = sorted(
        path[: -len("/Cargo.toml")]
        for path in all_paths
        if path.endswith(suffix)
    )
    if not candidates:
        return None
    # Prefer crates/<name> then the shallowest nested member.
    candidates.sort(key=lambda path: (path.count("/"), len(path)))
    return candidates[0]


def compare_crate(crate, pkg_root, zed_path, commit):
    zed_root = os.path.join(ZED, zed_path)
    crate["zed_commit"] = commit
    crate["zed_path"] = zed_path
    pack_files = walk_files(pkg_root)
    zed_files = walk_files(zed_root)
    manifest = read_toml(os.path.join(pkg_root, "Cargo.toml"))
    vcs_info = crate.get("vcs_info")
    zed_manifest = read_toml(os.path.join(zed_root, "Cargo.toml"))

    added_deps = sorted(dependency_keys(manifest) - dependency_keys(zed_manifest))
    removed_deps = sorted(dependency_keys(zed_manifest) - dependency_keys(manifest))
    if added_deps or removed_deps:
        crate["unexpected_diffs"].append(
            {
                "file": "Cargo.toml",
                "kind": "dependency_set_changed",
                "added_dependencies": added_deps,
                "removed_dependencies": removed_deps,
                "detail": "dependency table keys differ from the Zed manifest; renames "
                "keep their key and dev-dependencies are stripped by cargo when "
                "publishing, so neither explains this",
                "signals": (["new_dependency"] if added_deps else [])
                + (["removed_dependency"] if removed_deps else []),
            }
        )

    for rel in sorted(PACKAGING_FILES):
        if rel in pack_files:
            crate["expected_diffs"].append(
                packaging_entry(rel, pkg_root, manifest, vcs_info)
            )

    compared = 0
    for rel in sorted(pack_files):
        if rel in PACKAGING_FILES:
            continue
        full = pack_files[rel]
        upstream = zed_files.get(rel)
        if upstream is None:
            crate["unexpected_diffs"].append(
                added_file_entry(rel, full, zed_root, commit)
            )
            continue
        up_kind, up_payload = read_bytes(upstream)
        pub_kind, pub_payload = read_bytes(full)
        compared += 1
        if up_kind == pub_kind and up_payload == pub_payload:
            continue
        if up_kind == "symlink" and pub_kind == "file":
            # Cargo dereferences symlinks while packaging. Compare the packaged file
            # with the blob the symlink names instead of calling the shape a change.
            resolved = resolve_repo_symlink(zed_path, rel, up_payload)
            if resolved is None:
                crate["unexpected_diffs"].append(
                    {
                        "file": rel,
                        "kind": "symlink_outside_repo",
                        "detail": "Zed symlink %s -> %s does not resolve inside the repository"
                        % (rel, up_payload),
                        "signals": ["symlink"],
                    }
                )
                continue
            try:
                target_bytes = git_blob(commit, resolved)
            except AuditError as error:
                crate["unexpected_diffs"].append(
                    {
                        "file": rel,
                        "kind": "symlink_target_unreadable",
                        "detail": str(error),
                        "signals": ["symlink"],
                    }
                )
                continue
            if target_bytes == pub_payload:
                crate["expected_diffs"].append(
                    {
                        "file": rel,
                        "kind": "symlink_dereferenced",
                        "detail": "Zed has a symlink to %s; cargo packages the target contents"
                        % up_payload,
                        "symlink_target": resolved,
                    }
                )
            else:
                crate["unexpected_diffs"].append(
                    text_diff_entry(rel, target_bytes, pub_payload)
                )
            continue
        if up_kind == "symlink" or pub_kind == "symlink":
            crate["unexpected_diffs"].append(
                {
                    "file": rel,
                    "kind": "symlink_changed",
                    "upstream": up_payload if up_kind == "symlink" else None,
                    "published": pub_payload if pub_kind == "symlink" else None,
                    "signals": ["symlink"],
                }
            )
            continue
        crate["unexpected_diffs"].append(
            text_diff_entry(rel, up_payload, pub_payload)
        )

    for rel in sorted(zed_files):
        if rel == "Cargo.toml" or rel in pack_files:
            continue
        reason = omission_reason(zed_manifest, rel)
        if reason:
            crate["expected_diffs"].append(
                {
                    "file": rel,
                    "kind": "omitted_from_package",
                    "detail": reason,
                }
            )
            continue
        nested = nested_package_dir(zed_files, rel)
        if nested:
            crate["expected_diffs"].append(
                {
                    "file": rel,
                    "kind": "nested_package_omitted",
                    "detail": "cargo packages the nested workspace member %s separately; "
                    "the parent .crate omits its files" % nested,
                }
            )
            continue
        crate["unexpected_diffs"].append(
            {
                "file": rel,
                "kind": "missing_from_package",
                "detail": "present in the Zed crate, absent from the published .crate",
            }
        )

    # Files that warrant attention even when unchanged.
    build_script = manifest.get("package", {}).get("build")
    if not build_script and "build.rs" in pack_files:
        build_script = "build.rs"
    if build_script:
        status = "missing"
        if build_script in pack_files and build_script in zed_files:
            up = read_bytes(zed_files[build_script])[1]
            pub = read_bytes(pack_files[build_script])[1]
            status = "identical" if up == pub else "modified"
        elif build_script in pack_files:
            status = "added"
        crate["notable"]["build_scripts"].append(
            {"file": build_script, "status": status}
        )
    crate["notable"]["proc_macro"] = bool(manifest.get("lib", {}).get("proc-macro"))
    crate["notable"]["zed_crate_version"] = zed_manifest.get("package", {}).get(
        "version"
    )

    crate["files_compared"] = compared
    crate["expected_diffs_count"] = len(crate["expected_diffs"])
    crate["unexpected_diffs_count"] = len(crate["unexpected_diffs"])
    crate["status"] = "compared" if compared else "error"
    if not compared:
        crate["status_detail"] = "no source file could be compared"


def main():
    with open(os.path.join(NATIVE, "Cargo.lock"), "rb") as fh:
        lock = tomllib.load(fh)
    lock_packages = [
        package
        for package in lock.get("package", [])
        if package["name"] == "gpui-pre" or package["name"].startswith("gpui-pre-")
    ]
    if not lock_packages:
        raise AuditError("no gpui-pre* packages in native/Cargo.lock")

    crates = []
    for package in lock_packages:
        name = package["name"]
        version = package["version"]
        record = {
            "name": name,
            "version": version,
            "checksum": {
                "expected": package.get("checksum"),
                "actual": None,
                "verified": False,
            },
            "claimed_commit": None,
            "claimed_commit_source": None,
            "zed_crate": None,
            "zed_version": None,
            "vcs_info": None,
            "status": "pending",
            "status_detail": None,
            "zed_commit": None,
            "zed_path": None,
            "files_compared": 0,
            "expected_diffs_count": 0,
            "unexpected_diffs_count": 0,
            "expected_diffs": [],
            "unexpected_diffs": [],
            "notable": {"build_scripts": [], "proc_macro": False},
            "_pkg_root": None,
        }
        crates.append(record)

        crate_file = os.path.join(DL, "%s-%s.crate" % (name, version))
        url = "https://static.crates.io/crates/%s/%s-%s.crate" % (name, name, version)
        proc = run(
            [
                "curl", "-fsSL", "--retry", "3", "--connect-timeout", "20",
                "--max-time", "600", "-o", crate_file, url,
            ],
            check=False,
        )
        if proc.returncode != 0:
            record["status"] = "error"
            record["status_detail"] = "download failed: %s" % proc.stderr.strip()
            record["unexpected_diffs"].append(
                {
                    "file": "(crate)",
                    "kind": "download_failed",
                    "detail": "%s: %s" % (url, proc.stderr.strip()),
                }
            )
            record["unexpected_diffs_count"] = 1
            continue

        actual = sha256_file(crate_file)
        record["checksum"]["actual"] = actual
        record["checksum"]["verified"] = actual == record["checksum"]["expected"]
        if record["checksum"]["expected"] and not record["checksum"]["verified"]:
            record["unexpected_diffs"].append(
                {
                    "file": "(crate)",
                    "kind": "checksum_mismatch",
                    "detail": "Cargo.lock says %s, download is %s"
                    % (record["checksum"]["expected"], actual),
                }
            )

        extract_dir = os.path.join(CRATE_ROOT, name)
        os.makedirs(extract_dir)
        run(
            [
                "tar", "-xzf", crate_file, "-C", extract_dir,
                "--no-same-owner", "--no-same-permissions",
            ]
        )
        entries = [entry for entry in os.listdir(extract_dir)]
        if len(entries) != 1:
            record["status"] = "error"
            record["status_detail"] = "unexpected archive layout: %r" % entries
            continue
        pkg_root = os.path.join(extract_dir, entries[0])
        record["_pkg_root"] = pkg_root

        manifest = read_toml(os.path.join(pkg_root, "Cargo.toml"))
        package_section = manifest.get("package", {})
        if (
            package_section.get("name") != name
            or package_section.get("version") != version
        ):
            record["unexpected_diffs"].append(
                {
                    "file": "Cargo.toml",
                    "kind": "manifest_identity_mismatch",
                    "detail": "Cargo.lock has %s %s, manifest says %s %s"
                    % (
                        name,
                        version,
                        package_section.get("name"),
                        package_section.get("version"),
                    ),
                }
            )

        vcs_file = os.path.join(pkg_root, ".cargo_vcs_info.json")
        if os.path.isfile(vcs_file):
            with open(vcs_file, "r", encoding="utf-8") as fh:
                data = json.load(fh)
            git_info = data.get("git", {})
            record["vcs_info"] = {
                "sha1": git_info.get("sha1"),
                "dirty": git_info.get("dirty"),
                "path_in_vcs": data.get("path_in_vcs"),
            }

        metadata = package_section.get("metadata", {}).get("gpui-pre")
        if isinstance(metadata, dict):
            record["claimed_commit"] = metadata.get("zed-rev")
            record["claimed_commit_source"] = (
                "[package.metadata.gpui-pre] zed-rev"
            )
            record["zed_crate"] = metadata.get("zed-crate")
            record["zed_version"] = metadata.get("zed-version")

        if not record["claimed_commit"] or not record["zed_crate"]:
            record["status"] = "unmatched"
            detail = "no [package.metadata.gpui-pre] zed-rev/zed-crate in Cargo.toml"
            description = package_section.get("description")
            repository = package_section.get("repository")
            if description:
                detail += "; description=%r" % description
            if repository:
                detail += "; repository=%s" % repository
            if record["vcs_info"]:
                detail += "; .cargo_vcs_info.json sha1=%s dirty=%s path_in_vcs=%r" % (
                    record["vcs_info"].get("sha1"),
                    record["vcs_info"].get("dirty"),
                    record["vcs_info"].get("path_in_vcs"),
                )
            detail += (
                "; no Zed commit is claimed and no Zed crate can be identified, so "
                "there is nothing to compare it against"
            )
            record["status_detail"] = detail
            record["unexpected_diffs"].append(
                {"file": "(crate)", "kind": "unmatched_crate", "detail": detail}
            )
            record["unexpected_diffs_count"] = len(record["unexpected_diffs"])

    # Fetch each claimed commit once. Group crates so one shallow checkout serves all.
    groups = {}
    for record in crates:
        if record["status"] == "pending" and record["claimed_commit"]:
            groups.setdefault(record["claimed_commit"], []).append(record)

    for commit, members in sorted(groups.items()):
        if not os.path.isdir(os.path.join(ZED, ".git")):
            run(["git", "init", "-q", ZED])
        remotes = run(["git", "-C", ZED, "remote"]).stdout.split()
        if "origin" not in remotes:
            run(["git", "-C", ZED, "remote", "add", "origin", ZED_REPO])
        fetch = git(
            "fetch", "--depth", "1", "--filter=blob:none", "--no-tags",
            "origin", commit, check=False,
        )
        if fetch.returncode != 0:
            detail = "shallow fetch of %s failed: %s" % (commit, fetch.stderr.strip())
            for record in members:
                record["status"] = "error"
                record["status_detail"] = detail
                record["unexpected_diffs"].append(
                    {"file": "(crate)", "kind": "zed_fetch_failed", "detail": detail}
                )
                record["unexpected_diffs_count"] = len(record["unexpected_diffs"])
            continue
        head = git("rev-parse", "FETCH_HEAD").stdout.strip()
        if head != commit:
            detail = "fetched %s, expected %s" % (head, commit)
            for record in members:
                record["status"] = "error"
                record["status_detail"] = detail
                record["unexpected_diffs"].append(
                    {"file": "(crate)", "kind": "zed_fetch_mismatch", "detail": detail}
                )
                record["unexpected_diffs_count"] = len(record["unexpected_diffs"])
            continue

        all_paths = tree_paths(commit)
        resolved = []
        for record in members:
            zed_path = resolve_zed_dir(commit, record["zed_crate"], all_paths)
            if zed_path is None:
                detail = (
                    "no crates/**/%s/Cargo.toml at %s"
                    % (record["zed_crate"], commit)
                )
                record["status"] = "unmatched"
                record["status_detail"] = detail
                record["unexpected_diffs"].append(
                    {
                        "file": "(crate)",
                        "kind": "zed_crate_not_found",
                        "detail": detail,
                    }
                )
                record["unexpected_diffs_count"] = len(record["unexpected_diffs"])
                continue
            record["zed_path"] = zed_path
            resolved.append(record)

        if not resolved:
            continue

        dirs = sorted({record["zed_path"] for record in resolved})
        git("sparse-checkout", "init", "--cone")
        git("sparse-checkout", "set", *dirs)
        checkout = git("checkout", "-q", commit, check=False)
        if checkout.returncode != 0:
            detail = "checkout of %s failed: %s" % (commit, checkout.stderr.strip())
            for record in resolved:
                record["status"] = "error"
                record["status_detail"] = detail
                record["unexpected_diffs"].append(
                    {"file": "(crate)", "kind": "zed_checkout_failed", "detail": detail}
                )
                record["unexpected_diffs_count"] = len(record["unexpected_diffs"])
            continue

        for record in resolved:
            try:
                compare_crate(
                    record, record["_pkg_root"], record["zed_path"], commit
                )
            except Exception as error:  # one bad crate must not hide the others
                record["status"] = "error"
                record["status_detail"] = "comparison failed: %s" % error
                record["unexpected_diffs"].append(
                    {
                        "file": "(crate)",
                        "kind": "comparison_error",
                        "detail": str(error),
                    }
                )
                record["unexpected_diffs_count"] = len(record["unexpected_diffs"])

    for record in crates:
        record.pop("_pkg_root", None)
        record["expected_diffs_count"] = len(record["expected_diffs"])
        record["unexpected_diffs_count"] = len(record["unexpected_diffs"])
        if record["status"] == "pending":
            record["status"] = "error"
            record["status_detail"] = "not compared"

    signal_counts = {}
    for record in crates:
        for diff in record["unexpected_diffs"]:
            for signal in diff.get("signals", []):
                signal_counts[signal] = signal_counts.get(signal, 0) + 1

    summary = {
        "crates_in_lock": len(crates),
        "crates_compared": sum(1 for record in crates if record["status"] == "compared"),
        "crates_unmatched": sum(
            1 for record in crates if record["status"] in ("unmatched", "error")
        ),
        "files_compared": sum(record["files_compared"] for record in crates),
        "expected_diffs": sum(record["expected_diffs_count"] for record in crates),
        "unexpected_diffs": sum(
            record["unexpected_diffs_count"] for record in crates
        ),
        "unexpected_by_signal": dict(sorted(signal_counts.items())),
    }

    result = {
        "audit": "gpui-pre snapshot supply-chain audit",
        "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(
            timespec="seconds"
        ),
        "cargo_lock": os.path.relpath(os.path.join(NATIVE, "Cargo.lock"), ROOT),
        "zed_repository": ZED_REPO,
        "method": (
            "Download each published .crate from static.crates.io, verify its sha256 "
            "against Cargo.lock, extract it, shallow-fetch the claimed Zed commit "
            "(git fetch --depth 1 --filter=blob:none), sparse-checkout the matching "
            "crate directory, and byte-compare every packaged file. Cargo-generated "
            "manifest/lock/VCS files and autoexamples/autotests/autobenches omissions "
            "are counted as expected packaging; everything else is listed."
        ),
        "summary": summary,
        "crates": crates,
    }

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(OUT_JSON, "w", encoding="utf-8") as fh:
        json.dump(result, fh, indent=2)
        fh.write("\n")

    write_markdown(result)
    print(
        "audited %d crates: %d compared, %d unmatched/error, %d files, "
        "%d expected packaging diffs, %d unexpected diffs"
        % (
            summary["crates_in_lock"],
            summary["crates_compared"],
            summary["crates_unmatched"],
            summary["files_compared"],
            summary["expected_diffs"],
            summary["unexpected_diffs"],
        )
    )
    print("wrote %s" % OUT_JSON)
    print("wrote %s" % OUT_MD)


def md_escape(value):
    if value is None:
        return "(none)"
    return str(value).replace("|", "\\|")


def write_markdown(result):
    summary = result["summary"]
    lines = []
    lines.append("# gpui-pre supply-chain audit")
    lines.append("")
    lines.append("Generated %s from `%s`." % (
        result["generated_at"], result["cargo_lock"]))
    lines.append("")
    lines.append("Upstream: <%s>. Every published `.crate` was downloaded from "
                 "static.crates.io and checked against its `Cargo.lock` sha256. The "
                 "claimed Zed commit was shallow-fetched and each crate directory "
                 "byte-compared against the published source." % result["zed_repository"])
    lines.append("")
    lines.append("## Summary")
    lines.append("")
    lines.append("| Measure | Count |")
    lines.append("|---|---|")
    lines.append("| Crates in Cargo.lock | %d |" % summary["crates_in_lock"])
    lines.append("| Compared against Zed | %d |" % summary["crates_compared"])
    lines.append("| Unmatched or error | %d |" % summary["crates_unmatched"])
    lines.append("| Files compared | %d |" % summary["files_compared"])
    lines.append("| Expected packaging diffs | %d |" % summary["expected_diffs"])
    lines.append("| **Unexpected diffs** | **%d** |" % summary["unexpected_diffs"])
    lines.append("")

    lines.append("## Crates")
    lines.append("")
    lines.append("| Crate | Version | Claimed commit | Zed path | Files | Expected | Unexpected | Status |")
    lines.append("|---|---|---|---|---|---|---|---|")
    for record in result["crates"]:
        lines.append(
            "| %s | %s | %s | %s | %d | %d | %d | %s |"
            % (
                md_escape(record["name"]),
                md_escape(record["version"]),
                md_escape(record["claimed_commit"]),
                md_escape(record["zed_path"]),
                record["files_compared"],
                record["expected_diffs_count"],
                record["unexpected_diffs_count"],
                md_escape(record["status"]),
            )
        )
    lines.append("")

    unmatched = [
        record
        for record in result["crates"]
        if record["status"] in ("unmatched", "error")
    ]
    if unmatched:
        lines.append("## Crates that could not be matched")
        lines.append("")
        for record in unmatched:
            lines.append("- **%s %s** (%s): %s" % (
                record["name"], record["version"], record["status"],
                record.get("status_detail")))
        lines.append("")

    expected_by_kind = {}
    for record in result["crates"]:
        for diff in record["expected_diffs"]:
            expected_by_kind.setdefault(diff["kind"], []).append(
                "%s:%s" % (record["name"], diff["file"])
            )
    if expected_by_kind:
        lines.append("## Expected packaging changes")
        lines.append("")
        for kind in sorted(expected_by_kind):
            entries = expected_by_kind[kind]
            lines.append("- **%s**: %d" % (kind, len(entries)))
            preview = ", ".join(entries[:6])
            if len(entries) > 6:
                preview += ", ..."
            lines.append("  - %s" % preview)
        lines.append("")

    lines.append("## Unexpected differences")
    lines.append("")
    any_unexpected = False
    for record in result["crates"]:
        if not record["unexpected_diffs"]:
            continue
        any_unexpected = True
        lines.append("### %s %s" % (record["name"], record["version"]))
        lines.append("")
        lines.append(
            "- claimed Zed commit: `%s`" % md_escape(record["claimed_commit"])
        )
        lines.append("- Zed path: `%s`" % md_escape(record["zed_path"]))
        for diff in record["unexpected_diffs"]:
            lines.append("")
            lines.append(
                "- **`%s`** — %s%s"
                % (
                    diff["file"],
                    diff["kind"],
                    " — signals: " + ", ".join(diff["signals"])
                    if diff.get("signals")
                    else "",
                )
            )
            if diff.get("detail"):
                lines.append("  - %s" % diff["detail"])
            if diff.get("added_dependencies"):
                lines.append(
                    "  - added dependencies: %s"
                    % ", ".join("`%s`" % name for name in diff["added_dependencies"])
                )
            if diff.get("removed_dependencies"):
                lines.append(
                    "  - removed dependencies: %s"
                    % ", ".join("`%s`" % name for name in diff["removed_dependencies"])
                )
            if diff.get("vendor_upstream_path"):
                lines.append(
                    "  - vendored copy of `%s`; identical to upstream: %s"
                    % (
                        diff["vendor_upstream_path"],
                        diff.get("vendor_same_as_upstream"),
                    )
                )
            removed = diff.get("removed_lines") or []
            added = diff.get("added_lines") or []
            if removed or added:
                lines.append("  - removed %d line(s), added %d line(s)"
                             % (len(removed), len(added)))
                shown = 0
                lines.append("")
                lines.append("    ```diff")
                for entry in removed:
                    if shown >= 60:
                        break
                    lines.append("    -%6d %s" % (entry["line"], entry["text"]))
                    shown += 1
                for entry in added:
                    if shown >= 60:
                        break
                    lines.append("    +%6d %s" % (entry["line"], entry["text"]))
                    shown += 1
                lines.append("    ```")
                hidden = len(removed) + len(added) - shown
                if hidden > 0:
                    lines.append(
                        "    %d more changed line(s) are listed in the JSON report."
                        % hidden
                    )
        lines.append("")
    if not any_unexpected:
        lines.append("None. Every compared file matched its Zed counterpart.")
        lines.append("")

    with open(OUT_MD, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines))


if __name__ == "__main__":
    try:
        main()
    except AuditError as error:
        print("audit-gpui-pre: %s" % error, file=sys.stderr)
        sys.exit(1)
PY

AUDIT_WORK="$WORK" AUDIT_NATIVE="$NATIVE_DIR" AUDIT_ROOT="$ROOT" \
  python3 "$WORK/tools/audit.py"
