//! W13: the updater's life in the app.
//!
//! - **Start** (`started`): build the updater from `AppConfig::update` and the net runtime's HTTP
//!   client (the app's one TLS trust), and start the schedule, three seconds from now and then
//!   hourly. A build with no feed, or an install that can't update, starts nothing and keeps the
//!   reason for the settings row.
//! - **States** arrive on a channel from whichever thread the check ran on and become the card in
//!   the shell's notice corner and the settings row's status line.
//! - **Dismiss** is per version (saved in the settings), so a card for 1.4.0 stays away until
//!   1.4.1. A dismissed failure stays away until the next attempt.
//! - **Restart** goes through `AppConfig::restart`, the seam the binary implements: it starts the
//!   new file (which waits for this app's single-instance lock) and quits, or reports why it
//!   couldn't, and the app keeps running. Refused during a call: restarting would end it.
//!
//! The update itself is `semaphore-platform-desktop`'s: nothing here downloads, hashes or
//! installs.

use super::AppRoot;
use crate::runtime::Exec;
use crate::update::{UpdateStart, WhyNoUpdates};
use gpui_kit::*;
use semaphore_platform_desktop::update::{
    Arch, ReadyAction, UpdateConfig, UpdateState, Updater, drive,
};
use semaphore_ui::update::{UpdateBanner, UpdateBannerEvent, UpdateStatus};
use std::sync::Arc;

pub(super) struct Updates {
    /// `None` when this build doesn't check (`off` says why).
    pub(super) updater: Option<Updater>,
    /// Where a manual check runs.
    pub(super) exec: Option<Exec>,
    pub(super) banner: Option<Entity<UpdateBanner>>,
    pub(super) state: UpdateState,
    /// The version whose card the user put away; saved, so it stays away after a restart.
    dismissed_version: Option<String>,
    /// A failure's message the user put away; this run only.
    dismissed_failure: Option<String>,
    /// Why this build doesn't check for updates.
    pub(super) off: Option<WhyNoUpdates>,
    /// Ends the schedule when the app quits.
    stop: Option<tokio::sync::watch::Sender<bool>>,
}

impl Default for Updates {
    fn default() -> Self {
        Self {
            updater: None,
            exec: None,
            banner: None,
            state: UpdateState::Idle,
            dismissed_version: None,
            dismissed_failure: None,
            off: None,
            stop: None,
        }
    }
}

impl AppRoot {
    /// Starts the updater, if this build and install can update.
    pub(super) fn start_updates(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let (UpdateStart::On(options), Some(services)) = (&self.config.update, &self.services)
        else {
            if let UpdateStart::Off(why) = &self.config.update {
                self.updates.off = Some(*why);
            }
            return;
        };
        let Ok(version) = crate::update::current_version() else {
            self.updates.off = Some(WhyNoUpdates::BadVersion);
            return;
        };
        let Some(arch) = Arch::current() else {
            self.updates.off = Some(WhyNoUpdates::UnsupportedInstall);
            return;
        };
        // The TLS trust the app already has: `semaphore-net`'s configuration (the OS store),
        // built when the backend started, so this is cheap and does no I/O. The updater adds its
        // own redirect rule and timeouts.
        let tls = match semaphore_net::tls_client_config() {
            Ok(tls) => tls,
            Err(error) => {
                log::warn!("updates are off: no TLS configuration: {error}");
                self.updates.off = Some(WhyNoUpdates::UnsupportedInstall);
                return;
            }
        };
        let builder =
            reqwest::Client::builder().tls_backend_preconfigured(rustls::ClientConfig::clone(&tls));
        let config = UpdateConfig {
            manifest_url: options.manifest_url.clone(),
            current_version: version,
            install: options.install.clone(),
            cache_dir: options.cache_dir.clone(),
            arch,
            user_agent: format!("Semaphore-Chat-Native/{}", env!("SEMAPHORE_VERSION")),
        };
        let updater = match Updater::new(config, builder) {
            Ok(updater) => updater,
            Err(error) => {
                log::warn!("updates are off: no HTTP client: {error}");
                self.updates.off = Some(WhyNoUpdates::UnsupportedInstall);
                return;
            }
        };
        // What an earlier run left: the replaced AppImage (this process proves its successor
        // starts) and a download killed half way.
        updater.clear_leftovers();
        let (sender, receiver) = async_channel::unbounded();
        let activity = self.activity.clone();
        updater.set_sink(Arc::new(move |state| {
            let _ = sender.try_send(state.clone());
            activity.bump();
        }));
        let banner = cx.new(UpdateBanner::new);
        banner.update(cx, |banner, cx| {
            banner.set_manual(!options.install.downloads(), cx)
        });
        self.updates.banner = Some(banner.clone());
        self.updates.dismissed_version = self.settings.get().dismissed_update.clone();
        self._subscriptions
            .push(cx.subscribe_in(&banner, window, Self::on_update_banner));
        cx.spawn(async move |this, cx| {
            while let Ok(state) = receiver.recv().await {
                if this
                    .update(cx, |this, cx| this.on_update_state(state, cx))
                    .is_err()
                {
                    return;
                }
            }
        })
        .detach();
        let (stop, stopped) = tokio::sync::watch::channel(false);
        let driving = updater.clone();
        let schedule = options.schedule;
        services
            .exec
            .fire(async move { drive(driving, schedule, stopped).await });
        self.updates.exec = Some(services.exec.clone());
        self.updates.stop = Some(stop);
        self.updates.updater = Some(updater);
        cx.notify();
    }

    /// Ends the schedule. The updater keeps its state; nothing else is cleaned up.
    pub(super) fn stop_updates(&mut self) {
        if let Some(stop) = self.updates.stop.take() {
            let _ = stop.send(true);
        }
    }

    fn on_update_state(&mut self, state: UpdateState, cx: &mut Context<Self>) {
        self.updates.state = state;
        self.show_update_banner(cx);
        self.refresh_desktop_tab(cx);
        cx.notify();
    }

    fn on_update_banner(
        &mut self,
        _: &Entity<UpdateBanner>,
        event: &UpdateBannerEvent,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        match event {
            UpdateBannerEvent::Dismiss => {
                match crate::update::status_of(&self.updates.state) {
                    UpdateStatus::Available { version, .. }
                    | UpdateStatus::Ready { version, .. } => {
                        self.updates.dismissed_version = Some(version.clone());
                        self.update_settings(|settings| settings.dismissed_update = Some(version));
                    }
                    UpdateStatus::Failed { message, .. } => {
                        self.updates.dismissed_failure = Some(message)
                    }
                    _ => {}
                }
                self.show_update_banner(cx);
            }
            UpdateBannerEvent::Retry => self.check_for_updates(cx),
            UpdateBannerEvent::Restart => self.restart_to_update(cx),
            UpdateBannerEvent::ShowPackage => {
                if let UpdateState::Ready {
                    action: ReadyAction::Package { path, .. },
                    ..
                } = &self.updates.state
                {
                    let folder = path.parent().unwrap_or(path);
                    match reqwest::Url::from_directory_path(folder) {
                        Ok(url) => crate::open_url(url.as_str(), cx),
                        Err(()) => {
                            log::warn!("cannot open {}: not an absolute path", folder.display())
                        }
                    }
                }
            }
            UpdateBannerEvent::ReleaseNotes => {
                if let UpdateState::Available {
                    notes_url: Some(url),
                    ..
                } = &self.updates.state
                {
                    let url = url.clone();
                    crate::open_url(&url, cx);
                }
            }
        }
    }

    /// "Restart to update": never during a call (it would end it); otherwise the binary's seam
    /// starts the new build and quits, or says why it couldn't and the app carries on.
    fn restart_to_update(&mut self, cx: &mut Context<Self>) {
        let in_call = self
            .services
            .as_ref()
            .is_some_and(|services| services.core.voice().room.is_some());
        if in_call {
            self.show_restart_problem(
                "Leave the call first: restarting now would end it. Retry to restart afterwards."
                    .into(),
                cx,
            );
            return;
        }
        let Some(restart) = self.config.restart.clone() else {
            log::warn!(
                "the update is in place but this build has no way to restart: it runs next start"
            );
            return;
        };
        if let Err(problem) = restart(cx) {
            log::warn!("restart to update failed: {problem}");
            self.show_restart_problem(
                format!(
                    "The app couldn't restart ({problem}). The update runs the next time you start it."
                ),
                cx,
            );
        }
    }

    /// Shows a restart that didn't happen as a failure card. The updater still holds `Ready`, so
    /// Retry (a check) brings the restart button back.
    fn show_restart_problem(&mut self, message: String, cx: &mut Context<Self>) {
        self.updates.state = UpdateState::Failed {
            message,
            retryable: true,
        };
        self.updates.dismissed_failure = None;
        self.show_update_banner(cx);
        self.refresh_desktop_tab(cx);
        cx.notify();
    }

    /// "Check for updates" in the settings, or Retry on a failed card.
    pub(super) fn check_for_updates(&mut self, cx: &mut Context<Self>) {
        let (Some(updater), Some(exec)) = (self.updates.updater.clone(), self.updates.exec.clone())
        else {
            return;
        };
        self.updates.dismissed_failure = None;
        exec.fire(async move {
            updater.check_and_download().await;
        });
        cx.notify();
    }

    /// What the card should show, or `None` when there is nothing (or it was dismissed).
    fn banner_status(&self) -> Option<UpdateStatus> {
        let status = crate::update::status_of(&self.updates.state);
        (!card_is_hidden(
            &status,
            self.updates.dismissed_version.as_deref(),
            self.updates.dismissed_failure.as_deref(),
        ))
        .then_some(status)
    }

    fn show_update_banner(&mut self, cx: &mut Context<Self>) {
        let status = self.banner_status();
        if let Some(banner) = &self.updates.banner {
            banner.update(cx, |banner, cx| banner.set_status(status, cx));
        }
    }

    /// The shell's notice corner draws this, and nothing at all when there is no card: an empty
    /// element would still take the corner's gap.
    pub(super) fn update_banner_slot(&self) -> semaphore_ui::shell::UpdateBannerSlot {
        let banner = self.updates.banner.clone();
        std::rc::Rc::new(move |_, cx: &mut App| {
            let banner = banner.clone()?;
            banner
                .read(cx)
                .status()
                .is_some()
                .then(|| banner.into_any_element())
        })
    }

    /// The settings row's three facts: what the updater is doing, whether the button does
    /// anything, and why not when it doesn't.
    pub(super) fn desktop_update_row(&self) -> (UpdateStatus, bool, Option<String>) {
        let enabled = self.updates.updater.is_some();
        let status = if enabled {
            crate::update::status_of(&self.updates.state)
        } else {
            UpdateStatus::Unknown
        };
        let note = self.updates.off.map(|why| why.note().to_owned());
        (status, enabled, note)
    }

    /// For the headless rig: what the updater is doing.
    pub fn update_status(&self) -> UpdateStatus {
        crate::update::status_of(&self.updates.state)
    }

    /// For the headless rig: what the card shows, or `None` when nothing (or dismissed).
    pub fn update_banner_status(&self) -> Option<UpdateStatus> {
        self.banner_status()
    }
}

/// Whether the card stays away for this state. A version the user dismissed hides every notice
/// about it; a dismissed failure hides only that failure's message, so a new one shows.
fn card_is_hidden(
    status: &UpdateStatus,
    dismissed_version: Option<&str>,
    dismissed_failure: Option<&str>,
) -> bool {
    match status {
        UpdateStatus::Available { version, .. } | UpdateStatus::Ready { version, .. } => {
            dismissed_version == Some(version.as_str())
        }
        UpdateStatus::Failed { message, .. } => dismissed_failure == Some(message.as_str()),
        // A check in flight, up to date, or a build that doesn't check: no card at all.
        _ => true,
    }
}

#[cfg(test)]
mod tests {
    use super::card_is_hidden;
    use semaphore_ui::update::{ReadyHow, UpdateStatus};

    fn available(version: &str) -> UpdateStatus {
        UpdateStatus::Available {
            version: version.into(),
            notes_url: None,
        }
    }

    #[test]
    fn a_dismissed_version_stays_away_until_a_newer_one() {
        assert!(card_is_hidden(&available("1.4.0"), Some("1.4.0"), None));
        assert!(!card_is_hidden(&available("1.4.1"), Some("1.4.0"), None));
        assert!(card_is_hidden(
            &UpdateStatus::Ready {
                version: "1.4.0".into(),
                how: ReadyHow::Restart,
            },
            Some("1.4.0"),
            None
        ));
        // No dismissal: the card shows.
        assert!(!card_is_hidden(&available("1.4.0"), None, None));
    }

    #[test]
    fn a_dismissed_failure_hides_that_message_only() {
        let failed = |message: &str| UpdateStatus::Failed {
            message: message.into(),
            retryable: true,
        };
        assert!(card_is_hidden(
            &failed("The download stopped after 3 of 4 bytes."),
            None,
            Some("The download stopped after 3 of 4 bytes.")
        ));
        assert!(!card_is_hidden(
            &failed("The update server answered 503."),
            None,
            Some("The download stopped after 3 of 4 bytes.")
        ));
    }

    #[test]
    fn quiet_states_draw_no_card() {
        for status in [
            UpdateStatus::Unknown,
            UpdateStatus::Checking,
            UpdateStatus::UpToDate,
            UpdateStatus::Downloading {
                received: 1,
                total: 2,
            },
        ] {
            assert!(card_is_hidden(&status, None, None), "{status:?}");
        }
    }
}
