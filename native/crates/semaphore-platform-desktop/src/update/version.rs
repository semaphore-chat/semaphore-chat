//! Release versions: what a release calls itself, and which of two is newer.
//!
//! A manifest's `version` and the build's own version are bare semantic versions (`1.4.0`,
//! `2.0.0-rc.1`), the same string the app prints for `--version`. Comparison is [`semver`]'s, so
//! pre-releases order before their release (`2.0.0-rc.1 < 2.0.0`) and a prerelease-to-prerelease
//! upgrade (`2.0.0-beta.1` to `2.0.0-beta.2`) is newer. Build metadata (`+ci.5`) never makes a
//! version newer, as semver says.
//!
//! Strict on purpose: a leading `v`, a missing component or anything else that isn't a semver is
//! rejected rather than guessed at, because the whole point of comparing is that a wrong answer
//! installs a downgrade.

use semver::Version;

/// Why a version string isn't one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VersionError {
    pub text: String,
    pub message: String,
}

impl std::fmt::Display for VersionError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "{:?} isn't a version: {}",
            self.text, self.message
        )
    }
}

impl std::error::Error for VersionError {}

/// Parses a bare semantic version (`1.4.0`, `0.10.0-rc.1`).
pub fn parse_version(text: &str) -> Result<Version, VersionError> {
    Version::parse(text).map_err(|error| VersionError {
        text: text.to_owned(),
        message: error.to_string(),
    })
}

/// Whether `candidate` is a newer release than `running`.
///
/// Compared by semver precedence, which ignores build metadata: `1.0.0+ci.2` is not newer than
/// `1.0.0+ci.1`. (`Version`'s own `Ord` does compare build metadata, for use as a map key, so
/// this compares the components that semver says decide precedence.)
pub fn is_newer(candidate: &Version, running: &Version) -> bool {
    (
        candidate.major,
        candidate.minor,
        candidate.patch,
        &candidate.pre,
    ) > (running.major, running.minor, running.patch, &running.pre)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn newer(running: &str, candidate: &str) -> bool {
        is_newer(
            &parse_version(candidate).unwrap(),
            &parse_version(running).unwrap(),
        )
    }

    /// The ordering an updater must get right, in both directions.
    #[test]
    fn orders_releases() {
        let table = [
            ("0.9.0", "0.10.0", true),
            ("0.10.0", "0.9.0", false),
            ("1.9.9", "1.10.0", true),
            ("1.4.0", "1.4.0", false),
            ("1.4.0", "1.4.1", true),
            ("2.0.0-rc.1", "2.0.0", true),
            ("2.0.0", "2.0.0-rc.1", false),
            ("2.0.0-alpha", "2.0.0-alpha.1", true),
            ("2.0.0-alpha.1", "2.0.0-beta", true),
            ("2.0.0-beta.2", "2.0.0-beta.10", true),
            ("2.0.0-rc.1", "2.0.0-rc.1", false),
            // Build metadata is ignored by semver ordering.
            ("1.0.0+ci.1", "1.0.0+ci.2", false),
            // 0.x is semver too: 0.10 is newer than 0.9.
            ("0.0.0", "0.0.1", true),
            ("1.0.0", "0.0.0", false),
        ];
        for (running, candidate, expected) in table {
            assert_eq!(
                newer(running, candidate),
                expected,
                "{candidate} against {running}"
            );
        }
    }

    #[test]
    fn rejects_what_is_not_a_version() {
        for text in [
            "", "latest", "v1.4.0", "1.4", "1", "1.4.0.0", "1.4.0-", "1.4.0-01", " 1.4.0",
            "1.4.0 ", "01.4.0",
        ] {
            assert!(
                parse_version(text).is_err(),
                "{text:?} should not parse as a version"
            );
        }

        for text in ["1.4.0", "0.0.0", "1.4.0-rc.1", "1.4.0+2024-05-01", "0.10.0"] {
            assert!(parse_version(text).is_ok(), "{text:?} should parse");
        }
    }

    #[test]
    fn the_error_names_the_text() {
        let error = parse_version("v1.4.0").unwrap_err();
        assert!(error.to_string().contains("v1.4.0"), "{error}");
    }
}
