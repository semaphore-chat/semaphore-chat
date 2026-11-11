#!/bin/sh
# Type-checks Rust that sits on libwebrtc for x86_64-pc-windows-msvc, in the Linux image:
#
#   scripts/in-image.sh sh scripts/check-webrtc-windows.sh -p semaphore-media-livekit --example capture_probe
#
# The image has no MSVC headers or lib.exe, so C and C++ can't be built for Windows here.
# webrtc-sys's build script is skipped (DOCS_RS), and other build scripts' C/C++ goes to a tool
# that only creates the output file it's asked for. Nothing links, so this checks Rust only: the
# cxx bridges' Rust side and `cfg(windows)` code, not the C++ (the windows-link CI job builds
# that).
set -eu
fake=/tmp/fake-msvc-tool
cat > "$fake" <<'SH'
#!/bin/sh
out=""; prev=""
for a in "$@"; do
  case "$a" in
    -Fo*|/Fo*) out="${a#*Fo}" ;;
    -out:*|/OUT:*|-OUT:*) out="${a#*:}" ;;
  esac
  [ "$prev" = "-o" ] && out="$a"
  prev="$a"
done
[ -n "$out" ] && : > "$out"
exit 0
SH
chmod +x "$fake"
export DOCS_RS=1 CC_x86_64_pc_windows_msvc="$fake" CXX_x86_64_pc_windows_msvc="$fake" \
  AR_x86_64_pc_windows_msvc="$fake"
exec nice -n 10 cargo check --locked --target x86_64-pc-windows-msvc "$@"
