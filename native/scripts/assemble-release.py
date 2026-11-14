#!/usr/bin/env python3
"""Assemble a native preview release: the files to publish, latest.json and SHA256SUMS.

    scripts/assemble-release.py --version 0.10.0 --tag native-v0.10.0 \\
        --repo semaphore-chat/semaphore-chat --out <dir> <file>...

The files are the packages the release builds: one each of the AppImage, .deb, .rpm (from
scripts/package-linux.sh), the Windows portable zip and the NSIS installer (from
.github/workflows/native-package.yml and scripts/package-windows.sh). Each is copied into <dir>,
whose contents are then exactly the release's assets apart from the signature:

  - latest.json: the manifest the updater reads (the format in docs/packaging.md, "Auto-update"),
    with every URL pointing at this tag's release assets and notes_url at its release page;
  - SHA256SUMS: sha256sum lines for every artifact.

Refuses a version that isn't X.Y.Z, a tag that isn't native-v<version>, a file whose name
doesn't carry the version (so a package built from another version can't slip in), and a set
that isn't exactly one file of each kind. Run scripts/check-manifest.py on the result.
Standard library only.
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import sys

# What a native release may be called. Plain X.Y.Z: the Windows package step only accepts
# [0-9A-Za-z.] in a version, and every native release is already a GitHub pre-release.
VERSION = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$", re.ASCII)

# kind -> (file name pattern with {v} for the version, what it is)
KINDS = {
    "appimage": ("Semaphore-Chat-Native-{v}-x86_64.AppImage", "AppImage"),
    "deb": ("semaphore-chat-native_{v}_amd64.deb", ".deb"),
    "rpm": ("semaphore-chat-native-{v}-1.x86_64.rpm", ".rpm"),
    "windows-zip": ("semaphore-chat-native-{v}-windows-x86_64.zip", "Windows zip"),
    "windows-nsis": ("Semaphore-Chat-Native-Setup-{v}-x64.exe", "Windows installer"),
}
# Which kind a file is, by its suffix.
SUFFIXES = {
    ".AppImage": "appimage",
    ".deb": "deb",
    ".rpm": "rpm",
    ".zip": "windows-zip",
    ".exe": "windows-nsis",
}


def fail(message):
    sys.exit(f"assemble-release: {message}")


def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def kind_of(path):
    for suffix, kind in SUFFIXES.items():
        if path.endswith(suffix):
            return kind
    fail(f"which artifact is {path}? (expected one of {', '.join(SUFFIXES)})")


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--version", required=True)
    parser.add_argument("--tag", required=True)
    parser.add_argument("--repo", required=True, help="owner/name on github.com")
    parser.add_argument("--out", required=True)
    parser.add_argument("files", nargs="+")
    args = parser.parse_args()

    version = args.version
    if not VERSION.match(version):
        fail(f"version {version!r} is not X.Y.Z (no 'v', no pre-release or build suffix)")
    if args.tag != f"native-v{version}":
        fail(f"tag {args.tag!r} does not name version {version} (expected native-v{version})")
    if not re.match(r"^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$", args.repo):
        fail(f"repository {args.repo!r} is not owner/name")

    by_kind = {}
    for path in args.files:
        if not os.path.isfile(path):
            fail(f"no file at {path}")
        kind = kind_of(path)
        if kind in by_kind:
            fail(f"two {KINDS[kind][1]} files: {by_kind[kind]} and {path}")
        expected = KINDS[kind][0].format(v=version)
        if os.path.basename(path) != expected:
            fail(
                f"{path} is not {expected}: the {KINDS[kind][1]} must be built as version "
                f"{version} (a tag whose version doesn't match the build fails here)"
            )
        if os.path.getsize(path) == 0:
            fail(f"{path} is empty")
        by_kind[kind] = path
    missing = [KINDS[kind][1] for kind in KINDS if kind not in by_kind]
    if missing:
        fail(f"no {', '.join(missing)} among the files")

    os.makedirs(args.out, exist_ok=True)
    if os.listdir(args.out):
        fail(f"{args.out} is not empty")
    base = f"https://github.com/{args.repo}/releases/download/{args.tag}"
    artifacts = []
    sums = []
    for kind in KINDS:
        source = by_kind[kind]
        name = os.path.basename(source)
        target = os.path.join(args.out, name)
        shutil.copyfile(source, target)
        digest = sha256(target)
        size = os.path.getsize(target)
        artifacts.append(
            {"kind": kind, "arch": "x86_64", "url": f"{base}/{name}", "sha256": digest, "size": size}
        )
        sums.append(f"{digest}  {name}\n")
        print(f"  {kind:<13} {size:>10} bytes  {digest[:16]}...  {name}")

    manifest = {
        "version": version,
        "notes_url": f"https://github.com/{args.repo}/releases/tag/{args.tag}",
        "artifacts": artifacts,
    }
    # These bytes are what gets signed: written once, never reformatted afterwards.
    with open(os.path.join(args.out, "latest.json"), "w", encoding="utf-8", newline="\n") as handle:
        handle.write(json.dumps(manifest, indent=2) + "\n")
    with open(os.path.join(args.out, "SHA256SUMS"), "w", encoding="utf-8", newline="\n") as handle:
        handle.writelines(sums)
    print(f"  latest.json and SHA256SUMS for {args.tag} in {args.out}")


main()
