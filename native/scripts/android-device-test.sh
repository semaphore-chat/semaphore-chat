#!/usr/bin/env bash
# Run the instrumented Android tests on an x86_64 emulator, in Docker, on the shared
# semaphore-test network.
#
#   native/scripts/android-device-test.sh
#
# What a JVM test cannot reach, on a real Android runtime: the TLS verifier's Android half
# (NativeLib.init -> rustls-platform-verifier), KeystoreSecretStore over the Android Keystore, and
# the core signing in, hearing a live message and restoring its session against
# semaphore-fake-server with both of them in place
# (native/android/app/src/androidTest/.../DeviceCoreTest.kt). What each test does and does not
# prove is listed in native/android/README.md.
#
# Steps:
#  1. build (or reuse) semaphore-native-android-emulator, layered on the Android image by
#     native/docker/Dockerfile.android-emulator: the emulator and the x86_64 AOSP Android
#     14 system image, each pinned by URL and sha256;
#  2. in one container on semaphore-test, as the host user, with --device /dev/kvm:
#     - the emulator starts headless in the background while
#       `ANDROID_ABIS=x86_64 scripts/android.sh --inner` builds the x86_64 libraries, the Kotlin
#       bindings, the debug APK and runs the JVM test;
#     - semaphore-fake-server on 127.0.0.1:<fake port>, and an HTTPS server with a self-signed
#       certificate on 127.0.0.1:<tls port>;
#     - adb wait-for-device, then sys.boot_completed, then ./gradlew connectedDebugAndroidTest,
#       with the fake server's address and the certificate's fingerprint as instrumentation
#       arguments. The results are printed one test at a time and counted.
#  3. on exit (EXIT, INT, TERM) the container is removed, and with it the emulator, the AVD (under
#     the container's /tmp) and both servers. The container is named per checkout and labelled for
#     `scripts/test-stack.sh ls`, so one left by a SIGKILL shows up there and the next run in this
#     checkout removes it. No network is created or removed; no other container is touched.
#
# Why the servers share the emulator's container: inside an emulator, 10.0.2.2 is QEMU's user-mode
# network's alias for the *emulator process's* own loopback. A server in a second container is a
# different host, reachable only as that container's bridge address, with the guest routing out
# through the emulator's NAT to get there. In the same container it is 10.0.2.2, and the guest
# needs no DNS and no address discovery.
#
# The trusted-certificate test signs in to https://dl.google.com: a chain the platform store trusts,
# which a locally generated certificate is not, on a host the run's own downloads need anyway. It
# needs outbound HTTPS from the container.
set -euo pipefail

NATIVE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$NATIVE_DIR/.." && pwd)"
HOST_UID="$(id -u)"
HOST_GID="$(id -g)"

if [ "${1:-}" != --inner ]; then
  # The Android image, built if this is its first use: the emulator image is layered on it.
  # Its name only: it is pulled or built below only if the emulator image has to be built.
  android_image="$(bash "$NATIVE_DIR/scripts/android.sh" --print-name)"
  # Everything the image is built from: the Dockerfile, the package XML files it copies, the base.
  tag="$( { cat "$NATIVE_DIR/docker/Dockerfile.android-emulator" \
              "$NATIVE_DIR/docker/android-emulator/emulator-package.xml" \
              "$NATIVE_DIR/docker/android-emulator/system-image-package.xml";
            echo "$android_image"; } | sha256sum | cut -c1-12)"
  image="semaphore-native-android-emulator:$tag"

  # shellcheck source=image-cache.sh
  . "$NATIVE_DIR/scripts/image-cache.sh"
  if ! native_image_fetch "$image"; then
    bash "$NATIVE_DIR/scripts/android.sh" --print-image >/dev/null
    echo "android-device-test: building $image (the emulator and its system image) ..." >&2
    native_image_build "$image" -f "$NATIVE_DIR/docker/Dockerfile.android-emulator" \
      --build-arg "BASE=$android_image" \
      "$NATIVE_DIR"
  fi
  # Prints the image, pulled or built first, and runs nothing (.github/workflows/native-images.yml).
  if [ "${1:-}" = --print-image ]; then echo "$image"; exit 0; fi

  if [ ! -r /dev/kvm ] || [ ! -w /dev/kvm ]; then
    echo "android-device-test: /dev/kvm must be readable and writable: the emulator needs it" >&2
    echo "(on a bare machine: add your user to the kvm group)" >&2
    exit 1
  fi

  "$ROOT/scripts/test-net.sh" >/dev/null

  checkout="$(printf '%s' "$ROOT" | sha256sum | cut -c1-8)"
  container="native-android-device-$checkout"
  remove_container() { docker rm -f "$container" >/dev/null 2>&1 || true; }
  # Set before anything starts, so no signal can leave the container behind. A signal exits the
  # script, which runs the EXIT trap that removes the container. It
  # never removes the network or anything it did not start.
  trap remove_container EXIT
  trap 'exit 143' INT TERM
  # A leftover of a killed run in this checkout (and a second run here would share the build dirs).
  remove_container

  # --device /dev/kvm: the emulator accelerates in hardware, as it does in CI. --group-add: the
  # container's user has no supplementary groups, so a /dev/kvm that is 0660 root:kvm needs the
  # device's own gid. The label is the one scripts/test-stack.sh ls filters on.
  docker run -d --init \
    --name "$container" \
    --label "org.semaphore-chat.test-stack.ticket=android-device-$checkout" \
    --label "org.semaphore-chat.test-stack.role=android-device-test" \
    --network semaphore-test \
    --device /dev/kvm \
    --group-add "$(stat -c %g /dev/kvm)" \
    --user "$HOST_UID:$HOST_GID" \
    -v "$ROOT:$ROOT" \
    -v "$(native_cache_mount "${NATIVE_CARGO_CACHE:-semaphore-native-cargo}" /cache/cargo)" \
    -v "semaphore-native-target-android-$checkout:/cache/target" \
    -v "$(native_cache_mount "${NATIVE_GRADLE_CACHE:-semaphore-android-gradle}" /cache/gradle)" \
    -v semaphore-android-home:/cache/home \
    -e "CARGO_INCREMENTAL=${CARGO_INCREMENTAL:-0}" \
    -w "$NATIVE_DIR" \
    "$image" bash scripts/android-device-test.sh --inner "$@" >/dev/null

  # In the background and waited for: bash runs a trap when `wait` is interrupted, not while a
  # foreground command (docker logs -f, docker wait) is running.
  status_file="$(mktemp)"
  docker logs -f "$container" &
  logs_pid=$!
  docker wait "$container" >"$status_file" &
  wait_pid=$!
  trap 'remove_container; kill "$logs_pid" "$wait_pid" 2>/dev/null || true; rm -f "$status_file"' EXIT
  trap 'exit 143' INT TERM
  wait "$wait_pid" || true
  wait "$logs_pid" 2>/dev/null || true
  status="$(cat "$status_file")"
  [ "$status" = 0 ] || { echo "android-device-test: the container exited ${status:-?}" >&2; exit 1; }
  exit 0
fi

# ----- inside the emulator image ----------------------------------------------

ANDROID_DIR="$NATIVE_DIR/android"
APP="$ANDROID_DIR/app"
ADB="$ANDROID_HOME/platform-tools/adb"
EMULATOR="$ANDROID_HOME/emulator/emulator"
AVD="semaphore-device-test"
# Under the container's /tmp: it goes with the container and never lands in the shared HOME volume.
export ANDROID_AVD_HOME=/tmp/avd
SERIAL=emulator-5554
SYSTEM_IMAGE="system-images;android-34;default;x86_64"
FAKE_PORT=18080
TLS_PORT=18443
TRUSTED_SERVER="https://dl.google.com"
FAKE_LOG=/tmp/fake-server.log
EMULATOR_LOG=/tmp/emulator.log

emulator_pid=""
fake_pid=""
tls_pid=""
tls_dir=""

cleanup() {
  if [ -n "$tls_pid" ]; then kill "$tls_pid" 2>/dev/null || true; fi
  if [ -n "$fake_pid" ]; then kill "$fake_pid" 2>/dev/null || true; fi
  if [ -n "$emulator_pid" ]; then kill "$emulator_pid" 2>/dev/null || true; fi
  "$ADB" kill-server >/dev/null 2>&1 || true
  if [ -n "$tls_dir" ]; then rm -rf "$tls_dir"; fi
}
trap cleanup EXIT INT TERM

# The scenario's ids, as semaphore-fake-server's entity_uuid serves them (android.sh computes the
# same, for the JVM test).
entity() {
  python3 -c 'import sys, uuid; print(uuid.uuid5(uuid.UUID(int=0x5e3a9b0e000040008000656e74697479), sys.argv[1]))' "$1"
}

echo "=== emulator acceleration"
"$EMULATOR" -accel-check || {
  echo "android-device-test: no hardware acceleration for the emulator" >&2
  exit 1
}

echo "=== emulator (headless, $AVD)"
# Fresh every run: the AVD is cheap to create and must match the image in this image.
mkdir -p "$ANDROID_AVD_HOME"
echo no | avdmanager create avd --force -n "$AVD" -k "$SYSTEM_IMAGE" -d pixel_5 >/dev/null
# Started before the build below, which takes longer than a boot.
"$EMULATOR" -avd "$AVD" -port "${SERIAL#emulator-}" \
  -no-window -no-audio -no-boot-anim -no-snapshot -no-metrics \
  -gpu swiftshader_indirect -accel on -cores 4 -memory 2048 \
  >"$EMULATOR_LOG" 2>&1 &
emulator_pid=$!

echo "=== x86_64 libraries, bindings, APK and the JVM test (android.sh --inner)"
ANDROID_ABIS=x86_64 bash "$NATIVE_DIR/scripts/android.sh" --inner

echo "=== semaphore-fake-server on 127.0.0.1:$FAKE_PORT"
/cache/target/debug/fake-server --scenario showcase --port "$FAKE_PORT" --bind 127.0.0.1 \
  >"$FAKE_LOG" 2>&1 &
fake_pid=$!
for _ in $(seq 1 300); do
  grep -q 'listening on' "$FAKE_LOG" && break
  kill -0 "$fake_pid" 2>/dev/null || { cat "$FAKE_LOG" >&2; echo "android-device-test: fake-server exited" >&2; exit 1; }
  sleep 0.1
done
grep -q 'listening on' "$FAKE_LOG" \
  || { cat "$FAKE_LOG" >&2; echo "android-device-test: fake-server never listened" >&2; exit 1; }
cat "$FAKE_LOG"

echo "=== HTTPS server with a self-signed certificate on 127.0.0.1:$TLS_PORT"
# The device must refuse this one. Its fingerprint is passed to the test, which checks it saw the
# same certificate before checking that the core refuses it.
tls_dir="$(mktemp -d)"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -sha256 \
  -subj "/CN=Semaphore device test" -addext "subjectAltName=IP:10.0.2.2" -keyout "$tls_dir/key.pem" -out "$tls_dir/cert.pem" \
  >/dev/null 2>&1
tls_sha="$(openssl x509 -in "$tls_dir/cert.pem" -outform DER | sha256sum | cut -d' ' -f1)"
echo "certificate sha256: $tls_sha"
openssl s_server -quiet -www -accept "127.0.0.1:$TLS_PORT" \
  -cert "$tls_dir/cert.pem" -key "$tls_dir/key.pem" >/tmp/tls-server.log 2>&1 &
tls_pid=$!
for _ in $(seq 1 100); do
  (exec 3<>"/dev/tcp/127.0.0.1/$TLS_PORT") 2>/dev/null && break
  sleep 0.1
done

export ANDROID_SERIAL="$SERIAL"
echo "=== boot"
"$ADB" start-server >/dev/null
timeout 600 "$ADB" wait-for-device || { tail -50 "$EMULATOR_LOG" >&2; echo "android-device-test: adb saw no device" >&2; exit 1; }
deadline=$((SECONDS + 600))
while [ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" != 1 ]; do
  kill -0 "$emulator_pid" 2>/dev/null \
    || { tail -50 "$EMULATOR_LOG" >&2; echo "android-device-test: the emulator exited" >&2; exit 1; }
  [ "$SECONDS" -lt "$deadline" ] \
    || { tail -50 "$EMULATOR_LOG" >&2; echo "android-device-test: boot timed out" >&2; exit 1; }
  sleep 2
done
"$ADB" devices
"$ADB" shell getprop ro.build.version.release

echo "=== gradle connectedDebugAndroidTest"
rm -rf "$APP/build/outputs/androidTest-results"
cd "$ANDROID_DIR"
# A failing test fails the Gradle task, but the results below still say which: so its status is
# kept rather than ending the script here.
gradle_status=0
./gradlew --no-daemon --console=plain connectedDebugAndroidTest \
  -Psemaphore.abis=x86_64 \
  -Pandroid.testInstrumentationRunnerArguments.server="http://10.0.2.2:$FAKE_PORT" \
  -Pandroid.testInstrumentationRunnerArguments.channel="$(entity cc-general)" \
  -Pandroid.testInstrumentationRunnerArguments.author="$(entity u-priya)" \
  -Pandroid.testInstrumentationRunnerArguments.bulkChannel="$(entity cc-lfg)" \
  -Pandroid.testInstrumentationRunnerArguments.tlsServer="https://10.0.2.2:$TLS_PORT" \
  -Pandroid.testInstrumentationRunnerArguments.tlsSha256="$tls_sha" \
  -Pandroid.testInstrumentationRunnerArguments.trustedServer="$TRUSTED_SERVER" \
  || gradle_status=$?

# DeviceChatTest's timing of a 1000-row reset crossing the FFI into the chat's state, and
# DeviceNotifyTest's report of whether a mention arrives under forced Doze.
echo "=== timings and Doze"
"$ADB" logcat -d -s SemaphoreTiming:I SemaphoreDoze:I 2>/dev/null | grep -E 'SemaphoreTiming|SemaphoreDoze' || true

# A crash ends the instrumentation with no stack trace in the results: print the device's.
if [ "$gradle_status" != 0 ]; then
  echo "=== device crash log"
  "$ADB" logcat -d -b crash 2>/dev/null | grep -E "Abort message|signal [0-9]|#0[0-9] pc" | head -n 40 || true
  "$ADB" logcat -d 2>/dev/null | grep -E "AndroidRuntime|FATAL EXCEPTION|runtime.cc|Caused by|panicked" | head -n 80 || true
fi

results="$APP/build/outputs/androidTest-results"
python3 - "$results" <<'PY'
import glob, sys, xml.etree.ElementTree as ET

tests = failures = skipped = 0
for path in sorted(glob.glob(sys.argv[1] + "/**/*.xml", recursive=True)):
    suite = ET.parse(path).getroot()
    for case in suite.iter("testcase"):
        if case.find("failure") is not None or case.find("error") is not None:
            outcome = "FAILED"
            failures += 1
        elif case.find("skipped") is not None:
            outcome = "SKIPPED"
            skipped += 1
        else:
            outcome = "passed"
        tests += 1
        print(f"{outcome:8} {case.get('classname')}.{case.get('name')} ({case.get('time')}s)")
print(f"\ninstrumented tests: {tests} run, {failures} failed, {skipped} skipped")
sys.exit(1 if failures or skipped or not tests else 0)
PY

# The reason, not only the symptom: the saved per-test logcat has the verifier's own verdict.
logcat_of() { find "$results" -name "logcat-*$1.txt" | head -1; }
refused="$(logcat_of tlsVerifierRefusesACertificateTheDeviceDoesNotTrust)"
accepted="$(logcat_of tlsVerifierAcceptsACertificateThePlatformStoreTrusts)"
[ -n "$refused" ] && grep -q 'UnknownIssuer' "$refused" \
  || { echo "android-device-test: the refused certificate's logcat has no UnknownIssuer" >&2; exit 1; }
[ -n "$accepted" ] && ! grep -q 'failed to verify TLS certificate' "$accepted" \
  || { echo "android-device-test: the trusted host's logcat is missing or shows a failed verification" >&2; exit 1; }
echo "TLS reasons: refused for UnknownIssuer; the trusted host verified"

# Gradle can fail after the tests (an uninstall, a device that dropped): that is a failure too.
[ "$gradle_status" = 0 ] \
  || { echo "android-device-test: gradle exited $gradle_status" >&2; exit 1; }
