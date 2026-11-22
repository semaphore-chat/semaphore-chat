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

use crate::kit::{Button, Icon, IconButton, Paper, Spinner, Variant, on_core_event, text};
use crate::nav::{NavModel, Route};
use crate::theme::SemTheme;
pub(crate) use faces::{community_avatar, user_avatar};
use gpui_kit::component::input::InputState;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{ChannelKind, ChannelRow, CommunityRow, SessionState, ViewKey};
use semaphore_core::{ConnectionState, CoreEvent};
use semaphore_design::Icon as IconName;
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
/// Draws the frame's call slot when there's a call: the voice bar (U11).
pub type VoiceBarSlot = Rc<dyn Fn(&mut Window, &mut App) -> Option<AnyElement>>;
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
    /// The shell just appeared or navigated: the owner moves keyboard focus into what it shows (the
    /// composer), as it does on opening another conversation. Set on the first drawing of a channel
    /// after it, even when the conversation is the one already open: the shell's first render, and
    /// a click on a rail or channel row, took the focus.
    pub take_focus: bool,
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
    /// The side panel asked to close (its drawer's scrim below wide, or Members replacing it):
    /// the owner closes it.
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
    /// The "All communities" sheet is open.
    pub(crate) sheet_open: bool,
    /// The community header's menu is open.
    pub(crate) menu_open: bool,
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
            sheet_open: false,
            menu_open: false,
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

    pub fn side_panel_open(&self) -> bool {
        self.side_panel.is_some()
    }

    pub fn nav(&self) -> &NavModel {
        &self.nav
    }

    pub fn navigate(&mut self, route: Route, cx: &mut Context<Self>) {
        self.nav.navigate(route);
        self.settle_route();
        self.phone_pane = pane_for(self.nav.current());
        self.sheet_open = false;
        self.menu_open = false;
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
        if !self.nav.go_back() {
            self.nav.navigate(Route::Home);
        }
        self.settle_route();
        self.phone_pane = pane_for(self.nav.current());
        self.focus_content.set(true);
        cx.emit(ShellEvent::Navigated(self.nav.current().clone()));
        cx.notify();
    }

    /// `semaphore://` handed to us by the OS. A bad link does nothing, and returns false.
    pub fn open_deep_link(&mut self, raw: &str, cx: &mut Context<Self>) -> bool {
        let handled = self.nav.open_deep_link(raw);
        if handled {
            self.settle_route();
            self.phone_pane = pane_for(self.nav.current());
            self.focus_content.set(true);
            cx.emit(ShellEvent::Navigated(self.nav.current().clone()));
            cx.notify();
        }
        handled
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

    /// The middle column. The owner draws it, except while the community itself isn't there to
    /// draw: `CommunityPage`'s loading and `PageError` states.
    pub(crate) fn content_element(
        &self,
        centre_drawn: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        if self.nav.current().community_id().is_some() {
            match self.source.communities() {
                Load::Loading => {
                    return div()
                        .size_full()
                        .flex()
                        .items_center()
                        .justify_center()
                        .child(Spinner::new("community-loading").size(40.).label("Loading"))
                        .into_any_element();
                }
                Load::Failed(_) => {
                    return div()
                        .size_full()
                        .flex()
                        .items_center()
                        .justify_center()
                        .child(error_state(
                            "community-retry",
                            "Couldn't load this community",
                            "Check your connection and try again.",
                            cx,
                        ))
                        .into_any_element();
                }
                Load::Ready(_) => {}
            }
        }
        let channel = self.channel();
        // Kept until a channel is drawn: a route still loading has nothing to focus yet.
        let take_focus = channel.is_some() && centre_drawn && self.focus_content.take();
        let props = ContentProps {
            route: self.nav.current().clone(),
            channel,
            community: self.community(),
            take_focus,
        };
        (self.content)(&props, window, cx)
    }

    /// The channel header, or `None` when the route has no channel.
    /// The channel header. On a phone it leads with Back to the left pane; its Members button
    /// shows or hides the members at every width (`right_shown`: whether they are showing), and
    /// replaces an open side panel with them.
    pub(crate) fn header(
        &self,
        phone: bool,
        right_shown: bool,
        cx: &mut Context<Self>,
    ) -> Option<impl IntoElement + use<>> {
        let channel = self.channel()?;
        let sem = cx.sem();
        let pinned = self.pinned_count;
        let (secondary, primary_badge, on_primary_badge) =
            (sem.text_secondary, sem.primary, sem.primary_contrast);
        Some(
            Paper::new()
                .w_full()
                .flex_shrink_0()
                .px(px(16.))
                .py(px(8.))
                .flex()
                .items_center()
                .justify_between()
                .gap(px(8.))
                .when(phone, |header| header.child(self.phone_back(cx)))
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(6.))
                        .min_w_0()
                        .flex_1()
                        .when(channel.kind == ChannelKind::Voice, |row| {
                            // A voice channel's header, as the web's pre-join: the voice
                            // icon, not the text channel's hash.
                            row.child(Icon::new(IconName::VolumeUp).size(18.).color(secondary))
                        })
                        .child(
                            text(Variant::H6, header_title(channel.kind, &channel.name))
                                .font_weight(FontWeight(600.))
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
                        .gap(px(8.))
                        .child(
                            div()
                                .relative()
                                .child(
                                    IconButton::new(
                                        "header-pins",
                                        IconName::PushPin,
                                        format!("Pinned messages ({pinned})"),
                                    )
                                    .small()
                                    .on_click(
                                        cx.listener(|_, _, _, cx| cx.emit(ShellEvent::OpenPins)),
                                    ),
                                )
                                .when(pinned > 0, |this| {
                                    this.child(
                                        div()
                                            .absolute()
                                            .top(px(-5.))
                                            .right(px(-5.))
                                            .h(px(20.))
                                            .min_w(px(20.))
                                            .flex()
                                            .items_center()
                                            .justify_center()
                                            .rounded_full()
                                            .bg(primary_badge)
                                            .text_color(on_primary_badge)
                                            .child(text(Variant::Caption, pinned.to_string())),
                                    )
                                }),
                        )
                        .child(
                            IconButton::new("header-search", IconName::Search, "Search messages")
                                .small()
                                .on_click(
                                    cx.listener(|_, _, _, cx| cx.emit(ShellEvent::OpenSearch)),
                                ),
                        )
                        .child(match self.header_accessory.clone() {
                            Some(accessory) => accessory.into_any_element(),
                            None => IconButton::new(
                                "header-notifications",
                                IconName::AlternateEmail,
                                "Channel notifications",
                            )
                            .small()
                            .into_any_element(),
                        })
                        .child({
                            let view = cx.entity().downgrade();
                            IconButton::new("members-toggle", IconName::People, "Members")
                                .small()
                                .selected(right_shown)
                                .on_click(move |_, _, cx| {
                                    view.update(cx, |shell, cx| {
                                        if shell.side_panel.is_some() {
                                            // The members replace an open side panel, as on
                                            // the web: the owner closes it.
                                            shell.right_open = Some(true);
                                            cx.emit(ShellEvent::CloseSidePanel);
                                        } else {
                                            shell.right_open = Some(!right_shown);
                                        }
                                        cx.notify();
                                    })
                                    .ok();
                                })
                        }),
                ),
        )
    }
}

/// `ErrorState` in `ListState`: the community that didn't load.
pub(crate) fn error_state(
    id: &'static str,
    title: &str,
    description: &str,
    cx: &mut Context<Shell>,
) -> Div {
    let sem = cx.sem();
    let circle = 96.;
    let error = sem.error;
    let tint = error.opacity(if sem.is_dark { 0.16 } else { 0.1 });
    let view = cx.entity().downgrade();
    let (primary, secondary) = (sem.text_primary, sem.text_secondary);
    div()
        .flex()
        .flex_col()
        .items_center()
        .justify_center()
        .px(px(24.))
        .py(px(48.))
        .child(
            div()
                .size(px(circle))
                .mb(px(20.))
                .flex()
                .items_center()
                .justify_center()
                .rounded_full()
                .bg(tint)
                .child(Icon::new(IconName::Error).size(48.).color(error)),
        )
        .child(
            text(Variant::H6, title.to_owned())
                .font_weight(FontWeight(600.))
                .text_color(primary)
                .mb(px(4.))
                .text_center(),
        )
        .child(
            text(Variant::Body2, description.to_owned())
                .text_color(secondary)
                .max_w(px(300.))
                .mb(px(20.))
                .text_center(),
        )
        .child(
            Button::new(id, "Try again")
                .soft()
                .on_click(move |_, _, cx| {
                    view.update(cx, |_, cx| cx.emit(ShellEvent::Retry)).ok();
                }),
        )
}

#[cfg(feature = "stories")]
pub fn stories() -> Vec<crate::stories::Story> {
    let mut all = stories_impl::stories();
    all.extend(lounge::stories::stories());
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
