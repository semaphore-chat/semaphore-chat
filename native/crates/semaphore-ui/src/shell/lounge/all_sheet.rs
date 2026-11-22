//! The "All communities" sheet the dock's All button opens (design §3.2, the web's
//! `AllCommunitiesSheet`): the instance heading, every community as a row with its state line, a
//! filter field above eight communities, "Create a community" when you may, and the foot.
//!
//! Native's foot (B10 decision): Notifications at every width until the unified inbox (B14) takes
//! it over, because the old rail's bell is gone; on a phone also Settings, Your profile and Sign
//! out… (a phone has no user card). One keyboard list over the rows.

use super::lines::{
    ALL_LABEL, CommunityState, FILTER_THRESHOLD, matches_filter, mention_text,
    notification_count_text, state_line,
};
use super::{Face, IdAct, Rows, column, focused, text_line};
use crate::kit::{
    Avatar, AvatarShape, AvatarSize, Badge, BadgeTone, FieldShape, Icon, ListRow, RowSize, Sheet,
    SheetCloseReason, TextField,
};
use crate::theme::SemTheme;
use gpui_kit::component::input::InputState;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_design::LoungeIcon;
use semaphore_design::lounge::{self as t, SPACE_MD, SPACE_XS};
use std::rc::Rc;

/// A community in the sheet.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SheetCommunity {
    pub id: String,
    pub name: String,
    pub file: Option<String>,
    pub mentions: u32,
    pub new_messages: bool,
    /// Your call is in this community.
    pub in_your_call: bool,
}

/// A row at the sheet's foot.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FootRow {
    Create,
    Notifications,
    Settings,
    Profile,
    SignOut,
}

impl FootRow {
    /// The row's id in the list and its element id: `sheet-<id>`.
    pub fn id(self) -> &'static str {
        match self {
            FootRow::Create => "create-community",
            FootRow::Notifications => "notifications",
            FootRow::Settings => "settings",
            FootRow::Profile => "profile",
            FootRow::SignOut => "sign-out",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            FootRow::Create => "Create a community",
            FootRow::Notifications => "Notifications",
            FootRow::Settings => "Settings",
            FootRow::Profile => "Your profile",
            FootRow::SignOut => "Sign out…",
        }
    }

    fn icon(self) -> LoungeIcon {
        match self {
            FootRow::Create => LoungeIcon::Plus,
            FootRow::Notifications => LoungeIcon::Bell,
            FootRow::Settings => LoungeIcon::Settings,
            FootRow::Profile => LoungeIcon::User,
            FootRow::SignOut => LoungeIcon::LogOut,
        }
    }
}

/// The foot's rows: Create when you may, Notifications always, the phone's account rows.
pub fn foot_rows(can_create: bool, phone: bool) -> Vec<FootRow> {
    let mut rows = Vec::new();
    if can_create {
        rows.push(FootRow::Create);
    }
    rows.push(FootRow::Notifications);
    if phone {
        rows.extend([FootRow::Settings, FootRow::Profile, FootRow::SignOut]);
    }
    rows
}

/// The id of a community's row: `sheet-community-<id>`.
pub fn sheet_row_id(community_id: &str) -> String {
    format!("sheet-community-{community_id}")
}

type CloseAct = Rc<dyn Fn(SheetCloseReason, &mut Window, &mut App)>;
type FootAct = Rc<dyn Fn(FootRow, &mut Window, &mut App)>;

#[derive(IntoElement)]
pub struct AllCommunitiesSheet {
    instance: SharedString,
    username: Option<SharedString>,
    communities: Vec<SheetCommunity>,
    current: Option<String>,
    can_create: bool,
    face: Face,
    filter: Option<Entity<InputState>>,
    phone_foot: bool,
    notification_count: u32,
    on_close: Option<CloseAct>,
    on_community: Option<IdAct>,
    on_foot: Option<FootAct>,
}

impl AllCommunitiesSheet {
    /// `instance` heads the sheet ("moss.social"), `username` under it ("as alexk").
    pub fn new(
        instance: impl Into<SharedString>,
        communities: Vec<SheetCommunity>,
        face: Face,
    ) -> Self {
        Self {
            instance: instance.into(),
            username: None,
            communities,
            current: None,
            can_create: false,
            face,
            filter: None,
            phone_foot: false,
            notification_count: 0,
            on_close: None,
            on_community: None,
            on_foot: None,
        }
    }

    pub fn username(mut self, username: Option<impl Into<SharedString>>) -> Self {
        self.username = username.map(Into::into);
        self
    }

    pub fn current(mut self, id: Option<String>) -> Self {
        self.current = id;
        self
    }

    pub fn can_create(mut self, can: bool) -> Self {
        self.can_create = can;
        self
    }

    /// The filter field's state; the field shows above `FILTER_THRESHOLD` communities. The owner
    /// keeps it (and re-renders on its changes).
    pub fn filter(mut self, state: &Entity<InputState>) -> Self {
        self.filter = Some(state.clone());
        self
    }

    /// The phone's foot: Settings, Your profile and Sign out… too.
    pub fn phone_foot(mut self, phone: bool) -> Self {
        self.phone_foot = phone;
        self
    }

    /// Unread notifications, on the Notifications row.
    pub fn notification_count(mut self, count: u32) -> Self {
        self.notification_count = count;
        self
    }

    pub fn on_close(
        mut self,
        handler: impl Fn(SheetCloseReason, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_close = Some(Rc::new(handler));
        self
    }

    pub fn on_community(mut self, handler: impl Fn(&str, &mut Window, &mut App) + 'static) -> Self {
        self.on_community = Some(Rc::new(handler));
        self
    }

    pub fn on_foot(mut self, handler: impl Fn(FootRow, &mut Window, &mut App) + 'static) -> Self {
        self.on_foot = Some(Rc::new(handler));
        self
    }
}

impl RenderOnce for AllCommunitiesSheet {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let secondary = cx.sem().role.text_secondary;
        let filtering = self.communities.len() > FILTER_THRESHOLD;
        let query = match (&self.filter, filtering) {
            (Some(state), true) => state.read(cx).value().to_string(),
            _ => String::new(),
        };
        let ready = matches!(self.face, Face::Ready);
        let shown: Vec<&SheetCommunity> = if ready {
            self.communities
                .iter()
                .filter(|community| matches_filter(&community.name, &query))
                .collect()
        } else {
            Vec::new()
        };
        let foot = foot_rows(self.can_create, self.phone_foot);
        // The body's scroll, kept while the sheet is open: rows that take focus are brought into
        // view, and the current community is in the middle when the list first shows.
        let scroll = window
            .use_keyed_state("all-communities-scroll", cx, |_, _| ScrollHandle::new())
            .read(cx)
            .clone();
        let rows = Rows::new(
            "all-communities-list",
            shown
                .iter()
                .map(|community| (community.id.clone(), community.name.clone()))
                .chain(
                    foot.iter()
                        .map(|row| (row.id().to_owned(), row.label().to_owned())),
                )
                .collect(),
            self.current.clone(),
            Some(scroll.clone()),
            window,
            cx,
        );
        let current_shown = self
            .current
            .as_deref()
            .filter(|id| shown.iter().any(|community| community.id == *id));
        rows.centre_once(current_shown, window, cx);

        let community_rows: Vec<AnyElement> = shown
            .iter()
            .map(|community| {
                let state = CommunityState {
                    mentions: community.mentions,
                    new_messages: community.new_messages,
                    in_your_call: community.in_your_call,
                };
                let open = self.on_community.clone();
                let id = community.id.clone();
                let mut row = ListRow::new(
                    SharedString::from(sheet_row_id(&community.id)),
                    community.name.clone(),
                )
                .size(RowSize::Lg)
                .secondary(state_line(&state))
                .selected(self.current.as_deref() == Some(community.id.as_str()))
                .unread(community.mentions > 0 || community.new_messages)
                .leading(
                    Avatar::new(community.name.clone())
                        .shape(AvatarShape::Rounded)
                        .file(community.file.as_deref())
                        .decorative(true),
                )
                .on_click(move |window, cx| {
                    if let Some(open) = &open {
                        open(&id, window, cx);
                    }
                });
                if community.mentions > 0 {
                    row = row.trailing(
                        Badge::new(mention_text(community.mentions))
                            .count(community.mentions)
                            .tone(BadgeTone::Danger)
                            .decorative(true),
                    );
                    // The state line says the mentions, unless the call takes it.
                    if community.in_your_call {
                        row = row.trailing_label(mention_text(community.mentions));
                    }
                }
                focused(row, &rows, &community.id, cx)
            })
            .collect();
        let no_match = (filtering && ready && shown.is_empty()).then(|| {
            text_line(
                t::TEXT_BODY,
                format!("No community called “{}”", query.trim()),
            )
            .text_color(secondary)
        });
        let empty = if self.can_create {
            "You're not in any community yet. Create one, or join one with an invite link."
        } else {
            "You're not in any community yet. Join one with an invite link."
        };
        let list = self
            .face
            .view("all-communities-load")
            .lines(4)
            .empty(empty)
            .error_title("Couldn't load your communities")
            .content(column().children(community_rows).children(no_match));

        let foot_rows: Vec<AnyElement> = foot
            .iter()
            .map(|&foot_row| {
                let act = self.on_foot.clone();
                let mut row = ListRow::new(
                    SharedString::from(format!("sheet-{}", foot_row.id())),
                    foot_row.label(),
                )
                .leading(Icon::lounge(foot_row.icon()))
                .on_click(move |window, cx| {
                    if let Some(act) = &act {
                        act(foot_row, window, cx);
                    }
                });
                if foot_row == FootRow::Notifications
                    && let Some(words) = notification_count_text(self.notification_count)
                {
                    row = row
                        .trailing(
                            Badge::new(words.clone())
                                .count(self.notification_count)
                                .tone(BadgeTone::Danger)
                                .decorative(true),
                        )
                        .trailing_label(words);
                }
                focused(row, &rows, foot_row.id(), cx)
            })
            .collect();

        let mut heading = ListRow::new("all-communities-instance", self.instance.clone()).leading(
            Avatar::new(self.instance.clone())
                .size(AvatarSize::Sm)
                .shape(AvatarShape::Rounded)
                .decorative(true),
        );
        if let Some(username) = &self.username {
            heading = heading.secondary(format!("as {username}"));
        }
        let top = column().gap(px(SPACE_MD)).child(heading).when_some(
            self.filter.clone().filter(|_| filtering),
            |top, state| {
                top.child(
                    TextField::new("all-communities-filter", &state, "Find a community")
                        .label_hidden()
                        .shape(FieldShape::Round)
                        .start_icon(LoungeIcon::Search)
                        .placeholder("Find a community"),
                )
            },
        );
        let body = rows.keys(column().gap(px(SPACE_XS)).child(list).children(foot_rows));
        let on_close = self.on_close.clone();
        Sheet::new("all-communities", ALL_LABEL)
            .scroll_handle(&scroll)
            .top(top)
            .body(body)
            .on_request_close(move |reason, window, cx| {
                if let Some(close) = &on_close {
                    close(reason, window, cx);
                }
            })
    }
}
