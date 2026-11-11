#!/usr/bin/env python3
"""Fail if a UI crate, a desktop-only crate or a C build reaches semaphore-core or
semaphore-wire.

    check-core-boundary.py [--manifest-path Cargo.toml]

Walks each crate's normal and build dependencies with `cargo tree --target all`, so every
target and every feature the crate itself selects is covered, which is deliberately stricter
than any one build. Dev-dependencies are skipped: they never reach a consumer. Prints each
offender with the path that pulled it in.

Resolving from the crate rather than from `cargo metadata`'s workspace-wide resolve is what
makes the answer true to the crate: features are unified across a workspace, so another
member enabling `uuid/js` or `chrono/clock` would otherwise make semaphore-wire look like it
builds C for wasm or Haiku.

This is what keeps both crates checkable on iOS and Android with no C toolchain: the crates
that fail there (ring, webrtc-sys, link-cplusplus) all compile C or C++ in a build script.
semaphore-wire holds every type core talks about, so the same rule keeps the wire types
usable from core.
"""
import argparse
import json
import re
import subprocess
import sys

CRATES = ("semaphore-core", "semaphore-wire")

UI_CRATES = re.compile(
    r"^(gpui.*|iced.*|wgpu.*|winit|slint.*|egui.*|eframe|xilem.*|masonry.*|freya.*|dioxus.*"
    r"|tauri.*|gtk.*|gdk.*|qt.*|blade-.*|cosmic-text|accesskit.*)$"
)
DESKTOP_CRATES = re.compile(
    r"^(livekit.*|libwebrtc|webrtc-.*|keyring|ksni|tray-icon|pipewire.*|wasapi|windows-capture"
    r"|cpal|ashpd|zbus.*|x11.*|xcb.*|wayland-.*|directories|dirs.*|notify-rust)$"
)
C_BUILD_CRATES = re.compile(
    r"^(cc|cmake|cxx|cxx-build|cxxbridge-.*|bindgen|pkg-config|vcpkg|nasm-rs|autotools"
    r"|ring|aws-lc-.*|openssl|rusqlite)$"
)


def classify(name, links):
    """Why this package may not reach these crates, or None if it may."""
    if UI_CRATES.match(name):
        return "UI crate"
    if DESKTOP_CRATES.match(name):
        return "desktop-only crate"
    if C_BUILD_CRATES.match(name):
        return "C build dependency"
    if links:
        return f"links native library {links!r}"
    if name.endswith("-sys"):
        return "-sys crate"
    return None


def dependency_tree(crate, manifest):
    """Maps each package reachable from `crate` to the package that first pulled it in."""
    tree = subprocess.run(
        [
            "cargo",
            "tree",
            "--manifest-path",
            manifest,
            "-p",
            crate,
            "--target",
            "all",
            "--edges",
            "normal,build",
            "--prefix",
            "depth",
            "--format",
            "{p}",
        ],
        check=True,
        capture_output=True,
        text=True,
    ).stdout

    parents = {}
    ancestry = []
    for line in tree.splitlines():
        match = re.match(r"^(\d+)(.*)$", line)
        if not match:
            continue
        depth = int(match.group(1))
        # `{p}` is `name vX.Y.Z` and sometimes a path or a `(*)` repeat marker.
        name = match.group(2).split(" v", 1)[0]
        ancestry = ancestry[:depth] + [name]
        parents.setdefault(name, ancestry[-2] if depth > 0 else None)
    return parents


def metadata(manifest):
    """`(links per package name, workspace member names)`."""
    metadata = json.loads(
        subprocess.run(
            ["cargo", "metadata", "--format-version", "1", "--manifest-path", manifest],
            check=True,
            capture_output=True,
            text=True,
        ).stdout
    )
    links = {}
    for package in metadata["packages"]:
        if package.get("links"):
            links.setdefault(package["name"], package["links"])
    members = {
        package["name"]
        for package in metadata["packages"]
        if package["id"] in metadata["workspace_members"]
    }
    return links, members


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest-path", default="Cargo.toml")
    args = parser.parse_args()

    links, members = metadata(args.manifest_path)
    failed = False
    checked = 0
    for crate in CRATES:
        # scripts/test-policy.sh runs this against throwaway workspaces that hold only one
        # of the two, with a bad dependency added.
        if crate not in members:
            print(f"{crate}: not a member of {args.manifest_path}, skipped")
            continue
        checked += 1
        parents = dependency_tree(crate, args.manifest_path)

        offenders = []
        for name in parents:
            if name == crate:
                continue
            reason = classify(name, links.get(name))
            if not reason:
                continue
            path = [name]
            current = parents[name]
            while current is not None and current not in path:
                path.append(current)
                current = parents.get(current)
            offenders.append(f"{name}: {reason} ({' <- '.join(path)})")

        if offenders:
            print(f"{crate} boundary violated:", file=sys.stderr)
            for offender in sorted(offenders):
                print(f"  {offender}", file=sys.stderr)
            failed = True
            continue
        names = sorted(name for name in parents if name != crate)
        print(
            f"{crate} boundary ok: {len(names)} dependencies, none UI, desktop-only or "
            "C-building"
        )
        print("  " + " ".join(names))
    if checked == 0:
        sys.exit(f"none of {', '.join(CRATES)} is a member of {args.manifest_path}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
