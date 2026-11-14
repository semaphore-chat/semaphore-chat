#!/usr/bin/env bash
# Build the Linux packages of the native client from one place:
#
#   native/scripts/package-linux.sh [--help]
#
# The build runs in the pinned Debian 12 package image (docker/Dockerfile.package), not the
# Arch development image, because a binary linked on Arch needs glibc 2.44 and would not
# start on any current Debian, Ubuntu or Fedora (native/docs/size.md, "Release build
# environment"). Debian 12 has glibc 2.36; the binary needs at most GLIBC_2.35.
#
# The packages are written to native/dist-packages/ (gitignored; SEMAPHORE_PACKAGES_DIR
# overrides). They are not reproducible byte-for-byte across hosts: the Rust and LLVM
# toolchains are pinned, but Debian's package archive and apt.llvm.org move. The output is
# reproducible on a given host, and SOURCE_DATE_EPOCH (the checkout's commit time) fixes
# file timestamps.
#
# Version: the semaphore-app crate's Cargo.toml version (0.0.0 today), or SEMAPHORE_VERSION.
# CI passes the release version, e.g. SEMAPHORE_VERSION=0.10.0 native/scripts/package-linux.sh.
#
# Alongside the packages it writes latest.json, the release manifest the native updater reads
# (docs/packaging.md, "Auto-update"): the version, the release's notes URL and each artifact's
# URL, SHA-256 and size. SEMAPHORE_UPDATE_BASE_URL is the URL the artifacts will be published
# under; SEMAPHORE_RELEASE_NOTES_URL overrides the notes link.
set -euo pipefail

NATIVE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$NATIVE_DIR/.." && pwd)"
HOST_UID="$(id -u)"
HOST_GID="$(id -g)"

PACKAGE="semaphore-chat-native"
APP_ID="app.semaphorechat.semaphore"
BIN_NAME="semaphore-app"
OUT_DIR="${SEMAPHORE_PACKAGES_DIR:-$NATIVE_DIR/dist-packages}"

die() { echo "package-linux: $*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Build the native Linux packages: an AppImage, a .deb and an .rpm.

Usage: scripts/package-linux.sh

Environment:
  SEMAPHORE_VERSION     Package version; defaults to the semaphore-app crate's version.
  SEMAPHORE_PACKAGES_DIR Output directory; defaults to native/dist-packages.
  SEMAPHORE_UPDATE_BASE_URL
                        Where latest.json says the artifacts are published. Defaults to
                        https://github.com/semaphore-chat/semaphore-chat/releases/download/v<version>
  SEMAPHORE_RELEASE_NOTES_URL
                        The release's notes page. Defaults to the matching GitHub release tag.
  SEMAPHORE_UPDATE_MANIFEST_URL
                        The update feed compiled into the binary. Empty (no update checks)
                        unless the release workflow sets it (docs/packaging.md, "Auto-update").

The build runs in native/docker/Dockerfile.package (Debian 12, clang 22, rustup) and writes
into the named volumes semaphore-native-package-cargo and
semaphore-native-package-target-<checkout>. It creates no Docker network; it uses the shared
semaphore-test network from scripts/test-net.sh.

Artifacts:
  Semaphore-Chat-Native-<version>-x86_64.AppImage
  semaphore-chat-native_<version>_amd64.deb
  semaphore-chat-native-<version>-1.x86_64.rpm
  latest.json            The release manifest the updater reads
  SHA256SUMS
EOF
}

# --- The part that runs inside the package image -------------------------------------------

in_image() {
  : "${OUT_DIR:?the outer script must set OUT_DIR}"
  : "${SOURCE_DATE_EPOCH:?the outer script must set SOURCE_DATE_EPOCH}"
  cd "$NATIVE_DIR"

  local version="${SEMAPHORE_VERSION:-}"
  if [ -z "$version" ]; then
    version="$(cargo metadata --locked --no-deps --format-version 1 \
      | jq -r '.packages[] | select(.name == "semaphore-app") | .version')"
  fi
  version="${version#v}"
  [[ "$version" =~ ^[0-9][0-9A-Za-z.]*$ ]] \
    || die "version '$version' is not usable in a .deb and .rpm (use digits, letters and dots)"
  local release_date
  release_date="$(date -u -d "@$SOURCE_DATE_EPOCH" +%F)"

  echo "== building semaphore-app $version (dist profile, SEMAPHORE_PACKAGED=1, player)"
  # build.rs compiles this into the binary, so `--version` and the package version agree.
  export SEMAPHORE_VERSION="$version"
  # The shipped player, and with it AAC-LC decoding (docs/player.md): it is part of every package.
  SEMAPHORE_PACKAGED=1 cargo build --locked --profile dist -p semaphore-app --features player

  local target_dir bin
  target_dir="$(cargo metadata --locked --no-deps --format-version 1 | jq -r .target_directory)"
  bin="$target_dir/dist/$BIN_NAME"
  [ -x "$bin" ] || die "no binary at $bin"
  file "$bin"

  WORK_DIR="$(mktemp -d)"
  trap 'rm -rf "$WORK_DIR"' EXIT
  local work="$WORK_DIR"
  local stage="$work/root"
  install -Dm755 "$bin" "$stage/usr/bin/$BIN_NAME"

  # Icons: the app ships one 512 px PNG (crates/semaphore-platform-desktop/assets/icon.png);
  # hicolor wants the standard sizes, so derive them from it.
  local icon_src="$NATIVE_DIR/crates/semaphore-platform-desktop/assets/icon.png"
  for size in 16 24 32 48 64 128 256 512; do
    local dir="$stage/usr/share/icons/hicolor/${size}x${size}/apps"
    install -d "$dir"
    if [ "$size" = 512 ]; then
      install -m644 "$icon_src" "$dir/$APP_ID.png"
    else
      convert "$icon_src" -strip -depth 8 -filter Lanczos -resize "${size}x${size}" "$dir/$APP_ID.png"
    fi
  done

  write_desktop() { # <Exec> <path>
    cat >"$2" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=Semaphore Chat
GenericName=Voice Chat Application
Comment=Self-hosted voice and text chat application
Exec=$1 -- %u
TryExec=$1
Icon=$APP_ID
Terminal=false
Categories=Network;InstantMessaging;AudioVideo;
Keywords=chat;voice;video;messaging;
MimeType=x-scheme-handler/semaphore;
StartupWMClass=$APP_ID
EOF
  }
  install -d "$stage/usr/share/applications"
  write_desktop "/usr/bin/$BIN_NAME" "$stage/usr/share/applications/$APP_ID.desktop"

  install -d "$stage/usr/share/metainfo"
  cat >"$stage/usr/share/metainfo/$APP_ID.metainfo.xml" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<component type="desktop-application">
  <id>$APP_ID</id>
  <name>Semaphore Chat</name>
  <summary>Self-hosted voice and text chat</summary>
  <metadata_license>CC0-1.0</metadata_license>
  <project_license>AGPL-3.0-only</project_license>
  <developer id="app.semaphorechat">
    <name>Semaphore Chat Team</name>
  </developer>
  <description>
    <p>Semaphore Chat is a self-hosted voice and text chat client.</p>
    <p>The native client uses GPUI and libwebrtc instead of a webview: text channels, direct
    messages, calls, screen sharing and the in-app audio and video player.</p>
  </description>
  <launchable type="desktop-id">$APP_ID.desktop</launchable>
  <url type="homepage">https://semaphorechat.app</url>
  <url type="bugtracker">https://github.com/semaphore-chat/semaphore-chat/issues</url>
  <categories>
    <category>Network</category>
    <category>InstantMessaging</category>
    <category>AudioVideo</category>
  </categories>
  <icon type="stock">$APP_ID</icon>
  <content_rating type="oars-1.1"/>
  <releases>
    <release version="$version" date="$release_date"/>
  </releases>
</component>
EOF

  local doc="$stage/usr/share/doc/$PACKAGE"
  install -d "$doc"
  install -m644 "$ROOT/LICENSE.md" "$doc/LICENSE.md"
  install -m644 "$ROOT/LICENSE_COM.md" "$doc/LICENSE_COM.md"
  cat >"$doc/copyright" <<EOF
Semaphore Chat is licensed under the GNU Affero General Public License, version 3 only
(AGPL-3.0-only), with a commercial licence available as an alternative. See LICENSE.md and
LICENSE_COM.md.

The binary and the assets compiled into it include third-party code and data under the
licences listed in THIRD-PARTY-LICENCES.txt.
EOF

  echo "== writing third-party licences"
  generate_licences "$doc/THIRD-PARTY-LICENCES.txt" "$version" "$work"

  echo "== checking the desktop entry and metainfo"
  desktop-file-validate "$stage/usr/share/applications/$APP_ID.desktop"
  appstreamcli validate --no-net "$stage/usr/share/metainfo/$APP_ID.metainfo.xml" \
    || die "appstreamcli rejected the metainfo"

  local deb="$OUT_DIR/${PACKAGE}_${version}_amd64.deb"
  local rpm="$OUT_DIR/${PACKAGE}-${version}-1.x86_64.rpm"
  local appimage="$OUT_DIR/Semaphore-Chat-Native-${version}-x86_64.AppImage"
  rm -f "$deb" "$rpm" "$appimage" "$OUT_DIR/latest.json" "$OUT_DIR/SHA256SUMS"

  echo "== .deb"
  build_deb "$stage" "$deb" "$version"
  echo "== .rpm"
  build_rpm "$stage" "$rpm" "$version" "$work"
  echo "== AppImage"
  build_appimage "$stage" "$appimage" "$version" "$work"

  finish_artifacts "$deb" "$rpm" "$appimage" "$version"

  echo
  echo "== artifacts in $OUT_DIR"
  ls -lh "$deb" "$rpm" "$appimage" "$OUT_DIR/latest.json" "$OUT_DIR/SHA256SUMS" \
    | awk '{print $5"\t"$9}'
  echo
  echo "== installed tree (the same files are in all three packages)"
  du -ah "$stage" | sort -k2 | sed "s#$stage#/#"
}

# What the build flow does once the three packages exist: SHA256SUMS and latest.json, both in
# OUT_DIR. `--finish-artifacts` runs exactly this on existing files (no build, no image), which is
# how the manifest step is tested.
finish_artifacts() { # <deb> <rpm> <appimage> <version>
  local deb="$1" rpm="$2" appimage="$3" version="$4"
  ( cd "$OUT_DIR" && sha256sum "$(basename "$deb")" "$(basename "$rpm")" \
      "$(basename "$appimage")" > SHA256SUMS )
  echo "== latest.json"
  write_manifest "$deb" "$rpm" "$appimage" "$version"
}

# A semantic version as the updater parses it (semver.org's grammar: no leading zeros, no "v").
SEMVER_RE='^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-((0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(\.(0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*))?(\+([0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*))?$'

# The release manifest the updater reads. Its URLs are the names the artifacts will be published
# under, not where they are now; the hashes and sizes are of the files just built. Nothing is
# signed here: the release workflow assembles and signs the published manifest from every
# platform's packages (scripts/assemble-release.py; docs/packaging.md, "Releasing a preview").
write_manifest() { # <deb> <rpm> <appimage> <version>
  local deb="$1" rpm="$2" appimage="$3" version="$4"
  # Every client would reject anything else (a "v0.10.0" from a tag, say) and never update.
  [[ "$version" =~ $SEMVER_RE ]] \
    || die "latest.json: version '$version' is not a semantic version the updater accepts"
  local base="${SEMAPHORE_UPDATE_BASE_URL:-https://github.com/semaphore-chat/semaphore-chat/releases/download/v$version}"
  base="${base%/}"
  local notes="${SEMAPHORE_RELEASE_NOTES_URL:-https://github.com/semaphore-chat/semaphore-chat/releases/tag/v$version}"
  local deb_sha rpm_sha appimage_sha
  deb_sha="$(sha256sum "$deb" | cut -d' ' -f1)"
  rpm_sha="$(sha256sum "$rpm" | cut -d' ' -f1)"
  appimage_sha="$(sha256sum "$appimage" | cut -d' ' -f1)"
  local manifest="$OUT_DIR/latest.json"
  jq -n \
    --arg version "$version" \
    --arg notes "$notes" \
    --arg deb_url "$base/$(basename "$deb")" \
    --arg deb_sha "$deb_sha" \
    --argjson deb_size "$(stat -c %s "$deb")" \
    --arg rpm_url "$base/$(basename "$rpm")" \
    --arg rpm_sha "$rpm_sha" \
    --argjson rpm_size "$(stat -c %s "$rpm")" \
    --arg appimage_url "$base/$(basename "$appimage")" \
    --arg appimage_sha "$appimage_sha" \
    --argjson appimage_size "$(stat -c %s "$appimage")" \
    '{
      version: $version,
      notes_url: $notes,
      artifacts: [
        {kind: "appimage", arch: "x86_64", url: $appimage_url, sha256: $appimage_sha, size: $appimage_size},
        {kind: "deb", arch: "x86_64", url: $deb_url, sha256: $deb_sha, size: $deb_size},
        {kind: "rpm", arch: "x86_64", url: $rpm_url, sha256: $rpm_sha, size: $rpm_size}
      ]
    }' >"$manifest"
  # The updater is strict about this document; refuse to publish one it would reject.
  jq -e --arg semver "$SEMVER_RE" '
    (.version | type == "string") and (.version | test($semver)) and
    (.notes_url | startswith("https://")) and
    (.artifacts | length == 3) and
    (all(.artifacts[];
      (.kind | type == "string") and (.arch == "x86_64") and
      (.url | startswith("https://")) and
      (.sha256 | test("^[0-9a-f]{64}$")) and
      (.size > 0)))
  ' "$manifest" >/dev/null || die "latest.json is not a manifest the updater would accept"
  local kind
  for kind in appimage deb rpm; do
    local listed
    listed="$(jq -r --arg kind "$kind" '.artifacts[] | select(.kind == $kind) | "\(.sha256) \(.size)"' "$manifest")"
    echo "  $kind  $listed"
  done
}

generate_licences() { # <output> <version> <work>
  local out="$1" version="$2" work="$3"
  local metadata="$work/metadata.json"
  cargo metadata --locked --format-version 1 >"$metadata"
  # Every normal dependency the Linux binary links, with its declared licence and source.
  cargo tree --locked -p semaphore-app --target x86_64-unknown-linux-gnu -e normal \
    --prefix none --format '{p}' \
    | awk '$2 ~ /^v/ { sub(/^v/, "", $2); print $1, $2 }' \
    | sort -u >"$work/crates.txt"

  {
    cat <<EOF
Semaphore Chat native client $version — third-party licences
==============================================================

This file lists the third-party code and data compiled into or shipped with this package.
The app itself is AGPL-3.0-only (see LICENSE.md and LICENSE_COM.md).

Rust crates linked into the Linux binary (name, version, SPDX licence, source)
-----------------------------------------------------------------------------
EOF
    jq -r --rawfile list "$work/crates.txt" '
      ($list | split("\n") | map(select(length > 0))
        | map(split(" ") | "\(.[0]) \(.[1])")) as $want
      | .packages[]
      | select(.source != null)
      | "\(.name) \(.version)" as $id
      | select(($want | index($id)) != null)
      | "\(.name) \(.version) — \(.license // (if .license_file then "see \(.license_file)" else "UNKNOWN" end))\(if .repository then " — \(.repository)" else "" end)"
    ' "$metadata" | sort -u

    cat <<'EOF'

Bundled assets
--------------
Roboto 400/500/600/700 (native/crates/semaphore-ui/assets/fonts) — SIL Open Font License 1.1.
Material Icons (native/crates/semaphore-design/assets/icons) — MIT.
Lucide icons, through gpui-kit-assets — ISC.
The emoji names and categories in native/crates/semaphore-ui/assets/emoji are part of the
Semaphore Chat web client and covered by the project licence above.
In the AppImage only: the AppImage type-2 runtime (probonopd and contributors) — MIT.

libwebrtc (statically linked into the binary)
---------------------------------------------
The binary links LiveKit's prebuilt libwebrtc. Its components and licences:
  WebRTC (webrtc.org)                    BSD-3-Clause
  BoringSSL                              ISC
  libaom                                 BSD-3-Clause
  libvpx                                 BSD-3-Clause
  dav1d                                  BSD-2-Clause
  OpenH264                               BSD-2-Clause
  Opus                                   BSD-3-Clause
  FFmpeg (H.264 decoder, libavutil)      LGPL-2.1-or-later (WebRTC builds it without GPL code)
  libjpeg-turbo                          BSD-3-Clause and IJG
  libyuv                                 BSD-3-Clause
  abseil-cpp                             Apache-2.0
  libsrtp                                BSD-3-Clause
  rnnoise, pffft                         BSD-3-Clause
  libc++                                 Apache-2.0 WITH LLVM-exception
  libdrm, X11, Xext, Xfixes, Xdamage,    MIT
  Xcomposite, Xrandr
  PipeWire client headers and the        MIT
  xdg desktop portal
The WebRTC and FFmpeg sources are at https://webrtc.googlesource.com/src and
https://ffmpeg.org/download.html. The exact libwebrtc build is the one pinned by
third_party/vendor/series (LiveKit rust-sdks). FFmpeg is dynamically relinkable from the
unmodified object code in that prebuilt library; see the LGPL-2.1 for the relinking terms.

webrtc-sys notices
------------------
EOF
    cat "$NATIVE_DIR/third_party/vendor/webrtc-sys/NOTICE.md"
    echo
    echo "Font licence (SIL Open Font License 1.1)"
    echo "---------------------------------------"
    cat "$NATIVE_DIR/crates/semaphore-ui/assets/fonts/LICENSE"
    echo
    echo "Material Icons licence (MIT)"
    echo "----------------------------"
    cat "$NATIVE_DIR/crates/semaphore-design/assets/icons/LICENSE"
  } >"$out"
}

build_deb() { # <stage> <output> <version>
  local stage="$1" out="$2" version="$3"
  local root; root="$(mktemp -d)"
  cp -a "$stage/." "$root/"
  install -d "$root/DEBIAN"
  local installed_kb; installed_kb="$(du -sk --exclude=DEBIAN "$root" | cut -f1)"
  cat >"$root/DEBIAN/control" <<EOF
Package: $PACKAGE
Version: $version
Section: net
Priority: optional
Architecture: amd64
Maintainer: Semaphore Chat Team <noreply@semaphorechat.app>
Installed-Size: $installed_kb
Depends: libc6 (>= 2.35), libgcc-s1, libglib2.0-0, libpipewire-0.3-0, libasound2, libxcb1, libxkbcommon0, libxkbcommon-x11-0
Recommends: libvulkan1, mesa-vulkan-drivers, libegl1, libgl1, libpulse0, libwayland-client0, libwayland-egl1, libx11-6, libxext6, libxfixes3, libxdamage1, libxcomposite1, libxrandr2, libva2, libva-drm2, xdg-utils, fonts-noto-color-emoji
Homepage: https://semaphorechat.app
Description: Semaphore Chat native desktop client
 A self-hosted voice and text chat client built with GPUI and libwebrtc.
 It provides text channels, direct messages, calls, screen sharing and an
 in-app audio and video player without a webview.
EOF
  dpkg-deb --build --root-owner-group -Zxz "$root" "$out" >/dev/null
  rm -rf "$root"
}

build_rpm() { # <stage> <output> <version> <work>
  local stage="$1" out="$2" version="$3" work="$4"
  local changelog_date; changelog_date="$(date -u -d "@$SOURCE_DATE_EPOCH" '+%a %b %d %Y')"
  local top="$work/rpm"
  install -d "$top/SPECS" "$top/BUILD" "$top/RPMS" "$top/SRPMS" "$top/BUILDROOT"
  cat >"$top/SPECS/$PACKAGE.spec" <<EOF
Name:           $PACKAGE
Version:        $version
Release:        1%{?dist}
Summary:        Semaphore Chat native desktop client
License:        AGPL-3.0-only
URL:            https://semaphorechat.app
BuildArch:      x86_64
AutoReqProv:    no
Requires:       glibc >= 2.35
Requires:       libgcc
Requires:       glib2
Requires:       pipewire-libs
Requires:       alsa-lib
Requires:       libxcb
Requires:       libxkbcommon
Requires:       libxkbcommon-x11
Recommends:     vulkan-loader
Recommends:     mesa-vulkan-drivers
Recommends:     mesa-libEGL
Recommends:     mesa-libGL
Recommends:     pulseaudio-libs
Recommends:     wayland-libs-client
Recommends:     wayland-libs-egl
Recommends:     libX11
Recommends:     libXext
Recommends:     libXfixes
Recommends:     libXdamage
Recommends:     libXcomposite
Recommends:     libXrandr
Recommends:     libva
Recommends:     xdg-utils
Recommends:     google-noto-color-emoji-fonts

%description
A self-hosted voice and text chat client built with GPUI and libwebrtc.
It provides text channels, direct messages, calls, screen sharing and an
in-app audio and video player without a webview.

%install
rm -rf %{buildroot}
cp -a %{stagedir}/. %{buildroot}/

%files
%license %{_datadir}/doc/$PACKAGE/LICENSE.md
%license %{_datadir}/doc/$PACKAGE/LICENSE_COM.md
%license %{_datadir}/doc/$PACKAGE/THIRD-PARTY-LICENCES.txt
%license %{_datadir}/doc/$PACKAGE/copyright
%{_bindir}/$BIN_NAME
%{_datadir}/applications/$APP_ID.desktop
%{_datadir}/icons/hicolor/*/apps/$APP_ID.png
%{_datadir}/metainfo/$APP_ID.metainfo.xml

%changelog
* $changelog_date Semaphore Chat Team <noreply@semaphorechat.app> - $version-1
- Native Linux package $version
EOF
  rpmbuild -bb \
    --define "_topdir $top" \
    --define "stagedir $stage" \
    --define "debug_package %{nil}" \
    --define "_build_id_links none" \
    --define "_buildhost reproducible" \
    --define "use_source_date_epoch_as_buildtime 1" \
    --define "clamp_mtime_to_source_date_epoch 1" \
    --define "_binary_payload w19.zstdio" \
    "$top/SPECS/$PACKAGE.spec" >/dev/null
  local built
  built="$(find "$top/RPMS" -name "$PACKAGE-$version-*.rpm" | head -1)"
  [ -n "$built" ] || die "rpmbuild produced no package"
  install -m644 "$built" "$out"
}

build_appimage() { # <stage> <output> <version> <work>
  local stage="$1" out="$2" version="$3" work="$4"
  local appdir="$work/AppDir"
  rm -rf "$appdir"
  mkdir -p "$appdir"
  cp -a "$stage/." "$appdir/"

  # Inside the AppDir the executable is found through AppRun's PATH, so the entry uses the
  # bare name. The installed .deb/.rpm use /usr/bin/semaphore-app.
  write_desktop "$BIN_NAME" "$appdir/usr/share/applications/$APP_ID.desktop"
  cp "$appdir/usr/share/applications/$APP_ID.desktop" "$appdir/$APP_ID.desktop"
  cp "$appdir/usr/share/icons/hicolor/512x512/apps/$APP_ID.png" "$appdir/$APP_ID.png"

  cat >"$appdir/AppRun" <<'EOF'
#!/bin/sh
set -e
HERE="$(dirname "$(readlink -f "$0")")"
export PATH="$HERE/usr/bin:$PATH"
exec "$HERE/usr/bin/semaphore-app" "$@"
EOF
  chmod 755 "$appdir/AppRun"

  # No AppStream validation here: appimagetool's is stricter than the metainfo file needs to
  # be for .deb/.rpm, and we validate that file with appstreamcli above.
  ARCH=x86_64 appimagetool --no-appstream \
    --runtime-file /opt/appimage-runtime-x86_64 "$appdir" "$out" >/dev/null
  chmod 755 "$out"
}

# --- Outer script --------------------------------------------------------------------------

if [ "${1:-}" = "--in-image" ]; then
  shift
  in_image "$@"
  exit 0
fi

# Testing the manifest step on existing files: SEMAPHORE_PACKAGES_DIR=<dir> package-linux.sh
# --finish-artifacts <deb> <rpm> <appimage> <version>, the packages being in <dir>. Needs jq and
# sha256sum; builds nothing.
if [ "${1:-}" = "--finish-artifacts" ]; then
  shift
  [ "$#" = 4 ] || die "--finish-artifacts <deb> <rpm> <appimage> <version>"
  finish_artifacts "$@"
  exit 0
fi

case "${1:-}" in
  -h|--help) usage; exit 0 ;;
  "") ;;
  *) die "unknown argument '$1' (try --help)" ;;
esac

command -v docker >/dev/null 2>&1 || die "docker is required"

tag="$(cat "$NATIVE_DIR/docker/Dockerfile.package" "$NATIVE_DIR/rust-toolchain.toml" \
  | { cat; echo "$HOST_UID"; } | sha256sum | cut -c1-12)"
IMAGE="semaphore-native-package:$tag"
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "package-linux: building $IMAGE (first use of the package toolchain) ..." >&2
  docker build -q -f "$NATIVE_DIR/docker/Dockerfile.package" \
    --build-arg "HOST_UID=$HOST_UID" -t "$IMAGE" "$NATIVE_DIR" >/dev/null
fi

"$ROOT/scripts/test-net.sh" >/dev/null

mkdir -p "$OUT_DIR"
checkout="$(printf '%s' "$ROOT" | sha256sum | cut -c1-8)"
toolchain="$(sed -n 's/^channel = "\(.*\)"/\1/p' "$NATIVE_DIR/rust-toolchain.toml")"
epoch="$(git -C "$ROOT" log -1 --format=%ct 2>/dev/null || echo 0)"
[ "$epoch" != 0 ] || epoch="$(date +%s)"

echo "package-linux: building in $IMAGE, output in $OUT_DIR" >&2
exec docker run --rm --init \
  --name "semaphore-native-package-$$" \
  --network semaphore-test \
  --user "$HOST_UID:$HOST_GID" \
  -v "$ROOT:$ROOT" \
  -v "semaphore-native-package-cargo:/cache/cargo" \
  -v "semaphore-native-package-target-$checkout:/cache/target" \
  -v "$OUT_DIR:/out" \
  -w "$NATIVE_DIR" \
  -e "RUSTUP_TOOLCHAIN=$toolchain" \
  -e "CARGO_HOME=/cache/cargo" \
  -e "CARGO_TARGET_DIR=/cache/target" \
  -e "OUT_DIR=/out" \
  -e "SOURCE_DATE_EPOCH=$epoch" \
  -e "SEMAPHORE_VERSION=${SEMAPHORE_VERSION:-}" \
  -e "SEMAPHORE_PACKAGED=1" \
  -e "SEMAPHORE_UPDATE_MANIFEST_URL=${SEMAPHORE_UPDATE_MANIFEST_URL:-}" \
  -e "SEMAPHORE_UPDATE_BASE_URL=${SEMAPHORE_UPDATE_BASE_URL:-}" \
  -e "SEMAPHORE_RELEASE_NOTES_URL=${SEMAPHORE_RELEASE_NOTES_URL:-}" \
  -e "CC=clang" -e "CXX=clang++" \
  -e "CARGO_TERM_COLOR=never" \
  "$IMAGE" "$NATIVE_DIR/scripts/package-linux.sh" --in-image
