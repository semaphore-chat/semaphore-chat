//! Acting on a message (W1-ui-actions), following `messageActions.ts`, `MessageToolbar`,
//! `MessageContextMenu`, `MessageActionsSheet`, `ReactionTooltip` and `UnreadMessageDivider`.
//!
//! Which actions a row offers is a pure function of the row and the list's [`ListPermissions`], so
//! the toolbar, the right-click menu and the phone sheet always agree.

use super::palette::*;
use super::row::{Shared, clickable};
use super::view::MessageList;
use crate::emoji::QUICK_REACTIONS;
use crate::kit::{Icon, IconButton, IconButtonVariant};
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{MessageRow, ReactionUsers, SendState};
use semaphore_design::lounge::{TEXT_BODY_STRONG, TEXT_SMALL};
use semaphore_design::{Icon as IconName, LoungeIcon};
use std::rc::Rc;

/// What the signed-in user may do in the conversation a list shows. The owner fills it from the
/// channel's capabilities (`react`, posting) and `Core::channel_moderation`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ListPermissions {
    /// May post here: offers Reply.
    pub reply: bool,
    pub react: bool,
    /// Offers "Reply in thread". Off in a thread's own list.
    pub threads: bool,
    pub pin: bool,
    pub unpin: bool,
    /// May remove anyone's message (a moderator's soft removal).
    pub remove_any: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum MessageAction {
    React,
    Reply,
    Thread,
    Edit,
    Pin,
    Unpin,
    Copy,
    Delete,
}

impl MessageAction {
    pub fn label(self) -> &'static str {
        match self {
            Self::React => "Add reaction",
            Self::Reply => "Reply",
            Self::Thread => "Reply in thread",
            Self::Edit => "Edit message",
            Self::Pin => "Pin message",
            Self::Unpin => "Unpin message",
            Self::Copy => "Copy text",
            Self::Delete => "Delete message",
        }
    }

    /// The label on a row: a moderator's Delete on someone else's message removes it, and says so.
    pub fn label_for(self, row: &MessageRow, permissions: ListPermissions) -> &'static str {
        if self == Self::Delete && delete_is_removal(row, permissions) {
            "Remove message"
        } else {
            self.label()
        }
    }

    /// The element id a rig clicks: `message-action-<id>`.
    pub fn id(self) -> &'static str {
        match self {
            Self::React => "react",
            Self::Reply => "reply",
            Self::Thread => "thread",
            Self::Edit => "edit",
            Self::Pin => "pin",
            Self::Unpin => "unpin",
            Self::Copy => "copy",
            Self::Delete => "delete",
        }
    }

    fn icon(self) -> LoungeIcon {
        match self {
            Self::React => LoungeIcon::SmilePlus,
            Self::Reply => LoungeIcon::Reply,
            Self::Thread => LoungeIcon::MessageSquare,
            Self::Edit => LoungeIcon::Pencil,
            Self::Pin => LoungeIcon::Pin,
            Self::Unpin => LoungeIcon::PinOff,
            Self::Copy => LoungeIcon::Copy,
            Self::Delete => LoungeIcon::Trash2,
        }
    }

    fn destructive(self) -> bool {
        self == Self::Delete
    }

    /// The menu draws a divider between groups: reply, reaction, moderation, copy.
    fn group(self) -> u8 {
        match self {
            Self::Reply | Self::Thread => 0,
            Self::React => 1,
            Self::Edit | Self::Pin | Self::Unpin => 2,
            Self::Copy => 3,
            Self::Delete => 4,
        }
    }
}

/// Only a message the server has, and that isn't removed, can be acted on.
fn actionable(row: &MessageRow) -> bool {
    matches!(row.send_state, SendState::Sent) && row.id.is_some() && !row.removed
}

/// Deleting this row removes someone else's message as a moderator, rather than the author's own
/// delete: it asks for a reason, and moderators keep seeing it.
pub fn delete_is_removal(row: &MessageRow, permissions: ListPermissions) -> bool {
    !row.mine && permissions.remove_any
}

/// The right-click menu's and the phone sheet's actions, in the web's order: Reply, Thread,
/// React, Edit, Pin, Copy, then Delete last.
pub fn message_actions(row: &MessageRow, permissions: ListPermissions) -> Vec<MessageAction> {
    if !actionable(row) {
        return Vec::new();
    }
    let mut actions = Vec::new();
    if permissions.reply {
        actions.push(MessageAction::Reply);
    }
    if permissions.threads {
        actions.push(MessageAction::Thread);
    }
    if permissions.react {
        actions.push(MessageAction::React);
    }
    if row.mine {
        actions.push(MessageAction::Edit);
    }
    match (row.pinned, permissions.pin, permissions.unpin) {
        (false, true, _) => actions.push(MessageAction::Pin),
        (true, _, true) => actions.push(MessageAction::Unpin),
        _ => {}
    }
    if !row.display.is_empty() {
        actions.push(MessageAction::Copy);
    }
    if row.mine || permissions.remove_any {
        actions.push(MessageAction::Delete);
    }
    actions
}

/// The hover toolbar's buttons, in `MessageToolbar`'s order: React, Reply, Thread, Pin, Edit,
/// Delete. Copy lives in the menu only.
pub fn toolbar_actions(row: &MessageRow, permissions: ListPermissions) -> Vec<MessageAction> {
    let all = message_actions(row, permissions);
    [
        MessageAction::React,
        MessageAction::Reply,
        MessageAction::Thread,
        MessageAction::Pin,
        MessageAction::Unpin,
        MessageAction::Edit,
        MessageAction::Delete,
    ]
    .into_iter()
    .filter(|action| all.contains(action))
    .collect()
}

/// Where the unread divider goes: below the row with this seq.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UnreadDivider {
    pub after_seq: i64,
    pub count: u32,
}

/// `UnreadMessageDivider`'s label.
pub fn unread_label(count: u32) -> String {
    match count {
        0 => "NEW MESSAGES".to_owned(),
        1 => "1 NEW MESSAGE".to_owned(),
        n => format!("{n} NEW MESSAGES"),
    }
}

/// `ReactionTooltip`: who reacted, `+N more`, or `Loading...` until core has names.
pub fn reaction_tooltip_lines(users: Option<&ReactionUsers>) -> (String, Option<String>) {
    match users {
        None => ("Loading...".to_owned(), None),
        Some(users) => {
            let names: Vec<&str> = users
                .users
                .iter()
                .map(|user| {
                    user.display_name
                        .as_deref()
                        .filter(|name| !name.is_empty())
                        .unwrap_or(user.username.as_str())
                })
                .collect();
            let more = (users.more > 0).then(|| format!("+{} more", users.more));
            (names.join(", "), more)
        }
    }
}

/// Runs `action` on the row with `seq` through the list, from a click in a row.
fn act(shared: &Rc<Shared>, seq: i64, action: MessageAction, window: &mut Window, cx: &mut App) {
    let anchor = window.mouse_position();
    focus_after_press(shared, seq, window, cx);
    let view = shared.view.borrow().clone();
    view.update(cx, |list, cx| {
        list.run_action(seq, action, anchor, window, cx)
    })
    .ok();
}

/// After a press in the toolbar, focus goes where it can stay: the list for the pointer (the
/// toolbar goes when the pointer leaves), the row for the keyboard. A toolbar button keeps no
/// focus of its own, since the toolbar may be gone at the next frame.
fn focus_after_press(shared: &Rc<Shared>, seq: i64, window: &mut Window, cx: &mut App) {
    if window.last_input_was_keyboard() {
        let handle = shared.row_focus(seq, cx).handle;
        window.focus(&handle, cx);
    } else {
        window.focus(&shared.list_focus, cx);
    }
}

/// One of the toolbar's buttons: `message-action-<id>`, as rigs click it.
fn tool_button(shared: &Rc<Shared>, row: &MessageRow, action: MessageAction) -> AnyElement {
    let seq = row.seq;
    let label = action.label_for(row, shared.permissions.get());
    let event_shared = shared.clone();
    IconButton::new(
        SharedString::from(format!("message-action-{}", action.id())),
        IconName::MoreHoriz,
        label,
    )
    .lounge_icon(action.icon())
    .small()
    .when(action == MessageAction::Delete, |button| {
        button.variant(IconButtonVariant::Danger)
    })
    .selected(action == MessageAction::Unpin && row.pinned)
    .on_click(move |_, window, cx| act(&event_shared, seq, action, window, cx))
    .into_any_element()
}

/// `MessageTools`, for MessageRow's `actions`: the row's actions as IconButtons. While a delete is
/// staged it asks "Delete?" with confirm and cancel instead. On a phone it is one button that
/// opens the sheet. Empty when the row offers nothing.
pub(crate) fn toolbar_buttons(
    shared: &Rc<Shared>,
    row: &MessageRow,
    staged: bool,
    phone: bool,
) -> Vec<AnyElement> {
    let permissions = shared.permissions.get();
    let actions = toolbar_actions(row, permissions);
    if actions.is_empty() {
        return Vec::new();
    }
    let seq = row.seq;
    if staged {
        let confirm = shared.clone();
        let cancel = shared.clone();
        return vec![
            div()
                .id("message-toolbar-confirm")
                .test_support()
                .flex()
                .items_center()
                .px(px(8.))
                .child(
                    crate::kit::overlays::type_text(TEXT_SMALL, "Delete?")
                        .font_weight(FontWeight(TEXT_BODY_STRONG.weight as f32))
                        .text_color(shared.palette.get().error),
                )
                .into_any_element(),
            IconButton::new(
                "message-action-confirm-delete",
                IconName::Check,
                "Confirm delete",
            )
            .lounge_icon(LoungeIcon::Check)
            .small()
            .variant(IconButtonVariant::Danger)
            .on_click(move |_, window, cx| {
                focus_after_press(&confirm, seq, window, cx);
                let view = confirm.view.borrow().clone();
                view.update(cx, |list, cx| list.confirm_delete(seq, None, cx))
                    .ok();
            })
            .into_any_element(),
            IconButton::new(
                "message-action-cancel-delete",
                IconName::Close,
                "Cancel delete",
            )
            .lounge_icon(LoungeIcon::X)
            .small()
            .on_click(move |_, window, cx| {
                focus_after_press(&cancel, seq, window, cx);
                let view = cancel.view.borrow().clone();
                view.update(cx, |list, cx| list.cancel_delete(cx)).ok();
            })
            .into_any_element(),
        ];
    }
    if phone {
        let open = shared.clone();
        return vec![
            IconButton::new("message-action-more", IconName::MoreVert, "More actions")
                .lounge_icon(LoungeIcon::Ellipsis)
                .small()
                .on_click(move |_, window, cx| {
                    focus_after_press(&open, seq, window, cx);
                    let at = window.mouse_position();
                    let view = open.view.borrow().clone();
                    view.update(cx, |list, cx| list.open_menu(seq, at, cx)).ok();
                })
                .into_any_element(),
        ];
    }
    actions
        .into_iter()
        .map(|action| tool_button(shared, row, action))
        .collect()
}

fn menu_item(
    shared: &Rc<Shared>,
    row: &MessageRow,
    action: MessageAction,
    touch: bool,
) -> impl IntoElement {
    let palette = shared.palette.get();
    let seq = row.seq;
    let label = action.label_for(row, shared.permissions.get());
    let color = if action.destructive() {
        palette.error
    } else {
        palette.text
    };
    let event_shared = shared.clone();
    clickable(SharedString::from(format!("message-menu-{}", action.id())))
        .test_support()
        .role(Role::MenuItem)
        .aria_label(label)
        .flex()
        .items_center()
        .gap(px(12.))
        .min_h(px(if touch { 48. } else { 36. }))
        .px(px(16.))
        .hover(move |style| style.bg(palette.hover))
        .on_click(move |_, window, cx| act(&event_shared, seq, action, window, cx))
        .child(
            Icon::lounge(action.icon())
                .size(20.)
                .color(if action.destructive() {
                    palette.error
                } else {
                    palette.text_secondary
                }),
        )
        .child(
            div()
                .text_size(px(BODY_SIZE))
                .text_color(color)
                .child(label),
        )
}

fn menu_items(shared: &Rc<Shared>, row: &MessageRow, touch: bool) -> Vec<AnyElement> {
    let palette = shared.palette.get();
    let mut items = Vec::new();
    let mut last_group = None;
    for action in message_actions(row, shared.permissions.get()) {
        if last_group.is_some_and(|group| group != action.group()) {
            items.push(
                div()
                    .my(px(4.))
                    .h(px(1.))
                    .bg(palette.divider)
                    .into_any_element(),
            );
        }
        last_group = Some(action.group());
        items.push(menu_item(shared, row, action, touch).into_any_element());
    }
    items
}

/// `MessageContextMenu`: at the pointer, closed by a press outside it or Escape.
pub(crate) fn render_menu(
    shared: &Rc<Shared>,
    row: &MessageRow,
    position: Point<Pixels>,
    cx: &mut Context<MessageList>,
) -> impl IntoElement {
    let palette = shared.palette.get();
    deferred(
        anchored().position(position).snap_to_window().child(
            div()
                .id("message-menu")
                .test_support()
                .role(Role::Menu)
                .aria_label("Message actions")
                .min_w(px(200.))
                .py(px(8.))
                .rounded(px(4.))
                .bg(palette.paper)
                .border_1()
                .border_color(palette.divider)
                .shadow_lg()
                .occlude()
                .on_mouse_down_out(cx.listener(|list, _, _, cx| list.close_menu(cx)))
                .children(menu_items(shared, row, false)),
        ),
    )
    .with_priority(1)
}

/// `MessageActionsSheet`: from the bottom on a phone, quick reactions above the actions.
pub(crate) fn render_sheet(
    shared: &Rc<Shared>,
    row: &MessageRow,
    cx: &mut Context<MessageList>,
) -> impl IntoElement {
    let palette = shared.palette.get();
    let seq = row.seq;
    let react = shared.permissions.get().react
        && message_actions(row, shared.permissions.get()).contains(&MessageAction::React);
    let quick = react.then(|| {
        div()
            .flex()
            .justify_between()
            .px(px(12.))
            .py(px(8.))
            .children(QUICK_REACTIONS.iter().enumerate().map(|(ix, emoji)| {
                let emoji = (*emoji).to_owned();
                let event_shared = shared.clone();
                clickable(("quick-reaction", ix))
                    .test_support()
                    .role(Role::Button)
                    .aria_label(format!("React with {emoji}"))
                    .flex()
                    .items_center()
                    .justify_center()
                    .size(px(40.))
                    .rounded_full()
                    .bg(palette.hover)
                    .text_size(px(22.))
                    .on_click({
                        let emoji = emoji.clone();
                        move |_, _, cx| {
                            let view = event_shared.view.borrow().clone();
                            let emoji = emoji.clone();
                            view.update(cx, |list, cx| list.quick_react(seq, emoji, cx))
                                .ok();
                        }
                    })
                    .child(emoji)
            }))
    });
    div()
        .absolute()
        .inset_0()
        .child(
            div()
                .id("message-sheet-scrim")
                .test_support()
                .absolute()
                .inset_0()
                .occlude()
                .bg(hsla(0., 0., 0., 0.5))
                .on_click(cx.listener(|list, _, _, cx| list.close_menu(cx))),
        )
        .child(
            div()
                .id("message-sheet")
                .test_support()
                .role(Role::Menu)
                .aria_label("Message actions")
                .absolute()
                .left_0()
                .right_0()
                .bottom_0()
                .pt(px(8.))
                .pb(px(16.))
                .rounded_t(px(12.))
                .bg(palette.paper)
                .occlude()
                .child(
                    div()
                        .mx_auto()
                        .mb(px(8.))
                        .w(px(32.))
                        .h(px(4.))
                        .rounded_full()
                        .bg(palette.divider),
                )
                .children(quick)
                .children(menu_items(shared, row, true)),
        )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::messages::fixture::{self, Body, NOW_MS};
    use semaphore_core::model::UserView;
    use std::prelude::v1::test;

    fn row(mine: bool) -> MessageRow {
        let author = if mine {
            fixture::me()
        } else {
            fixture::user("u-2", "sam", None)
        };
        MessageRow {
            id: Some("m-1".into()),
            mine,
            ..fixture::message(1, author, NOW_MS, Body::default().text("hello"))
        }
    }

    const MEMBER: ListPermissions = ListPermissions {
        reply: true,
        react: true,
        threads: true,
        pin: false,
        unpin: false,
        remove_any: false,
    };
    const MODERATOR: ListPermissions = ListPermissions {
        pin: true,
        unpin: true,
        remove_any: true,
        ..MEMBER
    };

    use MessageAction::*;

    #[test]
    fn a_member_on_someone_elses_message() {
        assert_eq!(
            message_actions(&row(false), MEMBER),
            vec![Reply, Thread, React, Copy]
        );
        assert_eq!(
            toolbar_actions(&row(false), MEMBER),
            vec![React, Reply, Thread]
        );
    }

    #[test]
    fn the_author_edits_and_deletes() {
        assert_eq!(
            message_actions(&row(true), MEMBER),
            vec![Reply, Thread, React, Edit, Copy, Delete]
        );
        assert!(!delete_is_removal(&row(true), MODERATOR));
    }

    #[test]
    fn a_moderator_pins_and_removes() {
        let actions = message_actions(&row(false), MODERATOR);
        assert_eq!(actions, vec![Reply, Thread, React, Pin, Copy, Delete]);
        assert!(delete_is_removal(&row(false), MODERATOR));
        assert_eq!(Delete.label_for(&row(false), MODERATOR), "Remove message");
        assert_eq!(Delete.label_for(&row(true), MODERATOR), "Delete message");
        let pinned = MessageRow {
            pinned: true,
            ..row(false)
        };
        assert!(message_actions(&pinned, MODERATOR).contains(&Unpin));
        // Pin without unpin: a pinned message offers neither.
        let pin_only = ListPermissions {
            unpin: false,
            ..MODERATOR
        };
        let actions = message_actions(&pinned, pin_only);
        assert!(!actions.contains(&Pin) && !actions.contains(&Unpin));
    }

    #[test]
    fn read_only_and_thread_lists_lose_their_actions() {
        let read_only = ListPermissions::default();
        assert_eq!(message_actions(&row(false), read_only), vec![Copy]);
        assert!(toolbar_actions(&row(false), read_only).is_empty());
        assert_eq!(
            message_actions(&row(true), read_only),
            vec![Edit, Copy, Delete]
        );
    }

    #[test]
    fn unsent_failed_and_removed_rows_offer_nothing() {
        let pending = MessageRow {
            id: None,
            send_state: SendState::Pending,
            ..row(true)
        };
        let removed = MessageRow {
            removed: true,
            ..row(false)
        };
        assert!(message_actions(&pending, MODERATOR).is_empty());
        assert!(message_actions(&removed, MODERATOR).is_empty());
    }

    #[test]
    fn labels_and_tooltips() {
        assert_eq!(unread_label(0), "NEW MESSAGES");
        assert_eq!(unread_label(1), "1 NEW MESSAGE");
        assert_eq!(unread_label(12), "12 NEW MESSAGES");
        assert_eq!(reaction_tooltip_lines(None).0, "Loading...");
        let users = ReactionUsers {
            users: vec![
                UserView {
                    id: "a".into(),
                    username: "alex".into(),
                    display_name: Some("Alex K".into()),
                    avatar_file_id: None,
                },
                UserView {
                    id: "b".into(),
                    username: "sam".into(),
                    display_name: None,
                    avatar_file_id: None,
                },
            ],
            more: 3,
        };
        assert_eq!(
            reaction_tooltip_lines(Some(&users)),
            ("Alex K, sam".to_owned(), Some("+3 more".to_owned()))
        );
    }
}
