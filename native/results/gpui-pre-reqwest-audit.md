# gpui-pre-reqwest provenance audit

Generated 2026-11-05T21:21:14+00:00 from `native/Cargo.lock`.

Downloaded `gpui-pre-reqwest 0.12.15` from static.crates.io and checked its sha256 against `Cargo.lock`: **verified**. The archive was extracted and read only; nothing was built or executed.

## Summary

| Candidate | Role | Files compared | Packaging diffs | Non-packaging files | Lines (+/-) | Status |
|---|---|---|---|---|---|---|
| zed-industries/reqwest@68a26f46bb6ed5131f56517a574041d2c4d2aec8 | commit named by .cargo_vcs_info.json | 78 | 13 | 0 | +0/-0 | compared |
| zed-industries/reqwest@c15662463bda39148ba154100dd44d3fba5873a4 | commit named by the package description | 78 | 13 | 0 | +0/-0 | compared |
| crates.io reqwest 0.12.15 | published upstream release at the same version | 78 | 4 | 13 | +476/-83 | compared |
| seanmonstar/reqwest@54376c35dffb0fb2e79b430920a62363aee202c8 | upstream git tag for the same release | 78 | 13 | 13 | +476/-83 | compared |
| seanmonstar/reqwest@114d97c1a862567b465cb57f14d584626e1cf30c | upstream master commit the fork merged | 78 | 13 | 4 | +96/-6 | compared |

### Special-attention categories

| Category | zed_fork_vcs_sha | zed_fork_description_sha | crates_io_reqwest_0_12_15 | upstream_v0_12_15_tag | upstream_master_at_fork_base |
|---|---|---|---|---|---|
| `build_script`| 0 | 0 | 0 | 0 | 0 |
| `tls_certificate`| 0 | 0 | 0 | 0 | 0 |
| `proxy`| 0 | 0 | 2 | 2 | 0 |
| `url_or_host`| 0 | 0 | 19 | 19 | 11 |
| `redirect`| 0 | 0 | 34 | 34 | 34 |
| `header`| 0 | 0 | 19 | 19 | 7 |
| `process_spawn`| 0 | 0 | 0 | 0 | 0 |
| `unsafe`| 0 | 0 | 0 | 0 | 0 |
| `network_interface`| 0 | 0 | 6 | 6 | 0 |
| `dependency_change`| 0 | 0 | 4 | 4 | 0 |

- build.rs in the published crate: (none)
- build scripts in candidate trees: zed_fork_vcs_sha=(none), zed_fork_description_sha=(none), crates_io_reqwest_0_12_15=(none), upstream_v0_12_15_tag=(none), upstream_master_at_fork_base=(none)
- upstream tag vs crates.io reqwest 0.12.15: non-packaging diff identical: True (tag files compared 78, crate files compared 78)

## Upstream determination

**Verdict:** The published crate is the zed-industries/reqwest fork commit 68a26f46bb6ed5131f56517a574041d2c4d2aec8 (branch prep-for-crates-io); no seanmonstar/reqwest ref points at that commit, and the content differs from the v0.12.15 release tag. Every packaged source file is byte-identical to that fork commit; the description's c156624 has the same tree. The fork commit is based on upstream master 114d97c1a862567b465cb57f14d584626e1cf30c, which is 8 commits after the v0.12.15 release tag.

- The crate's .cargo_vcs_info.json names commit 68a26f46bb6ed5131f56517a574041d2c4d2aec8 (dirty=True); that commit is refs/heads/prep-for-crates-io, refs/pull/4/head in zed-industries/reqwest.
- zed-industries/reqwest is a GitHub fork of seanmonstar/reqwest (repository HTML; GitHub API metadata unavailable: GitHub API rate limit remaining=0, reset=1793916815).
- The description names zed-industries/request@c156624. zed-industries/request is not publicly accessible (git ls-remote: remote: Repository not found. | fatal: Authentication failed for 'https://github.com/zed-industries/request/'; GitHub API: GitHub API rate limit remaining=0, reset=1793916815). A by-SHA fetch from zed-industries/reqwest succeeds; no ref in that repository points at the commit.
- The description's c156624 resolves to c15662463bda39148ba154100dd44d3fba5873a4; its tree is f769a8d70cac46bdaeccf45039131d9766ced492 and the vcs commit's tree is f769a8d70cac46bdaeccf45039131d9766ced492 (identical).
- No ref in seanmonstar/reqwest points at 68a26f46bb6ed5131f56517a574041d2c4d2aec8; a by-SHA fetch still succeeds because the fork and its parent share GitHub's object network.
- The fork's merge commit 951c770a32f1998d6e999cef3e59e0013e6c4415 has second parent 114d97c1a862567b465cb57f14d584626e1cf30c (`ClientBuilder::interface` on macOS/Solarish OSes (#2623)), the upstream master commit it merged; source: second parent of fork merge commit 951c770a32f1998d6e999cef3e59e0013e6c4415. The release tag v0.12.15 is an ancestor of that base; 8 upstream commits separate them.
- Comparison with zed-industries/reqwest@68a26f46bb6ed5131f56517a574041d2c4d2aec8: 78 files compared, 0 non-packaging changed files, +0/-0 changed lines, 13 packaging differences.
- Every packaged source file is byte-identical to zed-industries/reqwest@68a26f46bb6ed5131f56517a574041d2c4d2aec8; the only differences are cargo packaging files, the manifest identity/description, and files cargo excludes from the package.
- Against upstream master 114d97c1a862567b465cb57f14d584626e1cf30c, the fork changes 4 files and +96/-6 lines. Changed-line categories: url_or_host=11, redirect=34, header=7. No TLS/certificate, proxy, process-spawn, unsafe or build-script line changes.
- The upstream tag v0.12.15 and the crates.io reqwest 0.12.15 crate produce the same non-packaging diff against the published crate: yes.
- The crate was packaged with dirty=true. The packaged manifest identity and description differ from the commit's manifest, while every packaged source file matches the commit; the dirty state is therefore not visible as a source change in the .crate.
- Comparison with crates.io reqwest 0.12.15: 13 files changed outside packaging, +476/-83 lines; 10 of those files are byte-identical to upstream master 114d97c1a862567b465cb57f14d584626e1cf30c and the rest contain the fork's changes.

### Repositories

GitHub API calls were skipped: GitHub API rate limit remaining=0, reset=1793916815. Repository existence comes from `git ls-remote`; fork metadata falls back to the repository HTML.

| Repository | Public | Fork | Parent | GitHub API |
|---|---|---|---|---|
| zed-industries/reqwest | yes | yes (HTML) | seanmonstar/reqwest | skipped |
| zed-industries/request | no | (none) | (none) | skipped |
| seanmonstar/reqwest | yes | (none) | (none) | skipped |

### Claimed commits

| Commit | Refs in zed fork | Refs upstream | Fetch zed | Fetch upstream | Compare upstream master | Tree |
|---|---|---|---|---|---|---|
| `68a26f46bb6ed5131f56517a574041d2c4d2aec8` | refs/heads/prep-for-crates-io, refs/pull/4/head | (none) | ok | ok | (unavailable) | `f769a8d70cac46bdaeccf45039131d9766ced492` |
| `c15662463bda39148ba154100dd44d3fba5873a4` | (none) | (none) | ok | ok | (unavailable) | `f769a8d70cac46bdaeccf45039131d9766ced492` |

- vcs commit tree: `f769a8d70cac46bdaeccf45039131d9766ced492`; description commit tree: `f769a8d70cac46bdaeccf45039131d9766ced492`; identical: **True**.
- fork merge commit: `951c770a32f1998d6e999cef3e59e0013e6c4415`; upstream base: `114d97c1a862567b465cb57f14d584626e1cf30c` (`ClientBuilder::interface` on macOS/Solarish OSes (#2623)); source: second parent of fork merge commit 951c770a32f1998d6e999cef3e59e0013e6c4415.
- upstream release tag `54376c35dffb0fb2e79b430920a62363aee202c8` is `an ancestor of the base`; 8 upstream commits separate the tag from the base.

Upstream commits between the release tag and the fork base:

- `114d97c1a862` `ClientBuilder::interface` on macOS/Solarish OSes (#2623)
- `2fd902ebbf20` fix(wasm): handle null body in bytes_stream (#2632)
- `91c52c42b562` chore: fix some typos in comment (#2628)
- `2576aacd2492` tests: switch over from libflate to flate2 in tests to reduce dependency footprint (#2625)
- `0be549582e95` chore: update brotli to v7 (#2620)
- `03d1635347cb` feat: add http3_send_grease and http3_max_field_section_size (#2609)
- `8f1f3e96f1cc` docs: link to char::REPLACEMENT_CHARACTER (#1880)
- `a6e0e31c0ae6` Clarify that `Response::content_length()` is not derived from a `Content-Length` header in docs (#2588)

## Crate metadata

| Field | Value |
|---|---|
| name | gpui-pre-reqwest |
| version | 0.12.15 |
| description | higher level HTTP client library zed-industries/request@c156624 |
| repository | https://github.com/seanmonstar/reqwest |
| license | MIT OR Apache-2.0 |
| edition | 2021 |
| rust_version | 1.64.0 |
| build | False |
| vcs sha1 | `68a26f46bb6ed5131f56517a574041d2c4d2aec8` |
| vcs dirty | True |
| vcs path_in_vcs | '' |
| build script | (none) |
| files | 82 |

## Candidate: zed-industries/reqwest@68a26f46bb6ed5131f56517a574041d2c4d2aec8

- id: `zed_fork_vcs_sha`
- role: commit named by .cargo_vcs_info.json
- source: git
- sha: `68a26f46bb6ed5131f56517a574041d2c4d2aec8` (resolved `68a26f46bb6ed5131f56517a574041d2c4d2aec8`, tree `f769a8d70cac46bdaeccf45039131d9766ced492`)
- status: compared
- files compared: 78 (78 identical)
- build script: (none)
- packaging differences: 13
- non-packaging differences: 0 files, +0/-0 lines

### Packaging differences

- **`Cargo.toml`** — cargo_manifest_metadata — publisher manifest metadata; package identity and description are rewritten for this repackaging
  - `name`: published `gpui-pre-reqwest`, candidate `zed-reqwest`
  - `version`: published `0.12.15`, candidate `0.12.15-zed`
  - `description`: published `higher level HTTP client library zed-industries/request@c156624`, candidate `higher level HTTP client library`
- **`.cargo_vcs_info.json`** — cargo_vcs_info — generated by cargo when publishing from git
- **`Cargo.lock`** — cargo_generated_lockfile — generated by cargo at package time; git candidates have no lockfile
- **`Cargo.toml`** — cargo_manifest_rewrite — cargo-normalized manifest for gpui-pre-reqwest 0.12.15; package name and lib name are rewritten from the candidate manifest
- **`examples/wasm_github_fetch/.gitignore`** — nested_package_omitted — the candidate has a nested package at examples/wasm_github_fetch; cargo excludes nested package files from the parent .crate
- **`examples/wasm_github_fetch/Cargo.toml`** — nested_package_omitted — the candidate has a nested package at examples/wasm_github_fetch; cargo excludes nested package files from the parent .crate
- **`examples/wasm_github_fetch/README.md`** — nested_package_omitted — the candidate has a nested package at examples/wasm_github_fetch; cargo excludes nested package files from the parent .crate
- **`examples/wasm_github_fetch/index.js`** — nested_package_omitted — the candidate has a nested package at examples/wasm_github_fetch; cargo excludes nested package files from the parent .crate
- **`examples/wasm_github_fetch/osv-scanner.toml`** — nested_package_omitted — the candidate has a nested package at examples/wasm_github_fetch; cargo excludes nested package files from the parent .crate
- **`examples/wasm_github_fetch/package-lock.json`** — nested_package_omitted — the candidate has a nested package at examples/wasm_github_fetch; cargo excludes nested package files from the parent .crate
- **`examples/wasm_github_fetch/package.json`** — nested_package_omitted — the candidate has a nested package at examples/wasm_github_fetch; cargo excludes nested package files from the parent .crate
- **`examples/wasm_github_fetch/src/lib.rs`** — nested_package_omitted — the candidate has a nested package at examples/wasm_github_fetch; cargo excludes nested package files from the parent .crate
- **`examples/wasm_github_fetch/webpack.config.js`** — nested_package_omitted — the candidate has a nested package at examples/wasm_github_fetch; cargo excludes nested package files from the parent .crate

### Non-packaging differences

None. Every shared source file is byte-identical to the published crate.

## Candidate: zed-industries/reqwest@c15662463bda39148ba154100dd44d3fba5873a4

- id: `zed_fork_description_sha`
- role: commit named by the package description
- source: git
- sha: `c15662463bda39148ba154100dd44d3fba5873a4` (resolved `c15662463bda39148ba154100dd44d3fba5873a4`, tree `f769a8d70cac46bdaeccf45039131d9766ced492`)
- status: compared
- files compared: 78 (78 identical)
- build script: (none)
- packaging differences: 13
- non-packaging differences: 0 files, +0/-0 lines

### Packaging differences

- **`Cargo.toml`** — cargo_manifest_metadata — publisher manifest metadata; package identity and description are rewritten for this repackaging
  - `name`: published `gpui-pre-reqwest`, candidate `zed-reqwest`
  - `version`: published `0.12.15`, candidate `0.12.15-zed`
  - `description`: published `higher level HTTP client library zed-industries/request@c156624`, candidate `higher level HTTP client library`
- **`.cargo_vcs_info.json`** — cargo_vcs_info — generated by cargo when publishing from git
- **`Cargo.lock`** — cargo_generated_lockfile — generated by cargo at package time; git candidates have no lockfile
- **`Cargo.toml`** — cargo_manifest_rewrite — cargo-normalized manifest for gpui-pre-reqwest 0.12.15; package name and lib name are rewritten from the candidate manifest
- **`examples/wasm_github_fetch/.gitignore`** — nested_package_omitted — the candidate has a nested package at examples/wasm_github_fetch; cargo excludes nested package files from the parent .crate
- **`examples/wasm_github_fetch/Cargo.toml`** — nested_package_omitted — the candidate has a nested package at examples/wasm_github_fetch; cargo excludes nested package files from the parent .crate
- **`examples/wasm_github_fetch/README.md`** — nested_package_omitted — the candidate has a nested package at examples/wasm_github_fetch; cargo excludes nested package files from the parent .crate
- **`examples/wasm_github_fetch/index.js`** — nested_package_omitted — the candidate has a nested package at examples/wasm_github_fetch; cargo excludes nested package files from the parent .crate
- **`examples/wasm_github_fetch/osv-scanner.toml`** — nested_package_omitted — the candidate has a nested package at examples/wasm_github_fetch; cargo excludes nested package files from the parent .crate
- **`examples/wasm_github_fetch/package-lock.json`** — nested_package_omitted — the candidate has a nested package at examples/wasm_github_fetch; cargo excludes nested package files from the parent .crate
- **`examples/wasm_github_fetch/package.json`** — nested_package_omitted — the candidate has a nested package at examples/wasm_github_fetch; cargo excludes nested package files from the parent .crate
- **`examples/wasm_github_fetch/src/lib.rs`** — nested_package_omitted — the candidate has a nested package at examples/wasm_github_fetch; cargo excludes nested package files from the parent .crate
- **`examples/wasm_github_fetch/webpack.config.js`** — nested_package_omitted — the candidate has a nested package at examples/wasm_github_fetch; cargo excludes nested package files from the parent .crate

### Non-packaging differences

None. Every shared source file is byte-identical to the published crate.

## Candidate: crates.io reqwest 0.12.15

- id: `crates_io_reqwest_0_12_15`
- role: published upstream release at the same version
- source: crate
- sha256: `d19c46a6fdd48bc4dab94b6103fccc55d34c67cc0ad04653aad4ea2a07cd7bbb`
- status: compared
- files compared: 78 (65 identical)
- build script: (none)
- packaging differences: 4
- non-packaging differences: 13 files, +476/-83 lines
- origin counts by file: fork_specific_or_mixed=4, upstream_drift=10

### Packaging differences

- **`Cargo.toml.orig`** — cargo_manifest_metadata — publisher manifest metadata; package identity and description are rewritten for this repackaging
  - `name`: published `gpui-pre-reqwest`, candidate `reqwest`
  - `description`: published `higher level HTTP client library zed-industries/request@c156624`, candidate `higher level HTTP client library`
- **`.cargo_vcs_info.json`** — cargo_vcs_info — generated by cargo when publishing from git
- **`Cargo.lock`** — cargo_generated_lockfile — generated by cargo at package time; git candidates have no lockfile
- **`Cargo.toml`** — cargo_manifest_rewrite — cargo-normalized manifest for gpui-pre-reqwest 0.12.15; package name and lib name are rewritten from the candidate manifest

### Non-packaging differences

- **`Cargo.toml.orig`** — dependency_set_changed — origin: upstream_drift — signals: dependency_change
  - added `flate2` (target.cfg(not(target_arch = "wasm32")).dev-dependencies, version `1.0.13`, optional=False)
  - removed `libflate` (target.cfg(not(target_arch = "wasm32")).dev-dependencies, version `2.1`, optional=False)
  - `hyper-util` (target.cfg(not(target_arch = "wasm32")).dependencies): `0.1.11` -> `0.1.10`
  - `brotli_crate` (target.cfg(not(target_arch = "wasm32")).dev-dependencies): `7.0.0` -> `6.0.0`
- **`src/async_impl/client.rs`** — modified — origin: fork_specific_or_mixed — signals: header, network_interface, redirect, url_or_host
  - removed 13 line(s), added 171 line(s)

    ```diff
    -    17 use crate::async_impl::h3_client::connect::H3Connector;
    -   161     #[cfg(any(target_os = "android", target_os = "fuchsia", target_os = "linux"))]
    -   265                 #[cfg(any(target_os = "android", target_os = "fuchsia", target_os = "linux"))]
    -   465                             target_os = "linux"
    -   509                             target_os = "linux"
    -   704                             target_os = "linux"
    -   724                 #[cfg(any(target_os = "android", target_os = "fuchsia", target_os = "linux"))]
    -  1105     pub fn redirect(mut self, policy: redirect::Policy) -> ClientBuilder {
    -  1406     /// Bind to an interface by `SO_BINDTODEVICE`.
    -  1418     #[cfg(any(target_os = "android", target_os = "fuchsia", target_os = "linux"))]
    -  2119         let (method, url, mut headers, body, timeout, version) = req.pieces();
    -  2358         #[cfg(any(target_os = "android", target_os = "fuchsia", target_os = "linux"))]
    -  2773                         .client
    +    17 use crate::async_impl::h3_client::connect::{H3ClientConfig, H3Connector};
    +   161     #[cfg(any(
    +   162         target_os = "android",
    +   163         target_os = "fuchsia",
    +   164         target_os = "illumos",
    +   165         target_os = "ios",
    +   166         target_os = "linux",
    +   167         target_os = "macos",
    +   168         target_os = "solaris",
    +   169         target_os = "tvos",
    +   170         target_os = "visionos",
    +   171         target_os = "watchos",
    +   172     ))]
    +   190     #[cfg(feature = "http3")]
    +   191     h3_max_field_section_size: Option<u64>,
    +   192     #[cfg(feature = "http3")]
    +   193     h3_send_grease: Option<bool>,
    +   280                 #[cfg(any(
    +   281                     target_os = "android",
    +   282                     target_os = "fuchsia",
    +   283                     target_os = "illumos",
    +   284                     target_os = "ios",
    +   285                     target_os = "linux",
    +   286                     target_os = "macos",
    +   287                     target_os = "solaris",
    +   288                     target_os = "tvos",
    +   289                     target_os = "visionos",
    +   290                     target_os = "watchos",
    +   291                 ))]
    +   309                 #[cfg(feature = "http3")]
    +   310                 h3_max_field_section_size: None,
    +   311                 #[cfg(feature = "http3")]
    +   312                 h3_send_grease: None,
    +   376                  h3_max_field_section_size,
    +   377                  h3_send_grease,
    +   400                     let mut h3_client_config = H3ClientConfig::default();
    +   401 
    +   402                     if let Some(max_field_section_size) = h3_max_field_section_size {
    +   403                         h3_client_config.max_field_section_size = Some(max_field_section_size);
    +   404                     }
    +   405 
    +   406                     if let Some(send_grease) = h3_send_grease {
    +   407                         h3_client_config.send_grease = Some(send_grease);
    +   408                     }
    +   409 
    +   415                         h3_client_config,
    +   508                             target_os = "illumos",
    +   509                             target_os = "ios",
    +   510                             target_os = "linux",
    +   511                             target_os = "macos",
    +   512                             target_os = "solaris",
    +   513                             target_os = "tvos",
    +   514                             target_os = "visionos",
    +   515                             target_os = "watchos",
    +   545                             config.h3_max_field_section_size,
    +   546                             config.h3_send_grease,
    +   561                             target_os = "illumos",
    +   562                             target_os = "ios",
    +   563                             target_os = "linux",
    +   564                             target_os = "macos",
    +   565                             target_os = "solaris",
    +   566                             target_os = "tvos",
    +   567                             target_os = "visionos",
    +   568                             target_os = "watchos",
    +   749                             config.h3_max_field_section_size,
    +   750                             config.h3_send_grease,
    +   765                             target_os = "illumos",
    +   766                             target_os = "ios",
    +   767                             target_os = "linux",
    +   768                             target_os = "macos",
    +   769                             target_os = "solaris",
    +   770                             target_os = "tvos",
    +   771                             target_os = "visionos",
    +   772                             target_os = "watchos",
    +   792                 #[cfg(any(
    +   793                     target_os = "android",
    +   794                     target_os = "fuchsia",
    +   795                     target_os = "illumos",
    +   796                     target_os = "ios",
    +   797                     target_os = "linux",
    +   798                     target_os = "macos",
    +   799                     target_os = "solaris",
    +   800                     target_os = "tvos",
    +   801                     target_os = "visionos",
    +   802                     target_os = "watchos",
    +   803                 ))]
    +  1184     pub fn redirect_policy(mut self, policy: redirect::Policy) -> ClientBuilder {
    +  1485     /// Bind connections only on the specified network interface.
    +  1486     ///
    +  1487     /// This option is only available on the following operating systems:
    +  1488     ///
    +  1489     /// - Android
    +  1490     /// - Fuchsia
    +  1491     /// - Linux,
    +  1492     /// - macOS and macOS-like systems (iOS, tvOS, watchOS and visionOS)
    +  1493     /// - Solaris and illumos
    +  1494     ///
    +  1495     /// On Android, Linux, and Fuchsia, this uses the
    +  1496     /// [`SO_BINDTODEVICE`][man-7-socket] socket option. On macOS and macOS-like
    +  1497     /// systems, Solaris, and illumos, this instead uses the [`IP_BOUND_IF` and
    +  1498     /// `IPV6_BOUND_IF`][man-7p-ip] socket options (as appropriate).
    +  1499     ///
    +  1500     /// Note that connections will fail if the provided interface name is not a
    +  1501     /// network interface that currently exists when a connection is established.
    +  1513     ///
    +  1514     /// [man-7-socket]: https://man7.org/linux/man-pages/man7/socket.7.html
    +  1515     /// [man-7p-ip]: https://docs.oracle.com/cd/E86824_01/html/E54777/ip-7p.html
    +  1516     #[cfg(any(
    +  1517         target_os = "android",
    +  1518         target_os = "fuchsia",
    +  1519         target_os = "illumos",
    +  1520         target_os = "ios",
    +  1521         target_os = "linux",
    +  1522         target_os = "macos",
    +  1523         target_os = "solaris",
    +  1524         target_os = "tvos",
    +  1525         target_os = "visionos",
    +  1526         target_os = "watchos",
    +  1527     ))]
    +  2074     /// Set the maximum HTTP/3 header size this client is willing to accept.
    +  2075     ///
    +  2076     /// See [header size constraints] section of the specification for details.
    +  2077     ///
    +  2078     /// [header size constraints]: https://www.rfc-editor.org/rfc/rfc9114.html#name-header-size-constraints
    +  2079     ///
    +  2080     /// Please see docs in [`Builder`] in [`h3`].
    +  2081     ///
    +  2082     /// [`Builder`]: https://docs.rs/h3/latest/h3/client/struct.Builder.html#method.max_field_section_size
    +  2083     #[cfg(feature = "http3")]
    +  2084     #[cfg_attr(docsrs, doc(cfg(all(reqwest_unstable, feature = "http3",))))]
    +  2085     pub fn http3_max_field_section_size(mut self, value: u64) -> ClientBuilder {
    +  2086         self.config.h3_max_field_section_size = Some(value.try_into().unwrap());
    +  2087         self
    +  2088     }
    +  2089 
    +  2090     /// Enable whether to send HTTP/3 protocol grease on the connections.
    +  2091     ///
    +  2092     /// HTTP/3 uses the concept of "grease"
    +  2093     ///
    +  2094     /// to prevent potential interoperability issues in the future.
    +  2095     /// In HTTP/3, the concept of grease is used to ensure that the protocol can evolve
    +  2096     /// and accommodate future changes without breaking existing implementations.
    +  2097     ///
    +  2098     /// Please see docs in [`Builder`] in [`h3`].
    +  2099     ///
    +  2100     /// [`Builder`]: https://docs.rs/h3/latest/h3/client/struct.Builder.html#method.send_grease
    +  2101     #[cfg(feature = "http3")]
    +  2102     #[cfg_attr(docsrs, doc(cfg(all(reqwest_unstable, feature = "http3",))))]
    +  2103     pub fn http3_send_grease(mut self, enabled: bool) -> ClientBuilder {
    +  2104         self.config.h3_send_grease = Some(enabled);
    +  2105         self
    +  2106     }
    +  2107 
    +  2262         let (method, url, mut headers, body, timeout, redirect_policy, version) = req.pieces();
    +  2353                 redirect_policy,
    +  2502         #[cfg(any(
    +  2503             target_os = "android",
    +  2504             target_os = "fuchsia",
    +  2505             target_os = "illumos",
    +  2506             target_os = "ios",
    +  2507             target_os = "linux",
    +  2508             target_os = "macos",
    +  2509             target_os = "solaris",
    +  2510             target_os = "tvos",
    +  2511             target_os = "visionos",
    +  2512             target_os = "watchos",
    +  2513         ))]
    +  2643         redirect_policy: Option<redirect::Policy>,
    +  2928                     // This request's redirect policy overrides the client's redirect policy
    +  2931                         .as_ref()
    +  2932                         .unwrap_or(&self.client.redirect_policy)
    ```
- **`src/async_impl/h3_client/connect.rs`** — modified — origin: upstream_drift — signals: header, url_or_host
  - removed 2 line(s), added 53 line(s)

    ```diff
    -    46         Ok(Self { resolver, endpoint })
    -    82                     return Ok(h3::client::new(quinn_conn).await?);
    +    20 /// H3 Client Config
    +    21 #[derive(Clone)]
    +    22 pub(crate) struct H3ClientConfig {
    +    23     /// Set the maximum HTTP/3 header size this client is willing to accept.
    +    24     ///
    +    25     /// See [header size constraints] section of the specification for details.
    +    26     ///
    +    27     /// [header size constraints]: https://www.rfc-editor.org/rfc/rfc9114.html#name-header-size-constraints
    +    28     ///
    +    29     /// Please see docs in [`Builder`] in [`h3`].
    +    30     ///
    +    31     /// [`Builder`]: https://docs.rs/h3/latest/h3/client/struct.Builder.html#method.max_field_section_size
    +    32     pub(crate) max_field_section_size: Option<u64>,
    +    33 
    +    34     /// Enable whether to send HTTP/3 protocol grease on the connections.
    +    35     ///
    +    36     /// Just like in HTTP/2, HTTP/3 also uses the concept of "grease"
    +    37     ///
    +    38     /// to prevent potential interoperability issues in the future.
    +    39     /// In HTTP/3, the concept of grease is used to ensure that the protocol can evolve
    +    40     /// and accommodate future changes without breaking existing implementations.
    +    41     ///
    +    42     /// Please see docs in [`Builder`] in [`h3`].
    +    43     ///
    +    44     /// [`Builder`]: https://docs.rs/h3/latest/h3/client/struct.Builder.html#method.send_grease
    +    45     pub(crate) send_grease: Option<bool>,
    +    46 }
    +    47 
    +    48 impl Default for H3ClientConfig {
    +    49     fn default() -> Self {
    +    50         Self {
    +    51             max_field_section_size: None,
    +    52             send_grease: None,
    +    53         }
    +    54     }
    +    55 }
    +    56 
    +    61     client_config: H3ClientConfig,
    +    70         client_config: H3ClientConfig,
    +    85         Ok(Self {
    +    86             resolver,
    +    87             endpoint,
    +    88             client_config,
    +    89         })
    +   125                     let mut h3_client_builder = h3::client::builder();
    +   126                     if let Some(max_field_section_size) = self.client_config.max_field_section_size
    +   127                     {
    +   128                         h3_client_builder.max_field_section_size(max_field_section_size);
    +   129                     }
    +   130                     if let Some(send_grease) = self.client_config.send_grease {
    +   131                         h3_client_builder.send_grease(send_grease);
    +   132                     }
    +   133                     return Ok(h3_client_builder.build(quinn_conn).await?);
    ```
- **`src/async_impl/h3_client/pool.rs`** — modified — origin: upstream_drift
  - removed 3 line(s), added 3 line(s)

    ```diff
    -    39 /// established or when the connection attempt fails. For example, whe
    -    98     /// Aqcuire a connecting lock. This is to ensure that we have only one HTTP3
    -   168             // micro optimisation, let's reuse it and avoid clonning.
    +    39 /// established or when the connection attempt fails. For example, when
    +    98     /// Acquire a connecting lock. This is to ensure that we have only one HTTP3
    +   168             // micro optimisation, let's reuse it and avoid cloning.
    ```
- **`src/async_impl/request.rs`** — modified — origin: fork_specific_or_mixed — signals: redirect, url_or_host
  - removed 1 line(s), added 26 line(s)

    ```diff
    -    18 use crate::{Method, Url};
    +    18 use crate::{redirect, Method, Url};
    +    28     redirect_policy: Option<redirect::Policy>,
    +    51             redirect_policy: None,
    +   116     /// Get a this request's redirect policy.
    +   117     #[inline]
    +   118     pub fn redirect_policy(&self) -> Option<&redirect::Policy> {
    +   119         self.redirect_policy.as_ref()
    +   120     }
    +   121 
    +   122     /// Get a mutable reference to the redirect policy.
    +   123     #[inline]
    +   124     pub fn redirect_policy_mut(&mut self) -> &mut Option<redirect::Policy> {
    +   125         &mut self.redirect_policy
    +   126     }
    +   127 
    +   164         Option<redirect::Policy>,
    +   173             self.redirect_policy,
    +   309     /// Overrides the client's redirect policy for this request
    +   310     pub fn redirect_policy(mut self, policy: redirect::Policy) -> RequestBuilder {
    +   311         if let Ok(ref mut req) = self.request {
    +   312             *req.redirect_policy_mut() = Some(policy)
    +   313         }
    +   314         self
    +   315     }
    +   316 
    +   648             redirect_policy: None,
    ```
- **`src/async_impl/response.rs`** — modified — origin: upstream_drift — signals: header
  - removed 6 line(s), added 12 line(s)

    ```diff
    -    82     /// Get the content-length of this response, if known.
    -    86     /// - The server didn't send a `content-length` header.
    -    87     /// - The response is compressed and automatically decoded (thus changing
    -    88     ///   the actual decoded length).
    -   137     /// and with malformed sequences replaced with the REPLACEMENT CHARACTER.
    -   178     /// and with malformed sequences replaced with the REPLACEMENT CHARACTER.
    +    82     /// Get the content length of the response, if it is known.
    +    83     ///
    +    84     /// This value does not directly represents the value of the `Content-Length`
    +    85     /// header, but rather the size of the response's body. To read the header's
    +    86     /// value, please use the [`Response::headers`] method instead.
    +    90     /// - The response does not include a body (e.g. it responds to a `HEAD`
    +    91     ///   request).
    +    92     /// - The response is gzipped and automatically decoded (thus changing the
    +    93     ///   actual decoded length).
    +   142     /// and with malformed sequences replaced with the
    +   143     /// [`char::REPLACEMENT_CHARACTER`].
    +   184     /// and with malformed sequences replaced with the [`char::REPLACEMENT_CHARACTER`].
    ```
- **`src/blocking/client.rs`** — modified — origin: fork_specific_or_mixed — signals: redirect
  - removed 1 line(s), added 1 line(s)

    ```diff
    -   340         self.with_inner(move |inner| inner.redirect(policy))
    +   340         self.with_inner(move |inner| inner.redirect_policy(policy))
    ```
- **`src/blocking/response.rs`** — modified — origin: upstream_drift — signals: header
  - removed 6 line(s), added 12 line(s)

    ```diff
    -   191     /// Get the content-length of the response, if it is known.
    -   195     /// - The server didn't send a `content-length` header.
    -   196     /// - The response is gzipped and automatically decoded (thus changing
    -   197     ///   the actual decoded length).
    -   269     /// and with malformed sequences replaced with the REPLACEMENT CHARACTER.
    -   297     /// and with malformed sequences replaced with the REPLACEMENT CHARACTER.
    +   191     /// Get the content length of the response, if it is known.
    +   192     ///
    +   193     ///
    +   194     /// This value does not directly represents the value of the `Content-Length`
    +   195     /// header, but rather the size of the response's body. To read the header's
    +   196     /// value, please use the [`Response::headers`] method instead.
    +   200     /// - The response does not include a body (e.g. it responds to a `HEAD`
    +   201     ///   request).
    +   202     /// - The response is gzipped and automatically decoded (thus changing the
    +   203     ///   actual decoded length).
    +   275     /// and with malformed sequences replaced with the [`char::REPLACEMENT_CHARACTER`].
    +   303     /// and with malformed sequences replaced with the [`char::REPLACEMENT_CHARACTER`].
    ```
- **`src/connect.rs`** — modified — origin: upstream_drift
  - removed 8 line(s), added 96 line(s)

    ```diff
    -   151         #[cfg(any(target_os = "android", target_os = "fuchsia", target_os = "linux"))]
    -   159         #[cfg(any(target_os = "android", target_os = "fuchsia", target_os = "linux"))]
    -   180         #[cfg(any(target_os = "android", target_os = "fuchsia", target_os = "linux"))]
    -   195             #[cfg(any(target_os = "android", target_os = "fuchsia", target_os = "linux"))]
    -   209         #[cfg(any(target_os = "android", target_os = "fuchsia", target_os = "linux"))]
    -   218         #[cfg(any(target_os = "android", target_os = "fuchsia", target_os = "linux"))]
    -   243         #[cfg(any(target_os = "android", target_os = "fuchsia", target_os = "linux"))]
    -   252         #[cfg(any(target_os = "android", target_os = "fuchsia", target_os = "linux"))]
    +   151         #[cfg(any(
    +   152             target_os = "android",
    +   153             target_os = "fuchsia",
    +   154             target_os = "illumos",
    +   155             target_os = "ios",
    +   156             target_os = "linux",
    +   157             target_os = "macos",
    +   158             target_os = "solaris",
    +   159             target_os = "tvos",
    +   160             target_os = "visionos",
    +   161             target_os = "watchos",
    +   162         ))]
    +   170         #[cfg(any(
    +   171             target_os = "android",
    +   172             target_os = "fuchsia",
    +   173             target_os = "illumos",
    +   174             target_os = "ios",
    +   175             target_os = "linux",
    +   176             target_os = "macos",
    +   177             target_os = "solaris",
    +   178             target_os = "tvos",
    +   179             target_os = "visionos",
    +   180             target_os = "watchos",
    +   181         ))]
    +   202         #[cfg(any(
    +   203             target_os = "android",
    +   204             target_os = "fuchsia",
    +   205             target_os = "illumos",
    +   206             target_os = "ios",
    +   207             target_os = "linux",
    +   208             target_os = "macos",
    +   209             target_os = "solaris",
    +   210             target_os = "tvos",
    +   211             target_os = "visionos",
    +   212             target_os = "watchos",
    +   213         ))]
    +   228             #[cfg(any(
    +   229                 target_os = "android",
    +   230                 target_os = "fuchsia",
    +   231                 target_os = "illumos",
    +   232                 target_os = "ios",
    +   233                 target_os = "linux",
    +   234                 target_os = "macos",
    +   235                 target_os = "solaris",
    +   236                 target_os = "tvos",
    +   237                 target_os = "visionos",
    +   238                 target_os = "watchos",
    +   239             ))]
    +   253         #[cfg(any(
    +   254             target_os = "android",
    +   255             target_os = "fuchsia",
    +   256             target_os = "illumos",
    +   257             target_os = "ios",
    +   258             target_os = "linux",
    +   259             target_os = "macos",
    +   260             target_os = "solaris",
    +   261             target_os = "tvos",
    +   262             target_os = "visionos",
    +   263             target_os = "watchos",
    +   264         ))]
    +   273         #[cfg(any(
    +   274             target_os = "android",
    +   275             target_os = "fuchsia",
    +   276             target_os = "illumos",
    +   277             target_os = "ios",
    +   278             target_os = "linux",
    +   279             target_os = "macos",
    +   280             target_os = "solaris",
    +   281             target_os = "tvos",
    +   282             target_os = "visionos",
    +   283             target_os = "watchos",
    +   284         ))]
    +   309         #[cfg(any(
    +   310             target_os = "android",
    +   311             target_os = "fuchsia",
    +   312             target_os = "illumos",
    +   313             target_os = "ios",
    +   314             target_os = "linux",
    +   315             target_os = "macos",
    +   316             target_os = "solaris",
    +   317             target_os = "tvos",
    +   318             target_os = "visionos",
    +   319             target_os = "watchos",
    +   320         ))]
    +   329         #[cfg(any(
    +   330             target_os = "android",
    +   331             target_os = "fuchsia",
    +   332             target_os = "illumos",
    +   333             target_os = "ios",
    +   334             target_os = "linux",
    +   335             target_os = "macos",
    +   336             target_os = "solaris",
    +   337             target_os = "tvos",
    +   338             target_os = "visionos",
    +   339             target_os = "watchos",
    +   340         ))]
    ```
- **`src/proxy.rs`** — modified — origin: upstream_drift — signals: proxy
  - removed 1 line(s), added 1 line(s)

    ```diff
    -   289             // Only read from windows registry proxy settings if not available from an enviroment
    +   289             // Only read from windows registry proxy settings if not available from an environment
    ```
- **`src/wasm/response.rs`** — modified — origin: upstream_drift
  - removed 17 line(s), added 23 line(s)

    ```diff
    -    14 use futures_util::stream::StreamExt;
    -   140         let body = web_response
    -   141             .body()
    -   142             .expect("could not create wasm byte stream");
    -   143         let body = wasm_streams::ReadableStream::from_raw(body.unchecked_into());
    -   144         Box::pin(body.into_stream().map(move |buf_js| {
    -   145             // Keep the abort guard alive as long as this stream is.
    -   146             let _abort = &abort;
    -   147             let buffer = Uint8Array::new(
    -   148                 &buf_js
    -   149                     .map_err(crate::error::wasm)
    -   150                     .map_err(crate::error::decode)?,
    -   151             );
    -   152             let mut bytes = vec![0; buffer.length() as usize];
    -   153             buffer.copy_to(&mut bytes);
    -   154             Ok(bytes.into())
    -   155         }))
    +    14 use futures_util::stream::{self, StreamExt};
    +   138         use futures_core::Stream;
    +   139         use std::pin::Pin;
    +   140 
    +   143 
    +   144         if let Some(body) = web_response.body() {
    +   145             let body = wasm_streams::ReadableStream::from_raw(body.unchecked_into());
    +   146             Box::pin(body.into_stream().map(move |buf_js| {
    +   147                 // Keep the abort guard alive as long as this stream is.
    +   148                 let _abort = &abort;
    +   149                 let buffer = Uint8Array::new(
    +   150                     &buf_js
    +   151                         .map_err(crate::error::wasm)
    +   152                         .map_err(crate::error::decode)?,
    +   153                 );
    +   154                 let mut bytes = vec![0; buffer.length() as usize];
    +   155                 buffer.copy_to(&mut bytes);
    +   156                 Ok(bytes.into())
    +   157             })) as Pin<Box<dyn Stream<Item = crate::Result<Bytes>>>>
    +   158         } else {
    +   159             // If there's no body, return an empty stream.
    +   160             Box::pin(stream::empty()) as Pin<Box<dyn Stream<Item = crate::Result<Bytes>>>>
    +   161         }
    ```
- **`tests/deflate.rs`** — modified — origin: upstream_drift
  - removed 12 line(s), added 8 line(s)

    ```diff
    -    95     let mut encoder = libflate::zlib::Encoder::new(Vec::new()).unwrap();
    -    96     match encoder.write(content.as_bytes()) {
    -    97         Ok(n) => assert!(n > 0, "Failed to write to encoder."),
    -    98         _ => panic!("Failed to deflate encode string."),
    -    99     };
    -   101     let deflated_content = encoder.finish().into_result().unwrap();
    -   161     let mut encoder = libflate::zlib::Encoder::new(Vec::new()).unwrap();
    -   162     match encoder.write(input) {
    -   163         Ok(n) => assert!(n > 0, "Failed to write to encoder."),
    -   164         _ => panic!("Failed to deflate encode string."),
    -   165     };
    -   166     encoder.finish().into_result().unwrap()
    +     2 use flate2::write::ZlibEncoder;
    +     3 use flate2::Compression;
    +    98     let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
    +    99     encoder.write_all(content.as_bytes()).unwrap();
    +   100     let deflated_content = encoder.finish().unwrap();
    +   160     let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
    +   161     encoder.write_all(input).unwrap();
    +   162     encoder.finish().unwrap()
    ```
- **`tests/gzip.rs`** — modified — origin: upstream_drift
  - removed 12 line(s), added 8 line(s)

    ```diff
    -    97     let mut encoder = libflate::gzip::Encoder::new(Vec::new()).unwrap();
    -    98     match encoder.write(content.as_bytes()) {
    -    99         Ok(n) => assert!(n > 0, "Failed to write to encoder."),
    -   100         _ => panic!("Failed to gzip encode string."),
    -   101     };
    -   103     let gzipped_content = encoder.finish().into_result().unwrap();
    -   163     let mut encoder = libflate::gzip::Encoder::new(Vec::new()).unwrap();
    -   164     match encoder.write(input) {
    -   165         Ok(n) => assert!(n > 0, "Failed to write to encoder."),
    -   166         _ => panic!("Failed to gzip encode string."),
    -   167     };
    -   168     encoder.finish().into_result().unwrap()
    +     2 use flate2::write::GzEncoder;
    +     3 use flate2::Compression;
    +   100     let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    +   101     encoder.write_all(content.as_bytes()).unwrap();
    +   102     let gzipped_content = encoder.finish().unwrap();
    +   162     let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    +   163     encoder.write_all(input).unwrap();
    +   164     encoder.finish().unwrap()
    ```
- **`tests/redirect.rs`** — modified — origin: fork_specific_or_mixed — signals: header, redirect, url_or_host
  - removed 1 line(s), added 62 line(s)

    ```diff
    -   247         .redirect(reqwest::redirect::Policy::none())
    +   247         .redirect_policy(reqwest::redirect::Policy::none())
    +   378 }
    +   379 
    +   380 #[tokio::test]
    +   381 async fn test_request_redirect() {
    +   382     let code = 301u16;
    +   383 
    +   384     let redirect = server::http(move |req| async move {
    +   385         if req.method() == "POST" {
    +   386             assert_eq!(req.uri(), &*format!("/{}", code));
    +   387             http::Response::builder()
    +   388                 .status(code)
    +   389                 .header("location", "/dst")
    +   390                 .header("server", "test-redirect")
    +   391                 .body(Default::default())
    +   392                 .unwrap()
    +   393         } else {
    +   394             assert_eq!(req.method(), "GET");
    +   395 
    +   396             http::Response::builder()
    +   397                 .header("server", "test-dst")
    +   398                 .body(Default::default())
    +   399                 .unwrap()
    +   400         }
    +   401     });
    +   402 
    +   403     let url = format!("http://{}/{}", redirect.addr(), code);
    +   404     let dst = format!("http://{}/{}", redirect.addr(), "dst");
    +   405 
    +   406     let default_redirect_client = reqwest::Client::new();
    +   407     let res = default_redirect_client
    +   408         .request(reqwest::Method::POST, &url)
    +   409         .redirect(reqwest::redirect::Policy::none())
    +   410         .send()
    +   411         .await
    +   412         .unwrap();
    +   413 
    +   414     assert_eq!(res.url().as_str(), url);
    +   415     assert_eq!(res.status(), reqwest::StatusCode::MOVED_PERMANENTLY);
    +   416     assert_eq!(
    +   417         res.headers().get(reqwest::header::SERVER).unwrap(),
    +   418         &"test-redirect"
    +   419     );
    +   420 
    +   421     let no_redirect_client = reqwest::Client::builder()
    +   422         .redirect_policy(reqwest::redirect::Policy::none())
    +   423         .build()
    +   424         .unwrap();
    +   425 
    +   426     let res = no_redirect_client
    +   427         .request(reqwest::Method::POST, &url)
    +   428         .redirect(reqwest::redirect::Policy::limited(2))
    +   429         .send()
    +   430         .await
    +   431         .unwrap();
    +   432 
    +   433     assert_eq!(res.url().as_str(), dst);
    +   434     assert_eq!(res.status(), reqwest::StatusCode::OK);
    +   435     assert_eq!(
    +   436         res.headers().get(reqwest::header::SERVER).unwrap(),
    +   437         &"test-dst"
    +   438     );
    ```

## Candidate: seanmonstar/reqwest@54376c35dffb0fb2e79b430920a62363aee202c8

- id: `upstream_v0_12_15_tag`
- role: upstream git tag for the same release
- source: git
- sha: `54376c35dffb0fb2e79b430920a62363aee202c8` (resolved `54376c35dffb0fb2e79b430920a62363aee202c8`, tree `992c96a90ac7af979384e97a422fb31eec106d9e`)
- status: compared
- files compared: 78 (65 identical)
- build script: (none)
- packaging differences: 13
- non-packaging differences: 13 files, +476/-83 lines
- origin counts by file: fork_specific_or_mixed=4, upstream_drift=10

### Packaging differences

- **`Cargo.toml`** — cargo_manifest_metadata — publisher manifest metadata; package identity and description are rewritten for this repackaging
  - `name`: published `gpui-pre-reqwest`, candidate `reqwest`
  - `description`: published `higher level HTTP client library zed-industries/request@c156624`, candidate `higher level HTTP client library`
- **`.cargo_vcs_info.json`** — cargo_vcs_info — generated by cargo when publishing from git
- **`Cargo.lock`** — cargo_generated_lockfile — generated by cargo at package time; git candidates have no lockfile
- **`Cargo.toml`** — cargo_manifest_rewrite — cargo-normalized manifest for gpui-pre-reqwest 0.12.15; package name and lib name are rewritten from the candidate manifest
- **`examples/wasm_github_fetch/.gitignore`** — nested_package_omitted — the candidate has a nested package at examples/wasm_github_fetch; cargo excludes nested package files from the parent .crate
- **`examples/wasm_github_fetch/Cargo.toml`** — nested_package_omitted — the candidate has a nested package at examples/wasm_github_fetch; cargo excludes nested package files from the parent .crate
- **`examples/wasm_github_fetch/README.md`** — nested_package_omitted — the candidate has a nested package at examples/wasm_github_fetch; cargo excludes nested package files from the parent .crate
- **`examples/wasm_github_fetch/index.js`** — nested_package_omitted — the candidate has a nested package at examples/wasm_github_fetch; cargo excludes nested package files from the parent .crate
- **`examples/wasm_github_fetch/osv-scanner.toml`** — nested_package_omitted — the candidate has a nested package at examples/wasm_github_fetch; cargo excludes nested package files from the parent .crate
- **`examples/wasm_github_fetch/package-lock.json`** — nested_package_omitted — the candidate has a nested package at examples/wasm_github_fetch; cargo excludes nested package files from the parent .crate
- **`examples/wasm_github_fetch/package.json`** — nested_package_omitted — the candidate has a nested package at examples/wasm_github_fetch; cargo excludes nested package files from the parent .crate
- **`examples/wasm_github_fetch/src/lib.rs`** — nested_package_omitted — the candidate has a nested package at examples/wasm_github_fetch; cargo excludes nested package files from the parent .crate
- **`examples/wasm_github_fetch/webpack.config.js`** — nested_package_omitted — the candidate has a nested package at examples/wasm_github_fetch; cargo excludes nested package files from the parent .crate

### Non-packaging differences

Identical to candidate `crates_io_reqwest_0_12_15`: the same changed files and changed lines; they are listed once there.

## Candidate: seanmonstar/reqwest@114d97c1a862567b465cb57f14d584626e1cf30c

- id: `upstream_master_at_fork_base`
- role: upstream master commit the fork merged
- source: git
- sha: `114d97c1a862567b465cb57f14d584626e1cf30c` (resolved `114d97c1a862567b465cb57f14d584626e1cf30c`, tree `58d4f131b733d45198be73bbd3b4d3d31748a98c`)
- status: compared
- files compared: 78 (74 identical)
- build script: (none)
- packaging differences: 13
- non-packaging differences: 4 files, +96/-6 lines
- origin counts by file: unclassified=4

### Packaging differences

- **`Cargo.toml`** — cargo_manifest_metadata — publisher manifest metadata; package identity and description are rewritten for this repackaging
  - `name`: published `gpui-pre-reqwest`, candidate `reqwest`
  - `description`: published `higher level HTTP client library zed-industries/request@c156624`, candidate `higher level HTTP client library`
- **`.cargo_vcs_info.json`** — cargo_vcs_info — generated by cargo when publishing from git
- **`Cargo.lock`** — cargo_generated_lockfile — generated by cargo at package time; git candidates have no lockfile
- **`Cargo.toml`** — cargo_manifest_rewrite — cargo-normalized manifest for gpui-pre-reqwest 0.12.15; package name and lib name are rewritten from the candidate manifest
- **`examples/wasm_github_fetch/.gitignore`** — nested_package_omitted — the candidate has a nested package at examples/wasm_github_fetch; cargo excludes nested package files from the parent .crate
- **`examples/wasm_github_fetch/Cargo.toml`** — nested_package_omitted — the candidate has a nested package at examples/wasm_github_fetch; cargo excludes nested package files from the parent .crate
- **`examples/wasm_github_fetch/README.md`** — nested_package_omitted — the candidate has a nested package at examples/wasm_github_fetch; cargo excludes nested package files from the parent .crate
- **`examples/wasm_github_fetch/index.js`** — nested_package_omitted — the candidate has a nested package at examples/wasm_github_fetch; cargo excludes nested package files from the parent .crate
- **`examples/wasm_github_fetch/osv-scanner.toml`** — nested_package_omitted — the candidate has a nested package at examples/wasm_github_fetch; cargo excludes nested package files from the parent .crate
- **`examples/wasm_github_fetch/package-lock.json`** — nested_package_omitted — the candidate has a nested package at examples/wasm_github_fetch; cargo excludes nested package files from the parent .crate
- **`examples/wasm_github_fetch/package.json`** — nested_package_omitted — the candidate has a nested package at examples/wasm_github_fetch; cargo excludes nested package files from the parent .crate
- **`examples/wasm_github_fetch/src/lib.rs`** — nested_package_omitted — the candidate has a nested package at examples/wasm_github_fetch; cargo excludes nested package files from the parent .crate
- **`examples/wasm_github_fetch/webpack.config.js`** — nested_package_omitted — the candidate has a nested package at examples/wasm_github_fetch; cargo excludes nested package files from the parent .crate

### Non-packaging differences

- **`src/async_impl/client.rs`** — modified — signals: header, redirect, url_or_host
  - removed 3 line(s), added 7 line(s)

    ```diff
    -  1184     pub fn redirect(mut self, policy: redirect::Policy) -> ClientBuilder {
    -  2262         let (method, url, mut headers, body, timeout, version) = req.pieces();
    -  2927                         .client
    +  1184     pub fn redirect_policy(mut self, policy: redirect::Policy) -> ClientBuilder {
    +  2262         let (method, url, mut headers, body, timeout, redirect_policy, version) = req.pieces();
    +  2353                 redirect_policy,
    +  2643         redirect_policy: Option<redirect::Policy>,
    +  2928                     // This request's redirect policy overrides the client's redirect policy
    +  2931                         .as_ref()
    +  2932                         .unwrap_or(&self.client.redirect_policy)
    ```
- **`src/async_impl/request.rs`** — modified — signals: redirect, url_or_host
  - removed 1 line(s), added 26 line(s)

    ```diff
    -    18 use crate::{Method, Url};
    +    18 use crate::{redirect, Method, Url};
    +    28     redirect_policy: Option<redirect::Policy>,
    +    51             redirect_policy: None,
    +   116     /// Get a this request's redirect policy.
    +   117     #[inline]
    +   118     pub fn redirect_policy(&self) -> Option<&redirect::Policy> {
    +   119         self.redirect_policy.as_ref()
    +   120     }
    +   121 
    +   122     /// Get a mutable reference to the redirect policy.
    +   123     #[inline]
    +   124     pub fn redirect_policy_mut(&mut self) -> &mut Option<redirect::Policy> {
    +   125         &mut self.redirect_policy
    +   126     }
    +   127 
    +   164         Option<redirect::Policy>,
    +   173             self.redirect_policy,
    +   309     /// Overrides the client's redirect policy for this request
    +   310     pub fn redirect_policy(mut self, policy: redirect::Policy) -> RequestBuilder {
    +   311         if let Ok(ref mut req) = self.request {
    +   312             *req.redirect_policy_mut() = Some(policy)
    +   313         }
    +   314         self
    +   315     }
    +   316 
    +   648             redirect_policy: None,
    ```
- **`src/blocking/client.rs`** — modified — signals: redirect
  - removed 1 line(s), added 1 line(s)

    ```diff
    -   340         self.with_inner(move |inner| inner.redirect(policy))
    +   340         self.with_inner(move |inner| inner.redirect_policy(policy))
    ```
- **`tests/redirect.rs`** — modified — signals: header, redirect, url_or_host
  - removed 1 line(s), added 62 line(s)

    ```diff
    -   247         .redirect(reqwest::redirect::Policy::none())
    +   247         .redirect_policy(reqwest::redirect::Policy::none())
    +   378 }
    +   379 
    +   380 #[tokio::test]
    +   381 async fn test_request_redirect() {
    +   382     let code = 301u16;
    +   383 
    +   384     let redirect = server::http(move |req| async move {
    +   385         if req.method() == "POST" {
    +   386             assert_eq!(req.uri(), &*format!("/{}", code));
    +   387             http::Response::builder()
    +   388                 .status(code)
    +   389                 .header("location", "/dst")
    +   390                 .header("server", "test-redirect")
    +   391                 .body(Default::default())
    +   392                 .unwrap()
    +   393         } else {
    +   394             assert_eq!(req.method(), "GET");
    +   395 
    +   396             http::Response::builder()
    +   397                 .header("server", "test-dst")
    +   398                 .body(Default::default())
    +   399                 .unwrap()
    +   400         }
    +   401     });
    +   402 
    +   403     let url = format!("http://{}/{}", redirect.addr(), code);
    +   404     let dst = format!("http://{}/{}", redirect.addr(), "dst");
    +   405 
    +   406     let default_redirect_client = reqwest::Client::new();
    +   407     let res = default_redirect_client
    +   408         .request(reqwest::Method::POST, &url)
    +   409         .redirect(reqwest::redirect::Policy::none())
    +   410         .send()
    +   411         .await
    +   412         .unwrap();
    +   413 
    +   414     assert_eq!(res.url().as_str(), url);
    +   415     assert_eq!(res.status(), reqwest::StatusCode::MOVED_PERMANENTLY);
    +   416     assert_eq!(
    +   417         res.headers().get(reqwest::header::SERVER).unwrap(),
    +   418         &"test-redirect"
    +   419     );
    +   420 
    +   421     let no_redirect_client = reqwest::Client::builder()
    +   422         .redirect_policy(reqwest::redirect::Policy::none())
    +   423         .build()
    +   424         .unwrap();
    +   425 
    +   426     let res = no_redirect_client
    +   427         .request(reqwest::Method::POST, &url)
    +   428         .redirect(reqwest::redirect::Policy::limited(2))
    +   429         .send()
    +   430         .await
    +   431         .unwrap();
    +   432 
    +   433     assert_eq!(res.url().as_str(), dst);
    +   434     assert_eq!(res.status(), reqwest::StatusCode::OK);
    +   435     assert_eq!(
    +   436         res.headers().get(reqwest::header::SERVER).unwrap(),
    +   437         &"test-dst"
    +   438     );
    ```

## Method and limits

- Every candidate commit is shallow-fetched with `--filter=blob:none` and materialized with `git archive`; the published crate is extracted with `tar`. Files are compared byte for byte; symlinks are resolved the way cargo dereferences them.
- Packaging covers `Cargo.toml`, `Cargo.toml.orig`, `Cargo.lock`, `.cargo_vcs_info.json`, `.cargo-ok`, cargo-normalized manifest rewrites, nested packages cargo excludes, and auto-disabled target directories. Everything else is listed as a non-packaging difference.
- Origin labels for the crates.io reqwest candidate are file-level: a file byte-identical to upstream master at the fork base is labelled `upstream_drift`; any other changed file is `fork_specific_or_mixed`. The separate comparison against upstream master lists the exact fork-side lines.
- Signal categories are textual and advisory (for example, `header` matches any changed line containing `header`); they do not establish runtime effect.
- GitHub commit lookups can resolve objects that exist in the fork network even when no ref in the queried repository points at them; ref and compare results are reported separately for that reason. Unauthenticated GitHub API calls are subject to rate limits.
- Nothing downloaded was built, sourced, or executed; this report records content and provenance, not intent or runtime behaviour.
