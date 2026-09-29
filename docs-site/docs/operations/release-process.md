# Release Process

Semaphore Chat uses a tag-based release workflow with support for full releases, component hotfixes, and manual builds.

## Tag Patterns

| Tag Pattern | What it Triggers |
|-------------|------------------|
| `v*.*.*` | Full release: Electron + Docker + Helm + GitHub Release |
| `electron-v*.*.*` | Electron builds + GitHub Release only |
| `docker-v*.*.*` | Docker images to GHCR only |
| `helm-v*.*.*` | Helm chart to GHCR only |

## Creating a Release

### Pre-release checks

The Docker publish workflow gates image publishing on a Trivy scan against the **live** advisory database, so a release can fail on advisories published after the last green PR run. Scan and patch dependencies *before* tagging:

```bash
# Scan the lockfile against current advisories (same severity gate as CI)
docker run --rm -v "$PWD:/repo" aquasec/trivy fs \
  --severity HIGH,CRITICAL --ignore-unfixed \
  --ignorefile /repo/.trivyignore --scanners vuln /repo/pnpm-lock.yaml
```

If it reports findings, bump the affected packages to their fixed versions — for transitive dependencies, add a `pnpm.overrides` entry in the root `package.json` and regenerate the lockfile:

```bash
docker compose run --rm -v "$PWD:/workspace" backend \
  sh -c 'cd /workspace && pnpm install --lockfile-only'
```

Then rebuild images (`docker compose build`), re-run the test suites, and re-scan before proceeding. This keeps the release atomic — otherwise a failed image publish requires a `docker-v*` hotfix tag from a later commit, and the `latest` tag must be repointed manually (component tags don't apply it).

Also confirm that every pnpm patch (root `package.json`, `pnpm.patchedDependencies`) still applies, and that the desktop updater's Linux install path works:

```bash
# fails with ERR_PNPM_UNUSED_PATCH / ERR_PNPM_PATCH_FAILED if a patch no longer matches
docker compose run --rm -v "$PWD:/workspace" backend \
  sh -c 'cd /workspace && pnpm install --lockfile-only'
# electron-updater's .deb/.rpm install through pkexec/sudo (a bad patch broke it in 0.4.2 and 0.4.3)
docker compose run --rm frontend pnpm exec vitest run src/__tests__/electron/linuxUpdaterInstall.node.test.ts
```

### Full Release

```bash
git checkout main
git pull origin main

# Update CHANGELOG.md, commit
git add CHANGELOG.md
git commit -m "docs: update changelog for v1.0.0"

# Tag and push
git tag v1.0.0
git push origin main
git push origin v1.0.0
```

This triggers:

- Electron builds for Windows (.exe) and Linux (.AppImage, .deb, .rpm)
- Docker images published to GHCR (backend + frontend)
- Helm chart published to GHCR
- GitHub Release created with all Electron artifacts
- Auto-update manifests uploaded (latest.yml, latest-linux.yml)

### Component Hotfixes

```bash
# Electron only
git tag electron-v1.0.1 && git push origin electron-v1.0.1

# Docker images only
git tag docker-v1.0.1 && git push origin docker-v1.0.1

# Helm chart only
git tag helm-v1.0.1 && git push origin helm-v1.0.1
```

### Manual Build

Go to GitHub Actions, select the workflow, click "Run workflow", optionally specify a version.

## Release Artifacts

### GitHub Release (Electron)

| Artifact | Description |
|----------|-------------|
| `SemaphoreChat-Setup-X.X.X.exe` | Windows NSIS installer |
| `SemaphoreChat-X.X.X.AppImage` | Linux universal binary |
| `semaphore-chat_X.X.X_amd64.deb` | Debian/Ubuntu package |
| `semaphore-chat-X.X.X.x86_64.rpm` | Fedora/RHEL package |
| `latest.yml` / `latest-linux.yml` | Auto-update manifests |

### Docker Images (GHCR)

```
ghcr.io/OWNER/semaphore-backend:1.0.0
ghcr.io/OWNER/semaphore-frontend:1.0.0
```

Tags: `1.0.0`, `1.0`, `1`, `latest`

### Helm Chart (GHCR OCI)

```bash
helm install semaphore-chat oci://ghcr.io/OWNER/semaphore-chat/charts/semaphore-chat --version 1.0.0
```

## Electron Auto-Update

The desktop app checks for updates on startup (3s delay) and every hour. Uses GitHub Releases as the update source.

**Requirements**: `latest.yml` must exist in the release, release must not be draft/prerelease.

## Version Management

Versions are injected from git tags during CI -- no need to manually update `package.json` or `Chart.yaml`.

Follow [Semantic Versioning](https://semver.org/): MAJOR (breaking), MINOR (features), PATCH (fixes).

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Auto-update not working | Verify `latest.yml` exists in release, not draft/prerelease |
| Build failures | Check Actions logs, verify Node.js v20 compat |
| Version mismatch | Verify tag format matches expected patterns |
