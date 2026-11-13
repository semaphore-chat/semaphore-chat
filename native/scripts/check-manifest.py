#!/usr/bin/env python3
"""Check a release manifest (latest.json) against the packages it describes.

    scripts/check-manifest.py <latest.json> <deb> <rpm> <appimage>

The same rules the native updater applies (crates/semaphore-platform-desktop/src/update/manifest.rs
and version.rs), so a manifest every client would reject is never published: a semantic version
(no "v", no leading zeros), an https notes URL, one x86_64 artifact of each kind with an https URL,
a 64-hex SHA-256 and a positive size; and each file's hash, size and name must match. Run by
scripts/test-packages.sh; standard library only.
"""
import hashlib
import json
import os
import re
import sys

# semver.org's grammar, as the updater's `semver` crate parses it.
SEMVER = re.compile(
    r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)"
    r"(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?"
    r"(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$",
    re.ASCII,
)

manifest_path, *paths = sys.argv[1:]
try:
    with open(manifest_path, encoding="utf-8") as handle:
        manifest = json.load(handle)
except OSError as error:
    sys.exit(f"no manifest at {manifest_path} ({error}): run scripts/package-linux.sh")


def fail(problem):
    sys.exit(f"{manifest_path}: {problem}")


if not isinstance(manifest.get("version"), str) or not manifest["version"]:
    fail("no version")
if not SEMVER.match(manifest["version"]):
    fail(f"version {manifest['version']!r} is not a semantic version the updater accepts")
notes = manifest.get("notes_url")
if not isinstance(notes, str) or not notes.startswith("https://"):
    fail(f"notes_url {notes!r} is not an https URL")
artifacts = manifest.get("artifacts")
if not isinstance(artifacts, list):
    fail("no artifacts")

by_kind = {}
for artifact in artifacts:
    kind = artifact.get("kind")
    if kind not in ("appimage", "deb", "rpm"):
        fail(f"unknown kind {kind!r}")
    if kind in by_kind:
        fail(f"two {kind} artifacts")
    if artifact.get("arch") != "x86_64":
        fail(f"{kind} is for {artifact.get('arch')!r}")
    if not str(artifact.get("url", "")).startswith("https://"):
        fail(f"{kind} url {artifact.get('url')!r} is not https")
    digest = artifact.get("sha256", "")
    if len(digest) != 64 or any(character not in "0123456789abcdef" for character in digest):
        fail(f"{kind} sha256 is not 64 lowercase hex digits")
    if not isinstance(artifact.get("size"), int) or artifact["size"] <= 0:
        fail(f"{kind} size {artifact.get('size')!r} is not a positive integer")
    by_kind[kind] = artifact
missing = [kind for kind in ("appimage", "deb", "rpm") if kind not in by_kind]
if missing:
    fail(f"no {', '.join(missing)} artifact")

kinds = []
for path in paths:
    kind = {"AppImage": "appimage", "deb": "deb", "rpm": "rpm"}.get(path.rsplit(".", 1)[-1])
    if kind is None:
        fail(f"which artifact is {path}?")
    kinds.append(kind)
    artifact = by_kind[kind]
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    size = os.path.getsize(path)
    if artifact["sha256"] != digest.hexdigest():
        fail(f"{kind} sha256 does not match {path}")
    if artifact["size"] != size:
        fail(f"{kind} size {artifact['size']} is not {path}'s {size}")
    if not artifact["url"].endswith("/" + os.path.basename(path)):
        fail(f"{kind} url does not name {os.path.basename(path)}")
    print(f"  {kind:<8} {size:>10} bytes  {artifact['sha256'][:16]}...  {artifact['url']}")
if sorted(kinds) != sorted(by_kind):
    fail(f"the manifest and the files disagree: {sorted(by_kind)} against {sorted(kinds)}")
print(f"  version {manifest['version']}, notes {notes}")
