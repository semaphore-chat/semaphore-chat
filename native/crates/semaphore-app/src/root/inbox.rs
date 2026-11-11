//! W2's wiring: DMs, friends, the notification centre, the channel level menu, notification
//! settings, OS notifications and their sounds, the tray's count, deep links and idle.
//!
//! - **Routes.** `Route::DirectMessages` and `Route::DirectMessage` get the `DmSidebar` in the
//!   shell's route sidebar slot; a DM opens in the same `ConversationPane` as a channel, under a
//!   `DmHeader` (with search; pins and custom emoji are channel things, and the pane offers neither
//!   without a community). On a phone the slot draws the open DM, since the shell only shows its
//!   content for a channel.
//! - **The centre** is the shell's side panel while open: it closes the pane's pins, search or
//!   thread first, and the pane's next panel closes it.
//! - **OS notifications.** `CoreEvent::Notify` goes to the [`Notifier`](semaphore_core::platform)
//!   with its sound, and its link is kept by tag; a click (`open_notification`) marks it read on
//!   the server and opens that link. `WithdrawNotifications` takes it down.
//! - **Deep links** route at once, or after sign-in when they arrive before it.
//! - **Idle** (`Core::set_idle`): 5 minutes with no input, or the window hidden, as the web does.

use super::AppRoot;
use crate::conversation::ConversationPane;
use crate::sounds::Sounds;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::CoreEvent;
use semaphore_core::cache::keys;
use semaphore_core::model::{
    Conversation, ErrorView, LoadState, MessageLink, NotifySound, OsNotification, SessionState,
    ViewKey,
};
use semaphore_core::platform::{CoreError, Tray as _};
use semaphore_ui::dms::{
    CreateDmDialog, CreateDmEvent, DmHeader, DmHeaderEvent, DmHeaderState, DmListEvent, DmSidebar,
    DmSidebarEvent, DmTab, SEARCH_LIMIT,
};
use semaphore_ui::friends::{
    AddFriendDialog, AddFriendDialogEvent, AddFriendEvent, AddOutcome, FriendsEvent,
};
use semaphore_ui::kit::{Button, Dialog};
use semaphore_ui::nav::{DeepLink, Route};
use semaphore_ui::notifications::{
    ChannelNotifyEvent, ChannelNotifyMenu, NotificationCenter, NotificationEvent,
    NotificationSettingsSection, SettingsEvent,
};
use semaphore_ui::shell::{RouteSidebarProps, RouteSidebarSlot};
use std::cell::Cell;
use std::collections::HashMap;
use std::rc::Rc;
use std::time::{Duration, Instant};

/// No input for this long is idle, as the web's `useIdleDetection`.
pub const IDLE_AFTER: Duration = Duration::from_secs(5 * 60);
/// How often idle is looked at between inputs.
const IDLE_CHECK_EVERY: Duration = Duration::from_secs(30);

/// What "Send Test Notification" shows, in the web's words.
const TEST_TITLE: &str = "Test Notification";
const TEST_BODY: &str = "This is a test notification from Semaphore Chat";

/// An OS notification core raised, kept by its tag for a click.
#[derive(Debug, Clone)]
pub struct Raised {
    pub id: String,
    pub link: MessageLink,
    pub parent_message_id: Option<String>,
}

#[derive(Default)]
pub(super) struct Inbox {
    sidebar: Option<Entity<DmSidebar>>,
    header: Option<Entity<DmHeader>>,
    /// The header's back arrow, as last set: set only on a change, since it's set while drawing.
    header_back: Cell<Option<bool>>,
    centre: Option<Entity<NotificationCenter>>,
    centre_open: bool,
    loading_more: bool,
    level: Option<Entity<ChannelNotifyMenu>>,
    level_channel: Option<String>,
    settings: Option<Entity<NotificationSettingsSection>>,
    create_dm: Option<Entity<CreateDmDialog>>,
    add_friend: Option<Entity<AddFriendDialog>>,
    raised: HashMap<String, Raised>,
    pending_link: Option<DeepLink>,
    sounds: Option<Sounds>,
    /// Focus the composer when the DM is next drawn: it was just navigated to.
    focus_dm: Rc<Cell<bool>>,
    last_input: Rc<Cell<Option<Instant>>>,
    idle: bool,
    subscriptions: Vec<Subscription>,
}

/// The header for a DM: its row once the list has it, unavailable once the list says it isn't
/// there, loading meanwhile.
fn header_state(core: &semaphore_core::Core, dm_id: &str) -> DmHeaderState {
    match core.dm(dm_id.to_owned()) {
        Some(row) => DmHeaderState::Ready(row),
        None => match core.dm_list().state {
            LoadState::Loading => DmHeaderState::Loading,
            LoadState::Ready | LoadState::Failed { .. } => DmHeaderState::Unavailable,
        },
    }
}

fn error_view(error: &CoreError) -> ErrorView {
    ErrorView {
        code: String::new(),
        message: match error {
            CoreError::Failed { message } => message.clone(),
            CoreError::Unavailable { what } => what.clone(),
        },
        retryable: false,
        retry_after_ms: None,
    }
}

/// A DM in the middle column: its header over the conversation pane.
pub(super) fn dm_conversation(
    root: &Entity<AppRoot>,
    dm_id: &str,
    phone: bool,
    window: &mut Window,
    cx: &mut App,
) -> Option<AnyElement> {
    let (pane, header, focus, back_changed) = {
        let root = root.read(cx);
        let header = root.inbox.header.clone()?;
        let back_changed = root.inbox.header_back.get() != Some(phone);
        root.inbox.header_back.set(Some(phone));
        (
            root.pane.clone()?,
            header,
            root.inbox.focus_dm.clone(),
            back_changed,
        )
    };
    if back_changed {
        header.update(cx, |header, cx| header.set_back(phone, cx));
    }
    let conversation = Conversation::DirectMessage {
        id: dm_id.to_owned(),
    };
    pane.update(cx, |pane, cx| {
        pane.show(conversation, None, None, window, cx);
        if focus.take() {
            pane.focus_composer(window, cx);
        }
    });
    Some(
        div()
            .id("dm-conversation")
            .size_full()
            .flex()
            .flex_col()
            .child(header)
            .child(div().flex_1().min_h_0().child(pane))
            .into_any_element(),
    )
}

impl AppRoot {
    /// Once services are up: the sounds and the idle clock.
    pub(super) fn start_inbox(
        &mut self,
        audio: std::sync::Arc<dyn semaphore_media_livekit::audio::AudioIo>,
        cx: &mut Context<Self>,
    ) {
        self.inbox.sounds = Some(Sounds::start(audio));
        self.inbox
            .last_input
            .set(Some(cx.background_executor().now()));
        cx.spawn(async move |this, cx| {
            loop {
                cx.background_executor().timer(IDLE_CHECK_EVERY).await;
                if this.update(cx, |root, cx| root.check_idle(cx)).is_err() {
                    return;
                }
            }
        })
        .detach();
    }

    /// Some input arrived: not idle any more.
    pub(super) fn input_seen(&mut self, cx: &mut Context<Self>) {
        self.inbox
            .last_input
            .set(Some(cx.background_executor().now()));
        if self.inbox.idle {
            self.check_idle(cx);
        }
    }

    /// Tells core whether the user is idle, when that changed.
    pub fn check_idle(&mut self, cx: &App) {
        let Some(core) = self.core() else {
            return;
        };
        let now = cx.background_executor().now();
        let hidden = cx
            .try_global::<crate::desktop::DesktopShell>()
            .is_some_and(|shell| shell.is_hidden());
        let quiet = self
            .inbox
            .last_input
            .get()
            .is_some_and(|last| now.saturating_duration_since(last) >= IDLE_AFTER);
        let idle = hidden || quiet;
        if idle != self.inbox.idle {
            self.inbox.idle = idle;
            core.set_idle(idle);
        }
    }

    /// Whether core was last told the user is idle.
    pub fn is_idle(&self) -> bool {
        self.inbox.idle
    }

    /// The views W2 adds to the shell, and the route sidebar slot that shows them.
    pub(super) fn build_inbox(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> RouteSidebarSlot {
        let sidebar = cx.new(DmSidebar::new);
        let header = cx.new(|cx| {
            let mut header = DmHeader::new(cx);
            header.set_search(true, cx);
            header
        });
        let centre = cx.new(NotificationCenter::new);
        let level = cx.new(ChannelNotifyMenu::new);
        self.inbox.subscriptions = vec![
            cx.subscribe_in(&sidebar, window, Self::on_dm_sidebar),
            cx.subscribe_in(&header, window, Self::on_dm_header),
            cx.subscribe_in(&centre, window, Self::on_centre),
            cx.subscribe_in(&level, window, Self::on_level),
        ];
        self.inbox.sidebar = Some(sidebar);
        self.inbox.header = Some(header);
        self.inbox.centre = Some(centre);
        self.inbox.level = Some(level);
        self.inbox.header_back.set(None);
        self.inbox.centre_open = false;
        self.refresh_dms(cx);
        self.refresh_friends(cx);
        self.refresh_level_default(cx);

        let root = cx.entity().downgrade();
        Rc::new(
            move |props: &RouteSidebarProps, window: &mut Window, cx: &mut App| {
                let root = root.upgrade()?;
                match &props.route {
                    Route::DirectMessage { dm_group_id } if props.phone => {
                        dm_conversation(&root, dm_group_id, true, window, cx)
                    }
                    Route::DirectMessages | Route::DirectMessage { .. } => root
                        .read(cx)
                        .inbox
                        .sidebar
                        .clone()
                        .map(|sidebar| sidebar.into_any_element()),
                    _ => None,
                }
            },
        )
    }

    /// The level menu, for the shell's header once its channel's level is known.
    fn level_menu(&self) -> Option<AnyView> {
        self.inbox.level.clone().map(Into::into)
    }

    /// Signed out: the views go with the shell; links and raised notifications stay.
    pub(super) fn drop_inbox(&mut self) {
        let Inbox {
            raised,
            pending_link,
            sounds,
            focus_dm,
            last_input,
            idle,
            ..
        } = std::mem::take(&mut self.inbox);
        self.inbox = Inbox {
            raised,
            pending_link,
            sounds,
            focus_dm,
            last_input,
            idle,
            ..Inbox::default()
        };
    }

    // ---- Core's events. ----

    pub(super) fn inbox_on_core(&mut self, event: &CoreEvent, cx: &mut Context<Self>) {
        match event {
            CoreEvent::ViewChanged {
                view: ViewKey::DirectMessages,
            } => self.refresh_dms(cx),
            CoreEvent::ViewChanged {
                view: ViewKey::Friends,
            } => self.refresh_friends(cx),
            CoreEvent::ViewChanged {
                view: ViewKey::Notifications,
            } => self.refresh_centre(cx),
            CoreEvent::ViewChanged {
                view: ViewKey::NotificationSettings,
            } => {
                self.refresh_level_default(cx);
                self.refresh_settings(cx);
            }
            CoreEvent::ViewChanged {
                view: ViewKey::ChannelNotifyLevel { channel_id },
            } if self.inbox.level_channel.as_ref() == Some(channel_id) => self.refresh_level(cx),
            CoreEvent::ViewChanged {
                view: ViewKey::Badge,
            } => self.refresh_badge(cx),
            CoreEvent::Notify { notification } => self.raise(notification),
            CoreEvent::WithdrawNotifications { tag } => {
                self.inbox.raised.remove(tag);
                if let Some(notifier) = &self.config.notifier {
                    notifier.withdraw(tag);
                }
            }
            _ => {}
        }
    }

    fn raise(&mut self, notification: &OsNotification) {
        self.inbox.raised.insert(
            notification.tag.clone(),
            Raised {
                id: notification.id.clone(),
                link: notification.link.clone(),
                parent_message_id: notification.parent_message_id.clone(),
            },
        );
        if let Some(sound) = notification.sound {
            self.play(sound);
        }
        if let Some(notifier) = &self.config.notifier
            && let Err(error) = notifier.show(notification.clone())
        {
            log::info!("notification not shown: {error}");
        }
    }

    fn play(&self, sound: NotifySound) {
        if let Some(sounds) = &self.inbox.sounds {
            sounds.play(sound, self.settings.get().voice.output_device.clone());
        }
    }

    /// The raised notifications, by tag, for the rig.
    pub fn raised(&self) -> &HashMap<String, Raised> {
        &self.inbox.raised
    }

    fn refresh_dms(&mut self, cx: &mut Context<Self>) {
        let (Some(core), Some(sidebar)) = (self.core(), self.inbox.sidebar.clone()) else {
            return;
        };
        let list = core.dm_list();
        let list_view = sidebar.read(cx).list().clone();
        list_view.update(cx, |view, cx| view.set_list(list, cx));
        if let (Some(header), Some(Route::DirectMessage { dm_group_id })) =
            (self.inbox.header.clone(), self.route(cx))
        {
            let state = header_state(&core, &dm_group_id);
            header.update(cx, |header, cx| header.set_state(state, cx));
        }
    }

    fn refresh_friends(&mut self, cx: &mut Context<Self>) {
        let (Some(core), Some(sidebar)) = (self.core(), self.inbox.sidebar.clone()) else {
            return;
        };
        let view = core.friends();
        if let Some(dialog) = &self.inbox.add_friend {
            let form = dialog.read(cx).form().clone();
            form.update(cx, |form, cx| form.set_friends(&view, cx));
        }
        let panel = sidebar.read(cx).friends().clone();
        panel.update(cx, |panel, cx| panel.set_view(view, cx));
    }

    fn refresh_centre(&mut self, cx: &mut Context<Self>) {
        let (Some(core), Some(centre)) = (self.core(), self.inbox.centre.clone()) else {
            return;
        };
        if !self.inbox.centre_open {
            return;
        }
        let list = core.notifications();
        let loading_more = self.inbox.loading_more;
        centre.update(cx, |centre, cx| centre.set_list(list, loading_more, cx));
    }

    fn refresh_level(&mut self, cx: &mut Context<Self>) {
        let (Some(core), Some(level), Some(channel_id)) = (
            self.core(),
            self.inbox.level.clone(),
            self.inbox.level_channel.clone(),
        ) else {
            return;
        };
        let view = core.channel_notify_level(channel_id);
        // Until the level is known the shell's own @ button stands in, which looks the same as the
        // menu's for the default level, rather than the menu's spinner.
        let loaded = !matches!(view.state, LoadState::Loading);
        level.update(cx, |level, cx| level.set_view(view, cx));
        let accessory = self.level_menu().filter(|_| loaded);
        if let Some(shell) = self.shell.clone() {
            shell.update(cx, |shell, cx| shell.set_header_accessory(accessory, cx));
        }
    }

    fn refresh_level_default(&mut self, cx: &mut Context<Self>) {
        let (Some(core), Some(level)) = (self.core(), self.inbox.level.clone()) else {
            return;
        };
        let default = core.notification_settings().settings.default_level;
        level.update(cx, |level, cx| level.set_default(default, cx));
    }

    fn refresh_settings(&mut self, cx: &mut Context<Self>) {
        let (Some(core), Some(section)) = (self.core(), self.inbox.settings.clone()) else {
            return;
        };
        let view = core.notification_settings();
        let _ = self.window.update(cx, |_, window, cx| {
            section.update(cx, |section, cx| section.set_view(view, window, cx));
        });
    }

    fn refresh_badge(&mut self, cx: &mut Context<Self>) {
        let Some(core) = self.core() else {
            return;
        };
        let count = core.badge_count();
        if let Some(tray) = cx
            .try_global::<crate::desktop::DesktopShell>()
            .and_then(|shell| shell.tray())
        {
            let _ = tray.set_unread(count);
        }
    }

    fn route(&self, cx: &App) -> Option<Route> {
        self.shell
            .as_ref()
            .map(|shell| shell.read(cx).nav().current().clone())
    }

    fn navigate(&mut self, route: Route, cx: &mut Context<Self>) {
        if let Some(shell) = self.shell.clone() {
            shell.update(cx, |shell, cx| shell.navigate(route, cx));
        }
    }

    /// The shell went somewhere: the DM header and list's selection, and the level menu's channel.
    pub(super) fn inbox_navigated(&mut self, route: &Route, cx: &mut Context<Self>) {
        let Some(core) = self.core() else {
            return;
        };
        let selected = match route {
            Route::DirectMessage { dm_group_id } => {
                self.inbox.focus_dm.set(true);
                if let Some(header) = self.inbox.header.clone() {
                    let state = header_state(&core, dm_group_id);
                    header.update(cx, |header, cx| header.set_state(state, cx));
                }
                Some(dm_group_id.clone())
            }
            _ => None,
        };
        if let Some(sidebar) = self.inbox.sidebar.clone() {
            let list = sidebar.read(cx).list().clone();
            list.update(cx, |list, cx| list.set_selected(selected, cx));
        }
        if let Route::Channel {
            community_id,
            channel_id,
        } = route
            && self.inbox.level_channel.as_ref() != Some(channel_id)
        {
            self.inbox.level_channel = Some(channel_id.clone());
            let name = core
                .channels(community_id.clone())
                .into_iter()
                .find(|channel| &channel.id == channel_id)
                .map(|channel| channel.name);
            if let Some(level) = self.inbox.level.clone() {
                level.update(cx, |level, cx| level.set_channel_name(name, cx));
            }
            self.refresh_level(cx);
        }
    }

    // ---- Links and notification clicks. ----

    /// A `semaphore://` link: routed now, or once signed in.
    pub(super) fn route_link(&mut self, link: DeepLink, cx: &mut Context<Self>) {
        if self.shell.is_none() {
            log::info!("deep link kept until sign-in: {link:?}");
            self.inbox.pending_link = Some(link);
            return;
        }
        self.navigate(link.route(), cx);
    }

    /// The shell was just built: a link that came before it goes now. True if one did.
    pub(super) fn route_pending_link(&mut self, cx: &mut Context<Self>) -> bool {
        match self.inbox.pending_link.take() {
            Some(link) => {
                self.navigate(link.route(), cx);
                true
            }
            None => false,
        }
    }

    /// The OS notification with this tag was clicked.
    pub(super) fn notification_clicked(
        &mut self,
        tag: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(raised) = self.inbox.raised.get(tag).cloned() else {
            log::info!("a click on a notification no longer known: {tag}");
            return;
        };
        if let (Some(core), Some(services)) = (self.core(), &self.services) {
            let id = raised.id.clone();
            services.exec.fire(async move {
                if let Err(error) = core.mark_notification_read(id).await {
                    log::warn!("marking a clicked notification read: {error}");
                }
            });
        }
        self.open_message_link(raised.link, raised.parent_message_id, window, cx);
    }

    /// Opens what a notification is about: its message (in its thread for a reply), or its
    /// conversation.
    fn open_message_link(
        &mut self,
        link: MessageLink,
        parent_message_id: Option<String>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let MessageLink {
            community_id,
            conversation,
            message_id,
        } = link;
        if let (Some(message_id), Some(pane)) = (message_id, self.pane.clone()) {
            pane.update(cx, |pane, cx| {
                pane.jump(
                    conversation,
                    community_id,
                    message_id,
                    parent_message_id,
                    window,
                    cx,
                )
            });
            return;
        }
        match (conversation, community_id) {
            (Conversation::Channel { id }, Some(community_id)) => self.navigate(
                Route::Channel {
                    community_id,
                    channel_id: id,
                },
                cx,
            ),
            (Conversation::DirectMessage { id }, _) => {
                self.navigate(Route::DirectMessage { dm_group_id: id }, cx)
            }
            (other, _) => log::warn!("nowhere to open {other:?}"),
        }
    }

    // ---- The centre. ----

    pub(super) fn toggle_centre(&mut self, cx: &mut Context<Self>) {
        if self.inbox.centre_open {
            self.close_centre(cx);
            return;
        }
        let (Some(shell), Some(centre)) = (self.shell.clone(), self.inbox.centre.clone()) else {
            return;
        };
        self.inbox.centre_open = true;
        self.refresh_centre(cx);
        // The pane's panel makes way; its "closed" that follows is ignored while the centre shows.
        if let Some(pane) = &self.pane {
            pane.update(cx, |pane, cx| pane.close_side(cx));
        }
        shell.update(cx, |shell, cx| {
            shell.set_side_panel(Some(centre.into()), cx)
        });
    }

    pub(super) fn close_centre(&mut self, cx: &mut Context<Self>) {
        if !self.inbox.centre_open {
            return;
        }
        self.inbox.centre_open = false;
        if let Some(shell) = self.shell.clone() {
            shell.update(cx, |shell, cx| shell.set_side_panel(None, cx));
        }
    }

    pub fn centre_open(&self) -> bool {
        self.inbox.centre_open
    }

    /// The pane wants the side panel (`Some`) or let it go (`None`). Returns whether to pass it
    /// to the shell.
    pub(super) fn pane_side_panel(&mut self, panel: bool) -> bool {
        if panel {
            self.inbox.centre_open = false;
            true
        } else {
            !self.inbox.centre_open
        }
    }

    fn on_centre(
        &mut self,
        _: &Entity<NotificationCenter>,
        event: &NotificationEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let (Some(core), Some(exec)) = (
            self.core(),
            self.services.as_ref().map(|services| services.exec.clone()),
        ) else {
            return;
        };
        match event.clone() {
            NotificationEvent::Open {
                notification_id: _,
                link,
                parent_message_id,
            } => {
                self.close_centre(cx);
                self.open_message_link(link, parent_message_id, window, cx);
            }
            NotificationEvent::MarkRead { id } => exec.fire(async move {
                log_failure(
                    "marking a notification read",
                    core.mark_notification_read(id).await,
                )
            }),
            NotificationEvent::MarkAllRead => exec.fire(async move {
                log_failure(
                    "marking every notification read",
                    core.mark_all_notifications_read().await,
                )
            }),
            NotificationEvent::Dismiss { id } => exec.fire(async move {
                log_failure(
                    "dismissing a notification",
                    core.dismiss_notification(id).await,
                )
            }),
            NotificationEvent::LoadMore => {
                self.inbox.loading_more = true;
                self.refresh_centre(cx);
                exec.run(
                    window,
                    cx,
                    async move { core.load_more_notifications().await },
                    |this, result, _, cx| {
                        log_failure("loading more notifications", result);
                        this.inbox.loading_more = false;
                        this.refresh_centre(cx);
                    },
                );
            }
            NotificationEvent::Retry => core.retry_failed(),
            NotificationEvent::Close => self.close_centre(cx),
        }
    }

    fn on_level(
        &mut self,
        level: &Entity<ChannelNotifyMenu>,
        event: &ChannelNotifyEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let ChannelNotifyEvent::SetLevel(wanted) = *event;
        let (Some(core), Some(exec), Some(channel_id)) = (
            self.core(),
            self.services.as_ref().map(|services| services.exec.clone()),
            self.inbox.level_channel.clone(),
        ) else {
            return;
        };
        level.update(cx, |level, cx| level.set_busy(true, cx));
        let level = level.downgrade();
        exec.run(
            window,
            cx,
            async move { core.set_channel_notify_level(channel_id, wanted).await },
            move |this, result, _, cx| {
                log_failure("setting the channel's notifications", result);
                level.update(cx, |level, cx| level.set_busy(false, cx)).ok();
                this.refresh_level(cx);
            },
        );
    }

    // ---- DMs and friends. ----

    fn on_dm_sidebar(
        &mut self,
        _: &Entity<DmSidebar>,
        event: &DmSidebarEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let (Some(core), Some(exec)) = (
            self.core(),
            self.services.as_ref().map(|services| services.exec.clone()),
        ) else {
            return;
        };
        match event.clone() {
            DmSidebarEvent::List(DmListEvent::Open { dm_id }) => {
                self.navigate(Route::DirectMessage { dm_group_id: dm_id }, cx)
            }
            DmSidebarEvent::List(DmListEvent::NewMessage) => self.open_create_dm(window, cx),
            DmSidebarEvent::List(DmListEvent::Retry)
            | DmSidebarEvent::Friends(FriendsEvent::Retry) => core.retry_failed(),
            DmSidebarEvent::Friends(FriendsEvent::Message { user_id }) => exec.run(
                window,
                cx,
                async move { core.create_dm(vec![user_id], None).await },
                |this, result, _, cx| match result {
                    Ok(dm_id) => this.navigate(Route::DirectMessage { dm_group_id: dm_id }, cx),
                    Err(error) => log::warn!("opening the DM failed: {error}"),
                },
            ),
            DmSidebarEvent::Friends(FriendsEvent::Accept { friendship_id }) => {
                exec.fire(async move {
                    log_failure(
                        "accepting a friend request",
                        core.accept_friend_request(friendship_id).await,
                    )
                })
            }
            DmSidebarEvent::Friends(FriendsEvent::Decline { friendship_id }) => {
                exec.fire(async move {
                    log_failure(
                        "declining a friend request",
                        core.decline_friend_request(friendship_id).await,
                    )
                })
            }
            DmSidebarEvent::Friends(FriendsEvent::Cancel { friendship_id }) => {
                exec.fire(async move {
                    log_failure(
                        "cancelling a friend request",
                        core.cancel_friend_request(friendship_id).await,
                    )
                })
            }
            DmSidebarEvent::Friends(FriendsEvent::Remove { friendship_id }) => {
                exec.fire(async move {
                    log_failure("removing a friend", core.remove_friend(friendship_id).await)
                })
            }
            DmSidebarEvent::Friends(FriendsEvent::AddFriend) => self.open_add_friend(window, cx),
            DmSidebarEvent::TabChanged(DmTab::Friends) => {
                // As the web's list refetching when it mounts: requests come with no event.
                core.invalidate(&keys::op(keys::FRIENDS));
                self.refresh_friends(cx);
            }
            DmSidebarEvent::TabChanged(DmTab::Messages) => {}
        }
    }

    fn on_dm_header(
        &mut self,
        _: &Entity<DmHeader>,
        event: &DmHeaderEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        match event {
            DmHeaderEvent::Back => self.navigate(Route::DirectMessages, cx),
            DmHeaderEvent::Search => {
                self.inbox.centre_open = false;
                if let Some(pane) = &self.pane {
                    pane.update(cx, |pane, cx| pane.toggle_search(window, cx));
                }
            }
            // No DM calls or members drawer until wave 4: neither button is offered.
            DmHeaderEvent::JoinCall | DmHeaderEvent::OpenMembers => {}
        }
    }

    fn open_create_dm(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let dialog = cx.new(|cx| CreateDmDialog::new(window, cx));
        dialog.update(cx, |dialog, cx| dialog.focus_field(window, cx));
        self.inbox
            .subscriptions
            .push(cx.subscribe_in(&dialog, window, Self::on_create_dm));
        self.inbox.create_dm = Some(dialog);
        cx.notify();
    }

    fn on_create_dm(
        &mut self,
        dialog: &Entity<CreateDmDialog>,
        event: &CreateDmEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let (Some(core), Some(exec)) = (
            self.core(),
            self.services.as_ref().map(|services| services.exec.clone()),
        ) else {
            return;
        };
        let dialog = dialog.clone();
        match event.clone() {
            CreateDmEvent::Search { query } => {
                let asked = query.clone();
                exec.run(
                    window,
                    cx,
                    async move { core.search_users(query, Some(SEARCH_LIMIT)).await },
                    move |_, result, _, cx| {
                        let picker = dialog.read(cx).picker().clone();
                        picker.update(cx, |picker, cx| {
                            picker.set_results(&asked, result.map_err(|e| e.to_string()), cx)
                        });
                    },
                );
            }
            CreateDmEvent::Create { user_ids, name } => {
                dialog.update(cx, |dialog, cx| dialog.set_busy(true, cx));
                exec.run(
                    window,
                    cx,
                    async move { core.create_dm(user_ids, name).await },
                    move |this, result, _, cx| match result {
                        Ok(dm_id) => {
                            this.inbox.create_dm = None;
                            this.navigate(Route::DirectMessage { dm_group_id: dm_id }, cx);
                            cx.notify();
                        }
                        Err(error) => dialog.update(cx, |dialog, cx| {
                            dialog.set_busy(false, cx);
                            dialog.set_failed(Some(error.to_string()), cx);
                        }),
                    },
                );
            }
            CreateDmEvent::Cancel => {
                self.inbox.create_dm = None;
                cx.notify();
            }
        }
    }

    fn open_add_friend(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(core) = self.core() else {
            return;
        };
        let dialog = cx.new(|cx| AddFriendDialog::new(window, cx));
        let form = dialog.read(cx).form().clone();
        let me = match core.session() {
            SessionState::SignedIn { me } => vec![me.id],
            _ => Vec::new(),
        };
        let friends = core.friends();
        form.update(cx, |form, cx| {
            form.set_friends(&friends, cx);
            form.set_excluded(me, cx);
            form.focus_field(window, cx);
        });
        self.inbox
            .subscriptions
            .push(cx.subscribe_in(&dialog, window, Self::on_add_friend));
        self.inbox.add_friend = Some(dialog);
        cx.notify();
    }

    fn on_add_friend(
        &mut self,
        dialog: &Entity<AddFriendDialog>,
        event: &AddFriendDialogEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let (Some(core), Some(exec)) = (
            self.core(),
            self.services.as_ref().map(|services| services.exec.clone()),
        ) else {
            return;
        };
        let form = dialog.read(cx).form().clone();
        match event.clone() {
            AddFriendDialogEvent::Form(AddFriendEvent::Search { query }) => {
                let asked = query.clone();
                exec.run(
                    window,
                    cx,
                    async move { core.search_users(query, Some(25)).await },
                    move |_, result, _, cx| {
                        form.update(cx, |form, cx| {
                            form.set_results(&asked, result.map_err(|e| e.to_string()), cx)
                        });
                    },
                );
            }
            AddFriendDialogEvent::Form(AddFriendEvent::Send { user_id }) => {
                form.update(cx, |form, cx| {
                    form.set_outcome(AddOutcome::Sending, window, cx)
                });
                exec.run(
                    window,
                    cx,
                    async move { core.send_friend_request(user_id).await },
                    move |_, result, window, cx| {
                        let outcome = match result {
                            Ok(()) => AddOutcome::Sent,
                            Err(error) => AddOutcome::Failed(error_view(&error)),
                        };
                        form.update(cx, |form, cx| form.set_outcome(outcome, window, cx));
                    },
                );
            }
            AddFriendDialogEvent::Close => {
                self.inbox.add_friend = None;
                cx.notify();
            }
        }
    }

    // ---- Notification settings, from the account dialog until the settings page (W3). ----

    pub(super) fn open_notification_settings(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let section = cx.new(|cx| {
            let mut section = NotificationSettingsSection::new(window, cx);
            section.set_local_timezone(semaphore_core::notify::system_timezone(), cx);
            section
        });
        self.inbox
            .subscriptions
            .push(cx.subscribe_in(&section, window, Self::on_settings));
        self.inbox.settings = Some(section);
        self.refresh_settings(cx);
        cx.notify();
    }

    fn on_settings(
        &mut self,
        section: &Entity<NotificationSettingsSection>,
        event: &SettingsEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let (Some(core), Some(exec)) = (
            self.core(),
            self.services.as_ref().map(|services| services.exec.clone()),
        ) else {
            return;
        };
        match event.clone() {
            SettingsEvent::Save(patch) => {
                section.update(cx, |section, cx| section.set_saving(true, cx));
                let section = section.downgrade();
                exec.run(
                    window,
                    cx,
                    async move { core.update_notification_settings(patch).await },
                    move |_, result, _, cx| {
                        log_failure("saving the notification settings", result);
                        section
                            .update(cx, |section, cx| section.set_saving(false, cx))
                            .ok();
                    },
                );
            }
            SettingsEvent::PreviewSound(sound) => self.play(sound),
            SettingsEvent::SendTest => {
                if let Some(notifier) = &self.config.notifier
                    && let Err(error) = notifier.notify(TEST_TITLE.into(), TEST_BODY.into())
                {
                    log::info!("the test notification wasn't shown: {error}");
                }
            }
            SettingsEvent::Retry => core.retry_failed(),
        }
    }

    pub fn settings_open(&self) -> bool {
        self.inbox.settings.is_some()
    }

    /// The dialogs W2 opens over the shell.
    pub(super) fn inbox_overlays(&self, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let mut overlays: Vec<AnyElement> = Vec::new();
        if let Some(dialog) = &self.inbox.create_dm {
            overlays.push(dialog.clone().into_any_element());
        }
        if let Some(dialog) = &self.inbox.add_friend {
            overlays.push(dialog.clone().into_any_element());
        }
        if let Some(section) = &self.inbox.settings {
            let close = cx.entity().downgrade();
            let done = close.clone();
            overlays.push(
                Dialog::new("Notification settings")
                    .width(560.)
                    .body(div().max_h(px(560.)).child(section.clone()))
                    .action(Button::new("notification-settings-done", "Done").on_click(
                        move |_, _, cx| {
                            done.update(cx, |this, cx| {
                                this.inbox.settings = None;
                                cx.notify();
                            })
                            .ok();
                        },
                    ))
                    .on_close(move |_, cx| {
                        close
                            .update(cx, |this, cx| {
                                this.inbox.settings = None;
                                cx.notify();
                            })
                            .ok();
                    })
                    .into_any_element(),
            );
        }
        overlays
    }
}

fn log_failure(what: &str, result: Result<(), CoreError>) {
    if let Err(error) = result {
        log::warn!("{what} failed: {error}");
    }
}

/// Whether the pane is on this DM, for the rig.
pub fn pane_on_dm(pane: &ConversationPane, dm_id: &str) -> bool {
    pane.conversation()
        == Some(&Conversation::DirectMessage {
            id: dm_id.to_owned(),
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn a_refused_call_reads_as_its_message() {
        let view = error_view(&CoreError::Failed {
            message: "Friend request already sent".into(),
        });
        assert_eq!(view.message, "Friend request already sent");
        assert!(!view.retryable);
    }
}
