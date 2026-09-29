// @vitest-environment node
/**
 * Linux .deb/.rpm auto-update: the installed electron-updater's own install path
 * (DebUpdater/RpmUpdater.doInstall -> LinuxUpdater.runCommandWithSudoIfNeeded ->
 * BaseUpdater.spawnSyncLog, which spawns through /bin/sh) runs unmodified here.
 * Only the programs it calls are fakes on PATH: pkexec/sudo exec their PROGRAM
 * like the real ones, and the package managers record the argv they receive.
 *
 * electron-updater hands pkexec/sudo `/bin/bash -c '<command>'`. The single quotes
 * are shell syntax for the /bin/sh that spawnSyncLog starts (`shell: true`), not
 * literal characters, so bash gets `<command>` as one argument. The 0.4.2 pnpm patch
 * removed them, which made bash run `dpkg` with no arguments ("need an action
 * option") and broke every pkexec/sudo install in 0.4.2 and 0.4.3. This test fails
 * if a patch or an upstream change stops the package manager from receiving the
 * package path.
 */
import { createRequire } from 'node:module';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

type InstallOptions = { isSilent: boolean; isForceRunAfter: boolean };
type LinuxUpdaterClass = { prototype: { doInstall(options: InstallOptions): boolean } };

const require = createRequire(import.meta.url);
const { DebUpdater } = require('electron-updater/out/DebUpdater') as { DebUpdater: LinuxUpdaterClass };
const { RpmUpdater } = require('electron-updater/out/RpmUpdater') as { RpmUpdater: LinuxUpdaterClass };

// Records its argv as one line, `[arg1][arg2]...`, in $FAKE_LOG_DIR/<name>.log;
// exits with the number in $FAKE_LOG_DIR/<name>.exit if that file exists.
const recorder = (name: string) => `#!/bin/sh
line=""
for a in "$@"; do line="$line[$a]"; done
printf '%s\\n' "$line" >> "$FAKE_LOG_DIR/${name}.log"
if [ -f "$FAKE_LOG_DIR/${name}.exit" ]; then read code < "$FAKE_LOG_DIR/${name}.exit"; exit "$code"; fi
exit 0
`;

// Like pkexec/sudo: skip leading options, then exec PROGRAM with its arguments.
const elevator = (name: string) => `#!/bin/sh
line=""
for a in "$@"; do line="$line[$a]"; done
printf '%s\\n' "$line" >> "$FAKE_LOG_DIR/${name}.log"
while [ "\${1#-}" != "$1" ]; do shift; done
exec "$@"
`;

describe.runIf(process.platform === 'linux' && existsSync('/bin/bash'))('electron-updater Linux package install', () => {
  let root: string;
  let bin: string;
  let savedPath: string | undefined;
  let savedLogDir: string | undefined;

  const install = (tools: Record<string, string>) => {
    for (const [name, script] of Object.entries(tools)) {
      writeFileSync(path.join(bin, name), script);
      chmodSync(path.join(bin, name), 0o755);
    }
  };
  const argv = (name: string): string[] => {
    const file = path.join(root, `${name}.log`);
    return existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n') : [];
  };

  // Runs the package's doInstall on a bare instance: no Electron app, no download.
  const runInstall = (Updater: LinuxUpdaterClass, file: string) => {
    const errors: Error[] = [];
    const updater = Object.create(Updater.prototype);
    Object.defineProperties(updater, {
      isRunningAsRoot: { value: () => false },
      _logger: { value: { info() {}, warn() {}, error() {} } },
      app: { value: { name: 'Semaphore Chat', relaunch() {} } },
      downloadedUpdateHelper: { value: { file } },
      dispatchError: { value: (e: Error) => errors.push(e) },
    });
    const ok = updater.doInstall({ isSilent: true, isForceRunAfter: false });
    return { ok, errors: errors.map((e) => e.message) };
  };

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'updater-install-'));
    bin = path.join(root, 'bin');
    mkdirSync(bin);
    savedPath = process.env.PATH;
    savedLogDir = process.env.FAKE_LOG_DIR;
    // Only the fakes are found: no real pkexec/sudo/dpkg from the host.
    process.env.PATH = bin;
    process.env.FAKE_LOG_DIR = root;
  });

  afterEach(() => {
    process.env.PATH = savedPath;
    if (savedLogDir === undefined) delete process.env.FAKE_LOG_DIR;
    else process.env.FAKE_LOG_DIR = savedLogDir;
    rmSync(root, { recursive: true, force: true });
  });

  const pendingDir = () => path.join(root, '.cache', 'semaphore-chat-updater', 'pending');
  const debs = () => [
    path.join(pendingDir(), 'semaphore-chat_0.5.1_amd64.deb'),
    path.join(root, '.cache', 'Semaphore Chat-updater', 'pending', 'Semaphore Chat (0.5.1).deb'),
  ];

  for (const elevate of ['pkexec', 'sudo'] as const) {
    describe(`as a non-root user via ${elevate}`, () => {
      beforeEach(() => install({ [elevate]: elevator(elevate) }));

      it('.deb: dpkg -i receives the package path', () => {
        install({ dpkg: recorder('dpkg'), 'apt-get': recorder('apt-get') });
        for (const deb of debs()) {
          rmSync(path.join(root, 'dpkg.log'), { force: true });
          expect(runInstall(DebUpdater, deb)).toEqual({ ok: true, errors: [] });
          expect(argv('dpkg')).toEqual([`[-i][${deb}]`]);
        }
        expect(argv(elevate)).toHaveLength(debs().length);
        expect(argv('apt-get')).toEqual([]);
      });

      it('.deb: when dpkg fails, the apt-get dependency fix gets its arguments', () => {
        install({ dpkg: recorder('dpkg'), 'apt-get': recorder('apt-get') });
        writeFileSync(path.join(root, 'dpkg.exit'), '1\n');
        const [deb] = debs();
        expect(runInstall(DebUpdater, deb)).toEqual({ ok: true, errors: [] });
        expect(argv('dpkg')).toEqual([`[-i][${deb}]`]);
        expect(argv('apt-get')).toEqual(['[install][-f][-y]']);
      });

      it('.rpm: dnf install receives the package path', () => {
        install({ dnf: recorder('dnf') });
        const rpm = path.join(pendingDir(), 'semaphore-chat-0.5.1.x86_64.rpm');
        expect(runInstall(RpmUpdater, rpm)).toEqual({ ok: true, errors: [] });
        expect(argv('dnf')).toEqual([`[install][--nogpgcheck][-y][${rpm}]`]);
      });

      it('.rpm: zypper install receives the package path', () => {
        install({ zypper: recorder('zypper') });
        const rpm = path.join(pendingDir(), 'semaphore-chat-0.5.1.x86_64.rpm');
        expect(runInstall(RpmUpdater, rpm)).toEqual({ ok: true, errors: [] });
        expect(argv('zypper')).toEqual([`[--non-interactive][--no-refresh][install][--allow-unsigned-rpm][-f][${rpm}]`]);
      });
    });
  }
});
