#!/usr/bin/env bash
# Build the Windows installer of the native client: one entry point for CI and for testing.
#
#   native/scripts/package-windows.sh [options]
#
# On Windows (Git Bash, as the windows-latest job runs it) it calls the runner's makensis. On
# Linux it runs itself in native/docker/Dockerfile.nsis, which has the distribution's stock NSIS;
# that mode compiles and inspects the installer but cannot run it. --in-image skips the Docker
# jump (test-package-windows.sh calls the script that way inside the container).
#
# Inputs, all available as options and environment variables:
#   --version / SEMAPHORE_VERSION (or PACKAGE_VERSION)  the version; defaults to the workspace's
#                                                       semaphore-app version (native/Cargo.toml)
#   --app-exe / SEMAPHORE_INSTALLER_APP_EXE             the built semaphore-app.exe (default
#                                                       native/target/dist/semaphore-app.exe)
#   --licences / SEMAPHORE_INSTALLER_LICENCES           THIRD-PARTY-LICENCES.txt (default
#                                                       <out-dir>/THIRD-PARTY-LICENCES.txt)
#   --out-dir / SEMAPHORE_PACKAGES_DIR                  output directory (default
#                                                       native/dist-packages)
#
# Output (both gitignored):
#   Semaphore-Chat-Native-Setup-<version>-x64.exe
#   Semaphore-Chat-Native-Setup-<version>-x64.exe.sha256   (sha256sum format: "<hash>  <name>")
set -euo pipefail

NATIVE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$NATIVE_DIR/.." && pwd)"

VERSION="${SEMAPHORE_VERSION:-${PACKAGE_VERSION:-}}"
APP_EXE="${SEMAPHORE_INSTALLER_APP_EXE:-$NATIVE_DIR/target/dist/semaphore-app.exe}"
LICENCES="${SEMAPHORE_INSTALLER_LICENCES:-}"
OUT_DIR="${SEMAPHORE_PACKAGES_DIR:-$NATIVE_DIR/dist-packages}"
IN_IMAGE=0

die() { echo "package-windows: $*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Build the native client's Windows installer (NSIS, per-user, silent-capable).

Usage: scripts/package-windows.sh [options]

Options:
  --version <v>    Installer version (also SEMAPHORE_VERSION or PACKAGE_VERSION).
  --app-exe <p>    The built semaphore-app.exe.
  --licences <p>   THIRD-PARTY-LICENCES.txt to install next to the exe.
  --out-dir <d>    Where to write the installer and its .sha256.
  --in-image       Run makensis here instead of in native/docker/Dockerfile.nsis (used by
                   scripts/test-package-windows.sh inside the image).
  -h, --help       This text.

Environment:
  SEMAPHORE_VERSION, PACKAGE_VERSION, SEMAPHORE_INSTALLER_APP_EXE,
  SEMAPHORE_INSTALLER_LICENCES, SEMAPHORE_PACKAGES_DIR.

Artifacts:
  Semaphore-Chat-Native-Setup-<version>-x64.exe
  Semaphore-Chat-Native-Setup-<version>-x64.exe.sha256
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --in-image) IN_IMAGE=1 ;;
    --version) [ $# -ge 2 ] || die "--version needs a value"; VERSION="$2"; shift ;;
    --app-exe) [ $# -ge 2 ] || die "--app-exe needs a value"; APP_EXE="$2"; shift ;;
    --licences) [ $# -ge 2 ] || die "--licences needs a value"; LICENCES="$2"; shift ;;
    --out-dir) [ $# -ge 2 ] || die "--out-dir needs a value"; OUT_DIR="$2"; shift ;;
    *) die "unknown argument '$1' (try --help)" ;;
  esac
  shift
done

is_windows() {
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) return 0 ;;
    *) return 1 ;;
  esac
}

# Absolute path in the form makensis on this host understands. Git Bash's /c/... is not a
# Windows path; cygpath -w gives C:\... (NSIS's File finds nothing through forward slashes), and it survives being
# passed in a -D define.
absolute() { # <path>
  local path="$1" dir
  [ -e "$path" ] || die "no such file: $path"
  dir="$(cd "$(dirname "$path")" && pwd)"
  if is_windows; then
    cygpath -w "$dir/$(basename "$path")"
  else
    printf '%s/%s\n' "$dir" "$(basename "$path")"
  fi
}

# On Linux without --in-image, run in the NSIS image. The worktree is mounted at its own path,
# the network is off, and nothing outside the mounted tree is written.
if ! is_windows && [ "$IN_IMAGE" = 0 ]; then
  command -v docker >/dev/null 2>&1 || die "docker is required (or run with --in-image)"
  tag="$(sha256sum "$NATIVE_DIR/docker/Dockerfile.nsis" | cut -c1-12)"
  IMAGE="semaphore-native-nsis:$tag"
  if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
    echo "package-windows: building $IMAGE (first use of the NSIS image) ..." >&2
    docker build -q -f "$NATIVE_DIR/docker/Dockerfile.nsis" -t "$IMAGE" "$NATIVE_DIR" >/dev/null
  fi
  exec docker run --rm --init \
    --network none \
    --user "$(id -u):$(id -g)" \
    -v "$ROOT:$ROOT" \
    -w "$NATIVE_DIR" \
    -e "HOME=/tmp" \
    -e "SEMAPHORE_VERSION=$VERSION" \
    -e "SEMAPHORE_INSTALLER_APP_EXE=$APP_EXE" \
    -e "SEMAPHORE_INSTALLER_LICENCES=$LICENCES" \
    -e "SEMAPHORE_PACKAGES_DIR=$OUT_DIR" \
    "$IMAGE" "$NATIVE_DIR/scripts/package-windows.sh" --in-image
fi

# ---- Inside the image (or on Windows) -------------------------------------------------------

if [ -z "$VERSION" ]; then
  VERSION="$(sed -n 's/^version = "\(.*\)"/\1/p' "$NATIVE_DIR/Cargo.toml" | head -1)"
fi
[ -n "$VERSION" ] || die "no version: pass --version or set SEMAPHORE_VERSION"
VERSION="${VERSION#v}"
# Same shape as package-linux.sh allows, plus a semver prerelease suffix: safe in the artifact
# name and in Add/Remove Programs.
[[ "$VERSION" =~ ^[0-9]+(\.[0-9]+)*(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$ ]] \
  || die "version '$VERSION' is not usable (use digits and dots, optionally -prerelease)"

# The file-version resource needs exactly four numbers; a prerelease's numbers come from the
# release part, with zero padding (1.2.3-rc.1 -> 1.2.3.0).
base="${VERSION%%[-+]*}"
IFS=. read -r -a parts <<<"$base"
[ "${#parts[@]}" -le 4 ] || die "version '$VERSION' has more than four numeric components"
quad=()
for i in 0 1 2 3; do quad+=("${parts[$i]:-0}"); done
for part in "${quad[@]}"; do
  [[ "$part" =~ ^[0-9]+$ ]] || die "version '$VERSION' has a non-numeric component"
done
VERSION_QUAD="${quad[0]}.${quad[1]}.${quad[2]}.${quad[3]}"

if [ -z "$LICENCES" ]; then
  LICENCES="$OUT_DIR/THIRD-PARTY-LICENCES.txt"
fi
[ -s "$APP_EXE" ] || die "no built exe at $APP_EXE (build it with the dist profile first)"
[ -s "$LICENCES" ] || die "no licences file at $LICENCES"

APP_EXE_ABS="$(absolute "$APP_EXE")"
LICENCES_ABS="$(absolute "$LICENCES")"
ICON_ABS="$(absolute "$NATIVE_DIR/packaging/windows/semaphore-chat.ico")"
mkdir -p "$OUT_DIR"
OUT_DIR_ABS="$(cd "$OUT_DIR" && pwd)"

NAME="Semaphore-Chat-Native-Setup-$VERSION-x64.exe"
if is_windows; then
  OUT_FILE="$(cygpath -m "$OUT_DIR_ABS")/$NAME"
else
  OUT_FILE="$OUT_DIR_ABS/$NAME"
fi

# makensis gets the backslash form on Windows; bash keeps using $OUT_FILE.
NSIS_OUT_FILE="$OUT_FILE"
if is_windows; then NSIS_OUT_FILE="$(cygpath -w "$OUT_FILE")"; fi

MAKENSIS="$(command -v makensis || true)"
if [ -z "$MAKENSIS" ] && is_windows; then
  pf86="$(printenv 'ProgramFiles(x86)' 2>/dev/null || true)"
  if [ -n "$pf86" ] && [ -x "$pf86/NSIS/makensis.exe" ]; then
    MAKENSIS="$pf86/NSIS/makensis.exe"
  fi
fi
[ -n "$MAKENSIS" ] || die "makensis not found (the Windows runner image ships NSIS 3.10 on PATH)"

echo "package-windows: semaphore-app $VERSION ($VERSION_QUAD) -> $OUT_FILE"
# -WX: warnings are errors. There is no signing step yet; see docs/packaging.md.
"$MAKENSIS" -WX \
  -DVERSION="$VERSION" \
  -DVERSION_QUAD="$VERSION_QUAD" \
  -DAPP_EXE="$APP_EXE_ABS" \
  -DLICENCES="$LICENCES_ABS" \
  -DICON="$ICON_ABS" \
  -DOUT_FILE="$NSIS_OUT_FILE" \
  "$NATIVE_DIR/packaging/windows/installer.nsi"

[ -s "$OUT_FILE" ] || die "makensis reported success but $OUT_FILE is missing or empty"

# sha256sum format, relative to the output directory, so `cd` there and `sha256sum -c` works on
# Windows (Git Bash) and Linux alike.
( cd "$OUT_DIR_ABS" && sha256sum "$NAME" > "$NAME.sha256" && sha256sum -c "$NAME.sha256" >/dev/null )

size="$(wc -c <"$OUT_FILE")"
hash="$(cut -d' ' -f1 "$OUT_FILE.sha256")"
printf 'package-windows: wrote %s (%s bytes)\n' "$NAME" "$size"
printf 'package-windows: %s  %s\n' "$hash" "$NAME"
