#!/usr/bin/env bash
# Build the Android debug APK, and test its bindings on the JVM, in the Android image, on the
# shared semaphore-test network.
#
#   native/scripts/android.sh
#
# Produces native/android/out/semaphore-android-debug.apk: the Jetpack Compose app over
# libsemaphore_mobile.so, which carries semaphore-core's UniFFI surface (crates/semaphore-ffi) and
# the real transports behind it (crates/semaphore-mobile, over crates/semaphore-net). Steps, all
# inside the container:
#
#   cargo ndk -t <each ABI> --platform 26 build -p semaphore-mobile --release
#   uniffi-bindgen generate --library --language kotlin <libsemaphore_mobile.so>
#   ./gradlew assembleDebug  (native/android)
#   the JVM test: the same Kotlin bindings over a host build of libsemaphore_mobile.so, against
#   semaphore-fake-server on loopback (./gradlew testDebugUnitTest)
#
# - On the shared semaphore-test network only. It creates and removes no network.
# - The image tag hashes the base tag, the Dockerfile and the uid, so a change rebuilds it and an
#   unchanged one never does.
# - The cargo registry, the per-checkout target directory, Gradle's caches and HOME are named
#   volumes. HOME carries ~/.android/debug.keystore, so every build signs the APK with the same
#   debug key and a sideloaded update is not rejected for a changed signature.
# - The repo is mounted at its own path, so paths in output work on the host too.
# - ANDROID_ABIS is a comma-separated list of ABIs, arm64-v8a by default. The x86_64 emulator
#   needs `ANDROID_ABIS=x86_64` (native/scripts/android-device-test.sh asks for it), and the image
#   carries both Rust targets.
set -euo pipefail

NATIVE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$NATIVE_DIR/.." && pwd)"
HOST_UID="$(id -u)"
HOST_GID="$(id -g)"

if [ "${1:-}" != --inner ]; then
  base="$("$NATIVE_DIR/scripts/in-image.sh" --print-image)"
  # Everything the image is built from: the Dockerfile, the base, the ids it chowns to, and the
  # uniffi version it installs uniffi-bindgen at (read from Cargo.lock, as the Dockerfile does).
  # The whole lockfile isn't hashed: any other dependency change would rebuild the image for nothing.
  uniffi_version="$(sed -n '/^name = "uniffi"$/{n;s/^version = "\(.*\)"$/\1/p;q}' "$NATIVE_DIR/Cargo.lock")"
  tag="$( { cat "$NATIVE_DIR/docker/Dockerfile.android"; echo "$base"; echo "$HOST_UID";
            echo "$HOST_GID"; echo "uniffi=$uniffi_version"; } | sha256sum | cut -c1-12)"
  image="semaphore-native-android:$tag"

  if ! docker image inspect "$image" >/dev/null 2>&1; then
    echo "android: building $image (first use of this toolchain: JDK, SDK, NDK, Gradle) ..." >&2
    docker build -q -f "$NATIVE_DIR/docker/Dockerfile.android" \
      --build-arg "BASE=$base" \
      --build-arg "HOST_UID=$HOST_UID" \
      --build-arg "HOST_GID=$HOST_GID" \
      -t "$image" "$NATIVE_DIR" >/dev/null
  fi

  # Prints the image it would run, for images layered on this one
  # (native/scripts/android-device-test.sh adds the emulator).
  if [ "${1:-}" = --print-image ]; then echo "$image"; exit 0; fi

  "$ROOT/scripts/test-net.sh" >/dev/null

  checkout="$(printf '%s' "$ROOT" | sha256sum | cut -c1-8)"
  exec docker run --rm --init \
    --name "native-android-build-$$" \
    --network semaphore-test \
    --user "$HOST_UID:$HOST_GID" \
    -v "$ROOT:$ROOT" \
    -v semaphore-native-cargo:/cache/cargo \
    -v "semaphore-native-target-android-$checkout:/cache/target" \
    -v semaphore-android-gradle:/cache/gradle \
    -v semaphore-android-home:/cache/home \
    -e "CARGO_INCREMENTAL=${CARGO_INCREMENTAL:-0}" \
    -e "ANDROID_ABIS=${ANDROID_ABIS:-arm64-v8a}" \
    -w "$NATIVE_DIR" \
    "$image" bash scripts/android.sh --inner "$@"
fi

# ----- inside the image -------------------------------------------------------

ANDROID_DIR="$NATIVE_DIR/android"
APP="$ANDROID_DIR/app"

# The ABIs to build, named as cargo-ndk names them: arm64-v8a is a phone, x86_64 the emulator
# (native/scripts/android-device-test.sh). Each has its Rust target in the image.
ANDROID_ABIS="${ANDROID_ABIS:-arm64-v8a}"
abis=()
triples=()
targets=()
for abi in ${ANDROID_ABIS//,/ }; do
  case "$abi" in
    arm64-v8a) triple=aarch64-linux-android ;;
    x86_64) triple=x86_64-linux-android ;;
    *) echo "android.sh: no Rust target for ABI $abi" >&2; exit 1 ;;
  esac
  abis+=("$abi")
  triples+=("$triple")
  targets+=(-t "$abi")
done
# uniffi-bindgen reads one built library's metadata; every ABI carries the same crates.
TARGET="${triples[0]}"
LIB="/cache/target/$TARGET/release/libsemaphore_mobile.so"

echo "=== cargo ndk build (${abis[*]}, release)"
# The workspace's release profile strips symbols (Cargo.toml), and uniffi-bindgen reads the FFI
# metadata out of the library's static symbol table, so this build keeps it: only debug
# information is stripped. The copy that ships is stripped to its dynamic symbols below.
export CARGO_PROFILE_RELEASE_STRIP=debuginfo
# Cleared first: a library left by a run for another ABI would otherwise ship in this APK too.
rm -rf "$APP/build/rustJniLibs"
cargo ndk "${targets[@]}" --platform 26 \
  -o "$APP/build/rustJniLibs" \
  build --locked -p semaphore-mobile --release

rm -rf "$APP/build/generated/uniffi"
echo "=== uniffi-bindgen (Kotlin)"
# Library mode writes every UniFFI crate in the library: uniffi.semaphore (semaphore-ffi) and
# uniffi.semaphore_mobile, both loading libsemaphore_mobile.so.
uniffi-bindgen generate --no-format --language kotlin \
  --out-dir "$APP/build/generated/uniffi" \
  --metadata-no-deps "$LIB"

# What the app loads needs nothing beyond the exported dynamic symbols.
ndk_bin="$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin"
for abi in "${abis[@]}"; do
  shipped="$APP/build/rustJniLibs/$abi/libsemaphore_mobile.so"
  [ -f "$shipped" ] || { echo "android.sh: cargo ndk wrote no $abi library" >&2; exit 1; }
  # cargo ndk also copies semaphore-ffi's own cdylib. Its code is already inside
  # libsemaphore_mobile.so, and nothing loads it, so it must not ship: it is a second copy of core.
  rm -f "$APP/build/rustJniLibs/$abi/libsemaphore_ffi.so"
  "$ndk_bin/llvm-strip" --strip-unneeded "$shipped"

  echo "=== exported symbols ($abi)"
  # Both crates' UniFFI exports, and the JNI entry point NativeLib calls, in the one library.
  symbols="$("$ndk_bin/llvm-nm" -D --defined-only "$shipped")"
  for prefix in uniffi_semaphore_ffi_fn_ uniffi_semaphore_mobile_fn_; do
    count="$(printf '%s\n' "$symbols" | grep -c " T ${prefix}" || true)"
    echo "$prefix*: $count"
    [ "$count" -gt 0 ] || { echo "android.sh: no $prefix symbols in $shipped" >&2; exit 1; }
  done
  # Here-strings, not pipes: grep -q exits at the first match, and the writer's SIGPIPE would fail
  # the pipeline under pipefail.
  grep -q ' T Java_app_semaphorechat_android_NativeLib_nativeInit$' <<<"$symbols" \
    || { echo "android.sh: the JNI entry point is missing from $shipped" >&2; exit 1; }
  echo "Java_app_semaphorechat_android_NativeLib_nativeInit: present"
  # Every `external fun` the Kotlin bindings declare resolves in the shipped library.
  missing=0
  for name in $(grep -rhoE 'external fun [A-Za-z0-9_]+' "$APP/build/generated/uniffi" \
    | awk '{print $3}' | sort -u); do
    grep -q " T ${name}\$" <<<"$symbols" || { echo "missing: $name" >&2; missing=1; }
  done
  [ "$missing" = 0 ] || { echo "android.sh: bindings name symbols the library lacks" >&2; exit 1; }
  echo "every external fun in the bindings is exported: $(grep -rhoE 'external fun [A-Za-z0-9_]+' \
    "$APP/build/generated/uniffi" | sort -u | wc -l) symbols"
done

echo "=== host build for the JVM test"
# The same library for this machine, and the fake server it talks to.
# Two builds: `--bin` would also limit semaphore-mobile to binaries, of which it has none.
cargo build --locked -p semaphore-mobile --lib
cargo build --locked -p semaphore-fake-server --bin fake-server
[ -f /cache/target/debug/libsemaphore_mobile.so ] \
  || { echo "android.sh: no host libsemaphore_mobile.so" >&2; exit 1; }
HOST_LIB_DIR=/cache/target/debug
FAKE_LOG="$(mktemp)"
/cache/target/debug/fake-server --scenario showcase --port 0 >"$FAKE_LOG" 2>&1 &
fake_pid=$!
trap 'kill "$fake_pid" 2>/dev/null || true; rm -f "$FAKE_LOG"' EXIT
fake_url=""
for _ in $(seq 1 300); do
  fake_url="$(grep -oE 'listening on http://[0-9.:]+' "$FAKE_LOG" | awk '{print $3}' || true)"
  [ -n "$fake_url" ] && break
  kill -0 "$fake_pid" 2>/dev/null || { cat "$FAKE_LOG" >&2; echo "android.sh: fake-server exited" >&2; exit 1; }
  sleep 0.1
done
[ -n "$fake_url" ] || { cat "$FAKE_LOG" >&2; echo "android.sh: fake-server never listened" >&2; exit 1; }
echo "fake-server: $fake_url"
# The scenario's ids as the fake server serves them (semaphore-fake-server's entity_uuid).
entity() {
  python3 -c 'import sys, uuid; print(uuid.uuid5(uuid.UUID(int=0x5e3a9b0e000040008000656e74697479), sys.argv[1]))' "$1"
}

cd "$ANDROID_DIR"
echo "=== gradle assembleDebug testDebugUnitTest"
./gradlew --no-daemon --console=plain assembleDebug testDebugUnitTest \
  -Psemaphore.abis="$ANDROID_ABIS" \
  -Psemaphore.hostLibDir="$HOST_LIB_DIR" \
  -Psemaphore.fakeServer="$fake_url" \
  -Psemaphore.channelId="$(entity cc-general)" \
  -Psemaphore.authorId="$(entity u-priya)"

results="$APP/build/test-results/testDebugUnitTest"
python3 - "$results" <<'PY'
import glob, sys, xml.etree.ElementTree as ET
tests = failures = skipped = 0
for path in glob.glob(sys.argv[1] + "/*.xml"):
    suite = ET.parse(path).getroot()
    tests += int(suite.get("tests")); skipped += int(suite.get("skipped"))
    failures += int(suite.get("failures")) + int(suite.get("errors"))
print(f"JVM tests: {tests} run, {failures} failed, {skipped} skipped")
sys.exit(1 if failures or skipped or not tests else 0)
PY

mkdir -p "$ANDROID_DIR/out"
apk="$ANDROID_DIR/out/semaphore-android-debug.apk"
cp "$APP/build/outputs/apk/debug/app-debug.apk" "$apk"

echo
echo "=== APK"
ls -l "$apk"
# One listing: grepping it twice from a pipe would end in SIGPIPE under pipefail.
listing="$(unzip -l "$apk")"
printf '%s\n' "$listing" | grep -E 'lib/.*\.so|classes'
for abi in "${abis[@]}"; do
  printf '%s\n' "$listing" | grep -q "lib/$abi/libsemaphore_mobile\.so" \
    || { echo "android.sh: lib/$abi/libsemaphore_mobile.so is not in $apk" >&2; exit 1; }
  if printf '%s\n' "$listing" | grep -q "lib/$abi/libsemaphore_ffi\.so"; then
    echo "android.sh: $apk ships lib/$abi/libsemaphore_ffi.so, a second copy of core" >&2
    exit 1
  fi
done
