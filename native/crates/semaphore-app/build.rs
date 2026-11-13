//! The version the binary reports and the packages are named after.
//!
//! It is the crate's `Cargo.toml` version, unless `SEMAPHORE_VERSION` is set: CI sets it from
//! the release version and `scripts/package-linux.sh` from its argument. `main.rs` prints it for
//! `--version`, which is the package tests' start-up check.

fn main() {
    println!("cargo:rerun-if-env-changed=SEMAPHORE_VERSION");
    let version = std::env::var("SEMAPHORE_VERSION")
        .ok()
        .filter(|version| !version.is_empty())
        .unwrap_or_else(|| env!("CARGO_PKG_VERSION").to_owned());
    println!("cargo:rustc-env=SEMAPHORE_VERSION={version}");
}
