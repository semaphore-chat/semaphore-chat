# Proposed CLAUDE.md addition: cutting a native preview release

Not applied: changes to the repository `CLAUDE.md` need the owner's approval. To apply, paste the
section below into `CLAUDE.md` right after "Cutting a release" (after its step 6, before
"Sensitive User Fields Policy").

---

### Cutting a native preview release

The native client (`native/`) ships separately from the Electron app, as GitHub **pre-releases**
tagged `native-vX.Y.Z` (`.github/workflows/native-release.yml`). It never touches the Electron,
Docker or Helm lanes above, and `v*` tags never build it. Confirm the version and the tag push
with Mike: the tag publishes. Full procedure: `native/docs/packaging.md`, "Releasing a native
preview".

1. **Version.** Plain `X.Y.Z` (no `-rc`; the Windows package step refuses it). The tag is
   `native-vX.Y.Z`; the build takes its version from it, so there is no bump commit.
2. **Test.** The native CI on the commit is green (`native-spike.yml`, `native-package.yml`,
   `native-e2e.yml`), and `native/scripts/test-release-assembly.sh` passes (it also runs in the
   build image: `native/scripts/in-image.sh scripts/test-release-assembly.sh`).
3. **Dry run** (no secret, no release, no tag):
   `gh workflow run native-release.yml --ref <branch> -f version=X.Y.Z` (dry_run defaults to true),
   then `gh run watch <id> --exit-status`. Download the `native-release-X.Y.Z` artifact, install a
   package, check `--version`, read `notes.md`.
4. **Tag** (with Mike's go-ahead), on the dry-run commit:
   `git tag -a native-vX.Y.Z -m "native-vX.Y.Z" && git push origin native-vX.Y.Z`.
5. **What it publishes:** the pre-release `native-vX.Y.Z` (AppImage, .deb, .rpm, Windows zip and
   installer, `SHA256SUMS`, `latest.json`, `latest.json.sig`), then it replaces `latest.json` and
   `latest.json.sig` on the fixed pre-release `native-preview-feed`, which installed copies read.
   `latest.json` is signed with the `NATIVE_UPDATE_SIGNING_KEY` secret (Ed25519); never print it.
6. **Verify:** `gh run watch <id> --exit-status`, `gh release view native-vX.Y.Z`, and
   `curl -sL https://github.com/semaphore-chat/semaphore-chat/releases/download/native-preview-feed/latest.json`
   shows `X.Y.Z`.

Key rotation and a lost or leaked key: `native/docs/packaging.md`, "Key rotation".
