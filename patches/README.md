# pnpm patches

`pnpm patch <pkg>@<version>` / `pnpm patch-commit` write dependency patches
here, and root `package.json` lists them under `pnpm.patchedDependencies`.
There are none at the moment. The directory stays because every Dockerfile
copies it before `pnpm install`.

Rules for adding one:

- **Prove the bug in the unpatched package first, and add a test that fails
  without the patch.** The 0.4.2 `electron-updater@6.8.3` patch removed the
  quotes around the `bash -c` command in `LinuxUpdater`, reasoning that they
  reached bash literally. They don't: `spawnSyncLog` spawns through `/bin/sh`
  (`shell: true`), which strips them. The patch made bash run `dpkg` with no
  arguments, so .deb and .rpm auto-update in 0.4.2 and 0.4.3 failed on every
  pkexec/sudo install. `frontend/src/__tests__/electron/linuxUpdaterInstall.node.test.ts`
  now runs that install path and fails if the package manager doesn't get the
  package path.
- **Leave `allowUnusedPatches` off.** With it on, a patch keyed to a version
  that's no longer installed (a Dependabot bump) is skipped without a word.
  Off, the lockfile refresh fails with `ERR_PNPM_UNUSED_PATCH`, and someone
  has to port or drop the patch.
- A patch for a dependency that only one workspace package uses (such as a
  frontend-only one) also fails `backend/Dockerfile`: it runs a plain
  `pnpm install` on a workspace without `frontend/`, where the patch is
  unused. Handle that in the Dockerfile, not by turning `allowUnusedPatches`
  back on. CI's `--frozen-lockfile` installs, `--filter` installs and
  `backend/Dockerfile.prod` are fine.
