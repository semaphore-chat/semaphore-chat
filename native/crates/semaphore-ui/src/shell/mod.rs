//! The app shell: community rail, channel list, channel header, members panel, the resizable columns
//! between them, and the connection banner. Measures and colours come from `CommunityToggle`,
//! `ChannelList`, `ChannelRow`, `CommunityPage`, `ChannelMessageContainer` and `MemberList`.
//!
//! The middle column belongs to other units: the shell draws what [`ContentSlot`] returns for the
//! route. It reads through [`ShellSource`] and tells its owner what happened through [`ShellEvent`].

mod faces;
#[cfg(feature = "stories")]
pub mod fixtures;
mod members;
mod phone;
mod press;
mod rail;
mod sidebar;
mod source;
#[cfg(feature = "stories")]
pub mod stories_impl;

pub use source::{CoreSource, Load, MemberRow, RailCounts, ShellSource};

use crate::kit::LiveElement;
use crate::kit::{Button, Chip, Icon, IconButton, Paper, Spinner, Variant, on_core_event, text};
use crate::nav::{NavModel, Route};
use crate::theme::{FONT_FAMILY, SemTheme};
pub(crate) use faces::{community_avatar, user_avatar};
use gpui_kit::accesskit::Live;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::component::{ResizableState, h_resizable, resizable_panel};
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{ChannelKind, ChannelRow, CommunityRow, SessionState, ViewKey};
use semaphore_core::{ConnectionState, CoreEvent};
use semaphore_design::Icon as IconName;
use std::cell::Cell;
use std::collections::{HashMap, HashSet};
use std::rc::Rc;

/// From `constants/layout.ts`.
pub const RAIL_WIDTH: f32 = 80.;
pub const RAIL_EXPANDED_WIDTH: f32 = 160.;
pub const CHANNEL_SIDEBAR_WIDTH: f32 = 280.;
pub const MEMBER_LIST_WIDTH: f32 = 240.;
/// `useResponsive`: under this the members panel doesn't fit inline (`isNarrowDesktop`).
pub const NARROW_DESKTOP: f32 = 1024.;
/// `DEVICE_BREAKPOINTS.PHONE`: under this, one pane at a time.
pub const PHONE: f32 = 600.;
/// `SIDE_PANEL_WIDTH`: the docked pins, search and thread panel.
pub const SIDE_PANEL_WIDTH: f32 = 400.;
/// `DEVICE_BREAKPOINTS.DESKTOP`: from here up the side panel docks beside the messages; narrower
/// desktop windows draw it as a drawer, and the phone layout as a full-screen layer.
pub const DOCKED_PANEL: f32 = 1200.;

/// Draws the middle column for a route. Messages (U9) and the composer (U10) arrive here.
pub type ContentSlot = Rc<dyn Fn(&ContentProps, &mut Window, &mut App) -> AnyElement>;
/// Draws under the columns when there's something to show: the voice bar (U11).
pub type VoiceBarSlot = Rc<dyn Fn(&mut Window, &mut App) -> Option<AnyElement>>;
/// Draws the update card over the bottom-left corner, when there's an update to talk about.
pub type UpdateBannerSlot = Rc<dyn Fn(&mut Window, &mut App) -> Option<AnyElement>>;

/// Draws the sidebar column for a route outside a community: the DM list and friends on
/// `/direct-messages`. `None` leaves the route without one. On a phone the shell shows what it
/// returns in place of the middle column, so the owner returns `None` there for a route whose
/// content should show instead (an open conversation).
pub type RouteSidebarSlot =
    Rc<dyn Fn(&RouteSidebarProps, &mut Window, &mut App) -> Option<AnyElement>>;

/// What the shell knows when asking for a route's sidebar.
#[derive(Debug, Clone)]
pub struct RouteSidebarProps {
    pub route: Route,
    /// The phone layout: the sidebar would fill the pane between the app bar and the navigation.
    pub phone: bool,
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
    /// A voice row was pressed.
    JoinVoice {
        channel_id: String,
    },
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
    /// The drawer's scrim was clicked: the owner closes the side panel.
    CloseSidePanel,
}

pub struct Shell {
    pub(crate) source: Rc<dyn ShellSource>,
    pub(crate) nav: NavModel,
    pub(crate) connection: ConnectionState,
    pub(crate) rail_expanded: bool,
    pub(crate) members_open: bool,
    /// Phone layout only: whether the rail is drawn over the list.
    pub(crate) phone_rail_open: bool,
    /// Phone layout only: the content pane instead of the channel list.
    pub(crate) phone_content: bool,
    /// Touch-list categories folded away: `ChannelCategoryList`'s chevrons.
    pub(crate) collapsed: HashSet<&'static str>,
    /// `lastChannel`: the channel to reopen in each community.
    pub(crate) last_channel: HashMap<String, String>,
    pub(crate) columns: Entity<ResizableState>,
    /// With nothing focused GPUI sends keys past the kit's root, and Tab does nothing, so the shell
    /// holds focus until the user moves it.
    pub(crate) focus: FocusHandle,
    pub(crate) took_focus: bool,
    /// [`ContentProps::take_focus`] for the next drawing of a channel.
    pub(crate) focus_content: Cell<bool>,
    pub(crate) content: ContentSlot,
    pub(crate) voice_bar: Option<VoiceBarSlot>,
    /// The update card, drawn over the connection chip (W13).
    pub(crate) update_banner: Option<UpdateBannerSlot>,
    /// How many pinned messages the header's badge shows. Fed by the owner.
    pub pinned_count: u32,
    /// Pins, search or a thread, beside the messages. Set by the owner.
    pub(crate) side_panel: Option<AnyView>,
    pub(crate) route_sidebar: Option<RouteSidebarSlot>,
    /// The channel header's notification level control. Set by the owner.
    pub(crate) header_accessory: Option<AnyView>,
    /// W5: the phone layout was drawn last: a member row opens its menu on a long press.
    pub(crate) touch: Cell<bool>,
    /// W5: a press on a member row, and its timer.
    pub(crate) member_press: Option<(press::Press, Task<()>)>,
}

impl EventEmitter<ShellEvent> for Shell {}

impl Shell {
    pub fn new(
        source: Rc<dyn ShellSource>,
        route: Route,
        content: ContentSlot,
        connection: ConnectionState,
        cx: &mut Context<Self>,
    ) -> Self {
        let signed_in = matches!(source.session(), SessionState::SignedIn { .. });
        on_core_event(cx.entity().downgrade(), Self::on_core, cx);
        let mut shell = Self {
            source,
            nav: NavModel::new(route, signed_in),
            connection,
            rail_expanded: false,
            members_open: false,
            phone_rail_open: false,
            phone_content: false,
            collapsed: HashSet::new(),
            last_channel: HashMap::new(),
            columns: cx.new(|_| ResizableState::default()),
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
            touch: Cell::new(false),
            member_press: None,
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

    /// The update card in the bottom-left notice corner, above the connection chip.
    pub fn with_update_banner(mut self, slot: UpdateBannerSlot) -> Self {
        self.update_banner = Some(slot);
        self
    }

    /// What the route sidebar slot draws for the route on screen.
    pub(crate) fn route_sidebar(
        &self,
        phone: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let slot = self.route_sidebar.clone()?;
        let props = RouteSidebarProps {
            route: self.nav.current().clone(),
            phone,
        };
        slot(&props, window, cx)
    }

    /// Draws `view` in the channel header in place of the notification level button, and in the
    /// phone app bar beside the members button: the owner's level menu for the channel on screen.
    /// `None` puts the plain button back (and nothing on a phone).
    pub fn set_header_accessory(&mut self, view: Option<AnyView>, cx: &mut Context<Self>) {
        self.header_accessory = view;
        cx.notify();
    }

    /// Shows `panel` beside the messages (docked, a drawer, or a full-screen layer on a phone,
    /// by window width), or closes it. While open it takes the members panel's place.
    pub fn set_side_panel(&mut self, panel: Option<AnyView>, cx: &mut Context<Self>) {
        self.side_panel = panel;
        cx.notify();
    }

    pub fn side_panel_open(&self) -> bool {
        self.side_panel.is_some()
    }

    /// The side panel over a scrim that asks the owner to close it.
    pub(crate) fn side_panel_drawer(
        &self,
        full_screen: bool,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let panel = self.side_panel.clone()?;
        let view = cx.entity().downgrade();
        let sem = cx.sem();
        let paper = sem.paper;
        Some(
            div()
                .absolute()
                .inset_0()
                .child(
                    div()
                        .id("side-panel-scrim")
                        .test_support()
                        .absolute()
                        .inset_0()
                        .occlude()
                        .bg(hsla(0., 0., 0., 0.5))
                        .on_click(move |_, _, cx| {
                            view.update(cx, |_, cx| cx.emit(ShellEvent::CloseSidePanel))
                                .ok();
                        }),
                )
                .child(
                    div()
                        .id("side-panel")
                        .test_support()
                        .absolute()
                        .top_0()
                        .bottom_0()
                        .right_0()
                        .when(full_screen, |this| this.left_0())
                        .when(!full_screen, |this| {
                            this.w(px(SIDE_PANEL_WIDTH)).max_w_full()
                        })
                        .occlude()
                        .shadow_lg()
                        .bg(paper)
                        .child(panel),
                )
                .into_any_element(),
        )
    }

    pub fn nav(&self) -> &NavModel {
        &self.nav
    }

    pub fn navigate(&mut self, route: Route, cx: &mut Context<Self>) {
        self.nav.navigate(route);
        self.settle_route();
        self.phone_rail_open = false;
        self.phone_content = self.nav.current().channel_id().is_some();
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
        self.phone_content = self.nav.current().channel_id().is_some();
        self.focus_content.set(true);
        cx.emit(ShellEvent::Navigated(self.nav.current().clone()));
        cx.notify();
    }

    /// `semaphore://` handed to us by the OS. A bad link does nothing, and returns false.
    pub fn open_deep_link(&mut self, raw: &str, cx: &mut Context<Self>) -> bool {
        let handled = self.nav.open_deep_link(raw);
        if handled {
            self.settle_route();
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
                        .child(Spinner::new("community-loading"))
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
                            false,
                            cx,
                        ))
                        .into_any_element();
                }
                Load::Ready(_) => {}
            }
        }
        let channel = self.channel();
        // Kept until a channel is drawn: a route still loading has nothing to focus yet.
        let take_focus = channel.is_some() && self.focus_content.take();
        let props = ContentProps {
            route: self.nav.current().clone(),
            channel,
            community: self.community(),
            take_focus,
        };
        (self.content)(&props, window, cx)
    }

    /// The channel header, or `None` when the route has no channel.
    fn header(&self, narrow: bool, cx: &mut Context<Self>) -> Option<impl IntoElement + use<>> {
        let channel = self.channel()?;
        let sem = cx.sem();
        let pinned = self.pinned_count;
        let (secondary, primary_badge) = (sem.text_secondary, sem.primary);
        let icon_color = sem.action_active;
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
                            text(
                                Variant::H6,
                                match channel.kind {
                                    ChannelKind::Voice => channel.name.clone(),
                                    _ => format!("# {}", channel.name),
                                },
                            )
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
                                    .tiny()
                                    .color(icon_color)
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
                                            .text_color(rgb(0xffffff))
                                            .child(text(Variant::Caption, pinned.to_string())),
                                    )
                                }),
                        )
                        .child(
                            IconButton::new("header-search", IconName::Search, "Search messages")
                                .tiny()
                                .color(icon_color)
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
                            .small_with_large_icon()
                            .color(icon_color)
                            .into_any_element(),
                        })
                        .when(narrow, |row| {
                            let view = cx.entity().downgrade();
                            row.child(
                                IconButton::new("members-toggle", IconName::People, "Members")
                                    .small_with_large_icon()
                                    .color(icon_color)
                                    .selected(self.members_open)
                                    .on_click(move |_, _, cx| {
                                        view.update(cx, |shell, cx| {
                                            shell.members_open = !shell.members_open;
                                            cx.notify();
                                        })
                                        .ok();
                                    }),
                            )
                        }),
                ),
        )
    }

    /// `MemberListDrawerButton`'s drawer: the panel over a scrim that closes it.
    pub(crate) fn members_drawer(&self, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let view = cx.entity().downgrade();
        div()
            .absolute()
            .inset_0()
            .child(
                div()
                    .id("members-scrim")
                    .test_support()
                    .absolute()
                    .inset_0()
                    .occlude()
                    .bg(hsla(0., 0., 0., 0.5))
                    .on_click(move |_, _, cx| {
                        view.update(cx, |shell, cx| {
                            shell.members_open = false;
                            cx.notify();
                        })
                        .ok();
                    }),
            )
            .child(
                div()
                    .absolute()
                    .top_0()
                    .bottom_0()
                    .right_0()
                    .occlude()
                    .shadow_lg()
                    .child(self.members_panel(cx)),
            )
    }

    /// The bottom-left corner's notices, stacked: the update card (when there is one), then the
    /// connection chip. One column, so the two never overlap.
    pub(crate) fn notices(
        &self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let update = self
            .update_banner
            .as_ref()
            .and_then(|slot| slot(window, cx));
        let connection = self.connection_chip(cx);
        if update.is_none() && connection.is_none() {
            return None;
        }
        Some(
            div()
                .absolute()
                .left(px(16.))
                .right(px(16.))
                .bottom(px(16.))
                .flex()
                .flex_col()
                .items_start()
                .gap(px(8.))
                .children(update)
                .children(connection)
                .into_any_element(),
        )
    }

    fn connection_chip(&self, cx: &App) -> Option<AnyElement> {
        let sem = cx.sem();
        let label = match self.connection {
            ConnectionState::Connected | ConnectionState::Suspended => return None,
            ConnectionState::Disconnected => "Reconnecting...",
            ConnectionState::Offline => "You're offline",
        };
        let warning = sem.warning;
        Some(
            // The web's `OfflineBanner`/connection strip is `role="status"`: polite.
            div()
                .id("connection-banner")
                .test_support()
                .role(Role::Status)
                .aria_label(label)
                .aria_live(Live::Polite)
                .child(
                    Chip::new(label)
                        .icon(Spinner::new("connection-spinner").size(14.).color(warning))
                        .colors(sem.paper, warning, warning),
                )
                .into_any_element(),
        )
    }

    pub(crate) fn body_ground(&self, cx: &App) -> Div {
        let sem = cx.sem();
        div()
            .relative()
            .size_full()
            .font_family(FONT_FAMILY)
            .text_color(sem.text_primary)
            .bg(sem.background_default)
            .when(sem.body_band > px(0.), |this| {
                this.child(
                    div()
                        .absolute()
                        .top_0()
                        .left_0()
                        .right_0()
                        .h(sem.body_band)
                        .bg(sem.body.background()),
                )
            })
    }
}

impl Render for Shell {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if !self.took_focus {
            self.took_focus = true;
            window.focus(&self.focus, cx);
        }
        let width = f32::from(window.viewport_size().width);
        self.touch.set(width < PHONE);
        if width < PHONE {
            return self
                .render_phone(window, cx)
                .track_focus(&self.focus)
                .into_any_element();
        }

        let narrow = width < NARROW_DESKTOP;
        let in_community = self.nav.current().community_id().is_some();
        let docked = self.side_panel.clone().filter(|_| width >= DOCKED_PANEL);
        let drawer = if docked.is_none() {
            self.side_panel_drawer(false, cx)
        } else {
            None
        };
        let panel_open = self.side_panel.is_some();
        let show_members = in_community && !narrow && !panel_open;
        let overlay_members = in_community && narrow && self.members_open && !panel_open;
        let divider = cx.sem().divider;

        let sidebar = self.sidebar(window, cx);
        let content = self.content_element(window, cx);
        let header = self.header(narrow, cx);
        let voice_bar = self.voice_bar.clone().and_then(|slot| slot(window, cx));

        let main = div()
            .relative()
            .size_full()
            .flex()
            .flex_col()
            .children(header)
            .child(
                div()
                    .flex_1()
                    .min_h_0()
                    .flex()
                    .child(div().flex_1().min_w_0().h_full().child(content))
                    .when(show_members, |row| row.child(self.members_panel(cx)))
                    .when_some(docked, |row, panel| {
                        row.child(
                            div()
                                .id("side-panel")
                                .test_support()
                                .w(px(SIDE_PANEL_WIDTH))
                                .flex_shrink_0()
                                .h_full()
                                .border_l_1()
                                .border_color(divider)
                                .child(panel),
                        )
                    }),
            );

        let columns = match sidebar {
            Some(sidebar) => h_resizable("shell-columns")
                .with_state(&self.columns)
                .child(
                    resizable_panel()
                        .size(px(CHANNEL_SIDEBAR_WIDTH))
                        .size_range(px(220.)..px(320.))
                        .child(sidebar),
                )
                .child(resizable_panel().child(main))
                .into_any_element(),
            None => main.into_any_element(),
        };

        self.body_ground(cx)
            .track_focus(&self.focus)
            .flex()
            .flex_col()
            .child(
                div()
                    .relative()
                    .flex_1()
                    .min_h_0()
                    .flex()
                    .child(self.rail(cx))
                    .child(div().flex_1().min_w_0().h_full().child(columns))
                    .when(overlay_members, |this| this.child(self.members_drawer(cx)))
                    .children(drawer)
                    // In here, so it always clears the voice bar, as `BottomChromeContext` does.
                    .children(self.notices(window, cx)),
            )
            .children(voice_bar)
            .into_any_element()
    }
}

/// `ErrorState` in `ListState`, compact and regular.
pub(crate) fn error_state(
    id: &'static str,
    title: &str,
    description: &str,
    compact: bool,
    cx: &mut Context<Shell>,
) -> Div {
    let sem = cx.sem();
    let circle = if compact { 56. } else { 96. };
    let error = sem.error;
    let tint = error.opacity(if sem.is_dark { 0.16 } else { 0.1 });
    let view = cx.entity().downgrade();
    let (primary, secondary) = (sem.text_primary, sem.text_secondary);
    div()
        .flex()
        .flex_col()
        .items_center()
        .justify_center()
        .px(px(if compact { 16. } else { 24. }))
        .py(px(if compact { 24. } else { 48. }))
        .child(
            div()
                .size(px(circle))
                .mb(px(if compact { 12. } else { 20. }))
                .flex()
                .items_center()
                .justify_center()
                .rounded_full()
                .bg(tint)
                .child(
                    Icon::new(IconName::Error)
                        .size(if compact { 32. } else { 48. })
                        .color(error),
                ),
        )
        .child(
            text(
                if compact {
                    Variant::Subtitle2
                } else {
                    Variant::H6
                },
                title.to_owned(),
            )
            .font_weight(FontWeight(600.))
            .text_color(primary)
            .mb(px(4.))
            .text_center(),
        )
        .child(
            text(
                if compact {
                    Variant::Caption
                } else {
                    Variant::Body2
                },
                description.to_owned(),
            )
            .text_color(secondary)
            .max_w(px(300.))
            .mb(px(if compact { 12. } else { 20. }))
            .text_center(),
        )
        .child(
            Button::new(id, "Try again")
                .outlined()
                .on_click(move |_, _, cx| {
                    view.update(cx, |_, cx| cx.emit(ShellEvent::Retry)).ok();
                }),
        )
}

#[cfg(feature = "stories")]
pub fn stories() -> Vec<crate::stories::Story> {
    stories_impl::stories()
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
