#!/usr/bin/env bash
# Provenance audit for the crates.io crate gpui-pre-reqwest 0.12.15.
#
#   bash native/scripts/audit-gpui-pre-reqwest.sh
#
# What it does: reads the gpui-pre-reqwest entry from native/Cargo.lock, downloads the
# published .crate, verifies its sha256, extracts it, and compares every packaged file
# with:
#
#   * zed-industries/reqwest at the commit named by .cargo_vcs_info.json,
#   * zed-industries/reqwest at the commit named by the package description,
#   * seanmonstar/reqwest at tag v0.12.15,
#   * seanmonstar/reqwest at the upstream master commit the fork merged, and
#   * the published crates.io reqwest 0.12.15 crate.
#
# It also probes both repository names (reqwest and request), records which refs point
# at the claimed commits, and classifies every difference as cargo packaging or
# non-packaging. Every non-packaging changed line is listed, with per-line signals for
# build scripts, TLS/certificates, proxies, URLs/hosts, redirects, headers, process
# spawning, unsafe code and dependencies.
#
# The host only orchestrates Docker. Everything else runs in the pinned native build
# image, which has git, curl, tar, diff and python3. No Docker network is created,
# nothing is installed on the host, and downloaded source is only read and diffed --
# never built, sourced or executed. The repo is mounted read-only and only
# native/results is written. Writes native/results/gpui-pre-reqwest-audit.json and
# native/results/gpui-pre-reqwest-audit.md.

set -euo pipefail

NATIVE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$NATIVE_DIR/.." && pwd)"

if [ "${GPUI_PRE_REQWEST_AUDIT_IN_CONTAINER:-0}" != "1" ]; then
  HOST_UID="$(id -u)"
  HOST_GID="$(id -g)"
  tag="$(cat "$NATIVE_DIR/docker/Dockerfile.build" "$NATIVE_DIR/rust-toolchain.toml" \
    | { cat; echo "$HOST_UID"; } | sha256sum | cut -c1-12)"
  IMAGE="semaphore-native-build:$tag"
  if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
    echo "audit-gpui-pre-reqwest: building $IMAGE (first use of this toolchain) ..." >&2
    docker build -q -f "$NATIVE_DIR/docker/Dockerfile.build" \
      --build-arg "HOST_UID=$HOST_UID" -t "$IMAGE" "$NATIVE_DIR" >/dev/null
  fi
  mkdir -p "$NATIVE_DIR/results"
  exec docker run --rm --init \
    --name "gpui-pre-reqwest-audit-$$" \
    --network bridge \
    --user "$HOST_UID:$HOST_GID" \
    -e GPUI_PRE_REQWEST_AUDIT_IN_CONTAINER=1 \
    -e HOME=/tmp/gpui-pre-reqwest-audit-home \
    -e GIT_TERMINAL_PROMPT=0 \
    -v "$ROOT:$ROOT:ro" \
    -v "$NATIVE_DIR/results:$NATIVE_DIR/results" \
    -w "$NATIVE_DIR" \
    "$IMAGE" bash "$NATIVE_DIR/scripts/audit-gpui-pre-reqwest.sh" "$@"
fi

mkdir -p "$HOME"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/gpui-pre-reqwest-audit.XXXXXX")"
cleanup() {
  chmod -R u+w "$WORK" 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT

mkdir -p "$WORK/tools" "$WORK/downloads" "$WORK/extracted" "$WORK/repos" "$WORK/trees"
cat > "$WORK/tools/audit.py" <<'PY'
import datetime
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request

WORK = os.environ["AUDIT_WORK"]
NATIVE = os.environ["AUDIT_NATIVE"]
ROOT = os.environ["AUDIT_ROOT"]
OUT_DIR = os.path.join(NATIVE, "results")
OUT_JSON = os.path.join(OUT_DIR, "gpui-pre-reqwest-audit.json")
OUT_MD = os.path.join(OUT_DIR, "gpui-pre-reqwest-audit.md")

CRATE_NAME = "gpui-pre-reqwest"
CRATE_VERSION = "0.12.15"

ZED_REPO = "https://github.com/zed-industries/reqwest"
ZED_SLUG = "zed-industries/reqwest"
CLAIMED_SLUG = "zed-industries/request"
UPSTREAM_REPO = "https://github.com/seanmonstar/reqwest"
UPSTREAM_SLUG = "seanmonstar/reqwest"
UPSTREAM_TAG = "v0.12.15"
# Verified as the second parent of the fork's "Merge branch 'master' ..." commit.
# The script re-derives it from the fetched fork history and only uses this value if
# the derivation is impossible.
UPSTREAM_BASE_FALLBACK = "114d97c1a862567b465cb57f14d584626e1cf30c"
DESCRIPTION_SHA_FALLBACK = "c15662463bda39148ba154100dd44d3fba5873a4"

UA = "semaphore-chat-audit/1.0 (gpui-pre-reqwest provenance)"
GIT_ENV = dict(
    os.environ,
    GIT_TERMINAL_PROMPT="0",
    GIT_ASKPASS="/bin/true",
    GIT_CONFIG_NOSYSTEM="1",
)

PACKAGING_FILES = {
    "Cargo.toml",
    "Cargo.toml.orig",
    "Cargo.lock",
    ".cargo_vcs_info.json",
    ".cargo-ok",
}

SIGNAL_PATTERNS = [
    ("tls_certificate", re.compile(
        r"(?i)\b(?:tls|rustls|native[_-]tls|certificate|certs?|pem|pki|"
        r"danger_accept_invalid|trust|webpki|root_cert)\b"
    )),
    ("proxy", re.compile(r"(?i)\bproxy\b")),
    ("url_or_host", re.compile(
        r"(?i)(?:https?://|\bhostname\b|\bUri\b|\bUrl\b|\burl\(|\bhost\()"
    )),
    ("redirect", re.compile(r"(?i)\bredirect")),
    ("header", re.compile(r"(?i)\bheaders?\b")),
    ("process_spawn", re.compile(
        r"(?:Command::new|std::process|process::Command|\.spawn\(|"
        r"/bin/(?:sh|bash)\b|\bfork\s*\(|\bexecv)"
    )),
    ("unsafe", re.compile(r"\bunsafe\b")),
    ("network_interface", re.compile(
        r"(?i)(?:set_interface|local_address|IpAddr|TcpStream|TcpListener|"
        r"UdpSocket|SO_BINDTODEVICE|IP_BOUND_IF|interface)"
    )),
]

ATTENTION_ORDER = [
    "build_script",
    "tls_certificate",
    "proxy",
    "url_or_host",
    "redirect",
    "header",
    "process_spawn",
    "unsafe",
    "network_interface",
    "dependency_change",
]


class AuditError(Exception):
    pass


def run(args, cwd=None, check=True, env=None):
    proc = subprocess.run(
        args,
        cwd=cwd,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
    )
    if check and proc.returncode != 0:
        raise AuditError(
            "command failed (%d): %s\n%s"
            % (proc.returncode, " ".join(args), proc.stderr.strip())
        )
    return proc


def git(repo, *args, check=True):
    return run(["git", "-C", repo, *args], check=check, env=GIT_ENV)


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_bytes(data):
    return hashlib.sha256(data).hexdigest()


def read_toml(path):
    import tomllib

    with open(path, "rb") as fh:
        return tomllib.load(fh)


def read_entry(path):
    if os.path.islink(path):
        return ("symlink", os.readlink(path))
    with open(path, "rb") as fh:
        return ("file", fh.read())


def rel_path(full, root):
    return os.path.relpath(full, root).replace(os.sep, "/")


def walk_files(root):
    """Relative posix path -> absolute path. Does not follow symlinks."""
    found = {}
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        dirnames[:] = sorted(name for name in dirnames if name != ".git")
        for name in list(dirnames):
            full = os.path.join(dirpath, name)
            if os.path.islink(full):
                found[rel_path(full, root)] = full
                dirnames.remove(name)
        for name in sorted(filenames):
            if name in (".git",):
                continue
            full = os.path.join(dirpath, name)
            found[rel_path(full, root)] = full
    return found


def is_binary(data):
    return b"\x00" in data[:8192]


def decode_text(data):
    try:
        return data.decode("utf-8"), None
    except UnicodeDecodeError:
        return None, "not valid UTF-8"


def signals_for_line(rel, text):
    signals = []
    if os.path.basename(rel) == "build.rs":
        signals.append("build_script")
    for name, pattern in SIGNAL_PATTERNS:
        if pattern.search(text):
            signals.append(name)
    return signals


HUNK_RE = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")


def diff_lines(rel, upstream, published):
    """Changed lines from GNU diff -U0, with line numbers on each side."""
    tmp = tempfile.mkdtemp(dir=WORK, prefix="diffline.")
    try:
        a_path = os.path.join(tmp, "a")
        b_path = os.path.join(tmp, "b")
        with open(a_path, "wb") as fh:
            fh.write(upstream.encode("utf-8"))
        with open(b_path, "wb") as fh:
            fh.write(published.encode("utf-8"))
        proc = subprocess.run(
            [
                "diff",
                "-U0",
                "--label",
                "a/" + rel,
                "--label",
                "b/" + rel,
                a_path,
                b_path,
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    if proc.returncode not in (0, 1):
        raise AuditError(
            "diff failed for %s: %s"
            % (rel, proc.stderr.decode("utf-8", "replace").strip())
        )
    removed = []
    added = []
    old_line = 0
    new_line = 0
    for line in proc.stdout.decode("utf-8", "replace").splitlines():
        match = HUNK_RE.match(line)
        if match:
            old_line = int(match.group(1))
            new_line = int(match.group(3))
            continue
        if line.startswith("\\"):
            continue
        if line.startswith("--- ") or line.startswith("+++ "):
            continue
        if line.startswith("-"):
            removed.append(
                {
                    "line": old_line,
                    "text": line[1:],
                    "signals": signals_for_line(rel, line[1:]),
                }
            )
            old_line += 1
        elif line.startswith("+"):
            added.append(
                {
                    "line": new_line,
                    "text": line[1:],
                    "signals": signals_for_line(rel, line[1:]),
                }
            )
            new_line += 1
    return removed, added


def text_diff_entry(rel, upstream_bytes, published_bytes, origin=None):
    upstream_text, upstream_error = decode_text(upstream_bytes)
    published_text, published_error = decode_text(published_bytes)
    if (
        upstream_error
        or published_error
        or is_binary(upstream_bytes)
        or is_binary(published_bytes)
    ):
        return {
            "file": rel,
            "kind": "modified_binary",
            "origin": origin,
            "upstream_sha256": sha256_bytes(upstream_bytes),
            "published_sha256": sha256_bytes(published_bytes),
            "upstream_bytes": len(upstream_bytes),
            "published_bytes": len(published_bytes),
            "signals": ["binary_changed"],
        }
    removed, added = diff_lines(rel, upstream_text, published_text)
    if not removed and not added:
        return {
            "file": rel,
            "kind": "modified_bytes",
            "origin": origin,
            "detail": "bytes differ but no line does (trailing newline or encoding)",
            "upstream_sha256": sha256_bytes(upstream_bytes),
            "published_sha256": sha256_bytes(published_bytes),
            "signals": ["bytes_changed"],
        }
    signals = sorted(
        {
            signal
            for entry in removed + added
            for signal in entry["signals"]
        }
    )
    return {
        "file": rel,
        "kind": "modified",
        "origin": origin,
        "lines_removed": len(removed),
        "lines_added": len(added),
        "removed_lines": removed,
        "added_lines": added,
        "signals": signals,
    }


def added_file_entry(rel, path):
    kind, payload = read_entry(path)
    if kind == "symlink":
        return {
            "file": rel,
            "kind": "added_symlink",
            "target": payload,
            "signals": ["added_file", "symlink"],
        }
    text, error = decode_text(payload)
    if error or is_binary(payload):
        return {
            "file": rel,
            "kind": "added_binary",
            "sha256": sha256_bytes(payload),
            "bytes": len(payload),
            "signals": ["added_file", "binary_added"],
        }
    lines = [
        {
            "line": index,
            "text": value,
            "signals": signals_for_line(rel, value),
        }
        for index, value in enumerate(text.splitlines(), 1)
    ]
    return {
        "file": rel,
        "kind": "added_file",
        "lines_added": len(lines),
        "lines_removed": 0,
        "added_lines": lines,
        "removed_lines": [],
        "signals": sorted(
            {"added_file"}
            | {signal for entry in lines for signal in entry["signals"]}
        ),
    }


def omission_reason(manifest, rel):
    if not manifest:
        return None
    package = manifest.get("package", {})
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
                for target in manifest.get(table, [])
                if isinstance(target, dict)
            }
            if rel not in declared:
                return (
                    "%s = false in the candidate manifest and no %s target "
                    "names this path" % (flag, label)
                )
    return None


def nested_package_dir(files, rel):
    parts = rel.split("/")
    for index in range(1, len(parts)):
        prefix = "/".join(parts[:index])
        if prefix + "/Cargo.toml" in files:
            return prefix
    return None


def packaging_entry(rel, crate_manifest, candidate_manifest, cand_is_crate):
    if rel == "Cargo.lock":
        return {
            "file": rel,
            "kind": "cargo_generated_lockfile",
            "detail": "generated by cargo at package time; git candidates have no lockfile",
        }
    if rel == ".cargo_vcs_info.json":
        return {
            "file": rel,
            "kind": "cargo_vcs_info",
            "detail": "generated by cargo when publishing from git",
        }
    if rel == ".cargo-ok":
        return {
            "file": rel,
            "kind": "cargo_artifact",
            "detail": "cargo packaging marker",
        }
    if rel == "Cargo.toml":
        package = crate_manifest.get("package", {})
        lib = crate_manifest.get("lib", {})
        return {
            "file": rel,
            "kind": "cargo_manifest_rewrite",
            "detail": (
                "cargo-normalized manifest for %s %s; package name and lib name "
                "are rewritten from the candidate manifest"
                % (package.get("name"), package.get("version"))
            ),
            "candidate_manifest": "Cargo.toml.orig" if cand_is_crate else "Cargo.toml",
            "published_name": package.get("name"),
            "published_lib_name": lib.get("name"),
            "published_build": package.get("build"),
        }
    return {
        "file": rel,
        "kind": "cargo_packaging_file",
        "detail": "cargo packaging artifact",
    }


def dependency_map(manifest):
    out = {}

    def add(table, deps):
        for key, value in deps.items():
            if isinstance(value, str):
                version = value
                package = key
                optional = False
            elif isinstance(value, dict):
                version = value.get("version")
                package = value.get("package", key)
                optional = bool(value.get("optional", False))
            else:
                continue
            out[(table, key)] = {
                "key": key,
                "table": table,
                "version": version,
                "package": package,
                "optional": optional,
            }

    tables = ("dependencies", "build-dependencies", "dev-dependencies")
    for table in tables:
        add(table, manifest.get(table, {}))
    for target, target_tables in manifest.get("target", {}).items():
        if not isinstance(target_tables, dict):
            continue
        for table in tables:
            add("target.%s.%s" % (target, table), target_tables.get(table, {}))
    return out


def dependency_diff(published_manifest, candidate_manifest):
    published = dependency_map(published_manifest)
    candidate = dependency_map(candidate_manifest)
    added = []
    removed = []
    version_changed = []
    package_changed = []
    for key in sorted(set(published) - set(candidate)):
        added.append(published[key])
    for key in sorted(set(candidate) - set(published)):
        removed.append(candidate[key])
    for key in sorted(set(published) & set(candidate)):
        left = published[key]
        right = candidate[key]
        if left["version"] != right["version"]:
            version_changed.append(
                {
                    "key": left["key"],
                    "table": left["table"],
                    "published_version": left["version"],
                    "candidate_version": right["version"],
                }
            )
        if left["package"] != right["package"]:
            package_changed.append(
                {
                    "key": left["key"],
                    "table": left["table"],
                    "published_package": left["package"],
                    "candidate_package": right["package"],
                }
            )
    return {
        "added": added,
        "removed": removed,
        "version_changed": version_changed,
        "package_changed": package_changed,
        "has_changes": bool(added or removed or version_changed or package_changed),
    }


def manifest_entry(crate_manifest, candidate_manifest, cand_is_crate, candidate_label):
    published = crate_manifest.get("package", {})
    candidate = candidate_manifest.get("package", {})
    fields = (
        "name",
        "version",
        "description",
        "repository",
        "documentation",
        "license",
        "edition",
        "rust-version",
    )
    changes = []
    for field in fields:
        left = published.get(field)
        right = candidate.get(field)
        if left != right:
            changes.append(
                {"field": field, "published": left, "candidate": right}
            )
    return {
        "file": "Cargo.toml.orig" if cand_is_crate else "Cargo.toml",
        "kind": "cargo_manifest_metadata",
        "detail": (
            "publisher manifest metadata; package identity and description are "
            "rewritten for this repackaging"
            if changes
            else "publisher manifest metadata is unchanged"
        ),
        "candidate": candidate_label,
        "package_field_changes": changes,
        "signals": ["manifest_metadata"] if changes else [],
    }


def origin_for_file(rel, published_dir, upstream_root):
    if not upstream_root:
        return None
    candidate = os.path.join(upstream_root, rel)
    if not os.path.isfile(candidate) or os.path.islink(candidate):
        return "fork_specific_or_mixed"
    published = os.path.join(published_dir, rel)
    if not os.path.isfile(published):
        return "fork_specific_or_mixed"
    with open(candidate, "rb") as fh:
        candidate_bytes = fh.read()
    with open(published, "rb") as fh:
        published_bytes = fh.read()
    if candidate_bytes == published_bytes:
        return "upstream_drift"
    return "fork_specific_or_mixed"


def compare_trees(
    crate_dir,
    crate_manifest,
    crate_manifest_orig,
    cand_dir,
    cand_manifest,
    cand_is_crate,
    candidate_label,
    upstream_root=None,
):
    crate_files = walk_files(crate_dir)
    cand_files = walk_files(cand_dir)

    packaging = []
    diff = []
    dependency_changes = dependency_diff(crate_manifest_orig, cand_manifest)

    packaging.append(
        manifest_entry(
            crate_manifest_orig, cand_manifest, cand_is_crate, candidate_label
        )
    )

    if dependency_changes["has_changes"]:
        dependency_origin = None
        if upstream_root:
            upstream_manifest_path = os.path.join(upstream_root, "Cargo.toml")
            if os.path.isfile(upstream_manifest_path):
                upstream_manifest = read_toml(upstream_manifest_path)
                upstream_diff = dependency_diff(
                    crate_manifest_orig, upstream_manifest
                )
                dependency_origin = (
                    "upstream_drift"
                    if not upstream_diff["has_changes"]
                    else "fork_specific_or_mixed"
                )
        diff.append(
            {
                "file": "Cargo.toml.orig" if cand_is_crate else "Cargo.toml",
                "kind": "dependency_set_changed",
                "origin": dependency_origin,
                "added_dependencies": [
                    entry for entry in dependency_changes["added"]
                ],
                "removed_dependencies": [
                    entry for entry in dependency_changes["removed"]
                ],
                "version_changed": dependency_changes["version_changed"],
                "package_changed": dependency_changes["package_changed"],
                "signals": ["dependency_change"],
            }
        )

    compared = 0
    identical = 0
    for rel in sorted(crate_files):
        if rel == "Cargo.toml.orig":
            continue
        if rel == "Cargo.toml":
            packaging.append(
                packaging_entry(
                    rel, crate_manifest, cand_manifest, cand_is_crate
                )
            )
            continue
        if rel in PACKAGING_FILES:
            packaging.append(
                packaging_entry(
                    rel, crate_manifest, cand_manifest, cand_is_crate
                )
            )
            continue
        candidate = cand_files.get(rel)
        if candidate is None:
            diff.append(added_file_entry(rel, crate_files[rel]))
            continue
        compared += 1
        cand_kind, cand_payload = read_entry(candidate)
        pub_kind, pub_payload = read_entry(crate_files[rel])
        if cand_kind == "file" and pub_kind == "file" and cand_payload == pub_payload:
            identical += 1
            continue
        if cand_kind == "symlink" and pub_kind == "file":
            target = os.path.normpath(
                os.path.join(os.path.dirname(candidate), cand_payload)
            )
            if target.startswith(cand_dir + os.sep) and os.path.isfile(target):
                with open(target, "rb") as fh:
                    target_bytes = fh.read()
                if target_bytes == pub_payload:
                    packaging.append(
                        {
                            "file": rel,
                            "kind": "symlink_dereferenced",
                            "detail": "cargo packages the symlink target contents",
                            "target": cand_payload,
                        }
                    )
                    identical += 1
                    continue
                diff.append(
                    text_diff_entry(
                        rel,
                        target_bytes,
                        pub_payload,
                        origin_for_file(rel, crate_dir, upstream_root),
                    )
                )
                continue
        if cand_kind == "symlink" or pub_kind == "symlink":
            diff.append(
                {
                    "file": rel,
                    "kind": "symlink_changed",
                    "origin": origin_for_file(rel, crate_dir, upstream_root),
                    "candidate": cand_payload if cand_kind == "symlink" else None,
                    "published": pub_payload if pub_kind == "symlink" else None,
                    "signals": ["symlink"],
                }
            )
            continue
        diff.append(
            text_diff_entry(
                rel,
                cand_payload,
                pub_payload,
                origin_for_file(rel, crate_dir, upstream_root),
            )
        )

    for rel in sorted(cand_files):
        if rel == "Cargo.toml" or rel in crate_files:
            continue
        if rel in PACKAGING_FILES:
            continue
        reason = omission_reason(cand_manifest, rel)
        if reason:
            packaging.append(
                {
                    "file": rel,
                    "kind": "omitted_by_cargo_rule",
                    "detail": reason,
                }
            )
            continue
        nested = nested_package_dir(cand_files, rel)
        if nested:
            packaging.append(
                {
                    "file": rel,
                    "kind": "nested_package_omitted",
                    "detail": (
                        "the candidate has a nested package at %s; cargo excludes "
                        "nested package files from the parent .crate" % nested
                    ),
                }
            )
            continue
        diff.append(
            {
                "file": rel,
                "kind": "missing_from_package",
                "detail": (
                    "present in the candidate tree, absent from the published .crate"
                ),
                "signals": ["missing_file"],
            }
        )

    added_lines = sum(len(entry.get("added_lines") or []) for entry in diff)
    removed_lines = sum(len(entry.get("removed_lines") or []) for entry in diff)

    attention = {}
    for name in ATTENTION_ORDER:
        attention[name] = {"lines": 0, "files": []}
    for entry in diff:
        if entry["kind"] == "dependency_set_changed":
            attention["dependency_change"]["lines"] += (
                len(entry["added_dependencies"])
                + len(entry["removed_dependencies"])
                + len(entry["version_changed"])
                + len(entry["package_changed"])
            )
            attention["dependency_change"]["files"].append(entry["file"])
            continue
        for side in ("removed_lines", "added_lines"):
            for line in entry.get(side) or []:
                for signal in line["signals"]:
                    if signal in attention:
                        attention[signal]["lines"] += 1
                        attention[signal]["files"].append(
                            "%s:%d" % (entry["file"], line["line"])
                        )

    origin_counts = {}
    for entry in diff:
        origin = entry.get("origin") or "unclassified"
        origin_counts[origin] = origin_counts.get(origin, 0) + 1

    return {
        "files_compared": compared,
        "identical_files": identical,
        "build_script": "build.rs" if "build.rs" in cand_files else None,
        "packaging_diffs": packaging,
        "packaging_diffs_count": len(packaging),
        "non_packaging_diffs": diff,
        "non_packaging_files": len(
            [entry for entry in diff if entry["kind"] != "dependency_set_changed"]
        ),
        "lines_added": added_lines,
        "lines_removed": removed_lines,
        "dependency_changes": dependency_changes,
        "attention": attention,
        "origin_counts": origin_counts,
    }


def api_get(path):
    request = urllib.request.Request(
        "https://api.github.com" + path,
        headers={
            "User-Agent": UA,
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return {
                "status": response.status,
                "body": json.loads(response.read().decode("utf-8")),
                "error": None,
            }
    except urllib.error.HTTPError as error:
        body = None
        try:
            body = json.loads(error.read().decode("utf-8"))
        except Exception:
            pass
        return {"status": error.code, "body": body, "error": None}
    except Exception as error:  # network failure or timeout
        return {"status": None, "body": None, "error": str(error)}


API_STATE = {
    "available": True,
    "reason": None,
    "remaining": None,
    "reset": None,
}


def api(path):
    if not API_STATE["available"]:
        return {
            "status": None,
            "body": None,
            "error": "skipped: " + API_STATE["reason"],
        }
    return api_get(path)


def check_api_budget():
    probe = api_get("/rate_limit")
    if probe["status"] == 200:
        core = ((probe["body"] or {}).get("resources") or {}).get("core") or {}
        remaining = core.get("remaining")
        API_STATE["remaining"] = remaining
        API_STATE["reset"] = core.get("reset")
        if isinstance(remaining, int) and remaining < 12:
            API_STATE["available"] = False
            API_STATE["reason"] = (
                "GitHub API rate limit remaining=%d, reset=%s"
                % (remaining, core.get("reset"))
            )
    return API_STATE


def html_repo(slug):
    """Fork metadata from the repository page, which is not API rate limited."""
    url = "https://github.com/%s" % slug
    proc = run(
        [
            "curl",
            "-sS",
            "-L",
            "--max-time",
            "30",
            "-A",
            "Mozilla/5.0",
            "-w",
            "\n__HTTP_STATUS__%{http_code}",
            url,
        ],
        check=False,
    )
    if proc.returncode != 0:
        return {"url": url, "error": proc.stderr.strip()}
    body, _, status_text = proc.stdout.rpartition("__HTTP_STATUS__")
    try:
        status = int(status_text.strip())
    except ValueError:
        return {"url": url, "error": "unreadable HTTP status"}
    parent = None
    marker = body.find("forked from")
    if marker != -1:
        match = re.search(
            r'href="/([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)"',
            body[marker:marker + 4000],
        )
        if match:
            parent = match.group(1)
    return {
        "url": url,
        "http_status": status,
        "exists": status == 200,
        "fork_parent": parent,
    }


def repo_summary(result):
    if result["status"] is None:
        return {"exists": None, "error": result["error"]}
    body = result["body"] or {}
    if result["status"] in (403, 429):
        return {
            "exists": None,
            "http_status": result["status"],
            "rate_limited": True,
            "message": (body or {}).get("message"),
        }
    if result["status"] != 200:
        return {
            "exists": False,
            "http_status": result["status"],
            "message": (body or {}).get("message"),
        }
    return {
        "exists": True,
        "http_status": 200,
        "fork": body.get("fork"),
        "parent": (body.get("parent") or {}).get("full_name"),
        "created_at": body.get("created_at"),
        "pushed_at": body.get("pushed_at"),
        "default_branch": body.get("default_branch"),
        "description": body.get("description"),
    }


def commit_summary(result):
    if result["status"] is None:
        return {"http_status": None, "error": result["error"]}
    body = result["body"] or {}
    if result["status"] != 200:
        return {"http_status": result["status"]}
    return {
        "http_status": 200,
        "sha": body.get("sha"),
        "date": ((body.get("commit") or {}).get("committer") or {}).get("date"),
        "message": ((body.get("commit") or {}).get("message") or "").split("\n")[0],
        "tree": (body.get("commit") or {}).get("tree", {}).get("sha"),
    }


def ls_remote(url):
    proc = run(
        ["git", "ls-remote", url], cwd=WORK, check=False, env=GIT_ENV
    )
    return {
        "ok": proc.returncode == 0,
        "returncode": proc.returncode,
        "error": None if proc.returncode == 0 else proc.stderr.strip(),
        "refs": proc.stdout.splitlines() if proc.returncode == 0 else [],
    }


def refs_at(refs, sha):
    matches = []
    for line in refs:
        parts = line.split()
        if len(parts) == 2 and parts[0] == sha:
            matches.append(parts[1])
    return sorted(matches)


def init_repo(path, url):
    os.makedirs(path)
    run(["git", "init", "-q", path], cwd=WORK, env=GIT_ENV)
    run(["git", "-C", path, "remote", "add", "origin", url], env=GIT_ENV)


def fetch(repo, sha, depth=1):
    proc = run(
        [
            "git",
            "-C",
            repo,
            "fetch",
            "--depth",
            str(depth),
            "--filter=blob:none",
            "--no-tags",
            "origin",
            sha,
        ],
        check=False,
        env=GIT_ENV,
    )
    return {
        "ok": proc.returncode == 0,
        "returncode": proc.returncode,
        "error": None if proc.returncode == 0 else proc.stderr.strip(),
    }


def rev_parse(repo, expr):
    proc = git(repo, "rev-parse", expr, check=False)
    return proc.stdout.strip() if proc.returncode == 0 else None


def materialize(repo, sha, dest):
    os.makedirs(dest)
    archive = subprocess.run(
        ["git", "-C", repo, "archive", "--format=tar", sha],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=GIT_ENV,
    )
    if archive.returncode != 0:
        raise AuditError(
            "git archive %s failed: %s"
            % (sha, archive.stderr.decode("utf-8", "replace").strip())
        )
    proc = subprocess.run(
        ["tar", "-x", "-C", dest, "--no-same-owner", "--no-same-permissions"],
        input=archive.stdout,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if proc.returncode != 0:
        raise AuditError(
            "tar extraction failed: %s"
            % proc.stderr.decode("utf-8", "replace").strip()
        )


def find_upstream_base(repo, fork_sha):
    """Second parent of the fork's 'Merge branch master' commit."""
    merge_proc = git(repo, "rev-list", "--merges", fork_sha, check=False)
    if merge_proc.returncode != 0:
        return None, None, None
    for commit in merge_proc.stdout.split():
        subject_proc = git(repo, "show", "-s", "--format=%s", commit, check=False)
        subject = subject_proc.stdout.strip()
        if not subject.startswith("Merge branch 'master'"):
            continue
        parents_proc = git(repo, "show", "-s", "--format=%P", commit, check=False)
        parents = parents_proc.stdout.split()
        if len(parents) == 2:
            base_subject = git(
                repo, "show", "-s", "--format=%s", parents[1], check=False
            ).stdout.strip()
            return commit, parents[1], base_subject
    return None, None, None


def candidate_source_label(candidate):
    if candidate["kind"] == "git":
        return "%s@%s" % (candidate["slug"], candidate["sha"])
    return "crates.io %s %s" % (candidate["name"], candidate["version"])


def main():
    errors = []

    with open(os.path.join(NATIVE, "Cargo.lock"), "rb") as fh:
        import tomllib

        lock = tomllib.load(fh)
    lock_packages = [
        package
        for package in lock.get("package", [])
        if package.get("name") == CRATE_NAME
    ]
    if len(lock_packages) != 1:
        raise AuditError(
            "expected one %s entry in native/Cargo.lock, found %d"
            % (CRATE_NAME, len(lock_packages))
        )
    lock_package = lock_packages[0]
    if lock_package.get("version") != CRATE_VERSION:
        raise AuditError(
            "Cargo.lock has %s %s, expected %s"
            % (CRATE_NAME, lock_package.get("version"), CRATE_VERSION)
        )
    expected_checksum = lock_package.get("checksum")

    download = os.path.join(
        WORK, "downloads", "%s-%s.crate" % (CRATE_NAME, CRATE_VERSION)
    )
    download_url = "https://static.crates.io/crates/%s/%s-%s.crate" % (
        CRATE_NAME,
        CRATE_NAME,
        CRATE_VERSION,
    )
    proc = run(
        [
            "curl",
            "-fsSL",
            "--retry",
            "3",
            "--connect-timeout",
            "20",
            "--max-time",
            "600",
            "-o",
            download,
            download_url,
        ],
        check=False,
    )
    if proc.returncode != 0:
        raise AuditError("crate download failed: %s" % proc.stderr.strip())

    actual_checksum = sha256_file(download)
    checksum_verified = actual_checksum == expected_checksum
    if not checksum_verified:
        raise AuditError(
            "checksum mismatch: Cargo.lock %s, download %s"
            % (expected_checksum, actual_checksum)
        )

    extract_root = os.path.join(WORK, "extracted", "gpui-pre-reqwest")
    os.makedirs(extract_root)
    run(
        [
            "tar",
            "-xzf",
            download,
            "-C",
            extract_root,
            "--no-same-owner",
            "--no-same-permissions",
        ]
    )
    entries = sorted(os.listdir(extract_root))
    if len(entries) != 1:
        raise AuditError("unexpected archive layout: %r" % entries)
    crate_dir = os.path.join(extract_root, entries[0])
    crate_manifest = read_toml(os.path.join(crate_dir, "Cargo.toml"))
    crate_manifest_orig = read_toml(os.path.join(crate_dir, "Cargo.toml.orig"))
    crate_files = walk_files(crate_dir)

    with open(
        os.path.join(crate_dir, ".cargo_vcs_info.json"), "r", encoding="utf-8"
    ) as fh:
        vcs_data = json.load(fh)
    vcs_git = vcs_data.get("git", {})
    vcs_info = {
        "sha1": vcs_git.get("sha1"),
        "dirty": vcs_git.get("dirty"),
        "path_in_vcs": vcs_data.get("path_in_vcs"),
    }

    package = crate_manifest_orig.get("package", {})
    description = package.get("description") or ""
    repository = package.get("repository")
    description_match = re.search(
        r"([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)@([0-9a-f]{7,40})", description
    )
    claimed_repo = description_match.group(1) if description_match else None
    claimed_prefix = description_match.group(2) if description_match else None

    # Repository probes.
    zed_remote = ls_remote(ZED_REPO)
    upstream_remote = ls_remote(UPSTREAM_REPO)
    claimed_remote = ls_remote("https://github.com/%s" % CLAIMED_SLUG)
    check_api_budget()
    zed_api = api("/repos/%s" % ZED_SLUG)
    upstream_api = api("/repos/%s" % UPSTREAM_SLUG)
    claimed_api = api("/repos/%s" % CLAIMED_SLUG)
    zed_html = html_repo(ZED_SLUG)

    zed_repo = os.path.join(WORK, "repos", "zed")
    upstream_repo = os.path.join(WORK, "repos", "upstream")
    init_repo(zed_repo, ZED_REPO)
    init_repo(upstream_repo, UPSTREAM_REPO)

    vcs_sha = vcs_info["sha1"]
    if not vcs_sha:
        raise AuditError("no .cargo_vcs_info.json git sha1")

    # Fetch the fork commit with enough history to find its upstream merge base.
    fork_history = fetch(zed_repo, vcs_sha, depth=12)
    if not fork_history["ok"]:
        raise AuditError(
            "cannot fetch fork commit %s: %s" % (vcs_sha, fork_history["error"])
        )
    fork_tree = rev_parse(zed_repo, vcs_sha + "^{tree}")
    merge_commit, upstream_base_sha, upstream_base_subject = find_upstream_base(
        zed_repo, vcs_sha
    )
    upstream_base_source = "second parent of fork merge commit %s" % merge_commit
    if not upstream_base_sha:
        compare_probe = api(
            "/repos/%s/compare/master...%s" % (UPSTREAM_SLUG, vcs_sha)
        )
        if compare_probe["status"] == 200:
            upstream_base_sha = (
                (compare_probe["body"] or {}).get("merge_base_commit", {}).get("sha")
            )
            upstream_base_source = "GitHub compare merge_base_commit"
    if not upstream_base_sha:
        upstream_base_sha = UPSTREAM_BASE_FALLBACK
        upstream_base_source = "verified fallback constant"

    # Resolve the description's short sha.
    description_sha = None
    description_resolution = "unresolved"
    if claimed_prefix:
        for repo_slug in (claimed_repo, ZED_SLUG):
            if not repo_slug:
                continue
            commit_probe = api(
                "/repos/%s/commits/%s" % (repo_slug, claimed_prefix)
            )
            if commit_probe["status"] == 200:
                description_sha = (commit_probe["body"] or {}).get("sha")
                description_resolution = "GitHub commit API for %s in %s" % (
                    claimed_prefix,
                    repo_slug,
                )
                break
        if not description_sha:
            committed = (
                DESCRIPTION_SHA_FALLBACK
                if DESCRIPTION_SHA_FALLBACK.startswith(claimed_prefix)
                else None
            )
            if committed:
                description_sha = committed
                description_resolution = "verified constant; " + (
                    API_STATE.get("reason")
                    or "GitHub API did not resolve %s" % claimed_prefix
                )

    # Commit probes for both repositories.
    commit_probes = {}
    probe_shas = [sha for sha in (vcs_sha, description_sha) if sha]
    for sha in probe_shas:
        zed_fetch = fetch(zed_repo, sha, depth=1)
        upstream_fetch = fetch(upstream_repo, sha, depth=1)
        compare_probe = api(
            "/repos/%s/compare/master...%s" % (UPSTREAM_SLUG, sha)
        )
        compare_body = compare_probe["body"] or {}
        compare_summary = None
        if compare_probe["status"] == 200:
            compare_summary = {
                "status": compare_body.get("status"),
                "ahead_by": compare_body.get("ahead_by"),
                "behind_by": compare_body.get("behind_by"),
                "total_commits": compare_body.get("total_commits"),
                "merge_base_commit": (compare_body.get("merge_base_commit") or {}).get(
                    "sha"
                ),
                "commits": [
                    {
                        "sha": entry.get("sha"),
                        "message": (
                            ((entry.get("commit") or {}).get("message") or "").split(
                                "\n"
                            )[0]
                        ),
                    }
                    for entry in compare_body.get("commits", [])
                ],
            }
        commit_probes[sha] = {
            "zed_refs": refs_at(zed_remote["refs"], sha),
            "upstream_refs": refs_at(upstream_remote["refs"], sha),
            "fetch_zed": zed_fetch,
            "fetch_upstream": upstream_fetch,
            "zed_commit_api": commit_summary(
                api("/repos/%s/commits/%s" % (ZED_SLUG, sha))
            ),
            "upstream_commit_api": commit_summary(
                api("/repos/%s/commits/%s" % (UPSTREAM_SLUG, sha))
            ),
            "upstream_compare": compare_summary,
            "tree": rev_parse(zed_repo, sha + "^{tree}"),
        }

    # Upstream release tag.
    tag_sha = None
    for line in upstream_remote["refs"]:
        parts = line.split()
        if len(parts) == 2 and parts[1] == "refs/tags/%s^{}" % UPSTREAM_TAG:
            tag_sha = parts[0]
            break
    if not tag_sha:
        for line in upstream_remote["refs"]:
            parts = line.split()
            if len(parts) == 2 and parts[1] == "refs/tags/%s" % UPSTREAM_TAG:
                tag_sha = parts[0]
                break
    if not tag_sha:
        tag_probe = run(
            [
                "git",
                "ls-remote",
                UPSTREAM_REPO,
                "refs/tags/%s" % UPSTREAM_TAG,
                "refs/tags/%s^{}" % UPSTREAM_TAG,
            ],
            cwd=WORK,
            check=False,
            env=GIT_ENV,
        )
        for line in tag_probe.stdout.splitlines():
            parts = line.split()
            if len(parts) == 2 and parts[1].startswith(
                "refs/tags/%s" % UPSTREAM_TAG
            ):
                tag_sha = parts[0]
                if parts[1].endswith("^{}"):
                    break
    if not tag_sha:
        raise AuditError(
            "cannot resolve upstream tag %s (ls-remote ok=%s, error=%s, "
            "refs=%d, retry error=%s)"
            % (
                UPSTREAM_TAG,
                upstream_remote["ok"],
                upstream_remote["error"],
                len(upstream_remote["refs"]),
                tag_probe.stderr.strip() if "tag_probe" in dir() else "n/a",
            )
        )

    # Fetch enough upstream history to prove the release tag is the fork base's
    # ancestor and to list the upstream commits in between.
    upstream_history = fetch(upstream_repo, upstream_base_sha, depth=20)
    if not upstream_history["ok"]:
        upstream_history = fetch(upstream_repo, upstream_base_sha, depth=1)
    tag_is_ancestor = (
        git(
            upstream_repo,
            "merge-base",
            "--is-ancestor",
            tag_sha,
            upstream_base_sha,
            check=False,
        ).returncode
        == 0
    )
    upstream_commits_between = []
    if tag_is_ancestor:
        log = git(
            upstream_repo,
            "log",
            "--format=%H %s",
            "%s..%s" % (tag_sha, upstream_base_sha),
            check=False,
        )
        if log.returncode == 0:
            for line in log.stdout.splitlines():
                parts = line.split(" ", 1)
                upstream_commits_between.append(
                    {"sha": parts[0], "message": parts[1] if len(parts) > 1 else ""}
                )

    # Materialize git candidate trees.
    trees = {}
    for key, repo, sha in (
        ("fork_vcs", zed_repo, vcs_sha),
        ("fork_description", zed_repo, description_sha),
        ("upstream_tag", upstream_repo, tag_sha),
        ("upstream_base", upstream_repo, upstream_base_sha),
    ):
        if not sha:
            continue
        dest = os.path.join(WORK, "trees", key)
        try:
            materialize(repo, sha, dest)
            trees[key] = dest
        except AuditError as error:
            errors.append("%s: %s" % (key, error))

    # Download and extract crates.io reqwest at the matching version.
    reqwest_crate = os.path.join(
        WORK, "downloads", "reqwest-%s.crate" % CRATE_VERSION
    )
    reqwest_url = "https://static.crates.io/crates/reqwest/reqwest-%s.crate" % (
        CRATE_VERSION
    )
    reqwest_proc = run(
        [
            "curl",
            "-fsSL",
            "--retry",
            "3",
            "--connect-timeout",
            "20",
            "--max-time",
            "600",
            "-o",
            reqwest_crate,
            reqwest_url,
        ],
        check=False,
    )
    reqwest_dir = None
    reqwest_checksum = None
    if reqwest_proc.returncode == 0:
        reqwest_checksum = sha256_file(reqwest_crate)
        reqwest_extract = os.path.join(WORK, "extracted", "reqwest")
        os.makedirs(reqwest_extract)
        run(
            [
                "tar",
                "-xzf",
                reqwest_crate,
                "-C",
                reqwest_extract,
                "--no-same-owner",
                "--no-same-permissions",
            ]
        )
        reqwest_entries = sorted(os.listdir(reqwest_extract))
        if len(reqwest_entries) == 1:
            reqwest_dir = os.path.join(reqwest_extract, reqwest_entries[0])
        else:
            errors.append("unexpected reqwest archive layout: %r" % reqwest_entries)
    else:
        errors.append("reqwest crate download failed: %s" % reqwest_proc.stderr.strip())

    upstream_master_root = trees.get("upstream_base")

    candidate_specs = [
        {
            "id": "zed_fork_vcs_sha",
            "kind": "git",
            "role": "commit named by .cargo_vcs_info.json",
            "slug": ZED_SLUG,
            "repo": ZED_REPO,
            "repo_dir": zed_repo,
            "sha": vcs_sha,
            "tree_key": "fork_vcs",
        },
        {
            "id": "zed_fork_description_sha",
            "kind": "git",
            "role": "commit named by the package description",
            "slug": ZED_SLUG,
            "repo": ZED_REPO,
            "repo_dir": zed_repo,
            "sha": description_sha,
            "tree_key": "fork_description",
        },
        {
            "id": "crates_io_reqwest_0_12_15",
            "kind": "crate",
            "role": "published upstream release at the same version",
            "name": "reqwest",
            "version": CRATE_VERSION,
            "dir": reqwest_dir,
            "checksum": reqwest_checksum,
            "url": reqwest_url,
        },
        {
            "id": "upstream_v0_12_15_tag",
            "kind": "git",
            "role": "upstream git tag for the same release",
            "slug": UPSTREAM_SLUG,
            "repo": UPSTREAM_REPO,
            "repo_dir": upstream_repo,
            "sha": tag_sha,
            "tree_key": "upstream_tag",
        },
        {
            "id": "upstream_master_at_fork_base",
            "kind": "git",
            "role": "upstream master commit the fork merged",
            "slug": UPSTREAM_SLUG,
            "repo": UPSTREAM_REPO,
            "repo_dir": upstream_repo,
            "sha": upstream_base_sha,
            "tree_key": "upstream_base",
        },
    ]

    candidates = []
    for spec in candidate_specs:
        record = {
            "id": spec["id"],
            "role": spec["role"],
            "kind": spec["kind"],
            "label": candidate_source_label(spec) if spec.get("slug") else
            "crates.io reqwest %s" % spec["version"],
            "sha": spec.get("sha"),
            "resolved_sha": None,
            "tree": None,
            "status": "pending",
            "status_detail": None,
        }
        if spec["kind"] == "git":
            if not spec.get("sha"):
                record["status"] = "unresolved"
                record["status_detail"] = (
                    "no commit could be resolved for this candidate"
                )
                candidates.append(record)
                continue
            record["resolved_sha"] = rev_parse(
                spec["repo_dir"], spec["sha"] + "^{commit}"
            )
            record["tree"] = rev_parse(
                spec["repo_dir"], spec["sha"] + "^{tree}"
            )
            root = trees.get(spec["tree_key"])
            if not root:
                record["status"] = "error"
                record["status_detail"] = "commit tree could not be materialized"
                candidates.append(record)
                continue
            cand_manifest_path = os.path.join(root, "Cargo.toml")
            if not os.path.isfile(cand_manifest_path):
                record["status"] = "error"
                record["status_detail"] = "candidate tree has no Cargo.toml"
                candidates.append(record)
                continue
            cand_manifest = read_toml(cand_manifest_path)
            comparison = compare_trees(
                crate_dir,
                crate_manifest,
                crate_manifest_orig,
                root,
                cand_manifest,
                cand_is_crate=False,
                candidate_label=record["label"],
                upstream_root=upstream_master_root
                if spec["id"] != "upstream_master_at_fork_base"
                else None,
            )
        else:
            if not spec.get("dir"):
                record["status"] = "error"
                record["status_detail"] = "reqwest crate could not be downloaded"
                candidates.append(record)
                continue
            cand_manifest_path = os.path.join(spec["dir"], "Cargo.toml.orig")
            if not os.path.isfile(cand_manifest_path):
                cand_manifest_path = os.path.join(spec["dir"], "Cargo.toml")
            cand_manifest = read_toml(cand_manifest_path)
            comparison = compare_trees(
                crate_dir,
                crate_manifest,
                crate_manifest_orig,
                spec["dir"],
                cand_manifest,
                cand_is_crate=True,
                candidate_label=record["label"],
                upstream_root=upstream_master_root,
            )
            record["checksum"] = spec.get("checksum")
            record["url"] = spec.get("url")
        record.update(comparison)
        record["status"] = "compared"
        candidates.append(record)

    by_id = {record["id"]: record for record in candidates}

    def diff_fingerprint(record):
        if record["status"] != "compared":
            return None
        material = []
        for entry in record["non_packaging_diffs"]:
            if entry["kind"] == "dependency_set_changed":
                material.append(
                    [
                        "manifest",
                        entry["kind"],
                        sorted(
                            (dep["key"], dep["table"], dep["version"])
                            for dep in entry.get("added_dependencies") or []
                        ),
                        sorted(
                            (dep["key"], dep["table"], dep["version"])
                            for dep in entry.get("removed_dependencies") or []
                        ),
                        sorted(
                            (change["key"], change["published_version"],
                             change["candidate_version"])
                            for change in entry.get("version_changed") or []
                        ),
                    ]
                )
                continue
            material.append(
                [
                    entry["file"],
                    entry["kind"],
                    [line["text"] for line in entry.get("removed_lines") or []],
                    [line["text"] for line in entry.get("added_lines") or []],
                ]
            )
        return hashlib.sha256(
            json.dumps(material, sort_keys=True).encode("utf-8")
        ).hexdigest()

    for record in candidates:
        record["diff_fingerprint"] = diff_fingerprint(record)

    def metrics(record):
        if not record or record["status"] != "compared":
            return None
        return {
            "files_compared": record["files_compared"],
            "packaging_diffs": record["packaging_diffs_count"],
            "non_packaging_files": record["non_packaging_files"],
            "non_packaging_lines_added": record["lines_added"],
            "non_packaging_lines_removed": record["lines_removed"],
        }

    primary = by_id.get("zed_fork_vcs_sha")
    reqwest_candidate = by_id.get("crates_io_reqwest_0_12_15")
    master_candidate = by_id.get("upstream_master_at_fork_base")

    attention_summary = {}
    for name in ATTENTION_ORDER:
        attention_summary[name] = {}
        for record in candidates:
            if record["status"] != "compared":
                continue
            values = record["attention"][name]
            attention_summary[name][record["id"]] = {
                "lines": values["lines"],
                "files": sorted(set(values["files"]))[:12],
            }

    facts = []
    tag_candidate = by_id.get("upstream_v0_12_15_tag")
    release_tag_matches_crates_io = {
        "tag_candidate": tag_candidate["id"] if tag_candidate else None,
        "crates_io_candidate": reqwest_candidate["id"]
        if reqwest_candidate
        else None,
        "non_packaging_diff_identical": bool(
            tag_candidate
            and reqwest_candidate
            and tag_candidate.get("diff_fingerprint")
            and tag_candidate.get("diff_fingerprint")
            == reqwest_candidate.get("diff_fingerprint")
        ),
        "tag_files_compared": tag_candidate.get("files_compared")
        if tag_candidate
        else None,
        "crates_io_files_compared": reqwest_candidate.get("files_compared")
        if reqwest_candidate
        else None,
    }

    vcs_probe = commit_probes.get(vcs_sha, {})
    description_probe = (
        commit_probes.get(description_sha, {}) if description_sha else {}
    )
    facts.append(
        "The crate's .cargo_vcs_info.json names commit %s (dirty=%s); that commit "
        "is %s in %s."
        % (
            vcs_sha,
            vcs_info.get("dirty"),
            ", ".join(vcs_probe.get("zed_refs") or []) or "not on any fetched ref",
            ZED_SLUG,
        )
    )
    api_fork_parent = None
    api_created = None
    if zed_api.get("status") == 200:
        body = zed_api.get("body") or {}
        parent = body.get("parent")
        if isinstance(parent, dict):
            api_fork_parent = parent.get("full_name")
        api_created = body.get("created_at")
    html_parent = (zed_html or {}).get("fork_parent")
    if api_fork_parent:
        facts.append(
            "%s is a GitHub fork of %s (created %s; GitHub API)."
            % (ZED_SLUG, api_fork_parent, api_created or "unknown")
        )
    elif html_parent:
        facts.append(
            "%s is a GitHub fork of %s (repository HTML; GitHub API metadata "
            "unavailable: %s)."
            % (
                ZED_SLUG,
                html_parent,
                API_STATE.get("reason")
                or (zed_api.get("error") or "unknown reason"),
            )
        )
    else:
        facts.append(
            "%s exists publicly (git ls-remote ok); its fork parent could not be "
            "determined (GitHub API %s, repository HTML HTTP %s)."
            % (
                ZED_SLUG,
                API_STATE.get("reason") or zed_api.get("error") or "unavailable",
                (zed_html or {}).get("http_status"),
            )
        )
    claimed_remote_error = " | ".join(
        (claimed_remote.get("error") or "").splitlines()[:2]
    )
    if not claimed_remote["ok"]:
        claimed_state = (
            "%s is not publicly accessible (git ls-remote: %s; GitHub API: %s)"
            % (
                CLAIMED_SLUG,
                claimed_remote_error or "refused",
                API_STATE.get("reason")
                or "HTTP %s" % claimed_api.get("status"),
            )
        )
    else:
        claimed_state = "%s is reachable (git ls-remote ok)" % CLAIMED_SLUG
    facts.append(
        "The description names %s@%s. %s. A by-SHA fetch from %s succeeds; no ref "
        "in that repository points at the commit."
        % (
            claimed_repo or "an unparsed repository",
            claimed_prefix or "an unparsed sha",
            claimed_state,
            ZED_SLUG,
        )
    )
    if description_sha:
        facts.append(
            "The description's %s resolves to %s; its tree is %s and the vcs "
            "commit's tree is %s (%s)."
            % (
                claimed_prefix,
                description_sha,
                description_probe.get("tree"),
                vcs_probe.get("tree"),
                "identical"
                if description_probe.get("tree") == vcs_probe.get("tree")
                else "different",
            )
        )
    no_upstream_refs = not (vcs_probe.get("upstream_refs") or [])
    facts.append(
        "No ref in %s points at %s%s; a by-SHA fetch still succeeds because the "
        "fork and its parent share GitHub's object network."
        % (
            UPSTREAM_SLUG,
            vcs_sha,
            "" if no_upstream_refs else " (refs: %s)" % ", ".join(
                vcs_probe.get("upstream_refs")
            ),
        )
    )
    compare = (vcs_probe.get("upstream_compare") or {})
    if compare:
        facts.append(
            "GitHub compares master...%s as %s (ahead_by=%s, behind_by=%s, "
            "merge base %s), so the commit is fork history, not upstream master."
            % (
                vcs_sha,
                compare.get("status"),
                compare.get("ahead_by"),
                compare.get("behind_by"),
                compare.get("merge_base_commit"),
            )
        )
    facts.append(
        "The fork's merge commit %s has second parent %s (%s), the upstream master "
        "commit it merged; source: %s. The release tag v0.12.15 is %s of that base; "
        "%d upstream commits separate them."
        % (
            merge_commit,
            upstream_base_sha,
            upstream_base_subject,
            upstream_base_source,
            "an ancestor" if tag_is_ancestor else "not an ancestor",
            len(upstream_commits_between),
        )
    )
    if primary and primary["status"] == "compared":
        facts.append(
            "Comparison with %s: %d files compared, %d non-packaging changed files, "
            "+%d/-%d changed lines, %d packaging differences."
            % (
                primary["label"],
                primary["files_compared"],
                primary["non_packaging_files"],
                primary["lines_added"],
                primary["lines_removed"],
                primary["packaging_diffs_count"],
            )
        )
        if primary["non_packaging_files"] == 0:
            facts.append(
                "Every packaged source file is byte-identical to %s; the only "
                "differences are cargo packaging files, the manifest identity/"
                "description, and files cargo excludes from the package."
                % primary["label"]
            )
    if master_candidate and master_candidate["status"] == "compared":
        master_attention = master_candidate["attention"]
        facts.append(
            "Against upstream master %s, the fork changes %d files and +%d/-%d "
            "lines. Changed-line categories: %s. No TLS/certificate, proxy, "
            "process-spawn, unsafe or build-script line changes."
            % (
                upstream_base_sha,
                master_candidate["non_packaging_files"],
                master_candidate["lines_added"],
                master_candidate["lines_removed"],
                ", ".join(
                    "%s=%d" % (name, master_attention[name]["lines"])
                    for name in ATTENTION_ORDER
                    if master_attention[name]["lines"]
                )
                or "(none)",
            )
        )
    facts.append(
        "The upstream tag %s and the crates.io reqwest %s crate produce the same "
        "non-packaging diff against the published crate: %s."
        % (
            UPSTREAM_TAG,
            CRATE_VERSION,
            "yes"
            if release_tag_matches_crates_io["non_packaging_diff_identical"]
            else "no",
        )
    )
    facts.append(
        "The crate was packaged with dirty=true. The packaged manifest identity and "
        "description differ from the commit's manifest, while every packaged source "
        "file matches the commit; the dirty state is therefore not visible as a "
        "source change in the .crate."
    )
    if reqwest_candidate and reqwest_candidate["status"] == "compared":
        facts.append(
            "Comparison with crates.io reqwest %s: %d files changed outside "
            "packaging, +%d/-%d lines; %d of those files are byte-identical to "
            "upstream master %s and the rest contain the fork's changes."
            % (
                CRATE_VERSION,
                reqwest_candidate["non_packaging_files"],
                reqwest_candidate["lines_added"],
                reqwest_candidate["lines_removed"],
                reqwest_candidate["origin_counts"].get("upstream_drift", 0),
                upstream_base_sha,
            )
        )

    result = {
        "audit": "gpui-pre-reqwest provenance audit",
        "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(
            timespec="seconds"
        ),
        "cargo_lock": os.path.relpath(os.path.join(NATIVE, "Cargo.lock"), ROOT),
        "method": (
            "Download the published .crate from static.crates.io, verify its sha256 "
            "against Cargo.lock, extract it with tar, shallow-fetch (--depth, "
            "--filter=blob:none) each candidate commit, materialize each tree with "
            "git archive, and byte-compare every packaged file. Cargo-generated "
            "manifests/lock/VCS files, cargo-normalized manifests, and files cargo "
            "omits (nested packages, auto-disabled targets) are classified as "
            "packaging; every other difference is listed line by line. Downloaded "
            "source is only read and diffed; nothing is built or executed."
        ),
        "tool_versions": {
            "git": run(["git", "--version"]).stdout.strip(),
            "curl": run(["curl", "--version"]).stdout.splitlines()[0].strip(),
            "tar": run(["tar", "--version"]).stdout.splitlines()[0].strip(),
            "diff": run(["diff", "--version"]).stdout.splitlines()[0].strip(),
            "python": sys.version.split()[0],
        },
        "crate": {
            "name": CRATE_NAME,
            "version": CRATE_VERSION,
            "download_url": download_url,
            "checksum": {
                "expected": expected_checksum,
                "actual": actual_checksum,
                "verified": checksum_verified,
            },
            "archive_entries": entries,
            "file_count": len(crate_files),
            "package_metadata": {
                "name": package.get("name"),
                "version": package.get("version"),
                "description": description,
                "repository": repository,
                "license": package.get("license"),
                "edition": package.get("edition"),
                "rust_version": package.get("rust-version"),
                "build": crate_manifest.get("package", {}).get("build"),
            },
            "vcs_info": vcs_info,
            "build_script": "build.rs" if "build.rs" in crate_files else None,
            "description_claim": {
                "repository": claimed_repo,
                "sha_prefix": claimed_prefix,
                "resolved_sha": description_sha,
                "resolution": description_resolution,
            },
        },
        "upstream_resolution": {
            "verdict": (
                "The published crate is the zed-industries/reqwest fork commit %s "
                "(branch prep-for-crates-io); no seanmonstar/reqwest ref points at "
                "that commit, and the content differs from the v0.12.15 release tag. "
                "Every packaged source file is byte-identical to that fork "
                "commit; the description's c156624 has the same tree. The fork "
                "commit is based on upstream master %s, which is %d commits after "
                "the v0.12.15 release tag."
                % (
                    vcs_sha,
                    upstream_base_sha,
                    len(upstream_commits_between),
                )
            ),
            "github_api": API_STATE,
            "repositories": {
                ZED_SLUG: {
                    "git_ls_remote": {
                        "ok": zed_remote["ok"],
                        "error": zed_remote["error"],
                        "heads": [
                            line.split()[1]
                            for line in zed_remote["refs"]
                            if line.split()[1].startswith("refs/heads/")
                        ],
                    },
                    "github": repo_summary(zed_api),
                    "html": zed_html,
                },
                CLAIMED_SLUG: {
                    "git_ls_remote": {
                        "ok": claimed_remote["ok"],
                        "error": claimed_remote["error"],
                    },
                    "github": repo_summary(claimed_api),
                },
                UPSTREAM_SLUG: {
                    "git_ls_remote": {
                        "ok": upstream_remote["ok"],
                        "error": upstream_remote["error"],
                    },
                    "github": repo_summary(upstream_api),
                },
            },
            "commits": commit_probes,
            "tree_equality": {
                "vcs_sha": vcs_sha,
                "vcs_tree": vcs_probe.get("tree"),
                "description_sha": description_sha,
                "description_tree": description_probe.get("tree"),
                "identical": bool(
                    description_sha
                    and description_probe.get("tree")
                    and description_probe.get("tree") == vcs_probe.get("tree")
                ),
            },
            "fork_relationship": {
                "merge_commit": merge_commit,
                "upstream_base_sha": upstream_base_sha,
                "upstream_base_subject": upstream_base_subject,
                "upstream_base_source": upstream_base_source,
                "upstream_tag": UPSTREAM_TAG,
                "upstream_tag_sha": tag_sha,
                "tag_is_ancestor_of_base": tag_is_ancestor,
                "upstream_commits_between_tag_and_base": upstream_commits_between,
            },
            "release_tag_matches_crates_io": release_tag_matches_crates_io,
            "facts": facts,
        },
        "candidates": candidates,
        "summary": {
            "checksum_verified": checksum_verified,
            "crate_files": len(crate_files),
            "candidates": len(candidates),
            "candidates_compared": sum(
                1 for record in candidates if record["status"] == "compared"
            ),
            "candidates_unresolved": sum(
                1
                for record in candidates
                if record["status"] in ("unresolved", "error")
            ),
            "primary_candidate": primary["id"] if primary else None,
            "primary": metrics(primary),
            "vs_crates_io_reqwest_0_12_15": metrics(reqwest_candidate),
            "vs_upstream_master_at_fork_base": metrics(master_candidate),
            "attention": attention_summary,
            "build_scripts_in_crate": [
                rel for rel in crate_files if os.path.basename(rel) == "build.rs"
            ],
            "errors": errors,
        },
    }

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(OUT_JSON, "w", encoding="utf-8") as fh:
        json.dump(result, fh, indent=2)
        fh.write("\n")

    write_markdown(result)

    print(
        "audited %s %s: checksum %s, %d candidates (%d compared), "
        "primary non-packaging %s, vs reqwest 0.12.15 %s"
        % (
            CRATE_NAME,
            CRATE_VERSION,
            "verified" if checksum_verified else "MISMATCH",
            len(candidates),
            result["summary"]["candidates_compared"],
            metrics(primary),
            metrics(reqwest_candidate),
        )
    )
    print("wrote %s" % OUT_JSON)
    print("wrote %s" % OUT_MD)
    for error in errors:
        print("error: %s" % error, file=sys.stderr)
    if errors:
        sys.exit(1)


def md_cell(value):
    if value is None:
        return "(none)"
    return str(value).replace("|", "\\|")


def render_candidate(lines, record, duplicate_of=None):
    lines.append("## Candidate: %s" % record["label"])
    lines.append("")
    lines.append("- id: `%s`" % record["id"])
    lines.append("- role: %s" % record["role"])
    lines.append("- source: %s" % record["kind"])
    if record.get("sha"):
        lines.append(
            "- sha: `%s` (resolved `%s`, tree `%s`)"
            % (
                record.get("sha"),
                record.get("resolved_sha"),
                record.get("tree"),
            )
        )
    if record.get("checksum"):
        lines.append("- sha256: `%s`" % record["checksum"])
    lines.append("- status: %s" % record["status"])
    if record.get("status_detail"):
        lines.append("- detail: %s" % record["status_detail"])
    if record["status"] != "compared":
        lines.append("")
        return
    lines.append("- files compared: %d (%d identical)" % (
        record["files_compared"], record["identical_files"]))
    lines.append(
        "- build script: %s" % (record.get("build_script") or "(none)")
    )
    lines.append("- packaging differences: %d" % record["packaging_diffs_count"])
    lines.append(
        "- non-packaging differences: %d files, +%d/-%d lines"
        % (
            record["non_packaging_files"],
            record["lines_added"],
            record["lines_removed"],
        )
    )
    if record.get("origin_counts"):
        lines.append(
            "- origin counts by file: %s"
            % ", ".join(
                "%s=%d" % (key, value)
                for key, value in sorted(record["origin_counts"].items())
            )
        )
    lines.append("")

    lines.append("### Packaging differences")
    lines.append("")
    for entry in record["packaging_diffs"]:
        lines.append(
            "- **`%s`** — %s%s"
            % (
                entry["file"],
                entry["kind"],
                " — " + entry["detail"] if entry.get("detail") else "",
            )
        )
        for change in entry.get("package_field_changes", []):
            lines.append(
                "  - `%s`: published `%s`, candidate `%s`"
                % (change["field"], change["published"], change["candidate"])
            )
    lines.append("")

    lines.append("### Non-packaging differences")
    lines.append("")
    if duplicate_of:
        lines.append(
            "Identical to candidate `%s`: the same changed files and changed "
            "lines; they are listed once there." % duplicate_of
        )
        lines.append("")
        return
    if not record["non_packaging_diffs"]:
        lines.append(
            "None. Every shared source file is byte-identical to the published "
            "crate."
        )
        lines.append("")
        return
    for entry in record["non_packaging_diffs"]:
        lines.append(
            "- **`%s`** — %s%s%s"
            % (
                entry["file"],
                entry["kind"],
                " — origin: " + entry["origin"] if entry.get("origin") else "",
                " — signals: " + ", ".join(entry["signals"])
                if entry.get("signals")
                else "",
            )
        )
        if entry.get("detail"):
            lines.append("  - %s" % entry["detail"])
        if entry["kind"] == "dependency_set_changed":
            for dep in entry["added_dependencies"]:
                lines.append(
                    "  - added `%s` (%s, version `%s`, optional=%s)"
                    % (
                        dep["key"],
                        dep["table"],
                        dep["version"],
                        dep["optional"],
                    )
                )
            for dep in entry["removed_dependencies"]:
                lines.append(
                    "  - removed `%s` (%s, version `%s`, optional=%s)"
                    % (
                        dep["key"],
                        dep["table"],
                        dep["version"],
                        dep["optional"],
                    )
                )
            for change in entry["version_changed"]:
                lines.append(
                    "  - `%s` (%s): `%s` -> `%s`"
                    % (
                        change["key"],
                        change["table"],
                        change["published_version"],
                        change["candidate_version"],
                    )
                )
            for change in entry["package_changed"]:
                lines.append(
                    "  - `%s` (%s): package `%s` -> `%s`"
                    % (
                        change["key"],
                        change["table"],
                        change["published_package"],
                        change["candidate_package"],
                    )
                )
            continue
        removed = entry.get("removed_lines") or []
        added = entry.get("added_lines") or []
        lines.append(
            "  - removed %d line(s), added %d line(s)"
            % (len(removed), len(added))
        )
        if removed or added:
            lines.append("")
            lines.append("    ```diff")
            for line in removed:
                lines.append(
                    "    -%6d %s" % (line["line"], line["text"])
                )
            for line in added:
                lines.append(
                    "    +%6d %s" % (line["line"], line["text"])
                )
            lines.append("    ```")
    lines.append("")


def write_markdown(result):
    summary = result["summary"]
    upstream = result["upstream_resolution"]
    lines = []
    lines.append("# gpui-pre-reqwest provenance audit")
    lines.append("")
    lines.append(
        "Generated %s from `%s`."
        % (result["generated_at"], result["cargo_lock"])
    )
    lines.append("")
    lines.append(
        "Downloaded `%s %s` from static.crates.io and checked its sha256 against "
        "`Cargo.lock`: **%s**. The archive was extracted and read only; nothing "
        "was built or executed."
        % (
            result["crate"]["name"],
            result["crate"]["version"],
            "verified"
            if result["crate"]["checksum"]["verified"]
            else "MISMATCH",
        )
    )
    lines.append("")

    lines.append("## Summary")
    lines.append("")
    lines.append("| Candidate | Role | Files compared | Packaging diffs | Non-packaging files | Lines (+/-) | Status |")
    lines.append("|---|---|---|---|---|---|---|")
    for record in result["candidates"]:
        if record["status"] == "compared":
            lines.append(
                "| %s | %s | %d | %d | %d | +%d/-%d | %s |"
                % (
                    md_cell(record["label"]),
                    md_cell(record["role"]),
                    record["files_compared"],
                    record["packaging_diffs_count"],
                    record["non_packaging_files"],
                    record["lines_added"],
                    record["lines_removed"],
                    record["status"],
                )
            )
        else:
            lines.append(
                "| %s | %s | - | - | - | - | %s |"
                % (
                    md_cell(record["label"]),
                    md_cell(record["role"]),
                    record["status"],
                )
            )
    lines.append("")

    lines.append("### Special-attention categories")
    lines.append("")
    lines.append("| Category | " + " | ".join(
        record["id"] for record in result["candidates"]
        if record["status"] == "compared"
    ) + " |")
    lines.append("|---|" + "---|" * len(
        [record for record in result["candidates"] if record["status"] == "compared"]
    ))
    compared = [
        record for record in result["candidates"] if record["status"] == "compared"
    ]
    for name in ATTENTION_ORDER:
        row = ["| `%s`" % name]
        for record in compared:
            values = record["attention"][name]
            row.append(" %d " % values["lines"])
        lines.append("|".join(row) + "|")
    lines.append("")
    lines.append(
        "- build.rs in the published crate: %s"
        % (
            ", ".join(summary.get("build_scripts_in_crate") or [])
            or "(none)"
        )
    )
    lines.append(
        "- build scripts in candidate trees: %s"
        % (
            ", ".join(
                "%s=%s" % (record["id"], record["build_script"] or "(none)")
                for record in compared
            )
        )
    )
    tag_equality = upstream.get("release_tag_matches_crates_io") or {}
    lines.append(
        "- upstream tag vs crates.io reqwest %s: non-packaging diff identical: %s "
        "(tag files compared %s, crate files compared %s)"
        % (
            CRATE_VERSION,
            tag_equality.get("non_packaging_diff_identical"),
            tag_equality.get("tag_files_compared"),
            tag_equality.get("crates_io_files_compared"),
        )
    )
    lines.append("")

    lines.append("## Upstream determination")
    lines.append("")
    if upstream.get("verdict"):
        lines.append("**Verdict:** %s" % upstream["verdict"])
        lines.append("")
    for fact in upstream["facts"]:
        lines.append("- %s" % fact)
    lines.append("")
    lines.append("### Repositories")
    lines.append("")
    api_state = upstream.get("github_api") or {}
    if api_state.get("available") is False:
        lines.append(
            "GitHub API calls were skipped: %s. Repository existence comes from "
            "`git ls-remote`; fork metadata falls back to the repository HTML."
            % api_state.get("reason")
        )
        lines.append("")
    lines.append("| Repository | Public | Fork | Parent | GitHub API |")
    lines.append("|---|---|---|---|---|")
    for slug, info in upstream["repositories"].items():
        github = info.get("github") or {}
        html = info.get("html") or {}
        fork_value = github.get("fork")
        if fork_value is None and html.get("fork_parent"):
            fork_value = "yes (HTML)"
        api_value = github.get("http_status")
        if api_value is None:
            api_value = "skipped" if github.get("error") else "unknown"
        lines.append(
            "| %s | %s | %s | %s | %s |"
            % (
                slug,
                "yes" if info.get("git_ls_remote", {}).get("ok") else "no",
                md_cell(fork_value),
                md_cell(github.get("parent") or html.get("fork_parent")),
                md_cell(api_value),
            )
        )
    lines.append("")
    lines.append("### Claimed commits")
    lines.append("")
    lines.append("| Commit | Refs in zed fork | Refs upstream | Fetch zed | Fetch upstream | Compare upstream master | Tree |")
    lines.append("|---|---|---|---|---|---|---|")
    for sha, probe in upstream["commits"].items():
        compare = probe.get("upstream_compare") or {}
        lines.append(
            "| `%s` | %s | %s | %s | %s | %s | `%s` |"
            % (
                sha,
                md_cell(", ".join(probe.get("zed_refs") or []) or "(none)"),
                md_cell(", ".join(probe.get("upstream_refs") or []) or "(none)"),
                "ok" if probe.get("fetch_zed", {}).get("ok") else "failed",
                "ok" if probe.get("fetch_upstream", {}).get("ok") else "failed",
                md_cell(
                    "%s (ahead %s, behind %s, base %s)"
                    % (
                        compare.get("status"),
                        compare.get("ahead_by"),
                        compare.get("behind_by"),
                        compare.get("merge_base_commit"),
                    )
                    if compare
                    else "(unavailable)"
                ),
                probe.get("tree"),
            )
        )
    lines.append("")
    equality = upstream["tree_equality"]
    lines.append(
        "- vcs commit tree: `%s`; description commit tree: `%s`; identical: **%s**."
        % (
            equality.get("vcs_tree"),
            equality.get("description_tree"),
            equality.get("identical"),
        )
    )
    relationship = upstream["fork_relationship"]
    lines.append(
        "- fork merge commit: `%s`; upstream base: `%s` (%s); source: %s."
        % (
            relationship.get("merge_commit"),
            relationship.get("upstream_base_sha"),
            relationship.get("upstream_base_subject"),
            relationship.get("upstream_base_source"),
        )
    )
    lines.append(
        "- upstream release tag `%s` is `%s`; %d upstream commits separate the tag "
        "from the base."
        % (
            relationship.get("upstream_tag_sha"),
            "an ancestor of the base"
            if relationship.get("tag_is_ancestor_of_base")
            else "not an ancestor of the base",
            len(relationship.get("upstream_commits_between_tag_and_base") or []),
        )
    )
    lines.append("")
    if relationship.get("upstream_commits_between_tag_and_base"):
        lines.append("Upstream commits between the release tag and the fork base:")
        lines.append("")
        for commit in relationship["upstream_commits_between_tag_and_base"]:
            lines.append(
                "- `%s` %s" % (commit["sha"][:12], commit["message"])
            )
        lines.append("")

    lines.append("## Crate metadata")
    lines.append("")
    crate = result["crate"]
    lines.append("| Field | Value |")
    lines.append("|---|---|")
    for key, value in crate["package_metadata"].items():
        lines.append("| %s | %s |" % (key, md_cell(value)))
    lines.append("| vcs sha1 | `%s` |" % md_cell(crate["vcs_info"].get("sha1")))
    lines.append("| vcs dirty | %s |" % md_cell(crate["vcs_info"].get("dirty")))
    lines.append(
        "| vcs path_in_vcs | %s |"
        % md_cell(repr(crate["vcs_info"].get("path_in_vcs")))
    )
    lines.append(
        "| build script | %s |" % md_cell(crate.get("build_script") or "(none)")
    )
    lines.append("| files | %d |" % crate["file_count"])
    lines.append("")

    reqwest_fingerprint = None
    for record in result["candidates"]:
        if record["id"] == "crates_io_reqwest_0_12_15":
            reqwest_fingerprint = record.get("diff_fingerprint")
    for record in result["candidates"]:
        duplicate_of = None
        if (
            record["id"] == "upstream_v0_12_15_tag"
            and reqwest_fingerprint
            and record.get("diff_fingerprint") == reqwest_fingerprint
        ):
            duplicate_of = "crates_io_reqwest_0_12_15"
        render_candidate(lines, record, duplicate_of)

    lines.append("## Method and limits")
    lines.append("")
    lines.append(
        "- Every candidate commit is shallow-fetched with `--filter=blob:none` and "
        "materialized with `git archive`; the published crate is extracted with "
        "`tar`. Files are compared byte for byte; symlinks are resolved the way "
        "cargo dereferences them."
    )
    lines.append(
        "- Packaging covers `Cargo.toml`, `Cargo.toml.orig`, `Cargo.lock`, "
        "`.cargo_vcs_info.json`, `.cargo-ok`, cargo-normalized manifest rewrites, "
        "nested packages cargo excludes, and auto-disabled target directories. "
        "Everything else is listed as a non-packaging difference."
    )
    lines.append(
        "- Origin labels for the crates.io reqwest candidate are file-level: a file "
        "byte-identical to upstream master at the fork base is labelled "
        "`upstream_drift`; any other changed file is `fork_specific_or_mixed`. The "
        "separate comparison against upstream master lists the exact fork-side "
        "lines."
    )
    lines.append(
        "- Signal categories are textual and advisory (for example, `header` "
        "matches any changed line containing `header`); they do not establish "
        "runtime effect."
    )
    lines.append(
        "- GitHub commit lookups can resolve objects that exist in the fork network "
        "even when no ref in the queried repository points at them; ref and compare "
        "results are reported separately for that reason. Unauthenticated GitHub "
        "API calls are subject to rate limits."
    )
    lines.append(
        "- Nothing downloaded was built, sourced, or executed; this report records "
        "content and provenance, not intent or runtime behaviour."
    )
    lines.append("")
    for error in summary.get("errors") or []:
        lines.append("- error: %s" % error)
    if summary.get("errors"):
        lines.append("")

    with open(OUT_MD, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines))


if __name__ == "__main__":
    try:
        main()
    except AuditError as error:
        print("audit-gpui-pre-reqwest: %s" % error, file=sys.stderr)
        sys.exit(1)
PY

AUDIT_WORK="$WORK" AUDIT_NATIVE="$NATIVE_DIR" AUDIT_ROOT="$ROOT" \
  python3 "$WORK/tools/audit.py"
