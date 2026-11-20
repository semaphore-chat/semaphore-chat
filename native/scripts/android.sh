#!/usr/bin/env bash
# D1: build the Android debug APK, in the Android image, on the shared semaphore-test network.
#
#   native/scripts/android.sh
#
# Produces native/android/out/semaphore-android-debug.apk: an empty Jetpack Compose app that links
# semaphore-core through the UniFFI surface in crates/semaphore-ffi and shows a value read back
# from it. Steps, all inside the container:
#
#   cargo ndk -t arm64-v8a --platform 26 build -p semaphore-ffi --release
#   uniffi-bindgen generate --language kotlin <libsemaphore_ffi.so>
#   ./gradlew assembleDebug  (native/android)
#
# - On the shared semaphore-test network only. It creates and removes no network.
# - The image tag hashes the base tag, the Dockerfile and the uid, so a change rebuilds it and an
#   unchanged one never does.
# - The cargo registry, the per-checkout target directory, Gradle's caches and HOME are named
#   volumes. HOME carries ~/.android/debug.keystore, so every build signs the APK with the same
#   debug key and a sideloaded update is not rejected for a changed signature.
# - The repo is mounted at its own path, so paths in output work on the host too.
set -euo pipefail

NATIVE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$NATIVE_DIR/.." && pwd)"
HOST_UID="$(id -u)"
HOST_GID="$(id -g)"

if [ "${1:-}" != --inner ]; then
  base="$("$NATIVE_DIR/scripts/in-image.sh" --print-image)"
  tag="$( { cat "$NATIVE_DIR/docker/Dockerfile.android"; echo "$base"; echo "$HOST_UID"; } \
    | sha256sum | cut -c1-12)"
  image="semaphore-native-android:$tag"

  if ! docker image inspect "$image" >/dev/null 2>&1; then
    echo "android: building $image (first use of this toolchain: JDK, SDK, NDK, Gradle) ..." >&2
    docker build -q -f "$NATIVE_DIR/docker/Dockerfile.android" \
      --build-arg "BASE=$base" \
      --build-arg "HOST_UID=$HOST_UID" \
      --build-arg "HOST_GID=$HOST_GID" \
      -t "$image" "$NATIVE_DIR" >/dev/null
  fi

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
    -w "$NATIVE_DIR" \
    "$image" bash scripts/android.sh --inner "$@"
fi

# ----- inside the image -------------------------------------------------------

ANDROID_DIR="$NATIVE_DIR/android"
APP="$ANDROID_DIR/app"
TARGET=aarch64-linux-android
LIB="/cache/target/$TARGET/release/libsemaphore_ffi.so"

echo "=== cargo ndk build ($TARGET, release)"
# The workspace's release profile strips symbols (Cargo.toml), and uniffi-bindgen reads the FFI
# metadata out of the library's static symbol table, so this build keeps it: only debug
# information is stripped. The copy that ships is stripped to its dynamic symbols below.
export CARGO_PROFILE_RELEASE_STRIP=debuginfo
cargo ndk -t arm64-v8a --platform 26 \
  -o "$APP/build/rustJniLibs" \
  build --locked -p semaphore-ffi --release

rm -rf "$APP/build/generated/uniffi"
echo "=== uniffi-bindgen (Kotlin)"
uniffi-bindgen generate --no-format --language kotlin \
  --out-dir "$APP/build/generated/uniffi" \
  --metadata-no-deps "$LIB"

# What the app loads needs nothing beyond the exported dynamic symbols.
ndk_bin="$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin"
"$ndk_bin/llvm-strip" --strip-unneeded "$APP/build/rustJniLibs/arm64-v8a/libsemaphore_ffi.so"

echo "=== gradle assembleDebug"
cd "$ANDROID_DIR"
./gradlew --no-daemon --console=plain assembleDebug

mkdir -p "$ANDROID_DIR/out"
apk="$ANDROID_DIR/out/semaphore-android-debug.apk"
cp "$APP/build/outputs/apk/debug/app-debug.apk" "$apk"

echo
echo "=== APK"
ls -l "$apk"
# One listing: grepping it twice from a pipe would end in SIGPIPE under pipefail.
listing="$(unzip -l "$apk")"
printf '%s\n' "$listing" | grep -E 'lib/.*\.so|classes'
# The point of D1: the core is in the APK, for the ABI the app was built for.
printf '%s\n' "$listing" | grep -q 'lib/arm64-v8a/libsemaphore_ffi\.so' \
  || { echo "android.sh: lib/arm64-v8a/libsemaphore_ffi.so is not in $apk" >&2; exit 1; }
