#!/usr/bin/env python3
"""Fail if a UI crate, a desktop-only crate or a C build reaches semaphore-core.

    check-core-boundary.py [--manifest-path Cargo.toml]

Walks core's normal and build dependencies from `cargo metadata`, for every target and
feature, which is deliberately stricter than any one build. Dev-dependencies are skipped:
they never reach a consumer. Prints each offender with the path that pulled it in.

This is what keeps core checkable on iOS and Android with no C toolchain: the crates that
fail there (ring, webrtc-sys, link-cplusplus) all compile C or C++ in a build script.
"""
import argparse
import json
import re
import subprocess
import sys

CORE = "semaphore-core"

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


def classify(package):
    """Why this package may not reach core, or None if it may."""
    name = package["name"]
    if UI_CRATES.match(name):
        return "UI crate"
    if DESKTOP_CRATES.match(name):
        return "desktop-only crate"
    if C_BUILD_CRATES.match(name):
        return "C build dependency"
    if package.get("links"):
        return f"links native library {package['links']!r}"
    if name.endswith("-sys"):
        return "-sys crate"
    return None


def reachable_from(core_id, nodes):
    """Maps each package id reachable from core to the id that first pulled it in."""
    parents = {core_id: None}
    queue = [core_id]
    while queue:
        current = queue.pop()
        for dep in nodes[current]["deps"]:
            kinds = {kind["kind"] for kind in dep["dep_kinds"]}
            if kinds == {"dev"} or dep["pkg"] in parents:
                continue
            parents[dep["pkg"]] = current
            queue.append(dep["pkg"])
    return parents


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest-path", default="Cargo.toml")
    args = parser.parse_args()

    metadata = json.loads(
        subprocess.run(
            ["cargo", "metadata", "--format-version", "1", "--manifest-path", args.manifest_path],
            check=True,
            capture_output=True,
            text=True,
        ).stdout
    )
    packages = {package["id"]: package for package in metadata["packages"]}
    nodes = {node["id"]: node for node in metadata["resolve"]["nodes"]}

    core_ids = [id_ for id_, package in packages.items() if package["name"] == CORE]
    if len(core_ids) != 1:
        sys.exit(f"expected exactly one {CORE} package, found {len(core_ids)}")

    parents = reachable_from(core_ids[0], nodes)
    offenders = []
    for package_id in parents:
        if package_id == core_ids[0]:
            continue
        reason = classify(packages[package_id])
        if reason:
            path = []
            current = package_id
            while current is not None:
                path.append(packages[current]["name"])
                current = parents[current]
            offenders.append(f"{packages[package_id]['name']}: {reason} ({' <- '.join(path)})")

    if offenders:
        print(f"{CORE} boundary violated:", file=sys.stderr)
        for offender in sorted(offenders):
            print(f"  {offender}", file=sys.stderr)
        sys.exit(1)
    names = sorted(packages[id_]["name"] for id_ in parents if id_ != core_ids[0])
    print(f"{CORE} boundary ok: {len(names)} dependencies, none UI, desktop-only or C-building")
    print("  " + " ".join(names))


if __name__ == "__main__":
    main()
