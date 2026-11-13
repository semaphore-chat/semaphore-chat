//! What kind of install this is, and therefore what an update can do.
//!
//! | Install | Detected by | An update |
//! |---|---|---|
//! | AppImage | `$APPIMAGE` names an absolute path to a writable regular file | replaces that file and restarts |
//! | .deb | the executable is under `/usr` or `/opt`, is not writable, and the distribution is Debian-like | downloads the package; the user installs it |
//! | .rpm | the same, on a Fedora-like (`dnf`) or SUSE-like (`zypper`) distribution | downloads the package; the user installs it |
//! | Windows zip | a Windows build | downloads nothing: the settings row opens the release page |
//! | anything else | a checkout, a sandbox, a package in a directory a user owns, an unsupported format | never updates |
//!
//! Nothing here reads the environment while deciding: [`InstallEnv::current`] reads it once, and
//! [`InstallEnv::detect`] is a pure function of the fields, so tests and rigs build an
//! environment instead of arranging the machine. Detection never writes anything: writability is
//! a permission check, not a probe file.

use crate::update::manifest::ArtifactKind;
use std::path::{Path, PathBuf};

/// The operating system this build runs on, as far as installing goes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Os {
    Linux,
    Windows,
    Other,
}

/// Which package manager family a Linux distribution belongs to, from `/etc/os-release`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PackageFamily {
    /// Debian, Ubuntu and their derivatives: `dpkg`/`apt`.
    Debian,
    /// Fedora, RHEL and their derivatives: `dnf`.
    Fedora,
    /// openSUSE and SUSE: `zypper`.
    Suse,
    /// An Arch, Alpine, Gentoo or otherwise unrecognised distribution.
    Unknown,
}

/// The command a downloaded .rpm would be installed with, on this distribution.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RpmManager {
    Dnf,
    Zypper,
}

/// What a `Ready` update offers. The updater never elevates: it either replaced the AppImage, or
/// left a package for the user to install.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReadyAction {
    /// The AppImage at `path` is the update: restarting runs it.
    Restart { path: PathBuf },
    /// The package at `path` is downloaded: the user installs it with `command`.
    Package { path: PathBuf, command: String },
}

/// How this copy of the app was installed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InstallKind {
    /// Run from an AppImage, which is `path`.
    AppImage { path: PathBuf },
    /// Installed from a `.deb`; the executable is `path`.
    Deb { path: PathBuf },
    /// Installed from an `.rpm`; the executable is `path`.
    Rpm { path: PathBuf, manager: RpmManager },
    /// A Windows build: today a portable zip with no installer.
    WindowsZip,
    /// A development build, a sandbox, a package this build doesn't know, or an AppImage it
    /// cannot write. Never updates.
    Unknown,
}

impl InstallKind {
    /// The manifest artifact this install would use.
    pub fn artifact_kind(&self) -> Option<ArtifactKind> {
        match self {
            Self::AppImage { .. } => Some(ArtifactKind::AppImage),
            Self::Deb { .. } => Some(ArtifactKind::Deb),
            Self::Rpm { .. } => Some(ArtifactKind::Rpm),
            Self::WindowsZip => Some(ArtifactKind::WindowsZip),
            Self::Unknown => None,
        }
    }

    /// Whether an update is downloaded and kept for this install. A Windows zip is not: with no
    /// installer, the app only points at the release page.
    pub fn downloads(&self) -> bool {
        matches!(
            self,
            Self::AppImage { .. } | Self::Deb { .. } | Self::Rpm { .. }
        )
    }

    /// Whether the app can install the update itself and restart into it.
    pub fn installs_itself(&self) -> bool {
        matches!(self, Self::AppImage { .. })
    }

    /// What the UI calls this kind.
    pub fn label(&self) -> &'static str {
        match self {
            Self::AppImage { .. } => "AppImage",
            Self::Deb { .. } => ".deb package",
            Self::Rpm { .. } => ".rpm package",
            Self::WindowsZip => "Windows portable build",
            Self::Unknown => "this installation",
        }
    }

    /// What to tell the user to run, for a package that is downloaded but not installed.
    pub fn command(&self, package: &Path) -> Option<String> {
        let quoted = shell_quote(package);
        match self {
            Self::Deb { .. } => Some(format!("sudo dpkg -i {quoted}")),
            Self::Rpm {
                manager: RpmManager::Dnf,
                ..
            } => Some(format!("sudo dnf install {quoted}")),
            Self::Rpm {
                manager: RpmManager::Zypper,
                ..
            } => Some(format!("sudo zypper install {quoted}")),
            _ => None,
        }
    }
}

/// One argument for a shell, single-quoted, with `'` written as `'\''`. Only shown to the user:
/// nothing here runs a command.
fn shell_quote(path: &Path) -> String {
    let text = path.to_string_lossy();
    let mut quoted = String::with_capacity(text.len() + 2);
    quoted.push('\'');
    for character in text.chars() {
        if character == '\'' {
            quoted.push_str("'\\''");
        } else {
            quoted.push(character);
        }
    }
    quoted.push('\'');
    quoted
}

/// What [`InstallEnv::detect`] decides from. Every field is data so a test can make one up.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstallEnv {
    pub os: Os,
    /// `$APPIMAGE`, when it names an absolute path.
    pub appimage: Option<PathBuf>,
    /// Whether that path is a file this user may write.
    pub appimage_writable: bool,
    /// This process's executable.
    pub exe: Option<PathBuf>,
    /// Whether this user may write the executable.
    pub exe_writable: bool,
    pub family: PackageFamily,
}

impl InstallEnv {
    /// This machine's environment. Reads variables, `/etc/os-release` and permissions; writes
    /// nothing.
    pub fn current() -> Self {
        let os = if cfg!(target_os = "linux") {
            Os::Linux
        } else if cfg!(windows) {
            Os::Windows
        } else {
            Os::Other
        };
        let appimage = std::env::var_os("APPIMAGE")
            .map(PathBuf::from)
            .filter(|path| path.is_absolute())
            .filter(|path| path.is_file());
        let appimage_writable = appimage.as_deref().is_some_and(writable);
        let exe = std::env::current_exe().ok();
        let exe_writable = exe.as_deref().is_some_and(writable);
        let family = if os == Os::Linux {
            std::fs::read_to_string("/etc/os-release")
                .map(|text| family_from_os_release(&text))
                .unwrap_or(PackageFamily::Unknown)
        } else {
            PackageFamily::Unknown
        };
        Self {
            os,
            appimage,
            appimage_writable,
            exe,
            exe_writable,
            family,
        }
    }

    /// The install this environment describes.
    pub fn detect(&self) -> InstallKind {
        match self.os {
            Os::Linux => {
                if let Some(path) = &self.appimage {
                    // An AppImage that can't be replaced is not one we can update: better to
                    // notice nothing than to download 30 MB that cannot be installed.
                    if !self.appimage_writable || !path.is_absolute() {
                        return InstallKind::Unknown;
                    }
                    return InstallKind::AppImage { path: path.clone() };
                }
                let Some(exe) = &self.exe else {
                    return InstallKind::Unknown;
                };
                // A writable executable is a checkout (`target/debug`) or a copy someone unpacked
                // into their home: nothing owns it, so no release can replace it.
                if self.exe_writable {
                    return InstallKind::Unknown;
                }
                if !(exe.starts_with("/usr") || exe.starts_with("/opt")) {
                    return InstallKind::Unknown;
                }
                match self.family {
                    PackageFamily::Debian => InstallKind::Deb { path: exe.clone() },
                    PackageFamily::Fedora => InstallKind::Rpm {
                        path: exe.clone(),
                        manager: RpmManager::Dnf,
                    },
                    PackageFamily::Suse => InstallKind::Rpm {
                        path: exe.clone(),
                        manager: RpmManager::Zypper,
                    },
                    PackageFamily::Unknown => InstallKind::Unknown,
                }
            }
            Os::Windows => InstallKind::WindowsZip,
            Os::Other => InstallKind::Unknown,
        }
    }
}

/// The package family an `/etc/os-release` says it is.
pub fn family_from_os_release(text: &str) -> PackageFamily {
    let mut id = None;
    let mut like = None;
    for line in text.lines() {
        let Some((key, value)) = line.trim().split_once('=') else {
            continue;
        };
        let value = value.trim().trim_matches('"').to_ascii_lowercase();
        match key.trim() {
            "ID" => id = Some(value),
            "ID_LIKE" => like = Some(value),
            _ => {}
        }
    }
    let family = |name: &str| match name {
        "debian" | "ubuntu" | "linuxmint" | "pop" | "elementary" | "raspbian" | "neon"
        | "zorin" | "mx" | "kali" | "devuan" | "deepin" => Some(PackageFamily::Debian),
        "fedora" | "rhel" | "centos" | "rocky" | "almalinux" | "ol" | "nobara" => {
            Some(PackageFamily::Fedora)
        }
        "opensuse" | "suse" | "sles" | "sled" | "opensuse-leap" | "opensuse-tumbleweed" => {
            Some(PackageFamily::Suse)
        }
        _ => None,
    };
    if let Some(family) = id.as_deref().and_then(family) {
        return family;
    }
    // `ID_LIKE="rhel fedora"`: the first word this build knows wins.
    like.as_deref()
        .into_iter()
        .flat_map(str::split_whitespace)
        .find_map(family)
        .unwrap_or(PackageFamily::Unknown)
}

/// Whether this user may write `path`. A permission check, never a probe write.
#[cfg(target_os = "linux")]
fn writable(path: &Path) -> bool {
    use std::os::unix::ffi::OsStrExt as _;
    let Ok(path) = std::ffi::CString::new(path.as_os_str().as_bytes()) else {
        return false;
    };
    // SAFETY: `path` is a live, NUL-terminated string that outlives the call.
    unsafe { libc::access(path.as_ptr(), libc::W_OK) == 0 }
}

#[cfg(not(target_os = "linux"))]
fn writable(path: &Path) -> bool {
    // Opening for write is the check Windows offers; on Windows a running executable refuses it,
    // which is right: the portable zip is not replaced in place.
    std::fs::OpenOptions::new().write(true).open(path).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env(os: Os, appimage: Option<&str>, appimage_writable: bool) -> InstallEnv {
        InstallEnv {
            os,
            appimage: appimage.map(PathBuf::from),
            appimage_writable,
            exe: Some("/usr/bin/semaphore-app".into()),
            exe_writable: false,
            family: PackageFamily::Debian,
        }
    }

    #[test]
    fn a_writable_appimage_updates_itself() {
        let kind = env(
            Os::Linux,
            Some("/home/mike/Apps/Semaphore-Chat-Native.AppImage"),
            true,
        )
        .detect();
        assert_eq!(
            kind,
            InstallKind::AppImage {
                path: "/home/mike/Apps/Semaphore-Chat-Native.AppImage".into()
            }
        );
        assert!(kind.installs_itself());
        assert!(kind.downloads());
        assert_eq!(kind.artifact_kind(), Some(ArtifactKind::AppImage));
        assert_eq!(kind.command(Path::new("/tmp/a")), None);
    }

    #[test]
    fn an_appimage_that_cannot_be_written_is_not_updated() {
        assert_eq!(
            env(Os::Linux, Some("/opt/Semaphore.AppImage"), false).detect(),
            InstallKind::Unknown
        );
        // An `APPIMAGE` that isn't absolute is not a path to replace.
        assert_eq!(
            env(Os::Linux, Some("Semaphore.AppImage"), true).detect(),
            InstallKind::Unknown
        );
    }

    #[test]
    fn a_package_under_usr_or_opt_is_updated_by_downloading_it() {
        let mut debian = env(Os::Linux, None, false);
        assert_eq!(
            debian.detect(),
            InstallKind::Deb {
                path: "/usr/bin/semaphore-app".into()
            }
        );
        debian.family = PackageFamily::Fedora;
        assert_eq!(
            debian.detect(),
            InstallKind::Rpm {
                path: "/usr/bin/semaphore-app".into(),
                manager: RpmManager::Dnf
            }
        );
        debian.family = PackageFamily::Suse;
        assert_eq!(
            debian.detect(),
            InstallKind::Rpm {
                path: "/usr/bin/semaphore-app".into(),
                manager: RpmManager::Zypper
            }
        );
    }

    #[test]
    fn a_checkout_never_updates() {
        let mut checkout = env(Os::Linux, None, false);
        checkout.exe =
            Some("/home/mike/projects/semaphore-chat/native/target/debug/semaphore-app".into());
        checkout.exe_writable = true;
        assert_eq!(checkout.detect(), InstallKind::Unknown);

        // Not writable, but nowhere a package puts it either.
        let mut unpacked = env(Os::Linux, None, false);
        unpacked.exe = Some("/home/mike/Downloads/semaphore-app".into());
        assert_eq!(unpacked.detect(), InstallKind::Unknown);
    }

    #[test]
    fn an_unknown_package_family_never_updates() {
        let mut arch = env(Os::Linux, None, false);
        arch.family = PackageFamily::Unknown;
        assert_eq!(arch.detect(), InstallKind::Unknown);
    }

    #[test]
    fn windows_notifies_only() {
        let windows = InstallEnv {
            os: Os::Windows,
            appimage: None,
            appimage_writable: false,
            exe: Some("C:\\Users\\mike\\Semaphore\\semaphore-app.exe".into()),
            exe_writable: true,
            family: PackageFamily::Unknown,
        };
        assert_eq!(windows.detect(), InstallKind::WindowsZip);
        assert!(!windows.detect().downloads());
        assert_eq!(
            windows.detect().artifact_kind(),
            Some(ArtifactKind::WindowsZip)
        );
    }

    #[test]
    fn another_os_is_unknown() {
        assert_eq!(env(Os::Other, None, false).detect(), InstallKind::Unknown);
    }

    #[test]
    fn reads_os_release() {
        let table = [
            ("ID=debian\nVERSION_ID=\"12\"\n", PackageFamily::Debian),
            ("ID=ubuntu\nID_LIKE=debian\n", PackageFamily::Debian),
            (
                "ID=linuxmint\nID_LIKE=\"ubuntu debian\"\n",
                PackageFamily::Debian,
            ),
            ("ID=fedora\n", PackageFamily::Fedora),
            (
                "ID=\"rocky\"\nID_LIKE=\"rhel centos fedora\"\n",
                PackageFamily::Fedora,
            ),
            (
                "ID=opensuse-leap\nID_LIKE=\"suse opensuse\"\n",
                PackageFamily::Suse,
            ),
            ("ID=arch\n", PackageFamily::Unknown),
            ("ID=linux\nID_LIKE=\"arch\"\n", PackageFamily::Unknown),
            ("", PackageFamily::Unknown),
            ("NAME=\"Not a key=value\"\n", PackageFamily::Unknown),
        ];
        for (text, expected) in table {
            assert_eq!(family_from_os_release(text), expected, "{text:?}");
        }
    }

    #[test]
    fn the_commands_are_what_the_package_managers_take() {
        let package =
            Path::new("/home/mike/.cache/semaphore/updates/semaphore-chat_1.4.0_amd64.deb");
        let deb = InstallKind::Deb {
            path: "/usr/bin/semaphore-app".into(),
        };
        assert_eq!(
            deb.command(package).unwrap(),
            "sudo dpkg -i '/home/mike/.cache/semaphore/updates/semaphore-chat_1.4.0_amd64.deb'"
        );
        let rpm = InstallKind::Rpm {
            path: "/usr/bin/semaphore-app".into(),
            manager: RpmManager::Dnf,
        };
        assert!(
            rpm.command(package)
                .unwrap()
                .starts_with("sudo dnf install '")
        );
        let suse = InstallKind::Rpm {
            path: "/usr/bin/semaphore-app".into(),
            manager: RpmManager::Zypper,
        };
        assert!(
            suse.command(package)
                .unwrap()
                .starts_with("sudo zypper install '")
        );
    }

    #[test]
    fn quotes_a_path_for_the_shell() {
        assert_eq!(shell_quote(Path::new("/tmp/a.deb")), "'/tmp/a.deb'");
        assert_eq!(
            shell_quote(Path::new("/tmp/it's a.deb")),
            "'/tmp/it'\\''s a.deb'"
        );
    }
}
