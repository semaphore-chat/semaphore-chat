//! The Lounge frame (design §4): what the shell draws. `AppFrame` with the banner row around
//! `ThreeIslands`; the dock, the left island (the community's, or the inbox's), the centre (the
//! channel header over the owner's content), the right content (the side panel while one is open,
//! else the community's members) and the call slot. Each piece is a `lounge` view built here from
//! the source, as the web's `ThreeIslandsFrame` builds its `*Connected` pieces.

use super::lounge::lines::{CallStatus, Mic, around_count, group_members, inbox_count};
use super::lounge::{
    AllCommunitiesSheet, ChannelItem, ChannelSection, CommunityHeader, CommunityHome,
    CommunityLeft, CommunityLeftAccess, DockCommunity, DockCurrent, DockStatus, Face, FootRow,
    HomeState, MembersIsland, Retry, RoomPerson, SheetCommunity, ShellDock, UserCard,
    VoiceRoomCard,
};
use super::{Load, RouteSidebarProps, Shell, ShellEvent};
use crate::community_settings::rules::opens_settings;
use crate::kit::{
    Alert, AppFrame, IconButton, PhonePane, Severity, ThreeIslands, Variant, WidthRange, text,
};
use crate::nav::Route;
use crate::theme::SemTheme;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::ConnectionState;
use semaphore_core::model::{
    ChannelKind, ChannelPreset, ChannelRow, CommunityRow, SessionState, VoiceRoom, VoiceStatus,
};
use semaphore_design::Icon as IconName;
use std::collections::HashSet;

/// Which pane a phone shows for a route: a place's list (a community without a channel, the DM
/// list), or the centre.
pub(crate) fn pane_for(route: &Route) -> PhonePane {
    match route {
        Route::Community { .. } | Route::DirectMessages => PhonePane::Left,
        _ => PhonePane::Centre,
    }
}

/// Whether the route is in the inbox's place: the DMs (and, until their screens convert, the
/// pages the old shell drew outside a community).
fn dock_current(route: &Route) -> DockCurrent {
    match route {
        Route::DirectMessages | Route::DirectMessage { .. } => DockCurrent::Inbox,
        route => route
            .community_id()
            .map(|id| DockCurrent::Community(id.to_owned()))
            .unwrap_or_default(),
    }
}

fn shown_name(display: Option<&str>, username: &str) -> String {
    display
        .filter(|name| !name.trim().is_empty())
        .unwrap_or(username)
        .to_owned()
}

impl Shell {
    /// Back to the left pane, on a phone.
    pub(crate) fn phone_back(&self, cx: &mut Context<Self>) -> IconButton {
        let view = cx.entity().downgrade();
        IconButton::new("phone-back", IconName::ArrowBack, "Back").on_click(move |_, _, cx| {
            view.update(cx, |shell, cx| {
                shell.phone_pane = PhonePane::Left;
                cx.notify();
            })
            .ok();
        })
    }

    fn dock(&self, cx: &mut Context<Self>) -> ShellDock {
        let (communities, status) = match self.source.communities() {
            Load::Ready(rows) => (rows, DockStatus::Ready),
            Load::Loading => (Vec::new(), DockStatus::Loading),
            Load::Failed(_) => (Vec::new(), DockStatus::Error),
        };
        let counts = self.source.rail_counts();
        let items = communities
            .iter()
            .map(|row| DockCommunity {
                id: row.id.clone(),
                name: row.name.clone(),
                file: row.avatar_file_id.clone(),
                mentions: row.mention_count,
                new_messages: row.unread_count > 0 && row.mention_count == 0,
            })
            .collect();
        let (inbox, all, open) = (
            cx.entity().downgrade(),
            cx.entity().downgrade(),
            cx.entity().downgrade(),
        );
        ShellDock::new(items, dock_current(self.nav.current()), status)
            .inbox_count(inbox_count(counts.dm_unread, &communities))
            .on_inbox(move |_, cx| {
                inbox
                    .update(cx, |shell, cx| {
                        shell.navigate(Route::DirectMessages, cx);
                    })
                    .ok();
            })
            .on_all(move |_, cx| {
                all.update(cx, |shell, cx| {
                    shell.sheet_open = true;
                    cx.notify();
                })
                .ok();
            })
            .on_community(move |id, _, cx| {
                let community_id = id.to_owned();
                open.update(cx, |shell, cx| {
                    // A phone opens the community's home: its channels and rooms (`navigate`
                    // takes the pane from the route asked for).
                    shell.navigate(Route::Community { community_id }, cx);
                })
                .ok();
            })
    }

    fn sheet(&self, window: &mut Window, cx: &mut Context<Self>) -> AllCommunitiesSheet {
        let (communities, face) = match self.source.communities() {
            Load::Ready(rows) if rows.is_empty() => (rows, Face::Empty),
            Load::Ready(rows) => (rows, Face::Ready),
            Load::Loading => (Vec::new(), Face::Loading),
            Load::Failed(error) => (
                Vec::new(),
                Face::Error(error.message, Retry::new(self.retry(cx))),
            ),
        };
        let call_community = match self.source.voice().room {
            Some(VoiceRoom::Channel { community_id, .. }) => community_id,
            _ => None,
        };
        let rows = communities
            .iter()
            .map(|row: &CommunityRow| SheetCommunity {
                id: row.id.clone(),
                name: row.name.clone(),
                file: row.avatar_file_id.clone(),
                mentions: row.mention_count,
                new_messages: row.unread_count > 0,
                in_your_call: call_community.as_deref() == Some(row.id.as_str()),
            })
            .collect();
        let username = match self.source.session() {
            SessionState::SignedIn { me } => Some(me.username),
            _ => None,
        };
        let (close, open, foot) = (
            cx.entity().downgrade(),
            cx.entity().downgrade(),
            cx.entity().downgrade(),
        );
        AllCommunitiesSheet::new(self.instance_label.clone(), rows, face)
            .username(username)
            .current(self.nav.current().community_id().map(str::to_owned))
            .can_create(self.source.can_create_community())
            .filter(&self.filter)
            .phone_foot(WidthRange::current(window).is_phone())
            .notification_count(self.source.rail_counts().notifications_unread)
            .on_close(move |_, _, cx| {
                close
                    .update(cx, |shell, cx| {
                        shell.sheet_open = false;
                        cx.notify();
                    })
                    .ok();
            })
            .on_community(move |id, _, cx| {
                let community_id = id.to_owned();
                open.update(cx, |shell, cx| {
                    shell.navigate(Route::Community { community_id }, cx);
                })
                .ok();
            })
            .on_foot(move |row, _, cx| {
                foot.update(cx, |shell, cx| {
                    shell.sheet_open = false;
                    match row {
                        FootRow::Create => cx.emit(ShellEvent::CreateCommunity),
                        FootRow::Notifications => cx.emit(ShellEvent::OpenNotifications),
                        FootRow::Settings => shell.navigate(
                            Route::Settings {
                                tab: Default::default(),
                            },
                            cx,
                        ),
                        FootRow::Profile => shell.navigate(Route::OwnProfile, cx),
                        // The app's account menu, where signing out is confirmed (B16/B18 bring
                        // the web's question).
                        FootRow::SignOut => cx.emit(ShellEvent::OpenAccountMenu),
                    }
                    cx.notify();
                })
                .ok();
            })
    }

    /// Try again for a failed list: the owner retries what failed.
    fn retry(&self, cx: &mut Context<Self>) -> impl Fn(&mut Window, &mut App) + 'static {
        let view = cx.entity().downgrade();
        move |_, cx| {
            view.update(cx, |_, cx| cx.emit(ShellEvent::Retry)).ok();
        }
    }

    fn left_island(
        &self,
        community_id: &str,
        right_beside: bool,
        cx: &mut Context<Self>,
    ) -> CommunityLeft {
        let community = self.community();
        let missing = matches!(self.source.communities(), Load::Ready(_)) && community.is_none();
        let channels = self.source.channels(community_id);
        let members = self.source.members(community_id);
        let truncated = self.source.members_truncated(community_id);
        let caps = self.source.community_caps(community_id);
        let voice = self.source.voice();
        let me = match self.source.session() {
            SessionState::SignedIn { me } => Some(me.id),
            _ => None,
        };
        let rows: Vec<ChannelRow> = match &channels {
            Load::Ready(rows) => {
                let mut rows = rows.clone();
                rows.sort_by_key(|row| row.position);
                rows
            }
            _ => Vec::new(),
        };
        let around = match &members {
            Load::Ready(list) => around_count(&group_members(list, &rows), truncated),
            _ => None,
        };

        let view = cx.entity().downgrade();
        let menu_view = view.clone();
        let close_view = view.clone();
        let settings_view = view.clone();
        let create_view = view.clone();
        let members_view = view.clone();
        let (settings_id, create_id) = (community_id.to_owned(), community_id.to_owned());
        let header = CommunityHeader::new(community.as_ref().map(|row| row.name.clone()))
            .file(
                community
                    .as_ref()
                    .and_then(|row| row.avatar_file_id.clone()),
            )
            .around(around)
            .can_settings(opens_settings(&caps))
            .can_create_channel(caps.create_channel)
            .menu_open(self.menu_open)
            .members_shown(right_beside)
            .on_show_members(move |_, cx| {
                members_view
                    .update(cx, |shell, cx| shell.show_members(cx))
                    .ok();
            })
            .on_menu(move |_, cx| {
                menu_view
                    .update(cx, |shell, cx| {
                        shell.menu_open = !shell.menu_open;
                        cx.notify();
                    })
                    .ok();
            })
            .on_menu_close(move |_, cx| {
                close_view
                    .update(cx, |shell, cx| {
                        shell.menu_open = false;
                        cx.notify();
                    })
                    .ok();
            })
            .on_settings(move |_, cx| {
                let community_id = settings_id.clone();
                settings_view
                    .update(cx, |shell, cx| {
                        shell.menu_open = false;
                        cx.emit(ShellEvent::OpenCommunitySettings { community_id });
                    })
                    .ok();
            })
            .on_create_channel(move |_, cx| {
                let community_id = create_id.clone();
                create_view
                    .update(cx, |shell, cx| {
                        shell.menu_open = false;
                        cx.emit(ShellEvent::CreateChannel { community_id });
                    })
                    .ok();
            });

        let text_rows: Vec<&ChannelRow> = rows
            .iter()
            .filter(|row| row.kind == ChannelKind::Text)
            .collect();
        let voice_rows: Vec<&ChannelRow> = rows
            .iter()
            .filter(|row| row.kind == ChannelKind::Voice)
            .collect();
        let face = match &channels {
            Load::Loading => Face::Loading,
            Load::Failed(error) => Face::Error(error.message.clone(), Retry::new(self.retry(cx))),
            Load::Ready(_) if text_rows.is_empty() => Face::Empty,
            Load::Ready(_) => Face::Ready,
        };
        let items = text_rows
            .iter()
            .map(|row| ChannelItem {
                id: row.id.clone(),
                name: row.name.clone(),
                unread: row.unread_count > 0,
                mentions: row.mention_count,
                private: row.is_private,
                announcement: row.preset == ChannelPreset::Announcement,
            })
            .collect();
        let pick = view.clone();
        let pick_community = community_id.to_owned();
        let channels_view = ChannelSection::new(items, face)
            .selected(self.nav.current().channel_id().map(str::to_owned))
            .has_rooms(!voice_rows.is_empty())
            .scroll(&self.left_scroll)
            .on_channel(move |id, _, cx| {
                let route = Route::Channel {
                    community_id: pick_community.clone(),
                    channel_id: id.to_owned(),
                };
                pick.update(cx, |shell, cx| shell.navigate(route, cx)).ok();
            });

        let speaking: HashSet<String> = voice
            .participants
            .iter()
            // Only someone who can be heard, as the old voice row's ring.
            .filter(|participant| {
                participant.speaking && !participant.muted && !participant.deafened
            })
            .map(|participant| participant.user.id.clone())
            .collect();
        let rooms = voice_rows
            .iter()
            .map(|row| {
                let here = voice.channel_id.as_deref() == Some(row.id.as_str())
                    && voice.status != VoiceStatus::Disconnected;
                let people = row
                    .voice_users
                    .iter()
                    .map(|user| RoomPerson {
                        id: user.id.clone(),
                        name: shown_name(user.display_name.as_deref(), &user.username),
                        file: user.avatar_file_id.clone(),
                    })
                    .collect();
                let (join_id, open_route) = (
                    row.id.clone(),
                    Route::Channel {
                        community_id: community_id.to_owned(),
                        channel_id: row.id.clone(),
                    },
                );
                let (join, leave, open) = (view.clone(), view.clone(), view.clone());
                VoiceRoomCard::new(row.id.clone(), row.name.clone(), people)
                    .you(me.clone())
                    .you_are_here(here)
                    .speaking(if here {
                        speaking.clone()
                    } else {
                        HashSet::new()
                    })
                    .can_join(row.permissions.as_ref().is_none_or(|perms| perms.connect))
                    .joining(
                        voice.status == VoiceStatus::Connecting
                            && voice.channel_id.as_deref() == Some(row.id.as_str()),
                    )
                    .on_join(move |_, cx| {
                        let channel_id = join_id.clone();
                        join.update(cx, |_, cx| cx.emit(ShellEvent::JoinVoice { channel_id }))
                            .ok();
                    })
                    .on_leave(move |_, cx| {
                        leave
                            .update(cx, |_, cx| cx.emit(ShellEvent::LeaveVoice))
                            .ok();
                    })
                    .on_open(move |_, cx| {
                        let route = open_route.clone();
                        open.update(cx, |shell, cx| shell.navigate(route, cx)).ok();
                    })
            })
            .collect();
        let home = view.clone();
        CommunityLeft::new(header, channels_view)
            .access(if missing {
                CommunityLeftAccess::NotMember
            } else {
                CommunityLeftAccess::Member
            })
            .rooms(rooms)
            .on_leave(move |_, cx| {
                home.update(cx, |shell, cx| shell.navigate(Route::Home, cx))
                    .ok();
            })
    }

    /// The community home's centre (B12), for a community with no channel chosen.
    pub(crate) fn community_home(
        &self,
        community_id: &str,
        members_shown: bool,
        cx: &mut Context<Self>,
    ) -> CommunityHome {
        let community = self.community();
        let state = match (
            self.source.communities(),
            self.source.channels(community_id),
        ) {
            (Load::Loading, _) => HomeState::Loading,
            (Load::Failed(error), _) => {
                HomeState::CommunityError(error.message, Retry::new(self.retry(cx)))
            }
            (Load::Ready(_), _) if community.is_none() => HomeState::NotMember,
            (Load::Ready(_), Load::Loading) => HomeState::Loading,
            (Load::Ready(_), Load::Failed(error)) => {
                HomeState::ChannelsError(error.message, Retry::new(self.retry(cx)))
            }
            (Load::Ready(_), Load::Ready(rows)) => HomeState::Ready {
                text_channels: rows.iter().any(|row| row.kind == ChannelKind::Text),
                rooms: rows.iter().any(|row| row.kind == ChannelKind::Voice),
            },
        };
        let caps = self.source.community_caps(community_id);
        let (members_view, create_view) = (cx.entity().downgrade(), cx.entity().downgrade());
        let create_id = community_id.to_owned();
        CommunityHome::new(community.map(|row| row.name), state)
            .can_create_channel(caps.create_channel)
            .members_shown(members_shown)
            .on_show_members(move |_, cx| {
                members_view
                    .update(cx, |shell, cx| shell.show_members(cx))
                    .ok();
            })
            .on_create_channel(move |_, cx| {
                let community_id = create_id.clone();
                create_view
                    .update(cx, |_, cx| {
                        cx.emit(ShellEvent::CreateChannel { community_id })
                    })
                    .ok();
            })
    }

    fn members_island(&self, community_id: &str, cx: &mut Context<Self>) -> MembersIsland {
        let channels = match self.source.channels(community_id) {
            Load::Ready(rows) => rows,
            _ => Vec::new(),
        };
        let truncated = self.source.members_truncated(community_id);
        let (groups, face) = match self.source.members(community_id) {
            Load::Ready(rows) if rows.is_empty() => (Default::default(), Face::Empty),
            Load::Ready(rows) => (group_members(&rows, &channels), Face::Ready),
            Load::Loading => (Default::default(), Face::Loading),
            Load::Failed(error) => (
                Default::default(),
                Face::Error(error.message, Retry::new(self.retry(cx))),
            ),
        };
        let around = around_count(&groups, truncated);
        let (profile, menu) = (cx.entity().downgrade(), cx.entity().downgrade());
        let menu_community = community_id.to_owned();
        MembersIsland::new(groups, face)
            .around(around)
            .truncated(truncated)
            .scroll(&self.right_scroll)
            .on_profile(move |id, _, cx| {
                let user_id = id.to_owned();
                profile
                    .update(cx, |_, cx| cx.emit(ShellEvent::OpenProfile { user_id }))
                    .ok();
            })
            .on_menu(move |id, position, _, cx| {
                let (community_id, user_id) = (menu_community.clone(), id.to_owned());
                menu.update(cx, |_, cx| {
                    cx.emit(ShellEvent::MemberMenu {
                        community_id,
                        user_id,
                        position,
                    })
                })
                .ok();
            })
    }

    fn user_card(&self, cx: &mut Context<Self>) -> Option<UserCard> {
        let SessionState::SignedIn { me } = self.source.session() else {
            return None;
        };
        let voice = self.source.voice();
        let in_call = voice.room.is_some() && voice.status != VoiceStatus::Disconnected;
        let room_name = voice.channel_id.as_ref().and_then(|channel_id| {
            let community = match &voice.room {
                Some(VoiceRoom::Channel { community_id, .. }) => community_id.clone(),
                _ => None,
            }?;
            match self.source.channels(&community) {
                Load::Ready(rows) => rows
                    .into_iter()
                    .find(|row| &row.id == channel_id)
                    .map(|row| row.name),
                _ => None,
            }
        });
        let line = in_call.then(|| match room_name {
            Some(name) => format!("In {name}"),
            None => "In a call".to_owned(),
        });
        let call = in_call.then_some(CallStatus {
            mic: if voice.server_muted {
                Mic::ServerMuted
            } else if voice.muted {
                Mic::Muted
            } else {
                Mic::On
            },
            deafened: voice.deafened,
            key_label: None,
        });
        let account = cx.entity().downgrade();
        Some(
            UserCard::new(Some(shown_name(me.display_name.as_deref(), &me.username)))
                .person(me.id.clone(), me.avatar_file_id.clone())
                .line(line)
                .call(call)
                .on_account(move |_, cx| {
                    account
                        .update(cx, |_, cx| cx.emit(ShellEvent::OpenAccountMenu))
                        .ok();
                }),
        )
    }

    /// The inbox's left island: the DM list the owner draws for the DM routes, shown on every
    /// route outside a community until those screens convert (B14).
    fn inbox_left(&self, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let route = match self.nav.current() {
            route @ (Route::DirectMessages | Route::DirectMessage { .. }) => route.clone(),
            _ => Route::DirectMessages,
        };
        let props = RouteSidebarProps { route };
        self.route_sidebar
            .clone()
            .and_then(|slot| slot(&props, window, cx))
            .unwrap_or_else(|| {
                text(Variant::Body1, "Inbox")
                    .text_color(cx.sem().text_secondary)
                    .into_any_element()
            })
    }

    fn banners(&self, window: &mut Window, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let mut banners = Vec::new();
        let connection = match self.connection {
            ConnectionState::Connected | ConnectionState::Suspended => None,
            ConnectionState::Disconnected => Some((
                "Reconnecting",
                "Reconnecting to the server. Messages you send will wait until it's back.",
            )),
            ConnectionState::Offline => Some((
                "You're offline",
                "Messages you send will wait until the connection is back.",
            )),
        };
        if let Some((title, message)) = connection {
            banners.push(
                div()
                    .id("connection-banner")
                    .test_support()
                    .child(
                        Alert::new("connection-alert", Severity::Warning, message)
                            .title(title)
                            .announce(true),
                    )
                    .into_any_element(),
            );
        }
        if let Some(update) = self
            .update_banner
            .as_ref()
            .and_then(|slot| slot(window, cx))
        {
            banners.push(update);
        }
        banners
    }
}

impl Shell {
    /// The side panel below wide: a kit [`Drawer`](crate::kit::Drawer), a modal layer of the
    /// window's overlay stack at the right edge (`SIDE_PANEL_WIDTH`) or, on a phone, over the
    /// whole window. Escape and the scrim ask the owner to close it; focus moves in on open and
    /// back to the opener on close. The panel brings its own header and Close, and fills the
    /// drawer's height.
    fn side_panel_drawer(&self, panel: AnyView, phone: bool, cx: &mut Context<Self>) -> AnyElement {
        let view = cx.entity().downgrade();
        crate::kit::Drawer::new("side-panel-drawer", "Details", super::SIDE_PANEL_WIDTH)
            .full(phone)
            .on_request_close(move |_, _, cx| {
                view.update(cx, |_, cx| cx.emit(ShellEvent::CloseSidePanel))
                    .ok();
            })
            .child(
                div()
                    .id("side-panel")
                    .test_support()
                    .size_full()
                    .child(panel),
            )
            .into_any_element()
    }
}

impl Render for Shell {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if !self.took_focus {
            self.took_focus = true;
            window.focus(&self.focus, cx);
        }
        let range = WidthRange::current(window);
        let phone = range.is_phone();
        let route = self.nav.current().clone();
        let community_id = route.community_id().map(str::to_owned);
        // The side panel (pins, search, a thread) the owner opens: the right island at wide; below
        // it a drawer over the frame (a full-screen layer on a phone), whose definite height its
        // own list and header need (a Sheet's body takes its height from its content).
        let panel = self.side_panel.clone();
        let (island_panel, drawer_panel) = match panel {
            Some(panel) if range.is_wide() => (Some(panel), None),
            Some(panel) => (None, Some(panel)),
            None => (None, None),
        };
        // The members follow the user's choice; an open side panel takes their place.
        let members_shown = self.side_panel.is_none()
            && community_id.is_some()
            && self.right_open.unwrap_or(range.is_wide());
        let right_shown = island_panel.is_some() || members_shown;
        let right_beside = range.is_wide() && members_shown;

        let left = match &community_id {
            Some(id) => self.left_island(id, right_beside, cx).into_any_element(),
            None => self.inbox_left(window, cx),
        };
        let left_label = match &community_id {
            Some(_) => self
                .community()
                .map(|row| row.name)
                .unwrap_or_else(|| "Community".into()),
            None => "Inbox".into(),
        };

        let header = self.header(phone, members_shown, cx);
        let has_header = header.is_some();
        // The composer takes focus only when the centre is drawn: a phone showing the left pane
        // keeps the request for when it shows the centre.
        let centre_drawn = !phone || self.phone_pane == PhonePane::Centre;
        let content = self.content_element(centre_drawn, members_shown, window, cx);
        let centre = div()
            .id("shell-centre")
            .size_full()
            .flex()
            .flex_col()
            .children(header)
            .when(phone && !has_header, |centre| {
                centre.child(div().flex_none().p(px(4.)).child(self.phone_back(cx)))
            })
            .child(div().flex_1().min_h_0().child(content));
        let centre_label = match (self.channel(), &community_id) {
            (Some(channel), _) => channel.name,
            // The community home: the community's name, as its heading.
            (None, Some(_)) => self
                .community()
                .map(|row| row.name)
                .unwrap_or_else(|| "Community".into()),
            (None, None) => "Conversation".into(),
        };

        let mut islands = ThreeIslands::new(left, left_label, centre, centre_label)
            .dock(self.dock(cx))
            .phone_pane(self.phone_pane)
            .left_scroll(&self.left_scroll)
            .right_scroll(&self.right_scroll)
            .right_open(Some(right_shown));
        if !phone && let Some(card) = self.user_card(cx) {
            islands = islands.left_footer(card);
        }
        let close = cx.entity().downgrade();
        islands = islands.on_right_close(move |_, cx| {
            close
                .update(cx, |shell, cx| {
                    if shell.side_panel.is_some() {
                        cx.emit(ShellEvent::CloseSidePanel);
                    } else {
                        shell.right_open = Some(false);
                        cx.notify();
                    }
                })
                .ok();
        });
        if let Some(panel) = island_panel {
            islands = islands
                .right(
                    div()
                        .id("side-panel")
                        .test_support()
                        .size_full()
                        .child(panel),
                )
                .right_fill(true)
                .right_label("Details");
        } else if let Some(id) = &community_id {
            islands = islands
                .right(self.members_island(id, cx))
                .right_label("Members");
        }
        if let Some(bar) = self.voice_bar.clone().and_then(|slot| slot(window, cx)) {
            islands = islands.call_bar(bar);
        }

        let mut frame = AppFrame::new(islands);
        for banner in self.banners(window, cx) {
            frame = frame.banner(banner);
        }
        let sheet = self.sheet_open.then(|| self.sheet(window, cx));
        let drawer = drawer_panel.map(|panel| self.side_panel_drawer(panel, phone, cx));
        div()
            .id("shell")
            .size_full()
            .relative()
            .track_focus(&self.focus)
            .child(frame)
            .children(drawer)
            .children(sheet)
    }
}

#[cfg(test)]
mod tests {
    use super::{DockCurrent, dock_current, pane_for};
    use crate::kit::PhonePane;
    use crate::nav::Route;
    use core::prelude::v1::test;

    fn channel() -> Route {
        Route::Channel {
            community_id: "c".into(),
            channel_id: "ch".into(),
        }
    }

    #[test]
    fn a_phone_shows_a_places_list_or_the_centre_by_route() {
        assert_eq!(
            pane_for(&Route::Community {
                community_id: "c".into()
            }),
            PhonePane::Left
        );
        assert_eq!(pane_for(&Route::DirectMessages), PhonePane::Left);
        assert_eq!(pane_for(&channel()), PhonePane::Centre);
        assert_eq!(
            pane_for(&Route::DirectMessage {
                dm_group_id: "d".into()
            }),
            PhonePane::Centre
        );
        assert_eq!(pane_for(&Route::Notifications), PhonePane::Centre);
    }

    #[test]
    fn the_dock_marks_the_community_or_the_inbox_it_is_in() {
        assert_eq!(dock_current(&channel()), DockCurrent::Community("c".into()));
        assert_eq!(dock_current(&Route::DirectMessages), DockCurrent::Inbox);
        assert_eq!(
            dock_current(&Route::DirectMessage {
                dm_group_id: "d".into()
            }),
            DockCurrent::Inbox
        );
        assert_eq!(dock_current(&Route::Home), DockCurrent::None);
    }
}
