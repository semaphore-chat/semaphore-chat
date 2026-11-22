//! The community switcher in the frame's dock slot (design §3.1, the web's `ShellDock`): the Inbox,
//! every community the server lists for this user (a mention count, or the new-messages dot), and
//! "All communities", which opens the sheet. The kit's Dock makes it one keyboard list. On a phone
//! ThreeIslands puts it at the bottom edge; at compact and wide above the left island.

use super::lines::{ALL_LABEL, DOCK_LABEL};
use super::{Act, IdAct};
use crate::kit::{
    AvatarSize, CountMeaning, Dock, DockDivider, DockEntry, DockItem, IconButton,
    IconButtonVariant, Skeleton, count_words,
};
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_design::{Icon as I, LoungeIcon};

/// A community on the dock.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DockCommunity {
    pub id: String,
    pub name: String,
    /// The community's picture (a file id).
    pub file: Option<String>,
    /// Mentions in its channels: the count on the item.
    pub mentions: u32,
    /// Unread messages that do not mention you: the dot (the count wins).
    pub new_messages: bool,
}

/// What the dock marks as current, from the route.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum DockCurrent {
    Community(String),
    Inbox,
    #[default]
    None,
}

/// The communities' load, as the dock shows it: placeholders while loading; after a failed first
/// load only Inbox and All (the owner's toast offers to try again).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DockStatus {
    Loading,
    Error,
    Ready,
}

/// The id of a community's dock item: what the slice E2E steps click.
pub fn dock_item_id(community_id: &str) -> String {
    format!("community-{community_id}")
}

/// How many placeholder circles stand for the communities while they load.
const SKELETONS: usize = 3;

#[derive(IntoElement)]
pub struct ShellDock {
    communities: Vec<DockCommunity>,
    current: DockCurrent,
    inbox_count: u32,
    status: DockStatus,
    on_inbox: Option<Act>,
    on_all: Option<Act>,
    on_community: Option<IdAct>,
}

impl ShellDock {
    pub fn new(communities: Vec<DockCommunity>, current: DockCurrent, status: DockStatus) -> Self {
        Self {
            communities,
            current,
            inbox_count: 0,
            status,
            on_inbox: None,
            on_all: None,
            on_community: None,
        }
    }

    /// DM unread plus channel mentions (design PA-6, `lines::inbox_count`).
    pub fn inbox_count(mut self, count: u32) -> Self {
        self.inbox_count = count;
        self
    }

    pub fn on_inbox(mut self, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_inbox = Some(std::rc::Rc::new(handler));
        self
    }

    /// Opens the "All communities" sheet, whose state is the frame's.
    pub fn on_all(mut self, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_all = Some(std::rc::Rc::new(handler));
        self
    }

    pub fn on_community(mut self, handler: impl Fn(&str, &mut Window, &mut App) + 'static) -> Self {
        self.on_community = Some(std::rc::Rc::new(handler));
        self
    }
}

impl RenderOnce for ShellDock {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        let shown: &[DockCommunity] = if self.status == DockStatus::Ready {
            &self.communities
        } else {
            &[]
        };
        let has_items = !shown.is_empty() || self.status == DockStatus::Loading;
        let on_inbox = self.on_inbox.clone();
        let inbox = IconButton::new("dock-inbox", I::Notifications, "Inbox")
            .lounge_icon(LoungeIcon::Inbox)
            .variant(IconButtonVariant::Primary)
            .badge(
                self.inbox_count,
                count_words(self.inbox_count, CountMeaning::Unread),
            )
            .current(self.current == DockCurrent::Inbox)
            .on_click(move |_, window, cx| {
                if let Some(open) = &on_inbox {
                    open(window, cx);
                }
            });
        let on_all = self.on_all.clone();
        let all = IconButton::new("dock-all", I::GridView, ALL_LABEL)
            .lounge_icon(LoungeIcon::LayoutGrid)
            .variant(IconButtonVariant::Soft)
            .on_click(move |_, window, cx| {
                if let Some(open) = &on_all {
                    open(window, cx);
                }
            });
        let mut dock = Dock::new("shell-dock", DOCK_LABEL).start(DockEntry::button("inbox", inbox));
        if has_items {
            dock = dock.start(DockDivider);
        }
        if self.status == DockStatus::Loading {
            dock = dock.items((0..SKELETONS).map(|index| {
                DockEntry::Element(
                    Skeleton::circle(("dock-skeleton", index), AvatarSize::Md).into_any_element(),
                )
            }));
        }
        let items: Vec<DockEntry> = shown
            .iter()
            .map(|community| {
                let open = self.on_community.clone();
                let id = community.id.clone();
                DockItem::new(community.id.clone(), community.name.clone())
                    .id(SharedString::from(dock_item_id(&community.id)))
                    .file(community.file.clone().map(SharedString::from))
                    .current(self.current == DockCurrent::Community(community.id.clone()))
                    .unread(community.mentions)
                    .meaning(CountMeaning::Mentions)
                    .new_messages(community.new_messages)
                    .on_click(move |window, cx| {
                        if let Some(open) = &open {
                            open(&id, window, cx);
                        }
                    })
                    .into()
            })
            .collect();
        dock = dock.items(items);
        if has_items {
            dock = dock.end(DockDivider);
        }
        dock.end(DockEntry::button("all", all))
    }
}
