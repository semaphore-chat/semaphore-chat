//! The app shell: the Lounge frame (design §4, epic #848 B10). `AppFrame` with the banner row
//! (connection, update) around `ThreeIslands`: the dock and the community's left island (or the
//! inbox's), the centre, and the members island or the side panel on the right, with the call
//! slot. The pieces are `lounge`'s views; `frame` reads the source and builds them.
//!
//! The centre belongs to other units: the shell draws what [`ContentSlot`] returns for the route,
//! under the channel header. It reads through [`ShellSource`] and tells its owner what happened
//! through [`ShellEvent`].

mod faces;
#[cfg(feature = "stories")]
pub mod fixtures;
mod frame;
#[cfg(test)]
mod frame_tests;
pub mod lounge;
pub(crate) mod press;
mod source;
#[cfg(feature = "stories")]
pub mod stories_impl;

use crate::kit::PhonePane;
use frame::pane_for;
pub use source::{CoreSource, Load, MemberRow, RailCounts, ShellSource};

use crate::kit::{Icon, IconButton, Menu, MenuItem, on_core_event};
use crate::nav::{NavModel, Route};
use crate::theme::SemTheme;
pub(crate) use faces::{community_avatar, user_avatar};
use gpui_kit::component::input::InputState;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{
    ChannelKind, ChannelRow, CommunityRow, SessionState, ViewKey, VoiceRoom, VoiceView,
};
use semaphore_core::{ConnectionState, CoreEvent};
use semaphore_design::Icon as IconName;
use semaphore_design::LoungeIcon;
use semaphore_design::lounge::{LAYOUT_GUTTER, SPACE_SM, SPACE_XS, TEXT_TITLE};
use std::cell::Cell;
use std::collections::HashMap;
use std::rc::Rc;

/// From `constants/layout.ts`: the width of the old channel sidebar, which some stories still
/// frame their views at.
pub const CHANNEL_SIDEBAR_WIDTH: f32 = 280.;
/// `DEVICE_BREAKPOINTS.PHONE`: under this, one pane at a time.
pub const PHONE: f32 = 600.;
/// `SIDE_PANEL_WIDTH`: the pins, search and thread panel's drawer below wide.
pub const SIDE_PANEL_WIDTH: f32 = 400.;

/// Draws the centre for a route. Messages (U9) and the composer (U10) arrive here.
pub type ContentSlot = Rc<dyn Fn(&ContentProps, &mut Window, &mut App) -> AnyElement>;
/// Draws the frame's call slot (B11): the call bar with the call surface above it while there is a
/// call, the voice notice after one, or nothing.
pub type VoiceBarSlot = Rc<dyn Fn(&mut Window, &mut App) -> Option<crate::kit::CallSlot>>;
/// Draws the update card in the frame's banner row, when there's an update to talk about.
pub type UpdateBannerSlot = Rc<dyn Fn(&mut Window, &mut App) -> Option<AnyElement>>;

/// Draws the inbox's left island, outside a community: the DM list and friends. `None` leaves it
/// with a placeholder.
pub type RouteSidebarSlot =
    Rc<dyn Fn(&RouteSidebarProps, &mut Window, &mut App) -> Option<AnyElement>>;

/// What the shell knows when asking for a route's sidebar.
#[derive(Debug, Clone)]
pub struct RouteSidebarProps {
    pub route: Route,
}

/// What the shell knows when asking for the middle column.
#[derive(Debug, Clone)]
pub struct ContentProps {
    pub route: Route,
    pub channel: Option<ChannelRow>,
    pub community: Option<CommunityRow>,
    /// Whether the middle column is drawn now. On a phone one pane shows at a time: with the left
    /// pane in front the route stays, but this column and the stage in it aren't on screen.
    pub centre_drawn: bool,
    /// The shell just appeared or navigated: the owner moves keyboard focus into what it shows (the
    /// composer), as it does on opening another conversation. Set on the first drawing of a channel
    /// after it, even when the conversation is the one already open: the shell's first render, and
    /// a click on a rail or channel row, took the focus.
    pub take_focus: bool,
    /// What the owner draws is on screen. False while a phone shows the left pane, and while the
    /// shell draws the community home in its place: the owner draws nothing then, and shows no
    /// conversation, so nothing is marked read or counted as seen.
    pub shown: bool,
}

impl ContentProps {
    /// Whether the middle column is showing the call's own view: the route is the room of the call
    /// that's up, *and* the centre is drawn. A phone's left pane can leave the route on the call
    /// while the stage isn't on screen; then nothing of the call is drawn, so the frame's call
    /// slot must keep the call bar.
    pub fn call_stage_drawn(&self, voice: &VoiceView) -> bool {
        if !self.centre_drawn {
            return false;
        }
        match (&self.route, &self.channel, &voice.room) {
            (_, Some(channel), _) => voice.channel_id.as_deref() == Some(channel.id.as_str()),
            (Route::DirectMessage { dm_group_id }, _, Some(VoiceRoom::Dm { dm_group_id: id })) => {
                id == dm_group_id
            }
            _ => false,
        }
    }
}

/// What the owner acts on. Core's commands are the owner's to call, so stories need no core.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ShellEvent {
    Navigated(Route),
    /// A voice room's Join: the owner joins it, from here (design PA-2).
    JoinVoice {
        channel_id: String,
    },
    /// A voice room's Leave.
    LeaveVoice,
    OpenNotifications,
    OpenAccountMenu,
    OpenCommunitySettings {
        community_id: String,
    },
    /// W5: the channel list's "+" (shown with `CommunityCaps::create_channel`): the owner opens
    /// the settings' Channels tab with its create dialog (`ChannelsTab::open_create`).
    CreateChannel {
        community_id: String,
    },
    /// W5: a member row was secondary-clicked or long-pressed in the members panel: the owner
    /// opens `moderation::ModerationMenu` for them at `position` (window coordinates).
    MemberMenu {
        community_id: String,
        user_id: String,
        position: Point<Pixels>,
    },
    CreateCommunity,
    /// A member's row: their profile.
    OpenProfile {
        user_id: String,
    },
    /// The user asked to retry a failed list.
    Retry,
    /// The header's pin button: the owner shows the pins panel with [`Shell::set_side_panel`].
    OpenPins,
    /// The header's search button: likewise for the search panel.
    OpenSearch,
    /// The side panel asked to close (Escape or the scrim of its drawer below wide, or Members
    /// replacing it): the owner closes it.
    CloseSidePanel,
}

pub struct Shell {
    pub(crate) source: Rc<dyn ShellSource>,
    pub(crate) nav: NavModel,
    pub(crate) connection: ConnectionState,
    /// The right content: `None` until the user chooses (shown at wide, closed below).
    pub(crate) right_open: Option<bool>,
    /// Which pane a phone shows.
    pub(crate) phone_pane: PhonePane,
    /// The pane each Back entry was left on, in step with the history (`NavModel::depth`).
    pub(crate) pane_back: Vec<PhonePane>,
    /// The "All communities" sheet is open.
    pub(crate) sheet_open: bool,
    /// The community header's menu is open.
    pub(crate) menu_open: bool,
    /// The channel header's More menu is open.
    pub(crate) more_open: bool,
    /// The channel header's More button: where focus goes back to when a panel it opened closes.
    pub(crate) more_focus: FocusHandle,
    /// The sheet's filter field.
    pub(crate) filter: Entity<InputState>,
    /// The left island's and the right content's scrolling parts.
    pub(crate) left_scroll: ScrollHandle,
    pub(crate) right_scroll: ScrollHandle,
    /// The instance the user is on ("moss.social"), the sheet's heading.
    pub(crate) instance_label: SharedString,
    /// `lastChannel`: the channel to reopen in each community.
    pub(crate) last_channel: HashMap<String, String>,
    /// With nothing focused GPUI sends keys past the kit's root, and Tab does nothing, so the shell
    /// holds focus until the user moves it.
    pub(crate) focus: FocusHandle,
    pub(crate) took_focus: bool,
    /// [`ContentProps::take_focus`] for the next drawing of a channel.
    pub(crate) focus_content: Cell<bool>,
    pub(crate) content: ContentSlot,
    pub(crate) voice_bar: Option<VoiceBarSlot>,
    /// The update card, in the frame's banner row (W13).
    pub(crate) update_banner: Option<UpdateBannerSlot>,
    /// How many pinned messages the header's badge shows. Fed by the owner.
    pub pinned_count: u32,
    /// Pins, search or a thread, beside the messages. Set by the owner.
    pub(crate) side_panel: Option<AnyView>,
    pub(crate) route_sidebar: Option<RouteSidebarSlot>,
    /// The channel header's notification level control. Set by the owner.
    pub(crate) header_accessory: Option<AnyView>,
}

impl EventEmitter<ShellEvent> for Shell {}

impl Shell {
    pub fn new(
        source: Rc<dyn ShellSource>,
        route: Route,
        content: ContentSlot,
        connection: ConnectionState,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let signed_in = matches!(source.session(), SessionState::SignedIn { .. });
        on_core_event(cx.entity().downgrade(), Self::on_core, cx);
        let filter = crate::kit::text_state(window, cx, false);
        cx.observe(&filter, |_, _, cx| cx.notify()).detach();
        let phone_pane = pane_for(&route);
        let mut shell = Self {
            source,
            nav: NavModel::new(route, signed_in),
            connection,
            right_open: None,
            phone_pane,
            pane_back: Vec::new(),
            sheet_open: false,
            menu_open: false,
            more_open: false,
            more_focus: cx.focus_handle(),
            filter,
            left_scroll: ScrollHandle::new(),
            right_scroll: ScrollHandle::new(),
            instance_label: SharedString::default(),
            last_channel: HashMap::new(),
            focus: cx.focus_handle(),
            took_focus: false,
            focus_content: Cell::new(true),
            content,
            voice_bar: None,
            update_banner: None,
            pinned_count: 0,
            side_panel: None,
            route_sidebar: None,
            header_accessory: None,
        };
        shell.settle_route();
        shell
    }

    pub fn with_voice_bar(mut self, slot: VoiceBarSlot) -> Self {
        self.voice_bar = Some(slot);
        self
    }

    pub fn with_route_sidebar(mut self, slot: RouteSidebarSlot) -> Self {
        self.route_sidebar = Some(slot);
        self
    }

    /// The update card, in the frame's banner row under the connection notice.
    pub fn with_update_banner(mut self, slot: UpdateBannerSlot) -> Self {
        self.update_banner = Some(slot);
        self
    }

    /// The instance the user is on, the "All communities" sheet's heading ("moss.social").
    pub fn with_instance_label(mut self, label: impl Into<SharedString>) -> Self {
        self.instance_label = label.into();
        self
    }

    /// Draws `view` in the channel header in place of the notification level button, and in the
    /// phone app bar beside the members button: the owner's level menu for the channel on screen.
    /// `None` puts the plain button back (and nothing on a phone).
    pub fn set_header_accessory(&mut self, view: Option<AnyView>, cx: &mut Context<Self>) {
        self.header_accessory = view;
        cx.notify();
    }

    /// Shows `panel` beside the messages (the right island at wide, a drawer below it, a
    /// full-screen layer on a phone), or closes it. While open it takes the members' place.
    pub fn set_side_panel(&mut self, panel: Option<AnyView>, cx: &mut Context<Self>) {
        self.side_panel = panel;
        cx.notify();
    }

    /// Focus on the channel header's More, the opener of the pins and search panels: where it
    /// goes back to when one of them closes, as on the web.
    pub fn focus_more(&self, window: &mut Window, cx: &mut App) {
        window.focus(&self.more_focus, cx);
    }

    pub fn side_panel_open(&self) -> bool {
        self.side_panel.is_some()
    }

    pub fn nav(&self) -> &NavModel {
        &self.nav
    }

    pub fn navigate(&mut self, route: Route, cx: &mut Context<Self>) {
        let (depth, leaving) = (self.nav.depth(), self.phone_pane);
        // The pane is the asked-for route's: a phone opening a community shows its home (the left
        // pane) even though the route settles on a channel, as the web's phone home does.
        self.phone_pane = pane_for(&route);
        self.nav.navigate(route);
        self.keep_pane(depth, leaving);
        self.settle_route();
        self.sheet_open = false;
        self.menu_open = false;
        self.more_open = false;
        self.focus_content.set(true);
        cx.emit(ShellEvent::Navigated(self.nav.current().clone()));
        cx.notify();
    }

    /// Goes to `route` in place, adding no history: a settings tab, say.
    pub fn replace_route(&mut self, route: Route, cx: &mut Context<Self>) {
        self.nav.replace(route);
        cx.emit(ShellEvent::Navigated(self.nav.current().clone()));
        cx.notify();
    }

    /// Back to where the user was before, as a page's Back or Close does; Home if nowhere.
    pub fn go_back(&mut self, cx: &mut Context<Self>) {
        let (depth, leaving) = (self.nav.depth(), self.phone_pane);
        let back = self.nav.go_back();
        if !back {
            self.nav.navigate(Route::Home);
        }
        self.phone_pane = pane_for(self.nav.current());
        // Back restores the pane the user left that entry on: the community's home, or its chat.
        if let Some(pane) = self.keep_pane(depth, leaving) {
            self.phone_pane = pane;
        }
        self.settle_route();
        self.focus_content.set(true);
        cx.emit(ShellEvent::Navigated(self.nav.current().clone()));
        cx.notify();
    }

    /// `semaphore://` handed to us by the OS. A bad link does nothing, and returns false.
    pub fn open_deep_link(&mut self, raw: &str, cx: &mut Context<Self>) -> bool {
        let (depth, leaving) = (self.nav.depth(), self.phone_pane);
        let handled = self.nav.open_deep_link(raw);
        if handled {
            self.phone_pane = pane_for(self.nav.current());
            self.keep_pane(depth, leaving);
            self.settle_route();
            self.focus_content.set(true);
            cx.emit(ShellEvent::Navigated(self.nav.current().clone()));
            cx.notify();
        }
        handled
    }

    /// Keeps [`Self::pane_back`] in step with the history after a move from `depth` entries: the
    /// pane the user `left` goes with a new entry, and a step back returns the one it was left on.
    fn keep_pane(&mut self, depth: usize, left: PhonePane) -> Option<PhonePane> {
        let now = self.nav.depth();
        let restored = if now > depth {
            self.pane_back.push(left);
            None
        } else if now < depth {
            self.pane_back.pop()
        } else {
            None
        };
        // Signing out clears the history; nothing else does without the shell.
        self.pane_back.truncate(now);
        restored
    }

    /// `CommunityPage`: a community with no channel selected goes to the last-viewed text channel,
    /// or the first, in place.
    fn settle_route(&mut self) {
        match self.nav.current().clone() {
            Route::Community { community_id } => {
                let Load::Ready(channels) = self.source.channels(&community_id) else {
                    return;
                };
                let mut text: Vec<&ChannelRow> = channels
                    .iter()
                    .filter(|channel| channel.kind == ChannelKind::Text)
                    .collect();
                text.sort_by_key(|channel| channel.position);
                let last = self.last_channel.get(&community_id);
                let chosen = text
                    .iter()
                    .find(|channel| Some(&channel.id) == last)
                    .or(text.first());
                if let Some(channel) = chosen {
                    self.nav.replace(Route::Channel {
                        community_id,
                        channel_id: channel.id.clone(),
                    });
                }
            }
            Route::Channel {
                community_id,
                channel_id,
            } => {
                // A channel that isn't in the loaded list (deleted, or not the user's to see): a
                // phone shows the community's list, not a centre that points at it.
                if let Load::Ready(channels) = self.source.channels(&community_id)
                    && !channels.iter().any(|channel| channel.id == channel_id)
                {
                    self.phone_pane = PhonePane::Left;
                    return;
                }
                self.last_channel.insert(community_id, channel_id);
            }
            _ => {}
        }
    }

    fn on_core(&mut self, event: &CoreEvent, cx: &mut Context<Self>) {
        match event {
            CoreEvent::ConnectionChanged { state } => self.connection = *state,
            CoreEvent::ViewChanged { view } => {
                // A channel list may just have arrived for the community on screen.
                if matches!(view, ViewKey::Channels { .. }) {
                    self.settle_route();
                }
            }
            CoreEvent::QueriesInvalidated { .. }
            | CoreEvent::MessagesChanged { .. }
            | CoreEvent::Notify { .. }
            | CoreEvent::WithdrawNotifications { .. }
            | CoreEvent::DesktopSignedIn { .. }
            | CoreEvent::Sound { .. } => {}
            // W5: the community has gone for this user (the owner shows why): home, if it's on
            // screen, and nothing of it to reopen.
            CoreEvent::CommunityRemoved { community_id, .. } => {
                self.last_channel.remove(community_id);
                if self.nav.current().community_id() == Some(community_id.as_str()) {
                    self.navigate(Route::Home, cx);
                }
            }
            // W5: a channel went: leave it if it's open, for the community's next channel.
            CoreEvent::ChannelRemoved {
                community_id,
                channel_id,
            } => {
                if self.last_channel.get(community_id) == Some(channel_id) {
                    self.last_channel.remove(community_id);
                }
                if self.nav.current().channel_id() == Some(channel_id.as_str()) {
                    self.navigate(
                        Route::Community {
                            community_id: community_id.clone(),
                        },
                        cx,
                    );
                }
            }
        }
        cx.notify();
    }

    pub(crate) fn community(&self) -> Option<CommunityRow> {
        let id = self.nav.current().community_id()?;
        match self.source.communities() {
            Load::Ready(communities) => communities.into_iter().find(|row| row.id == id),
            _ => None,
        }
    }

    pub(crate) fn channel(&self) -> Option<ChannelRow> {
        let community = self.nav.current().community_id()?;
        let id = self.nav.current().channel_id()?;
        match self.source.channels(community) {
            Load::Ready(channels) => channels.into_iter().find(|row| row.id == id),
            _ => None,
        }
    }

    /// The middle column. The owner draws it, except for the community home (B12): a community
    /// with no channel chosen, and any community route while the communities load or fail.
    pub(crate) fn content_element(
        &self,
        centre_drawn: bool,
        members_shown: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let home = self.nav.current().community_id().is_some()
            && (!matches!(self.source.communities(), Load::Ready(_))
                || match self.nav.current() {
                    Route::Community { .. } => true,
                    Route::Channel { .. } => self.channel().is_none(),
                    _ => false,
                });
        let channel = self.channel();
        let shown = centre_drawn && !home;
        // Kept until a channel is drawn: a route still loading has nothing to focus yet.
        let take_focus = channel.is_some() && shown && self.focus_content.take();
        let props = ContentProps {
            route: self.nav.current().clone(),
            channel,
            community: self.community(),
            centre_drawn,
            take_focus,
            shown,
        };
        // The owner is told even when what it draws isn't on screen, so it can stop showing a
        // conversation.
        let content = (self.content)(&props, window, cx);
        match (home, self.nav.current().community_id()) {
            (true, Some(community_id)) if centre_drawn => {
                let community_id = community_id.to_owned();
                self.community_home(&community_id, members_shown, cx)
                    .into_any_element()
            }
            _ if !shown => div().into_any_element(),
            _ => content,
        }
    }

    /// Shows the members, the action of the header's Members button and the community header's
    /// members button. They replace an open side panel, as on the web: the owner closes it.
    pub(crate) fn show_members(&mut self, cx: &mut Context<Self>) {
        self.right_open = Some(true);
        if self.side_panel.is_some() {
            cx.emit(ShellEvent::CloseSidePanel);
        }
        cx.notify();
    }

    /// The channel header, or `None` when the route has no channel, as the web Lounge's
    /// `ChatHeader`: Back on a phone, the channel's name as the screen's heading (a lock when it
    /// is private), the notification level, Members (pressed while the members show; it hides
    /// them, or replaces an open side panel with them) and, in a text channel, More with Search
    /// messages and Pinned messages. More is the opener: focus goes back to it when the panel it
    /// opened closes.
    pub(crate) fn header(
        &self,
        phone: bool,
        right_shown: bool,
        cx: &mut Context<Self>,
    ) -> Option<impl IntoElement + use<>> {
        let channel = self.channel()?;
        let sem = cx.sem();
        let secondary = sem.text_secondary;
        let voice = channel.kind == ChannelKind::Voice;
        let title = header_title(channel.kind, &channel.name);
        let members = {
            let view = cx.entity().downgrade();
            IconButton::new("members-toggle", IconName::People, "Members")
                .lounge_icon(LoungeIcon::Users)
                .selected(right_shown)
                .on_click(move |_, _, cx| {
                    view.update(cx, |shell, cx| {
                        if shell.side_panel.is_some() || !right_shown {
                            shell.show_members(cx);
                        } else {
                            shell.right_open = Some(false);
                            cx.notify();
                        }
                    })
                    .ok();
                })
        };
        let more = (!voice).then(|| self.more_menu(cx));
        let notifications = match self.header_accessory.clone() {
            Some(accessory) => accessory.into_any_element(),
            None => IconButton::new(
                "header-notifications",
                IconName::AlternateEmail,
                "Channel notifications",
            )
            .lounge_icon(LoungeIcon::Bell)
            .into_any_element(),
        };
        Some(
            div()
                .id("channel-header")
                .test_support()
                .w_full()
                .flex_shrink_0()
                .px(px(SPACE_SM))
                .pt(px(SPACE_SM))
                .pb(px(SPACE_XS))
                .flex()
                .items_center()
                .gap(px(SPACE_SM))
                .when(phone, |header| header.child(self.phone_back(cx)))
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(SPACE_XS))
                        .min_w_0()
                        .flex_1()
                        .when(voice, |row| {
                            // A voice channel's header, as the web's pre-join: the voice
                            // icon, not the text channel's hash.
                            row.child(Icon::new(IconName::VolumeUp).size(18.).color(secondary))
                        })
                        .child(
                            crate::kit::type_text(TEXT_TITLE, title.clone())
                                .id("channel-header-title")
                                .test_support()
                                .role(Role::Heading)
                                .aria_label(title)
                                .min_w_0()
                                .truncate(),
                        )
                        .when(channel.is_private, |row| {
                            row.child(Icon::new(IconName::Lock).size(18.).color(secondary))
                        }),
                )
                .child(
                    div()
                        .flex()
                        .flex_shrink_0()
                        .items_center()
                        .gap(px(SPACE_XS))
                        .child(notifications)
                        .child(members)
                        .children(more),
                ),
        )
    }

    /// The header's More and, while open, its menu: Search messages and Pinned messages (with
    /// their count), anchored under the button's end as the web's `placement="bottom-end"`.
    fn more_menu(&self, cx: &mut Context<Self>) -> AnyElement {
        let pinned = self.pinned_count;
        let toggle = cx.entity().downgrade();
        let button = IconButton::new("header-more", IconName::MoreHoriz, "More")
            .lounge_icon(LoungeIcon::Ellipsis)
            .selected(self.more_open)
            .track_focus(&self.more_focus)
            .on_click(move |_, _, cx| {
                toggle
                    .update(cx, |shell, cx| {
                        shell.more_open = !shell.more_open;
                        cx.notify();
                    })
                    .ok();
            });
        let open = self.more_open.then(|| {
            let (search, pins, close) = (
                cx.entity().downgrade(),
                cx.entity().downgrade(),
                cx.entity().downgrade(),
            );
            let items = vec![
                MenuItem::new("header-more-search", "Search messages", move |_, cx| {
                    search
                        .update(cx, |shell, cx| {
                            shell.more_open = false;
                            cx.emit(ShellEvent::OpenSearch);
                            cx.notify();
                        })
                        .ok();
                })
                .icon(IconName::Search),
                MenuItem::new(
                    "header-more-pins",
                    if pinned > 0 {
                        format!("Pinned messages ({pinned})")
                    } else {
                        "Pinned messages".to_owned()
                    },
                    move |_, cx| {
                        pins.update(cx, |shell, cx| {
                            shell.more_open = false;
                            cx.emit(ShellEvent::OpenPins);
                            cx.notify();
                        })
                        .ok();
                    },
                )
                .icon(IconName::PushPin),
            ];
            let menu = Menu::new("Channel menu", items)
                .id("header-more-menu")
                .on_close(move |_, window, cx| {
                    close
                        .update(cx, |shell, cx| {
                            shell.more_open = false;
                            shell.focus_more(window, cx);
                            cx.notify();
                        })
                        .ok();
                });
            div()
                .absolute()
                .top_full()
                .right_0()
                .mt(px(crate::kit::ANCHOR_GAP))
                .child(
                    deferred(
                        anchored()
                            .anchor(Anchor::TopRight)
                            .snap_to_window_with_margin(px(LAYOUT_GUTTER))
                            .child(div().occlude().child(menu)),
                    )
                    .with_priority(1),
                )
        });
        div()
            .relative()
            .flex_none()
            .child(button)
            .children(open)
            .into_any_element()
    }
}

#[cfg(feature = "stories")]
pub fn stories() -> Vec<crate::stories::Story> {
    let mut all = stories_impl::stories();
    all.extend(lounge::stories::stories());
    all.extend(lounge::call::stories::stories());
    all
}

/// A channel's header label: a text channel's hash and name, or a voice channel's name alone,
/// drawn after the voice icon (the web's pre-join), as the channel list draws it.
fn header_title(kind: ChannelKind, name: &str) -> String {
    match kind {
        ChannelKind::Voice => name.to_owned(),
        _ => format!("# {name}"),
    }
}

#[cfg(test)]
mod header_tests {
    // Not `super::*`: its `gpui_kit::*` glob brings a `test` attribute of its own.
    use super::header_title;
    use semaphore_core::model::ChannelKind;

    #[test]
    fn a_voice_channels_header_has_a_voice_icon_not_a_hash() {
        assert_eq!(header_title(ChannelKind::Voice, "AFK"), "AFK");
        assert_eq!(header_title(ChannelKind::Voice, "Squad Up"), "Squad Up");
    }

    #[test]
    fn a_text_channels_header_keeps_its_hash() {
        assert_eq!(header_title(ChannelKind::Text, "general"), "# general");
        // A kind this build doesn't know is drawn as a text channel, as the channel list does.
        assert_eq!(header_title(ChannelKind::Unknown, "x"), "# x");
    }
}
