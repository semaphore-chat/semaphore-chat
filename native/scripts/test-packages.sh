#!/usr/bin/env bash
# Install and start each Linux package in a throwaway container.
#
#   native/scripts/test-packages.sh [--help]
#
# The .deb is installed on Debian 13 and Ubuntu 24.04, the .rpm on Fedora, and the AppImage is
# extracted and run in a Debian 13 container without FUSE (--appimage-extract-and-run). Each
# check proves:
#   - the package installs and puts the binary, .desktop entry, hicolor icons, metainfo and
#     third-party licences where the package manager says they are;
#   - desktop-file-validate accepts the entry;
#   - ldd reports no missing library;
#   - `semaphore-app --version` exits 0 and reports the package's version (the binary and its
#     libraries load; no window, no keyring, no socket, no display server).
#
# Every container is --rm, joins the shared semaphore-test network and mounts only the package
# directory (read-only in the install cases). Nothing touches the host.
set -euo pipefail

NATIVE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${SEMAPHORE_PACKAGES_DIR:-$NATIVE_DIR/dist-packages}"
PACKAGE="semaphore-chat-native"
APP_ID="app.semaphorechat.semaphore"
BIN_NAME="semaphore-app"
ICON_SIZES="16 24 32 48 64 128 256 512"

die() { echo "test-packages: $*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Install and start the native Linux packages in clean containers.

Usage: scripts/test-packages.sh

Environment:
  SEMAPHORE_PACKAGES_DIR  Where package-linux.sh wrote the packages
                          (default: native/dist-packages).

Images: debian:13-slim and ubuntu:24.04 for the .deb, fedora:45 for the .rpm, and
debian:13-slim again for the AppImage (no FUSE; --appimage-extract-and-run).
EOF
}

case "${1:-}" in
  -h|--help) usage; exit 0 ;;
  "") ;;
  *) die "unknown argument '$1' (try --help)" ;;
esac

command -v docker >/dev/null 2>&1 || die "docker is required"
"$NATIVE_DIR/../scripts/test-net.sh" >/dev/null

shopt -s nullglob
debs=("$OUT_DIR"/${PACKAGE}_*_amd64.deb)
rpms=("$OUT_DIR"/${PACKAGE}-*.x86_64.rpm)
appimages=("$OUT_DIR"/Semaphore-Chat-Native-*-x86_64.AppImage)
shopt -u nullglob
[ "${#debs[@]}" -gt 0 ] || die "no .deb in $OUT_DIR (run scripts/package-linux.sh first)"
[ "${#rpms[@]}" -gt 0 ] || die "no .rpm in $OUT_DIR (run scripts/package-linux.sh first)"
[ "${#appimages[@]}" -gt 0 ] || die "no AppImage in $OUT_DIR (run scripts/package-linux.sh first)"

# Newest first, so a directory with older versions still tests what was just built.
deb="$(ls -t "${debs[@]}" | head -1)"
rpm="$(ls -t "${rpms[@]}" | head -1)"
appimage="$(ls -t "${appimages[@]}" | head -1)"

echo "== packages"
for path in "$deb" "$rpm" "$appimage"; do
  printf '%10s  %s\n' "$(du -h "$path" | cut -f1)" "$(basename "$path")"
done

# The release manifest the updater reads: the same files, the same hashes and sizes, and
# nothing the updater would refuse. No package is built again for this.
echo "== latest.json"
command -v python3 >/dev/null 2>&1 || die "the manifest check needs python3 on this host"
python3 - "$OUT_DIR/latest.json" "$deb" "$rpm" "$appimage" <<'PYTHON'
import hashlib
import json
import os
import sys

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
PYTHON

# The shell that runs inside the .deb/.rpm container. It gets PKG, PM and the names in the
# environment; nothing is interpolated into the script text.
install_and_check() { # <image> <package-manager> <package path> <label>
  local image="$1" pm="$2" pkg="$3" label="$4"
  docker run --rm --network semaphore-test \
    -v "$(dirname "$pkg"):/packages:ro" \
    -e "PKG=/packages/$(basename "$pkg")" \
    -e "PM=$pm" \
    -e "PACKAGE=$PACKAGE" \
    -e "APP_ID=$APP_ID" \
    -e "BIN_NAME=$BIN_NAME" \
    -e "ICON_SIZES=$ICON_SIZES" \
    "$image" bash -c '
      set -euo pipefail
      export DEBIAN_FRONTEND=noninteractive HOME=/tmp
      if [ "$PM" = apt ]; then
        # Debian/Ubuntu container images exclude /usr/share/doc/* to save space; a real system
        # installs it. Remove the container-only exclusion so the package is tested as shipped.
        rm -f /etc/dpkg/dpkg.cfg.d/docker /etc/dpkg/dpkg.cfg.d/excludes
        apt-get update -qq >/dev/null
        apt-get install -y -qq "$PKG" desktop-file-utils binutils file >/dev/null
        installed_size="$(dpkg-query -W -f="\${Installed-Size}" "$PACKAGE") KiB"
        installed_version="$(dpkg-query -W -f="\${Version}" "$PACKAGE")"
        list() { dpkg -L "$PACKAGE"; }
      else
        dnf -q -y --nogpgcheck install "$PKG" desktop-file-utils binutils file >/dev/null
        installed_size="$(rpm -q --queryformat "%{SIZE}" "$PACKAGE") bytes"
        installed_version="$(rpm -q --queryformat "%{VERSION}" "$PACKAGE")"
        list() { rpm -ql "$PACKAGE"; }
      fi

      echo "--- $PACKAGE"
      list > /tmp/files
      fail=0
      check_file() {
        grep -qx "$1" /tmp/files || { echo "MISSING from package: $1"; fail=1; }
        [ -f "$1" ] || { echo "MISSING on disk: $1"; fail=1; }
      }
      check_file "/usr/bin/$BIN_NAME"
      check_file "/usr/share/applications/$APP_ID.desktop"
      check_file "/usr/share/metainfo/$APP_ID.metainfo.xml"
      check_file "/usr/share/doc/$PACKAGE/THIRD-PARTY-LICENCES.txt"
      check_file "/usr/share/doc/$PACKAGE/LICENSE.md"
      check_file "/usr/share/doc/$PACKAGE/LICENSE_COM.md"
      check_file "/usr/share/doc/$PACKAGE/copyright"
      for size in $ICON_SIZES; do
        check_file "/usr/share/icons/hicolor/${size}x${size}/apps/$APP_ID.png"
      done
      [ "$fail" = 0 ] || exit 1

      desktop-file-validate "/usr/share/applications/$APP_ID.desktop"
      echo "desktop-file-validate: ok"

      if ldd "/usr/bin/$BIN_NAME" | grep -q "not found"; then
        echo "ldd reports missing libraries:"
        ldd "/usr/bin/$BIN_NAME" | grep "not found"
        exit 1
      fi
      echo "ldd: no missing libraries"

      printed="$(SEMAPHORE_REGISTER_SCHEME=0 "/usr/bin/$BIN_NAME" --version)"
      echo "$printed"
      [ "$printed" = "$BIN_NAME $installed_version" ] \
        || { echo "version mismatch: package $installed_version, binary $printed"; exit 1; }
      echo "installed size: $installed_size"
      du -sh "/usr/bin/$BIN_NAME" \
        "/usr/share/applications/$APP_ID.desktop" \
        /usr/share/icons/hicolor/*/apps/"$APP_ID".png \
        "/usr/share/metainfo/$APP_ID.metainfo.xml" \
        "/usr/share/doc/$PACKAGE" | sed "s/^/  /"
    '
}

echo
echo "== .deb on Debian 13"
install_and_check debian:13-slim apt "$deb" "Debian 13"
echo
echo "== .deb on Ubuntu 24.04"
install_and_check ubuntu:24.04 apt "$deb" "Ubuntu 24.04"
echo
echo "== .rpm on Fedora"
install_and_check fedora:45 dnf "$rpm" "Fedora 45"

echo
echo "== AppImage on Debian 13 (no FUSE)"
docker run --rm --network semaphore-test \
  -v "$(dirname "$appimage"):/packages:ro" \
  -e "PKG=/packages/$(basename "$appimage")" \
  -e "PACKAGE=$PACKAGE" \
  -e "APP_ID=$APP_ID" \
  -e "BIN_NAME=$BIN_NAME" \
  -e "ICON_SIZES=$ICON_SIZES" \
  debian:13-slim bash -c '
    set -euo pipefail
    export DEBIAN_FRONTEND=noninteractive HOME=/tmp
    # The AppImage relies on the host desktop libraries, exactly like the .deb; install the same
    # declared dependencies. It is not a bundle of libc/glib/PipeWire.
    apt-get update -qq >/dev/null
    apt-get install -y -qq libglib2.0-0 libpipewire-0.3-0 libasound2 libxcb1 \
      libxkbcommon0 libxkbcommon-x11-0 libgcc-s1 desktop-file-utils binutils file >/dev/null
    cp "$PKG" /tmp/semaphore.AppImage
    chmod +x /tmp/semaphore.AppImage
    cd /tmp
    ./semaphore.AppImage --appimage-extract >/dev/null
    for path in \
      "squashfs-root/usr/bin/$BIN_NAME" \
      "squashfs-root/usr/share/applications/$APP_ID.desktop" \
      "squashfs-root/usr/share/metainfo/$APP_ID.metainfo.xml" \
      "squashfs-root/usr/share/doc/$PACKAGE/THIRD-PARTY-LICENCES.txt" \
      "squashfs-root/$APP_ID.desktop" \
      "squashfs-root/$APP_ID.png"; do
      [ -f "$path" ] || { echo "MISSING from AppImage: $path"; exit 1; }
    done
    for size in $ICON_SIZES; do
      [ -f "squashfs-root/usr/share/icons/hicolor/${size}x${size}/apps/$APP_ID.png" ] \
        || { echo "MISSING icon ${size}x${size}"; exit 1; }
    done
    desktop-file-validate "squashfs-root/$APP_ID.desktop"
    desktop-file-validate "squashfs-root/usr/share/applications/$APP_ID.desktop"
    echo "desktop-file-validate: ok"
    if ldd "squashfs-root/usr/bin/$BIN_NAME" | grep -q "not found"; then
      echo "ldd reports missing libraries:"
      ldd "squashfs-root/usr/bin/$BIN_NAME" | grep "not found"
      exit 1
    fi
    echo "ldd: no missing libraries"
    printed="$(./semaphore.AppImage --appimage-extract-and-run --version)"
    echo "$printed"
    app_version="$(basename "$PKG" | sed "s/^Semaphore-Chat-Native-//; s/-x86_64.AppImage$//")"
    [ "$printed" = "$BIN_NAME $app_version" ] \
      || { echo "version mismatch: package $app_version, binary $printed"; exit 1; }
    du -sh /tmp/semaphore.AppImage squashfs-root | sed "s/^/  /"
  '

echo
echo "all package checks passed"
