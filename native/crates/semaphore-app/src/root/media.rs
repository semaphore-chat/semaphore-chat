//! WM: third-party pictures in the app: the "Load images from other sites" switch reaching core,
//! the settings store, the file store's third-party entry point (`files::third_party`) and the
//! conversation pane; the GIF picker's core events and its overlay. (The conversation pane's half
//! is `conversation/media.rs`; GIF and link-preview fetching and the frame budget are `files.rs`.)
//!
//! Hub file from the UI freeze: `root.rs` calls the functions below once each (core events,
//! navigation, the route's content, overlays), and nothing else in the app does.

use super::AppRoot;
use gpui_kit::*;
use semaphore_core::CoreEvent;
use semaphore_core::model::{SessionState, ViewKey};
use semaphore_ui::nav::Route;

/// WM's state. Gone with the session.
#[derive(Default)]
pub struct MediaArea {
    /// Whether the server offers GIFs, from WM's own read of its public settings: a restored
    /// session never probes the server, so nothing else tells core or the app.
    gif_search: Option<bool>,
    /// That read is on its way.
    probing: bool,
}

/// Whether the GIF button shows: what the sign-in probe learnt, else WM's own read. `None`: not
/// known yet (no button).
pub(crate) fn gif_search(signed_in_probe: Option<bool>, own_read: Option<bool>) -> Option<bool> {
    signed_in_probe.or(own_read)
}

impl AppRoot {
    /// The one third-party media switch ("Load images from other sites"), from the settings tab
    /// or a message list's Load card: the settings store, the preview fetcher, core (whose views
    /// say whether GIFs may load) and the conversation pane's lists all follow it.
    ///
    /// Turning it off also drops every picture from another site already kept, so nothing is
    /// served again without a new fetch (`files::set_third_party`).
    pub(super) fn media_set_third_party(&mut self, on: bool, cx: &mut Context<Self>) {
        self.update_settings(|settings| settings.third_party_media = on);
        if let Some(media) = &self.media {
            media.set_third_party(on);
        }
        if let Some(core) = self.core() {
            core.set_third_party_media(on);
        }
        if let Some(pane) = self.pane.clone() {
            pane.update(cx, |pane, cx| pane.media_third_party(on, cx));
        }
        self.refresh_desktop_tab(cx);
        cx.refresh_windows();
    }

    /// GIF results reach the conversation pane; the session decides whether the server's GIF
    /// service is known, and the pane's composers show the GIF button when it is on.
    pub(super) fn media_on_core(&mut self, event: &CoreEvent, cx: &mut Context<Self>) {
        let CoreEvent::ViewChanged { view } = event else {
            return;
        };
        if matches!(view, ViewKey::Session) {
            self.media_session_changed(cx);
        }
        if let ViewKey::Gifs { .. } = view
            && let Some(pane) = self.pane.clone()
        {
            pane.update(cx, |pane, cx| pane.media_on_core(view, cx));
        }
        self.media_tell_pane(cx);
    }

    /// Signed in with nothing known about the GIF service: read the server's public settings once
    /// (`Core::probe_server`, which also tells core). Signed out: forget it.
    fn media_session_changed(&mut self, cx: &mut Context<Self>) {
        let Some(core) = self.core() else {
            return;
        };
        if !matches!(core.session(), SessionState::SignedIn { .. }) {
            self.media_area = MediaArea::default();
            return;
        }
        let known = self.server_info.as_ref().map(|info| info.gif_search);
        if gif_search(known, self.media_area.gif_search).is_some() || self.media_area.probing {
            return;
        }
        let Some(services) = self.services.as_ref() else {
            return;
        };
        let Some(url) = services.backend.server_url() else {
            return;
        };
        self.media_area.probing = true;
        let probe = services
            .exec
            .handle()
            .spawn(async move { core.probe_server(url).await });
        cx.spawn(async move |root, cx| {
            let answer = probe.await;
            root.update(cx, |root, cx| {
                root.media_area.probing = false;
                match answer {
                    Ok(Ok(info)) => root.media_area.gif_search = Some(info.gif_search),
                    Ok(Err(error)) => log::info!("reading the server's GIF service: {error}"),
                    Err(error) => log::info!("reading the server's GIF service: {error}"),
                }
                root.media_tell_pane(cx);
            })
            .ok();
        })
        .detach();
    }

    /// The pane's composers follow what is known about the GIF service.
    fn media_tell_pane(&mut self, cx: &mut Context<Self>) {
        let known = self.server_info.as_ref().map(|info| info.gif_search);
        let enabled = gif_search(known, self.media_area.gif_search).unwrap_or(false);
        let Some(pane) = self.pane.clone() else {
            return;
        };
        if pane.read(cx).gifs_enabled == enabled {
            return;
        }
        pane.update(cx, |pane, cx| pane.media_set_gifs_enabled(enabled, cx));
    }

    pub(super) fn media_navigated(
        &mut self,
        _route: &Route,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) {
    }

    /// The GIF picker, when a composer opened it.
    pub(super) fn media_overlays(&self, cx: &mut Context<Self>) -> Vec<AnyElement> {
        self.pane
            .clone()
            .and_then(|pane| pane.update(cx, |pane, cx| pane.media_gif_overlay(cx)))
            .into_iter()
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::prelude::rust_2024::test;

    #[test]
    fn the_sign_in_probe_wins_then_wm_s_own_read() {
        assert_eq!(gif_search(None, None), None);
        assert_eq!(gif_search(Some(true), None), Some(true));
        assert_eq!(gif_search(None, Some(true)), Some(true));
        assert_eq!(gif_search(Some(false), Some(true)), Some(false));
        assert_eq!(gif_search(Some(true), Some(false)), Some(true));
    }
}
