//! W5: moderation in the app. `ModerationMenu` (from `MembersEvent::Moderate`, the members
//! panel's `ShellEvent::MemberMenu`), one `ModerationDialog` at a time fed the op its action lives
//! on (a member's actions on `Core::moderation_target`, lifting a ban on the ban list, lifting a
//! timeout from the list on the timeout list), the voice participant menu's Kick, `ModerationTab`
//! for the settings' Moderation slot, `RemovedNotice` on `CoreEvent::CommunityRemoved` (one at a
//! time, in order, over Home: the shell has gone home already), and the timeout timers.
//!
//! - **Timers.** Core has none: when a community's channels say this user is timed out
//!   (`ChannelPermissions::timed_out_until_ms`), a GPUI timer is armed for then, by core's clock,
//!   and calls `Core::timeout_elapsed`, which reads the capabilities again. If the server still
//!   says timed out at the same time, the next try waits [`RETRY_LATE`] ([`wake_in`]).
//! - **Leaving.** Signing out drops everything here, queued notices and timers included. A
//!   removal closes the menu, dialog and tab for that community and drops its timer.

use super::AppRoot;
use super::roles::member_user;
use gpui_kit::*;
use semaphore_core::model::{RemovalCause, UserView, ViewKey};
use semaphore_core::{CoreError, CoreEvent};
use semaphore_ui::moderation::{
    ModerationDialog, ModerationDialogEvent, ModerationMenu, ModerationMenuEvent, ModerationTab,
    ModerationTabEvent, RemovedNotice, RemovedNoticeEvent,
};
use std::collections::{HashMap, VecDeque};
use std::future::Future;
use std::time::Duration;

/// A timeout the server still reports at the time it was due to end is tried again this late.
pub const RETRY_LATE: Duration = Duration::from_secs(2);

/// Where the open dialog's action is followed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Source {
    /// `Core::moderation_target(community, user)`.
    Target(String),
    /// `Core::bans(community)`.
    Bans,
    /// `Core::timeouts(community)`.
    Timeouts,
}

struct MenuOpen {
    community_id: String,
    user_id: String,
    view: Entity<ModerationMenu>,
    _events: Subscription,
}

struct DialogOpen {
    community_id: String,
    source: Source,
    view: Entity<ModerationDialog>,
    _events: Subscription,
}

struct TabOpen {
    community_id: String,
    view: Entity<ModerationTab>,
    _events: Subscription,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Removal {
    pub community_id: String,
    pub name: String,
    pub cause: RemovalCause,
}

struct Notice {
    view: Entity<RemovedNotice>,
    /// The removal on screen, until it's acknowledged.
    showing: Option<Removal>,
    _events: Subscription,
}

struct Timer {
    until_ms: i64,
    _task: Task<()>,
}

/// This session's moderation views and timers.
#[derive(Default)]
pub struct Moderation {
    menu: Option<MenuOpen>,
    dialog: Option<DialogOpen>,
    tab: Option<TabOpen>,
    notice: Option<Notice>,
    /// Removals not shown yet, oldest first; the one on screen isn't in here.
    queue: VecDeque<Removal>,
    timers: HashMap<String, Timer>,
    /// The timeout end each community's timer last fired for.
    fired: HashMap<String, i64>,
}

/// What a `ViewChanged` asks to be read again.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Feed {
    MenuTarget,
    DialogOp,
    TabCaps,
    TabBans,
    TabTimeouts,
    TabLog,
    /// Arm, move or drop this community's timeout timer.
    Timer(String),
}

/// What's open, as [`feeds`] needs it.
#[derive(Debug, Clone, Copy, Default)]
pub(crate) struct Open<'a> {
    pub menu: Option<(&'a str, &'a str)>,
    pub dialog: Option<(&'a str, &'a Source)>,
    pub tab: Option<&'a str>,
}

pub(crate) fn feeds(view: &ViewKey, open: Open) -> Vec<Feed> {
    let mut out = Vec::new();
    let tab = |c: &str| open.tab == Some(c);
    let dialog = |c: &str, source: &Source| open.dialog == Some((c, source));
    match view {
        ViewKey::ModerationTarget {
            community_id,
            user_id,
        } => {
            if open.menu == Some((community_id.as_str(), user_id.as_str())) {
                out.push(Feed::MenuTarget);
            }
            if dialog(community_id, &Source::Target(user_id.clone())) {
                out.push(Feed::DialogOp);
            }
        }
        ViewKey::Bans { community_id } => {
            if tab(community_id) {
                out.push(Feed::TabBans);
            }
            if dialog(community_id, &Source::Bans) {
                out.push(Feed::DialogOp);
            }
        }
        ViewKey::Timeouts { community_id } => {
            if tab(community_id) {
                out.push(Feed::TabTimeouts);
            }
            if dialog(community_id, &Source::Timeouts) {
                out.push(Feed::DialogOp);
            }
        }
        ViewKey::ModerationLog { community_id } => {
            if tab(community_id) {
                out.push(Feed::TabLog);
            }
        }
        ViewKey::CommunityPermissions { community_id } => {
            if open.menu.is_some_and(|(c, _)| c == community_id) {
                out.push(Feed::MenuTarget);
            }
            if tab(community_id) {
                // What the caps let the tab read changes too.
                out.extend([
                    Feed::TabCaps,
                    Feed::TabBans,
                    Feed::TabTimeouts,
                    Feed::TabLog,
                ]);
            }
        }
        ViewKey::Channels { community_id } => out.push(Feed::Timer(community_id.clone())),
        _ => {}
    }
    out
}

/// How long until a timeout ending at `until_ms` should be reported over, by core's clock at
/// `now_ms`; `None` with no timeout. One that already fired for this same end waits at least
/// [`RETRY_LATE`], so a server that disagrees isn't asked in a loop.
pub(crate) fn wake_in(now_ms: u64, until_ms: Option<i64>, fired: Option<i64>) -> Option<Duration> {
    let until = until_ms?;
    let left = u64::try_from(until).unwrap_or(0).saturating_sub(now_ms);
    let delay = Duration::from_millis(left);
    Some(if fired == Some(until) {
        delay.max(RETRY_LATE)
    } else {
        delay
    })
}

/// Removals as they're shown: one at a time, in order; the same community twice in a row (the
/// server can say it twice) shows once.
pub(crate) fn enqueue(queue: &mut VecDeque<Removal>, showing: Option<&str>, removal: Removal) {
    let last = queue
        .back()
        .map(|queued| queued.community_id.as_str())
        .or(showing);
    if last != Some(removal.community_id.as_str()) {
        queue.push_back(removal);
    }
}

impl AppRoot {
    /// Signed out: no menu, dialog, notice or timer of the last session stays.
    pub(super) fn drop_moderation(&mut self) {
        self.moderation = Moderation::default();
    }

    pub(super) fn moderation_on_core(&mut self, event: &CoreEvent, cx: &mut Context<Self>) {
        match event {
            CoreEvent::ViewChanged { view } => {
                let m = &self.moderation;
                let open = Open {
                    menu: m
                        .menu
                        .as_ref()
                        .map(|menu| (menu.community_id.as_str(), menu.user_id.as_str())),
                    dialog: m
                        .dialog
                        .as_ref()
                        .map(|dialog| (dialog.community_id.as_str(), &dialog.source)),
                    tab: m.tab.as_ref().map(|tab| tab.community_id.as_str()),
                };
                for feed in feeds(view, open) {
                    self.moderation_feed(feed, cx);
                }
            }
            CoreEvent::CommunityRemoved {
                community_id,
                name,
                cause,
            } => {
                let m = &mut self.moderation;
                if m.menu
                    .as_ref()
                    .is_some_and(|x| x.community_id == *community_id)
                {
                    m.menu = None;
                }
                if m.dialog
                    .as_ref()
                    .is_some_and(|x| x.community_id == *community_id)
                {
                    m.dialog = None;
                }
                if m.tab
                    .as_ref()
                    .is_some_and(|x| x.community_id == *community_id)
                {
                    m.tab = None;
                }
                m.timers.remove(community_id);
                m.fired.remove(community_id);
                let removal = Removal {
                    community_id: community_id.clone(),
                    name: name.clone(),
                    cause: cause.clone(),
                };
                let showing = self.showing_removal(cx);
                enqueue(&mut self.moderation.queue, showing.as_deref(), removal);
                self.show_next_removal(cx);
                cx.notify();
            }
            _ => {}
        }
    }

    fn showing_removal(&self, cx: &App) -> Option<String> {
        let notice = self.moderation.notice.as_ref()?;
        notice
            .showing
            .as_ref()
            .filter(|_| notice.view.read(cx).is_shown())
            .map(|removal| removal.community_id.clone())
    }

    /// The next queued removal, if none is on screen.
    fn show_next_removal(&mut self, cx: &mut Context<Self>) {
        if self.showing_removal(cx).is_some() {
            return;
        }
        let Some(next) = self.moderation.queue.pop_front() else {
            return;
        };
        let time = self.config.time;
        let notice = match &self.moderation.notice {
            Some(notice) => notice.view.clone(),
            None => {
                let view = cx.new(RemovedNotice::new);
                let events = cx.subscribe(&view, |this, _, event: &RemovedNoticeEvent, cx| {
                    let RemovedNoticeEvent::Acknowledged { .. } = event;
                    if let Some(notice) = &mut this.moderation.notice {
                        notice.showing = None;
                    }
                    this.show_next_removal(cx);
                    cx.notify();
                });
                self.moderation.notice = Some(Notice {
                    view: view.clone(),
                    showing: None,
                    _events: events,
                });
                view
            }
        };
        if let Some(shown) = &mut self.moderation.notice {
            shown.showing = Some(next.clone());
        }
        notice.update(cx, |notice, cx| {
            notice.set_time(time, cx);
            notice.show(next.community_id, next.name, next.cause, cx);
        });
    }

    fn moderation_feed(&mut self, feed: Feed, cx: &mut Context<Self>) {
        let Some(core) = self.core() else {
            return;
        };
        let m = &self.moderation;
        match feed {
            Feed::MenuTarget => {
                if let Some(menu) = &m.menu {
                    let target =
                        core.moderation_target(menu.community_id.clone(), menu.user_id.clone());
                    menu.view.update(cx, |v, cx| v.set_target(target, cx));
                }
            }
            Feed::DialogOp => {
                if let Some(dialog) = &m.dialog {
                    let c = dialog.community_id.clone();
                    let op = match &dialog.source {
                        Source::Target(user) => core.moderation_target(c, user.clone()).op,
                        Source::Bans => core.bans(c).op,
                        Source::Timeouts => core.timeouts(c).op,
                    };
                    dialog.view.update(cx, |v, cx| v.set_op(op, cx));
                }
            }
            Feed::TabCaps | Feed::TabBans | Feed::TabTimeouts | Feed::TabLog => {
                let Some(tab) = &m.tab else {
                    return;
                };
                let c = tab.community_id.clone();
                let caps = core.community_permissions(c.clone()).caps;
                // Only what these caps may read: a read is what fetches.
                tab.view.update(cx, |v, cx| match feed {
                    Feed::TabCaps => v.set_caps(caps, cx),
                    Feed::TabBans if caps.view_bans => v.set_bans(core.bans(c), cx),
                    Feed::TabTimeouts if caps.view_bans => v.set_timeouts(core.timeouts(c), cx),
                    Feed::TabLog if caps.view_moderation_log => {
                        v.set_log(core.moderation_log(c), cx)
                    }
                    _ => {}
                });
            }
            Feed::Timer(community_id) => {
                let until = core
                    .channels(community_id.clone())
                    .iter()
                    .find_map(|row| row.permissions.as_ref()?.timed_out_until_ms);
                self.arm_timeout(community_id, until, cx);
            }
        }
    }

    /// One timer per community for its timeout's end, by core's clock (see the module docs).
    fn arm_timeout(&mut self, community_id: String, until: Option<i64>, cx: &mut Context<Self>) {
        let m = &mut self.moderation;
        let fired = m.fired.get(&community_id).copied();
        let Some(delay) = wake_in(self.config.clock.now_ms(), until, fired) else {
            m.timers.remove(&community_id);
            m.fired.remove(&community_id);
            return;
        };
        let until = until.expect("a delay has an end");
        if m.timers
            .get(&community_id)
            .is_some_and(|timer| timer.until_ms == until)
        {
            return;
        }
        let id = community_id.clone();
        let task = cx.spawn(async move |this, cx| {
            cx.background_executor().timer(delay).await;
            this.update(cx, |this, cx| this.timeout_due(id, until, cx))
                .ok();
        });
        m.timers.insert(
            community_id,
            Timer {
                until_ms: until,
                _task: task,
            },
        );
    }

    fn timeout_due(&mut self, community_id: String, until: i64, cx: &mut Context<Self>) {
        let m = &mut self.moderation;
        // Only the timer still armed for this end.
        if m.timers.get(&community_id).map(|t| t.until_ms) != Some(until) {
            return;
        }
        m.timers.remove(&community_id);
        let now = self.config.clock.now_ms();
        if u64::try_from(until).unwrap_or(0) > now {
            // Early by core's clock: wait for the rest.
            self.arm_timeout(community_id, Some(until), cx);
            return;
        }
        self.moderation.fired.insert(community_id.clone(), until);
        if let Some(core) = self.core() {
            core.timeout_elapsed(community_id);
        }
    }

    /// The menu, the dialog and the removal notice over the shell.
    pub(super) fn moderation_overlays(&self, _cx: &mut Context<Self>) -> Vec<AnyElement> {
        let m = &self.moderation;
        let mut out = Vec::new();
        if let Some(menu) = &m.menu {
            out.push(menu.view.clone().into_any_element());
        }
        if let Some(dialog) = &m.dialog {
            out.push(dialog.view.clone().into_any_element());
        }
        if let Some(notice) = &m.notice {
            out.push(notice.view.clone().into_any_element());
        }
        out
    }

    /// The view for `CommunitySettingsScreen::set_moderation_slot`, built for this community.
    pub(super) fn moderation_slot(
        &mut self,
        community_id: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Option<AnyView> {
        self.core()?;
        if let Some(tab) = &self.moderation.tab
            && tab.community_id == community_id
        {
            return Some(tab.view.clone().into());
        }
        let view = cx.new(|cx| ModerationTab::new(window, cx));
        let time = self.config.time;
        view.update(cx, |tab, cx| tab.set_time(time, cx));
        let events = cx.subscribe_in(&view, window, Self::on_moderation_tab);
        self.moderation.tab = Some(TabOpen {
            community_id: community_id.to_owned(),
            view: view.clone(),
            _events: events,
        });
        for feed in [
            Feed::TabCaps,
            Feed::TabBans,
            Feed::TabTimeouts,
            Feed::TabLog,
        ] {
            self.moderation_feed(feed, cx);
        }
        Some(view.into())
    }

    fn on_moderation_tab(
        &mut self,
        _: &Entity<ModerationTab>,
        event: &ModerationTabEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let (Some(core), Some(c)) = (
            self.core(),
            self.moderation.tab.as_ref().map(|t| t.community_id.clone()),
        ) else {
            return;
        };
        match event.clone() {
            ModerationTabEvent::Unban { user } => {
                self.open_moderation_dialog(c, Source::Bans, user, Kind::Unban, window, cx)
            }
            ModerationTabEvent::RemoveTimeout { user } => self.open_moderation_dialog(
                c,
                Source::Timeouts,
                user,
                Kind::RemoveTimeout,
                window,
                cx,
            ),
            ModerationTabEvent::Filter(filter) => core.set_moderation_log_filter(c, filter),
            ModerationTabEvent::MoreLog => self.w5_fire("reading more of the moderation log", {
                async move { core.more_moderation_log(c).await }
            }),
            ModerationTabEvent::Retry => core.retry_failed(),
        }
    }

    /// The moderation menu for a member, at `position` (window coordinates; `None`: where the
    /// pointer is).
    pub(super) fn open_member_menu(
        &mut self,
        community_id: String,
        user_id: String,
        position: Option<Point<Pixels>>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(core) = self.core() else {
            return;
        };
        let user = member_user(&core, &community_id, &user_id);
        let position = position.unwrap_or_else(|| window.mouse_position());
        let target = core.moderation_target(community_id.clone(), user_id.clone());
        let time = self.config.time;
        let view = cx.new(|cx| {
            let mut menu = ModerationMenu::new(user, position, cx);
            menu.set_target(target, cx);
            menu.set_time(time, cx);
            menu
        });
        let events = cx.subscribe_in(&view, window, Self::on_moderation_menu);
        self.moderation.menu = Some(MenuOpen {
            community_id,
            user_id,
            view,
            _events: events,
        });
        cx.notify();
    }

    fn on_moderation_menu(
        &mut self,
        _: &Entity<ModerationMenu>,
        event: &ModerationMenuEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(c) = self
            .moderation
            .menu
            .as_ref()
            .map(|menu| menu.community_id.clone())
        else {
            return;
        };
        let target = |user: &UserView| Source::Target(user.id.clone());
        match event.clone() {
            ModerationMenuEvent::ViewProfile { user_id } => {
                self.moderation.menu = None;
                self.open_profile(user_id, window, cx);
            }
            ModerationMenuEvent::ChangeRoles { user_id } => {
                self.moderation.menu = None;
                self.open_role_assignment(c, user_id, window, cx);
            }
            ModerationMenuEvent::Kick { user } => {
                self.open_moderation_dialog(c, target(&user), user, Kind::Kick, window, cx)
            }
            ModerationMenuEvent::Timeout { user } => {
                self.open_moderation_dialog(c, target(&user), user, Kind::Timeout, window, cx)
            }
            ModerationMenuEvent::RemoveTimeout { user } => {
                self.open_moderation_dialog(c, target(&user), user, Kind::RemoveTimeout, window, cx)
            }
            ModerationMenuEvent::Ban { user } => {
                self.open_moderation_dialog(c, target(&user), user, Kind::Ban, window, cx)
            }
            ModerationMenuEvent::Close => {
                self.moderation.menu = None;
                cx.notify();
            }
        }
    }

    /// The voice participant menu's Kick: the moderation kick dialog, followed on the member's
    /// moderation target.
    pub(super) fn open_kick(
        &mut self,
        community_id: String,
        user: UserView,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let source = Source::Target(user.id.clone());
        self.open_moderation_dialog(community_id, source, user, Kind::Kick, window, cx);
    }

    fn open_moderation_dialog(
        &mut self,
        community_id: String,
        source: Source,
        user: UserView,
        kind: Kind,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.moderation.menu = None;
        let time = self.config.time;
        let view = cx.new(|cx| ModerationDialog::new(window, cx));
        view.update(cx, |dialog, cx| {
            dialog.set_time(time, cx);
            match kind {
                Kind::Ban => dialog.open_ban(user, window, cx),
                Kind::Kick => dialog.open_kick(user, window, cx),
                Kind::Timeout => dialog.open_timeout(user, window, cx),
                Kind::Unban => dialog.open_unban(user, window, cx),
                Kind::RemoveTimeout => dialog.open_remove_timeout(user, window, cx),
            }
        });
        let events = cx.subscribe_in(&view, window, Self::on_moderation_dialog);
        self.moderation.dialog = Some(DialogOpen {
            community_id,
            source,
            view,
            _events: events,
        });
        self.moderation_feed(Feed::DialogOp, cx);
        cx.notify();
    }

    fn on_moderation_dialog(
        &mut self,
        dialog: &Entity<ModerationDialog>,
        event: &ModerationDialogEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let (Some(core), Some(services), Some(open)) = (
            self.core(),
            self.services.as_ref(),
            self.moderation.dialog.as_ref(),
        ) else {
            return;
        };
        if open.view != *dialog {
            return;
        }
        let c = open.community_id.clone();
        let work: std::pin::Pin<Box<dyn Future<Output = Result<(), CoreError>> + Send>> =
            match event.clone() {
                ModerationDialogEvent::Ban { user_id, request } => {
                    Box::pin(async move { core.ban_member(c, user_id, request).await })
                }
                ModerationDialogEvent::Kick { user_id, reason } => {
                    Box::pin(async move { core.kick_member(c, user_id, reason).await })
                }
                ModerationDialogEvent::Timeout { user_id, request } => {
                    Box::pin(async move { core.timeout_member(c, user_id, request).await })
                }
                ModerationDialogEvent::Unban { user_id, reason } => {
                    Box::pin(async move { core.unban_member(c, user_id, reason).await })
                }
                ModerationDialogEvent::RemoveTimeout { user_id, reason } => {
                    Box::pin(async move { core.remove_timeout(c, user_id, reason).await })
                }
                ModerationDialogEvent::Cancel | ModerationDialogEvent::Succeeded { .. } => {
                    self.moderation.dialog = None;
                    cx.notify();
                    return;
                }
            };
        // The dialog follows its action's entry in the op for a refusal, which stays there. A
        // success removes the entry, and when the start and the end reach the app in one batch
        // the dialog never sees it running, so the answer itself closes it too.
        let sent = dialog.downgrade();
        services
            .exec
            .run(window, cx, work, move |this, result, _, cx| {
                let ours = this
                    .moderation
                    .dialog
                    .as_ref()
                    .is_some_and(|open| open.view.downgrade() == sent);
                match result {
                    Ok(()) if ours => {
                        this.moderation.dialog = None;
                        cx.notify();
                    }
                    Ok(()) => {}
                    Err(error) => log::warn!("moderating: {error}"),
                }
            });
    }

    /// Whether a moderation dialog is open, and of which kind, for the rig.
    pub fn moderation_dialog_open(&self, cx: &App) -> bool {
        self.moderation
            .dialog
            .as_ref()
            .is_some_and(|dialog| dialog.view.read(cx).is_open())
    }

    /// The removal notice on screen, for the rig: its community and `banned`, `kicked` or
    /// `deleted`.
    pub fn removed_notice(&self, cx: &App) -> Option<(String, &'static str)> {
        let notice = self.moderation.notice.as_ref()?;
        let removal = notice.showing.as_ref()?;
        notice.view.read(cx).is_shown().then(|| {
            let cause = match removal.cause {
                RemovalCause::Banned { .. } => "banned",
                RemovalCause::Kicked { .. } => "kicked",
                RemovalCause::Deleted => "deleted",
            };
            (removal.community_id.clone(), cause)
        })
    }
}

#[derive(Debug, Clone, Copy)]
enum Kind {
    Ban,
    Kick,
    Timeout,
    Unban,
    RemoveTimeout,
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn feeds_follow_what_is_open() {
        let target = Source::Target("u1".into());
        let all = Open {
            menu: Some(("c1", "u1")),
            dialog: Some(("c1", &target)),
            tab: Some("c1"),
        };
        let bans_dialog = Open {
            dialog: Some(("c1", &Source::Bans)),
            ..Open::default()
        };
        let timeouts_dialog = Open {
            dialog: Some(("c1", &Source::Timeouts)),
            ..Open::default()
        };
        let mt = |c: &str, u: &str| ViewKey::ModerationTarget {
            community_id: c.into(),
            user_id: u.into(),
        };
        let bans = |c: &str| ViewKey::Bans {
            community_id: c.into(),
        };
        let timeouts = |c: &str| ViewKey::Timeouts {
            community_id: c.into(),
        };
        let log = |c: &str| ViewKey::ModerationLog {
            community_id: c.into(),
        };
        let perms = |c: &str| ViewKey::CommunityPermissions {
            community_id: c.into(),
        };
        let cases: Vec<(ViewKey, Open, Vec<Feed>)> = vec![
            (mt("c1", "u1"), Open::default(), vec![]),
            (mt("c1", "u1"), all, vec![Feed::MenuTarget, Feed::DialogOp]),
            (mt("c1", "u2"), all, vec![]),
            (mt("c2", "u1"), all, vec![]),
            (mt("c1", "u1"), bans_dialog, vec![]),
            (bans("c1"), all, vec![Feed::TabBans]),
            (bans("c1"), bans_dialog, vec![Feed::DialogOp]),
            (bans("c2"), bans_dialog, vec![]),
            (bans("c1"), timeouts_dialog, vec![]),
            (timeouts("c1"), all, vec![Feed::TabTimeouts]),
            (timeouts("c1"), timeouts_dialog, vec![Feed::DialogOp]),
            (timeouts("c1"), bans_dialog, vec![]),
            (log("c1"), all, vec![Feed::TabLog]),
            (log("c2"), all, vec![]),
            (log("c1"), Open::default(), vec![]),
            (
                perms("c1"),
                all,
                vec![
                    Feed::MenuTarget,
                    Feed::TabCaps,
                    Feed::TabBans,
                    Feed::TabTimeouts,
                    Feed::TabLog,
                ],
            ),
            (perms("c2"), all, vec![]),
            // Every community's channels may carry a timeout, open or not.
            (
                ViewKey::Channels {
                    community_id: "c9".into(),
                },
                Open::default(),
                vec![Feed::Timer("c9".into())],
            ),
            (ViewKey::Session, all, vec![]),
            (ViewKey::Communities, all, vec![]),
        ];
        for (view, open, want) in cases {
            assert_eq!(feeds(&view, open), want, "{view:?} with {open:?}");
        }
    }

    #[test]
    fn wake_in_counts_by_core_clock_and_backs_off_a_disagreeing_server() {
        type Case = (u64, Option<i64>, Option<i64>, Option<Duration>);
        let ms = Duration::from_millis;
        let cases: Vec<Case> = vec![
            (1_000, None, None, None),
            (1_000, None, Some(500), None),
            (1_000, Some(61_000), None, Some(ms(60_000))),
            (1_000, Some(1_000), None, Some(ms(0))),
            (1_000, Some(10), None, Some(ms(0))),
            // A negative end (a bad clock on the server) is already over.
            (1_000, Some(-5), None, Some(ms(0))),
            // Fired for this end already: not before RETRY_LATE.
            (1_000, Some(1_000), Some(1_000), Some(RETRY_LATE)),
            (1_000, Some(500), Some(500), Some(RETRY_LATE)),
            // ...but a later end than the retry waits for itself.
            (1_000, Some(10_000), Some(10_000), Some(ms(9_000))),
            // A new end after firing for an old one counts normally.
            (1_000, Some(1_500), Some(1_000), Some(ms(500))),
            (0, Some(i64::MAX), None, Some(ms(i64::MAX as u64))),
            (u64::MAX, Some(5), None, Some(ms(0))),
        ];
        for (now, until, fired, want) in cases {
            assert_eq!(
                wake_in(now, until, fired),
                want,
                "{now} {until:?} {fired:?}"
            );
        }
    }

    fn removal(community_id: &str) -> Removal {
        Removal {
            community_id: community_id.into(),
            name: format!("{community_id} name"),
            cause: RemovalCause::Deleted,
        }
    }

    #[test]
    fn removals_queue_in_order_and_a_repeat_shows_once() {
        let order = |queue: &VecDeque<Removal>| -> Vec<String> {
            queue.iter().map(|r| r.community_id.clone()).collect()
        };
        // (showing, pushed in order, queued after)
        let cases: Vec<(Option<&str>, Vec<&str>, Vec<&str>)> = vec![
            (None, vec![], vec![]),
            (None, vec!["a"], vec!["a"]),
            (None, vec!["a", "b"], vec!["a", "b"]),
            (None, vec!["a", "a"], vec!["a"]),
            (None, vec!["a", "b", "a"], vec!["a", "b", "a"]),
            (Some("a"), vec!["a"], vec![]),
            (Some("a"), vec!["b"], vec!["b"]),
            (Some("a"), vec!["b", "b", "a"], vec!["b", "a"]),
        ];
        for (showing, pushed, want) in cases {
            let mut queue = VecDeque::new();
            for id in &pushed {
                enqueue(&mut queue, showing, removal(id));
            }
            assert_eq!(order(&queue), want, "{showing:?} {pushed:?}");
        }
    }
}
