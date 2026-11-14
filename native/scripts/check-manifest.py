#!/usr/bin/env python3
"""Check a release manifest (latest.json) against the packages it describes.

    scripts/check-manifest.py [--base-url <url>] [--notes-url <url>] <latest.json> <file>...

The same rules the native updater applies (crates/semaphore-platform-desktop/src/update/manifest.rs
and version.rs), so a manifest every client would reject is never published: a semantic version
(no "v", no leading zeros), an https notes URL, at most one x86_64 artifact of each kind with an
https URL, a 64-hex SHA-256 and a positive size, and always the three Linux kinds; and each file's
hash, size and name must match, with the files and the manifest naming the same kinds.

Files are told apart by suffix: .AppImage, .deb, .rpm, .zip (windows-zip) and .exe (windows-nsis).
--base-url requires every artifact URL to be <url>/<file name>, --notes-url the notes link to be
exactly <url>: the release workflow passes its tag's download and release-page URLs. Run by
scripts/test-packages.sh (the Linux manifest), the release workflow and
scripts/test-release-assembly.sh (the release's); standard library only.
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

KINDS = ("appimage", "deb", "rpm", "windows-zip", "windows-nsis")
REQUIRED = ("appimage", "deb", "rpm")
SUFFIXES = {"AppImage": "appimage", "deb": "deb", "rpm": "rpm", "zip": "windows-zip", "exe": "windows-nsis"}

arguments = sys.argv[1:]
options = {}
while arguments and arguments[0] in ("--base-url", "--notes-url"):
    if len(arguments) < 2:
        sys.exit(f"{arguments[0]} needs a value")
    options[arguments[0]] = arguments[1]
    arguments = arguments[2:]
if not arguments:
    sys.exit(__doc__)
manifest_path, *paths = arguments
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
if "--notes-url" in options and notes != options["--notes-url"]:
    fail(f"notes_url {notes!r} is not {options['--notes-url']!r}")
artifacts = manifest.get("artifacts")
if not isinstance(artifacts, list):
    fail("no artifacts")

by_kind = {}
for artifact in artifacts:
    kind = artifact.get("kind")
    if kind not in KINDS:
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
missing = [kind for kind in REQUIRED if kind not in by_kind]
if missing:
    fail(f"no {', '.join(missing)} artifact")

kinds = []
for path in paths:
    kind = SUFFIXES.get(path.rsplit(".", 1)[-1])
    if kind is None:
        fail(f"which artifact is {path}?")
    if kind in kinds:
        fail(f"two {kind} files given")
    kinds.append(kind)
    if kind not in by_kind:
        fail(f"{path} is a {kind} file, which the manifest does not list")
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
    if "--base-url" in options:
        expected = options["--base-url"].rstrip("/") + "/" + os.path.basename(path)
        if artifact["url"] != expected:
            fail(f"{kind} url {artifact['url']!r} is not {expected!r}")
    print(f"  {kind:<8} {size:>10} bytes  {artifact['sha256'][:16]}...  {artifact['url']}")
if sorted(kinds) != sorted(by_kind):
    fail(f"the manifest and the files disagree: {sorted(by_kind)} against {sorted(kinds)}")
print(f"  version {manifest['version']}, notes {notes}")
