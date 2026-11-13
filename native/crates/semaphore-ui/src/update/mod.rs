//! The update notice: the card the shell shows over its bottom-left corner, in the states
//! electron-updater's events put the Electron app in (`components/Electron/AutoUpdater.tsx`), and
//! the wording the settings row uses.
//!
//! The card is not the whole feature and holds no logic: it draws a [`UpdateStatus`] the app maps
//! from the updater, and emits [`UpdateBannerEvent`] for the app to act on. Nothing here reads the
//! environment, downloads, or knows what a manifest is.
//!
//! | State | The card |
//! |---|---|
//! | available | "Version X is available." with Release notes and Dismiss |
//! | downloading | "Downloading update... N%" and a progress bar |
//! | ready, AppImage | "Update downloaded! Version X is ready to install." with Restart to update |
//! | ready, package | "Version X is downloaded." and the install command, with Show in folder |
//! | failed | the message, with Retry when asking again could work |
//! | up to date, checking | nothing (the settings row says so) |
//!
//! Dismissing is per version: the app remembers the version and stops showing the card for it.

use crate::kit::{Alert, Button, ButtonSize, LinearProgress, Severity, Variant, text};
use crate::theme::SemTheme;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;

/// Where a downloaded update goes next.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReadyHow {
    /// The AppImage was replaced: restarting runs the new version.
    Restart,
    /// A package is in the cache: the user installs it with `command`.
    Package { command: String },
}

/// What the app maps the updater's state to. `Unknown` is a build that doesn't check (no feed, or
/// an install kind that can't update), which the settings row explains with its note.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum UpdateStatus {
    #[default]
    Unknown,
    Checking,
    UpToDate,
    Available {
        version: String,
        notes_url: Option<String>,
    },
    Downloading {
        received: u64,
        total: u64,
    },
    Ready {
        version: String,
        how: ReadyHow,
    },
    Failed {
        message: String,
        retryable: bool,
    },
}

impl UpdateStatus {
    /// 0-100 while downloading, `None` otherwise (or when the total isn't known).
    pub fn percent(&self) -> Option<u8> {
        match self {
            Self::Downloading { received, total } if *total > 0 => {
                Some((received.saturating_mul(100) / total).min(100) as u8)
            }
            Self::Downloading { .. } => Some(0),
            _ => None,
        }
    }

    /// What the settings row says, and how loud it is.
    pub fn summary(&self) -> (Severity, String) {
        match self {
            Self::Unknown => (
                Severity::Info,
                "Updates aren't checked in this build.".into(),
            ),
            Self::Checking => (Severity::Info, "Checking for updates...".into()),
            Self::UpToDate => (Severity::Success, "You're up to date.".into()),
            Self::Available { version, .. } => {
                (Severity::Info, format!("Version {version} is available."))
            }
            Self::Downloading { .. } => (
                Severity::Info,
                format!("Downloading update... {}%", self.percent().unwrap_or(0)),
            ),
            Self::Ready {
                version,
                how: ReadyHow::Restart,
            } => (
                Severity::Success,
                format!("Version {version} is ready: restart to update."),
            ),
            Self::Ready {
                version,
                how: ReadyHow::Package { command },
            } => (
                Severity::Success,
                format!("Version {version} was downloaded. Install it with: {command}"),
            ),
            Self::Failed { message, .. } => (Severity::Error, message.clone()),
        }
    }

    /// Whether a check is in flight, so the settings button can wait.
    pub fn busy(&self) -> bool {
        matches!(self, Self::Checking | Self::Downloading { .. })
    }
}

/// What the card asks the app to do.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UpdateBannerEvent {
    /// Restart into the update that was installed.
    Restart,
    /// Open the folder that holds the downloaded package.
    ShowPackage,
    /// Ask again (a failure worth retrying).
    Retry,
    /// Hide the card for this version.
    Dismiss,
    /// Open the release's notes (or its page).
    ReleaseNotes,
}

/// The card. `set_status(None)` draws nothing.
pub struct UpdateBanner {
    status: Option<UpdateStatus>,
    /// The install won't download by itself (a Windows portable build): the available state
    /// points at the release page instead of promising a download.
    manual: bool,
    /// The release the notes button opens.
    notes_url: Option<SharedString>,
}

impl EventEmitter<UpdateBannerEvent> for UpdateBanner {}

impl UpdateBanner {
    pub fn new(_: &mut Context<Self>) -> Self {
        Self {
            status: None,
            manual: false,
            notes_url: None,
        }
    }

    /// `None` for no card at all (up to date, checking, or dismissed).
    pub fn set_status(&mut self, status: Option<UpdateStatus>, cx: &mut Context<Self>) {
        self.notes_url = match &status {
            Some(UpdateStatus::Available { notes_url, .. }) => {
                notes_url.clone().map(SharedString::from)
            }
            _ => None,
        };
        self.status = status;
        cx.notify();
    }

    pub fn set_manual(&mut self, manual: bool, cx: &mut Context<Self>) {
        self.manual = manual;
        cx.notify();
    }

    pub fn status(&self) -> Option<&UpdateStatus> {
        self.status.as_ref()
    }

    fn button(
        id: &'static str,
        label: &'static str,
        contained: bool,
        event: UpdateBannerEvent,
        cx: &mut Context<Self>,
    ) -> Button {
        let view = cx.entity().downgrade();
        let button = Button::new(id, label)
            .size(ButtonSize::Small)
            .on_click(move |_, _, cx| {
                view.update(cx, |_, cx| cx.emit(event)).ok();
            });
        if contained {
            button.contained()
        } else {
            button
        }
    }
}

impl Render for UpdateBanner {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let Some(status) = self.status.clone() else {
            // Drawn, but with nothing in it: the shell's notice corner keeps its layout either
            // way.
            return div().id("update-banner-empty").into_any_element();
        };
        let sem = cx.sem().clone();
        let (severity, message) = match &status {
            UpdateStatus::Available { version, .. } => {
                (Severity::Info, format!("Version {version} is available."))
            }
            UpdateStatus::Downloading { .. } => (
                Severity::Info,
                format!("Downloading update... {}%", status.percent().unwrap_or(0)),
            ),
            UpdateStatus::Ready {
                version,
                how: ReadyHow::Restart,
            } => (
                Severity::Success,
                format!("Update downloaded! Version {version} is ready to install."),
            ),
            UpdateStatus::Ready {
                version,
                how: ReadyHow::Package { .. },
            } => (
                Severity::Success,
                format!("Version {version} is downloaded."),
            ),
            UpdateStatus::Failed { message, .. } => (Severity::Error, message.clone()),
            UpdateStatus::Unknown | UpdateStatus::Checking | UpdateStatus::UpToDate => {
                return div().id("update-banner-empty").into_any_element();
            }
        };
        let mut card = div()
            .id("update-banner")
            .test_support()
            .role(Role::Status)
            .aria_label(message.clone())
            .w(px(420.))
            .max_w_full()
            .p(px(12.))
            .rounded(px(8.))
            .bg(sem.paper)
            .border_1()
            .border_color(sem.paper_border)
            .shadow_lg()
            .flex()
            .flex_col()
            .gap(px(8.))
            .child(Alert::new(severity, message));
        match &status {
            UpdateStatus::Downloading { .. } => {
                card = card.child(LinearProgress::new(
                    "update-progress",
                    Some(f32::from(status.percent().unwrap_or(0))),
                    "Update download progress",
                ));
            }
            UpdateStatus::Ready {
                how: ReadyHow::Restart,
                ..
            } => {
                card = card.child(
                    text(
                        Variant::Caption,
                        "The app will restart to apply the update.",
                    )
                    .text_color(sem.text_secondary),
                );
            }
            UpdateStatus::Ready {
                how: ReadyHow::Package { command },
                ..
            } => {
                card = card
                    .child(
                        text(Variant::Caption, "Install it with your package manager:")
                            .text_color(sem.text_secondary),
                    )
                    .child(
                        div()
                            .id("update-command")
                            .test_support()
                            .role(Role::Note)
                            .aria_label(SharedString::from(command.clone()))
                            .w_full()
                            .p(px(8.))
                            .rounded(px(4.))
                            .bg(sem.background_default)
                            .child(
                                text(Variant::Body2, command.clone())
                                    .font_family("monospace")
                                    .text_color(sem.text_primary),
                            ),
                    );
            }
            _ => {}
        }
        card.child(self.buttons(&status, cx)).into_any_element()
    }
}

impl UpdateBanner {
    fn buttons(&self, status: &UpdateStatus, cx: &mut Context<Self>) -> Div {
        let mut row = div()
            .flex()
            .flex_wrap()
            .items_center()
            .justify_end()
            .gap(px(8.));
        match status {
            UpdateStatus::Available { .. } => {
                if self.notes_url.is_some() {
                    row = row.child(Self::button(
                        "update-release-notes",
                        if self.manual {
                            "Release page"
                        } else {
                            "Release notes"
                        },
                        false,
                        UpdateBannerEvent::ReleaseNotes,
                        cx,
                    ));
                }
            }
            UpdateStatus::Downloading { .. } => {}
            UpdateStatus::Ready {
                how: ReadyHow::Restart,
                ..
            } => {
                row = row.child(Self::button(
                    "update-restart",
                    "Restart to update",
                    true,
                    UpdateBannerEvent::Restart,
                    cx,
                ));
            }
            UpdateStatus::Ready {
                how: ReadyHow::Package { .. },
                ..
            } => {
                row = row.child(Self::button(
                    "update-show-package",
                    "Show in folder",
                    false,
                    UpdateBannerEvent::ShowPackage,
                    cx,
                ));
            }
            UpdateStatus::Failed { retryable, .. } => {
                if *retryable {
                    row = row.child(Self::button(
                        "update-retry",
                        "Retry",
                        true,
                        UpdateBannerEvent::Retry,
                        cx,
                    ));
                }
            }
            UpdateStatus::Unknown | UpdateStatus::Checking | UpdateStatus::UpToDate => {}
        }
        // Nothing to dismiss while a transfer runs (it would hide the progress without stopping
        // it); everywhere else the card can be put away until the next version.
        if !matches!(status, UpdateStatus::Downloading { .. }) {
            row = row.child(Self::button(
                "update-dismiss",
                "Dismiss",
                false,
                UpdateBannerEvent::Dismiss,
                cx,
            ));
        }
        row
    }
}

#[cfg(test)]
mod tests {
    use super::{ReadyHow, UpdateStatus};

    fn summary(status: &UpdateStatus) -> String {
        status.summary().1
    }

    #[test]
    fn percent_reports_whole_numbers() {
        let download = |received: u64, total: u64| UpdateStatus::Downloading { received, total };
        assert_eq!(download(0, 0).percent(), Some(0));
        assert_eq!(download(12_138_288, 30_345_720).percent(), Some(40));
        assert_eq!(download(7, 2).percent(), Some(100));
        assert_eq!(UpdateStatus::UpToDate.percent(), None);
    }

    #[test]
    fn the_settings_row_says_what_is_happening() {
        assert_eq!(summary(&UpdateStatus::Checking), "Checking for updates...");
        assert_eq!(summary(&UpdateStatus::UpToDate), "You're up to date.");
        assert_eq!(
            summary(&UpdateStatus::Available {
                version: "1.4.0".into(),
                notes_url: None,
            }),
            "Version 1.4.0 is available."
        );
        assert_eq!(
            summary(&UpdateStatus::Downloading {
                received: 40,
                total: 100,
            }),
            "Downloading update... 40%"
        );
        assert_eq!(
            summary(&UpdateStatus::Ready {
                version: "1.4.0".into(),
                how: ReadyHow::Restart,
            }),
            "Version 1.4.0 is ready: restart to update."
        );
        assert_eq!(
            summary(&UpdateStatus::Ready {
                version: "1.4.0".into(),
                how: ReadyHow::Package {
                    command: "sudo dpkg -i '/tmp/a.deb'".into(),
                },
            }),
            "Version 1.4.0 was downloaded. Install it with: sudo dpkg -i '/tmp/a.deb'"
        );
        assert_eq!(
            summary(&UpdateStatus::Failed {
                message: "The download stopped after 3 of 4 bytes.".into(),
                retryable: true,
            }),
            "The download stopped after 3 of 4 bytes."
        );
        assert_eq!(
            UpdateStatus::Failed {
                message: "x".into(),
                retryable: false,
            }
            .summary()
            .0,
            crate::kit::Severity::Error
        );
    }

    #[test]
    fn a_check_in_flight_makes_the_button_wait() {
        assert!(UpdateStatus::Checking.busy());
        assert!(
            UpdateStatus::Downloading {
                received: 1,
                total: 2,
            }
            .busy()
        );
        assert!(!UpdateStatus::UpToDate.busy());
        assert!(!UpdateStatus::Unknown.busy());
    }
}
