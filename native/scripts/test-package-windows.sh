#!/usr/bin/env bash
# Check the Windows installer on Linux, without Windows.
#
#   native/scripts/test-package-windows.sh [--in-image]
#
# What it proves, inside native/docker/Dockerfile.nsis (stock Debian NSIS 3.08):
#   - installer.nsi compiles with warnings as errors (-WX) for two versions, one of them a
#     semver prerelease whose file-version resource needs zero-padding;
#   - package-windows.sh names the artifact Semaphore-Chat-Native-Setup-<version>-x64.exe and
#     writes a sha256sum-format .sha256 that verifies;
#   - 7z lists the exe, the third-party licences and the uninstaller inside the installer;
#   - every registry key written by the install section is deleted by the uninstall section,
#     every shortcut created is deleted, each installed file has its own Delete (never a recursive delete),
#     the user's data directory is never touched, and semaphore:// is registered with "%1";
#   - the script uses only stock NSIS plug-ins (no nsProcess/WinShell/StdUtils/SpiderBanner).
#
# It cannot install or run the installer: that needs Windows, and is the checklist in
# native/docs/packaging.md ("Windows installer", "After merge: check on the Windows runner").
# NSIS text is matched literally below, so $VARS must not expand here.
# shellcheck disable=SC2016
set -euo pipefail

NATIVE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$NATIVE_DIR/.." && pwd)"
SCRIPT="$NATIVE_DIR/packaging/windows/installer.nsi"
PACKAGE="$NATIVE_DIR/scripts/package-windows.sh"

die() { echo "test-package-windows: $*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Compile and check the native client's Windows installer in a Linux container.

Usage: scripts/test-package-windows.sh [--in-image]

  --in-image   Run the checks here; the outer script runs them in
               native/docker/Dockerfile.nsis with no network.
EOF
}

IN_IMAGE=0
case "${1:-}" in
  -h|--help) usage; exit 0 ;;
  --in-image) IN_IMAGE=1 ;;
  "") ;;
  *) die "unknown argument '$1' (try --help)" ;;
esac

if [ "$IN_IMAGE" = 0 ]; then
  command -v docker >/dev/null 2>&1 || die "docker is required"
  tag="$(sha256sum "$NATIVE_DIR/docker/Dockerfile.nsis" | cut -c1-12)"
  IMAGE="semaphore-native-nsis:$tag"
  if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
    echo "test-package-windows: building $IMAGE (first use of the NSIS image) ..." >&2
    docker build -q -f "$NATIVE_DIR/docker/Dockerfile.nsis" -t "$IMAGE" "$NATIVE_DIR" >/dev/null
  fi
  exec docker run --rm --init \
    --network none \
    --user "$(id -u):$(id -g)" \
    -v "$ROOT:$ROOT" \
    -w "$NATIVE_DIR" \
    -e "HOME=/tmp" \
    "$IMAGE" "$NATIVE_DIR/scripts/test-package-windows.sh" --in-image
fi

# ---- Inside the NSIS image ------------------------------------------------------------------

[ -f "$SCRIPT" ] || die "missing $SCRIPT"
[ -x "$PACKAGE" ] || die "missing or not executable: $PACKAGE"
command -v makensis >/dev/null 2>&1 || die "makensis is not installed in this image"
command -v 7z >/dev/null 2>&1 || die "7z is not installed in this image"

failures=0
ok() { printf 'ok   %s\n' "$*"; }
bad() { printf 'FAIL %s\n' "$*" >&2; failures=$((failures + 1)); }
check() { # <description> <command...>
  local what="$1"
  shift
  if "$@"; then ok "$what"; else bad "$what"; fi
}

# The two sections, so a write can only be matched by a removal in the uninstaller.
section_install="$(awk '/^Section "Install"/{f=1} f{print} /^SectionEnd/{if(f)exit}' "$SCRIPT")"
section_uninstall="$(awk '/^Section "Uninstall"/{f=1} f{print} /^SectionEnd/{if(f)exit}' "$SCRIPT")"
[ -n "$section_install" ] || die "no install section in $SCRIPT"
[ -n "$section_uninstall" ] || die "no uninstall section in $SCRIPT"

echo "== installer script"
check "SetCompressor /SOLID lzma" grep -qF 'SetCompressor /SOLID lzma' "$SCRIPT"
check "Unicode installer" grep -qF 'Unicode true' "$SCRIPT"
check "per-user, no elevation" grep -qF 'RequestExecutionLevel user' "$SCRIPT"
check "file-version resource" grep -qF 'VIProductVersion "${VERSION_QUAD}"' "$SCRIPT"
check "artifact name from the packaging script" \
  grep -qF 'NAME="Semaphore-Chat-Native-Setup-$VERSION-x64.exe"' "$PACKAGE"
check "warnings are errors" grep -qF '"$MAKENSIS" -WX' "$PACKAGE"
check "silent uninstall registered" grep -qE 'QuietUninstallString.*/S' "$SCRIPT"
check "upgrade closes the app" grep -qF 'CheckAppRunning inst' "$SCRIPT"
check "uninstall closes the app" grep -qF 'CheckAppRunning un' "$SCRIPT"
check "previous version removed first" grep -qF 'old-uninstaller.exe" /S _?=$R2' "$SCRIPT"
check "semaphore:// open command takes %1" \
  grep -qF '"$INSTDIR\${APP_EXE_NAME}" "%1"' "$SCRIPT"
check "semaphore:// marked as a URL protocol" grep -qF 'URL Protocol' "$SCRIPT"

if grep -v '^ *;' "$SCRIPT" | grep -qE 'nsProcess|WinShell|StdUtils|SpiderBanner|FileAssociation|UAC\.nsh'; then
  bad "only stock NSIS plug-ins and headers"
else
  ok "only stock NSIS plug-ins and headers"
fi

# Installed files: both File lines carry /oname, and the uninstaller removes the install tree.
files_installed="$(printf '%s\n' "$section_install" | grep -cE '^ *File "/oname=' || true)"
check "two files installed (exe and licences)" test "$files_installed" -eq 2
check "uninstaller is written into the install tree" grep -qF 'WriteUninstaller "$INSTDIR\${UNINSTALLER_NAME}"' "$SCRIPT"
check "uninstall removes the directory only when empty" grep -qxF '  RMDir "$INSTDIR"' <<<"$section_uninstall"
check "uninstall never deletes recursively" bash -c '! grep -qE "^ *RMDir /r" "$1"' _ "$SCRIPT"
for installed in '${APP_EXE_NAME}' 'THIRD-PARTY-LICENCES.txt' '${UNINSTALLER_NAME}'; do
  check "uninstall deletes $installed" grep -qF "Delete \"\$INSTDIR\\$installed\"" <<<"$section_uninstall"
done

# The user's data directory must survive an uninstall: Electron's deleteAppDataOnUninstall
# defaults to false, and this installer has no switch for it either.
if printf '%s\n' "$section_uninstall" | grep -v '^ *;' | grep -qi 'appdata'; then
  bad "uninstall leaves the user's data directory alone"
else
  ok "uninstall leaves the user's data directory alone"
fi
if grep -qF -- '--delete-app-data' "$SCRIPT"; then
  bad "no delete-app-data switch"
else
  ok "no delete-app-data switch"
fi

# Registry: every key written by the installer must be removed by the uninstaller, either
# itself or through a parent key (DeleteRegKey removes the subkeys and values with it).
written_keys="$(printf '%s\n' "$section_install" \
  | grep -oE 'WriteReg(Str|ExpandStr|DWORD) HKCU "[^"]+"' \
  | sed -E 's/^WriteReg[A-Za-z]+ HKCU "(.*)"$/\1/' | sort -u)"
removed_keys="$(printf '%s\n' "$section_uninstall" \
  | grep -oE 'DeleteReg(Key|Value) HKCU "[^"]+"' \
  | sed -E 's/^DeleteReg(Key|Value) HKCU "(.*)"$/\2/' | sort -u || true)"
[ -n "$written_keys" ] || bad "the install section writes no registry key"

while IFS= read -r key; do
  [ -n "$key" ] || continue
  covered=0
  while IFS= read -r removed; do
    [ -n "$removed" ] || continue
    if [ "$key" = "$removed" ] || [[ "$key" == "$removed"\\* ]]; then
      covered=1
      break
    fi
  done <<<"$removed_keys"
  if [ "$covered" = 1 ]; then
    ok "registry key removed on uninstall: $key"
  else
    bad "registry key written but never removed: $key"
  fi
done <<<"$written_keys"

# Shortcuts: every CreateShortCut target must be Delete'd by the uninstaller.
created_links="$(printf '%s\n' "$section_install" \
  | grep -oE 'CreateShortCut "[^"]+"' | sed -E 's/^CreateShortCut "(.*)"$/\1/')"
deleted_links="$(printf '%s\n' "$section_uninstall" \
  | grep -oE '^ *Delete "[^"]+"' | sed -E 's/^ *Delete "(.*)"$/\1/' || true)"
[ -n "$created_links" ] || bad "the install section creates no shortcut"
while IFS= read -r link; do
  [ -n "$link" ] || continue
  if printf '%s\n' "$deleted_links" | grep -qxF "$link"; then
    ok "shortcut removed on uninstall: $link"
  else
    bad "shortcut created but never removed: $link"
  fi
done <<<"$created_links"

# Add/Remove Programs values, so a rename cannot silently drop the entry.
for value in DisplayName DisplayVersion Publisher DisplayIcon UninstallString EstimatedSize; do
  if grep -qF "WriteRegStr HKCU \"\${UNINSTALL_KEY}\" \"$value\"" "$SCRIPT" \
    || grep -qF "WriteRegDWORD HKCU \"\${UNINSTALL_KEY}\" \"$value\"" "$SCRIPT"; then
    ok "Add/Remove Programs has $value"
  else
    bad "Add/Remove Programs has $value"
  fi
done

# ---- Compile two versions and inspect the result --------------------------------------------

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
# A stand-in for the built exe (NSIS embeds whatever bytes it is given) and the licences.
{ printf 'MZ'; head -c 65536 /dev/zero; } >"$work/semaphore-app.exe"
printf 'Semaphore Chat native client: third-party licences (test fixture).\n' >"$work/THIRD-PARTY-LICENCES.txt"

for version in 0.10.0 1.2.3-rc.1; do
  out="$work/out-$version"
  log="$work/compile-$version.log"
  mkdir -p "$out"
  echo "== compiling version $version"
  if ! "$PACKAGE" --in-image --version "$version" \
      --app-exe "$work/semaphore-app.exe" \
      --licences "$work/THIRD-PARTY-LICENCES.txt" \
      --out-dir "$out" >"$log" 2>&1; then
    cat "$log" >&2
    bad "package-windows.sh failed for $version"
    continue
  fi
  name="Semaphore-Chat-Native-Setup-$version-x64.exe"
  file="$out/$name"
  check "artifact named $name" test -s "$file"
  check "hash file written for $version" test -s "$file.sha256"
  expected="$(sha256sum "$file" | cut -d' ' -f1)"
  if [ "$(cat "$file.sha256")" = "$expected  $name" ]; then
    ok "hash file is sha256sum format with the right digest"
  else
    bad "hash file is wrong: $(cat "$file.sha256")"
  fi
  if ( cd "$out" && sha256sum -c "$name.sha256" >/dev/null 2>&1 ); then
    ok "sha256sum -c verifies the installer"
  else
    bad "sha256sum -c does not verify the installer"
  fi
  check "compiler used solid lzma" grep -qF 'Using lzma (compress whole) compression' "$log"
  check "installer is NSIS 3 Unicode" grep -qF 'SubType = NSIS-3 Unicode' <(7z l "$file")
  listing="$(7z l "$file")"
  for entry in semaphore-app.exe THIRD-PARTY-LICENCES.txt "Uninstall Semaphore Chat.exe"; do
    if grep -qF "$entry" <<<"$listing"; then
      ok "7z lists $entry"
    else
      bad "7z does not list $entry"
    fi
  done
  echo "-- makensis final lines ($version)"
  tail -n 12 "$log"
done

if [ "$failures" -ne 0 ]; then
  die "$failures check(s) failed"
fi
echo "test-package-windows: all checks passed"
