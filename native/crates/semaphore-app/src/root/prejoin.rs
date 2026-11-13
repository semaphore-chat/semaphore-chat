//! WP: a voice channel's pre-join in the app: a voice channel you aren't in shows `PreJoinPanel`
//! (fed from `Core::voice_prejoin`, its Join running `Core::join_voice_with`) instead of the plain
//! "Join voice" button. (Seen-by's half is `conversation/seen.rs`.)
//!
//! Hub file from the UI freeze: `root.rs` calls the functions below once each (core events,
//! navigation, the route's content, overlays, and the not-joined voice channel's content below), and nothing else in the app does; WP
//! fills them. Copy the shape of `root/community.rs` (W5-app): one state struct here, feeds that
//! read core when they run, continuations that hold a ticket.
//!
//! - **Choosing a voice channel never joins it.** Every way there (a sidebar row, a deep link, the
//!   keyboard, Home's voice section) is a navigation to `Route::Channel`; `prejoin_navigated` builds
//!   the panel for it once core knows the channel is a voice one. The sidebar row's `JoinVoice` is
//!   ignored in `root.rs`, as the web's row only selects the channel.
//! - **The call you're in shows the stage**, as before: `root.rs` checks that before asking here.
//! - **Feeds**: the panel reads `Core::voice_prejoin` on navigation and on `ViewChanged { Voice }`
//!   (presence, my mute) and `ViewChanged { Channels }` of its community (names, capabilities).
//! - **A failed join** resets core's voice to nothing, so the bar and stage go and the panel shows
//!   again; a snackbar at the top says why (the voice bar is at the bottom, so it never covers it).
//! - **No float card over it**: in a call elsewhere, the card would sit on the joins ("joining
//!   moves you here"); the bar still shows the call (`prejoin_shows`, read by `root.rs`).

use super::AppRoot;
use super::replay::TOAST_FOR;
use gpui_kit::*;
use semaphore_core::CoreEvent;
use semaphore_core::model::{ChannelKind, ChannelRow, ViewKey, VoiceStatus};
use semaphore_core::platform::CoreError;
use semaphore_ui::kit::{Snackbar, Variant, text};
use semaphore_ui::messages::MediaSource;
use semaphore_ui::nav::Route;
use semaphore_ui::theme::SemTheme;
use semaphore_ui::voice::prejoin::{PreJoinEvent, PreJoinPanel};
use std::rc::Rc;

/// WP's state: what it has on screen. Gone with the session.
#[derive(Default)]
pub struct PreJoinArea {
    /// The panel for the voice channel the route shows.
    shown: Option<Shown>,
    /// A channel route whose channel core doesn't know yet, or whose panel waits for a window:
    /// its community and channel.
    pending: Option<(String, String)>,
    /// Why the last join failed, until its timer runs out.
    notice: Option<Notice>,
    /// Counts the joins pressed here: only the latest one's failure is shown.
    joins: u64,
}

struct Shown {
    community_id: String,
    channel_id: String,
    panel: Entity<PreJoinPanel>,
    _subscription: Subscription,
}

struct Notice {
    message: String,
    _timer: Task<()>,
}

/// What core says when the user left (or moved on) while the join ran: nobody's failure.
fn was_left(error: &CoreError) -> bool {
    matches!(error, CoreError::Failed { message } if message == "the call was left while joining")
}

impl AppRoot {
    pub(super) fn prejoin_on_core(&mut self, event: &CoreEvent, cx: &mut Context<Self>) {
        let CoreEvent::ViewChanged { view } = event else {
            return;
        };
        match view {
            ViewKey::Voice => self.prejoin_feed(cx),
            ViewKey::Channels { community_id } => {
                if self
                    .prejoin
                    .pending
                    .as_ref()
                    .is_some_and(|(community, _)| community == community_id)
                {
                    self.prejoin_build_later(cx);
                }
                if self
                    .prejoin
                    .shown
                    .as_ref()
                    .is_some_and(|shown| shown.community_id == *community_id)
                {
                    self.prejoin_feed(cx);
                }
            }
            _ => {}
        }
    }

    pub(super) fn prejoin_navigated(
        &mut self,
        route: &Route,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        match route {
            Route::Channel {
                community_id,
                channel_id,
            } => {
                self.prejoin.pending = Some((community_id.clone(), channel_id.clone()));
                self.prejoin_build(window, cx);
            }
            _ => {
                self.prejoin.pending = None;
                self.prejoin.shown = None;
            }
        }
    }

    pub(super) fn prejoin_overlays(&self, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let Some(notice) = &self.prejoin.notice else {
            return Vec::new();
        };
        let _ = cx;
        // At the top: the voice bar runs along the window's bottom edge.
        vec![
            div()
                .absolute()
                .left_0()
                .right_0()
                .top(px(72.))
                .px(px(16.))
                .flex()
                .justify_center()
                .child(
                    div()
                        .id("voice-join-failed")
                        .test_support()
                        .role(Role::Status)
                        .aria_label(SharedString::from(notice.message.clone()))
                        .child(Snackbar::new(notice.message.clone())),
                )
                .into_any_element(),
        ]
    }

    /// The content for a voice channel this user isn't in; `None` keeps the plain "Join voice".
    pub(super) fn prejoin_voice_channel(
        &self,
        channel: &ChannelRow,
        cx: &App,
    ) -> Option<AnyElement> {
        if let Some(shown) = &self.prejoin.shown
            && shown.channel_id == channel.id
        {
            return Some(shown.panel.clone().into_any_element());
        }
        // Known to be a voice channel now, its panel built after this frame: the main area's
        // neutral "Loading" until then, so the old button never flashes.
        if self
            .prejoin
            .pending
            .as_ref()
            .is_some_and(|(_, id)| *id == channel.id)
        {
            let sem = cx.sem();
            return Some(
                div()
                    .id("voice-prejoin-pending")
                    .size_full()
                    .flex()
                    .flex_col()
                    .items_center()
                    .justify_center()
                    .gap(px(8.))
                    .text_color(sem.text_secondary)
                    .child(text(Variant::H5, "Loading"))
                    .into_any_element(),
            );
        }
        None
    }

    /// Whether the main area shows (or is about to show) this channel's pre-join: `root.rs`
    /// keeps the call's float card off it.
    pub(super) fn prejoin_shows(&self, channel_id: &str) -> bool {
        self.prejoin
            .shown
            .as_ref()
            .is_some_and(|shown| shown.channel_id == channel_id)
            || self
                .prejoin
                .pending
                .as_ref()
                .is_some_and(|(_, id)| id == channel_id)
    }

    /// The failed join's notice, for the rig.
    pub fn prejoin_notice(&self) -> Option<&str> {
        self.prejoin
            .notice
            .as_ref()
            .map(|notice| notice.message.as_str())
    }

    /// The pending route's panel, if core knows its channel: built for a voice channel, given up
    /// for any other kind.
    fn prejoin_build(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let (Some(core), Some((community_id, channel_id))) =
            (self.core(), self.prejoin.pending.clone())
        else {
            return;
        };
        let Some(channel) = core
            .channels(community_id.clone())
            .into_iter()
            .find(|channel| channel.id == channel_id)
        else {
            // Not loaded yet: `ViewChanged { Channels }` builds it.
            self.prejoin.shown = None;
            return;
        };
        self.prejoin.pending = None;
        if channel.kind != ChannelKind::Voice {
            self.prejoin.shown = None;
            return;
        }
        if self
            .prejoin
            .shown
            .as_ref()
            .is_none_or(|shown| shown.channel_id != channel_id)
        {
            let time = self.config.time;
            let media = self.media.clone();
            let panel = cx.new(|cx| {
                let mut panel = PreJoinPanel::new(window, cx);
                panel.set_time(time, cx);
                if let Some(media) = media {
                    panel.set_media(media as Rc<dyn MediaSource>, cx);
                }
                panel
            });
            let subscription = cx.subscribe_in(&panel, window, Self::on_prejoin_event);
            self.prejoin.shown = Some(Shown {
                community_id,
                channel_id,
                panel,
                _subscription: subscription,
            });
        }
        self.prejoin_feed(cx);
        cx.notify();
    }

    /// `prejoin_build` with a window, after the event being handled.
    fn prejoin_build_later(&self, cx: &mut Context<Self>) {
        let (handle, root) = (self.window, cx.entity().downgrade());
        cx.defer(move |cx| {
            handle
                .update(cx, |_, window, cx| {
                    root.update(cx, |root, cx| root.prejoin_build(window, cx))
                        .ok();
                })
                .ok();
        });
    }

    fn prejoin_feed(&mut self, cx: &mut Context<Self>) {
        let (Some(core), Some(shown)) = (self.core(), &self.prejoin.shown) else {
            return;
        };
        // In this channel's call the stage shows, not the panel: no reads on every voice change.
        if core.voice().channel_id.as_deref() == Some(shown.channel_id.as_str()) {
            return;
        }
        let view = core.voice_prejoin(shown.community_id.clone(), shown.channel_id.clone());
        shown.panel.update(cx, |panel, cx| panel.set_view(view, cx));
    }

    fn on_prejoin_event(
        &mut self,
        _: &Entity<PreJoinPanel>,
        event: &PreJoinEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        match event {
            PreJoinEvent::Join(options) => self.prejoin_join(*options, window, cx),
            PreJoinEvent::Retry => {
                if let Some(core) = self.core() {
                    core.retry_failed();
                }
                self.prejoin_feed(cx);
            }
            PreJoinEvent::OpenProfile { user_id } => self.open_profile(user_id.clone(), window, cx),
        }
    }

    fn prejoin_join(
        &mut self,
        options: semaphore_core::model::VoiceJoinOptions,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let (Some(services), Some(shown)) = (&self.services, &self.prejoin.shown) else {
            return;
        };
        let (core, exec) = (services.core.clone(), services.exec.clone());
        let (community_id, channel_id) = (shown.community_id.clone(), shown.channel_id.clone());
        if let Some(channel) = core
            .channels(community_id)
            .into_iter()
            .find(|channel| channel.id == channel_id)
        {
            self.voice_channel_name = channel.name;
        }
        self.prepare_join();
        self.prejoin.notice = None;
        self.prejoin.joins += 1;
        let join = self.prejoin.joins;
        let joining = core.clone();
        exec.run(
            window,
            cx,
            async move { joining.join_voice_with(channel_id, options).await },
            move |this, result, _, cx| {
                let Err(error) = result else {
                    return;
                };
                log::warn!("joining voice: {error}");
                // Another join since, a leave, or a call that's up anyway: not this one's to say.
                let idle = this
                    .core()
                    .is_none_or(|core| core.voice().status == VoiceStatus::Disconnected);
                if this.prejoin.joins != join || was_left(&error) || !idle {
                    return;
                }
                this.prejoin_fail(format!("Couldn't join voice: {error}"), cx);
            },
        );
        cx.notify();
    }

    fn prejoin_fail(&mut self, message: String, cx: &mut Context<Self>) {
        let timer = cx.spawn(async move |this, cx| {
            cx.background_executor().timer(TOAST_FOR).await;
            this.update(cx, |root, cx| {
                root.prejoin.notice = None;
                cx.notify();
            })
            .ok();
        });
        self.prejoin.notice = Some(Notice {
            message,
            _timer: timer,
        });
        cx.notify();
    }
}
