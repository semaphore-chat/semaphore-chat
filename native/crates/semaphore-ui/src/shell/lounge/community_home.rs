//! The community home's centre (epic #848 B12): what the centre island shows for a community with
//! no channel chosen, at compact and wide. A phone shows the community's left pane instead (the
//! web's `CommunityHomeScreen`, `phonePane: 'left'`), so this is never its pane there.
//!
//! The shell goes to the last-viewed text channel, or the first, as soon as the list is in (the
//! web's `CommunityPage`), so this is seen while the community or its channels load or fail, and
//! for a community with no text channel. It follows the web's community fixture centre
//! (`CommunityFixtureScreen`'s `FixtureCentre`: the name as the heading, one line, Members when
//! they aren't beside it) and `writing.md`'s empty states (what will show, and the first step).

use super::{Act, Face, Retry, column, text_line};
use crate::kit::Button;
use crate::theme::SemTheme;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_design::lounge::{self as t, LAYOUT_GUTTER, SPACE_MD};
use std::rc::Rc;

/// What the community home knows of the community and its lists.
#[derive(Debug, Clone, PartialEq)]
pub enum HomeState {
    /// The community, or its channels, are still on their way.
    Loading,
    /// The list of communities failed: nothing of this one is known.
    CommunityError(String, Retry),
    /// The community is there; its channels failed.
    ChannelsError(String, Retry),
    /// 403/404: the left island says so and offers the way out.
    NotMember,
    /// Loaded: whether there are text channels and voice rooms.
    Ready { text_channels: bool, rooms: bool },
}

/// The home's one line under the heading, for a loaded community (`None` for the other states,
/// which show a load face instead).
pub fn home_line(state: &HomeState, can_create_channel: bool) -> Option<&'static str> {
    let HomeState::Ready {
        text_channels,
        rooms,
    } = state
    else {
        return match state {
            HomeState::NotMember => {
                Some("You're not a member of this community. Ask someone in it for an invite.")
            }
            _ => None,
        };
    };
    Some(match (text_channels, rooms, can_create_channel) {
        (true, true, _) => "Pick a channel or a room on the left.",
        (true, false, _) => "Pick a channel on the left.",
        (false, true, true) => {
            "No text channels yet. Pick a room on the left, or create a channel."
        }
        (false, true, false) => "No text channels yet. Pick a room on the left to talk.",
        (false, false, true) => "No channels yet. Create the first one to get everyone talking.",
        (false, false, false) => "No channels yet. They show here once someone creates one.",
    })
}

/// The centre for a community with no channel chosen: its name as the heading, the line, and
/// Create channel (when allowed and there is no text channel) and Members (while they aren't
/// shown) as its actions.
#[derive(IntoElement)]
pub struct CommunityHome {
    /// None while the community loads, or for one the user can't see.
    name: Option<SharedString>,
    state: HomeState,
    can_create_channel: bool,
    members_shown: bool,
    on_show_members: Option<Act>,
    on_create_channel: Option<Act>,
}

impl CommunityHome {
    pub fn new(name: Option<impl Into<SharedString>>, state: HomeState) -> Self {
        Self {
            name: name.map(Into::into),
            state,
            can_create_channel: false,
            members_shown: true,
            on_show_members: None,
            on_create_channel: None,
        }
    }

    pub fn can_create_channel(mut self, can: bool) -> Self {
        self.can_create_channel = can;
        self
    }

    /// Whether the members are on screen (the right island, or its drawer, open).
    pub fn members_shown(mut self, shown: bool) -> Self {
        self.members_shown = shown;
        self
    }

    pub fn on_show_members(mut self, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_show_members = Some(Rc::new(handler));
        self
    }

    pub fn on_create_channel(mut self, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_create_channel = Some(Rc::new(handler));
        self
    }
}

impl RenderOnce for CommunityHome {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let secondary = cx.sem().role.text_secondary;
        let line = home_line(&self.state, self.can_create_channel);
        let member = !matches!(
            self.state,
            HomeState::NotMember | HomeState::CommunityError(..)
        );
        let creates = self.can_create_channel
            && matches!(
                self.state,
                HomeState::Ready {
                    text_channels: false,
                    ..
                }
            );
        let face = match &self.state {
            HomeState::Loading => Some(Face::Loading.view("community-home-load").lines(3)),
            HomeState::CommunityError(message, retry) => Some(
                Face::Error(message.clone(), retry.clone())
                    .view("community-home-load")
                    .error_title("Couldn't load this community"),
            ),
            HomeState::ChannelsError(message, retry) => Some(
                Face::Error(message.clone(), retry.clone())
                    .view("community-home-load")
                    .error_title("Couldn't load channels"),
            ),
            _ => None,
        };
        let title = match (&self.name, &self.state) {
            (Some(name), _) => Some(name.clone()),
            (None, HomeState::NotMember) => Some("Community".into()),
            _ => None,
        };
        let create = self.on_create_channel.clone();
        let show = self.on_show_members.clone();
        let mut actions = div().flex().flex_wrap().gap(px(SPACE_MD));
        if creates {
            actions = actions.child(
                Button::new("community-home-create", "Create channel")
                    .primary()
                    .on_click(move |_, window, cx| {
                        if let Some(create) = &create {
                            create(window, cx);
                        }
                    }),
            );
        }
        if member && !self.members_shown {
            actions = actions.child(
                Button::new("community-home-members", "Members")
                    .ghost()
                    .on_click(move |_, window, cx| {
                        if let Some(show) = &show {
                            show(window, cx);
                        }
                    }),
            );
        }
        let has_actions = creates || (member && !self.members_shown);
        column()
            .id("community-home")
            .test_support()
            .role(Role::Region)
            .aria_label(title.clone().unwrap_or_else(|| "Community".into()))
            .size_full()
            .p(px(LAYOUT_GUTTER))
            .gap(px(SPACE_MD))
            .items_start()
            .when_some(title, |home, title| {
                home.child(
                    text_line(t::TEXT_TITLE, title)
                        .id("community-home-title")
                        .test_support()
                        .role(Role::Heading)
                        .max_w_full()
                        .truncate(),
                )
            })
            .when_some(line, |home, line| {
                home.child(
                    text_line(t::TEXT_BODY, line)
                        .id("community-home-line")
                        .test_support()
                        .text_color(secondary),
                )
            })
            .when_some(face, |home, face| {
                home.child(
                    div()
                        .id("community-home-face")
                        .test_support()
                        .w_full()
                        .child(face),
                )
            })
            .when(has_actions, |home| home.child(actions))
    }
}
