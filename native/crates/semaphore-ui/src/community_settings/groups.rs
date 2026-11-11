//! The mention groups tab, after `AliasGroupManagement.tsx` (the list) and `AliasGroupEditor.tsx`
//! (which replaces the list while a group is made or edited): `@name`, its member count, edit and
//! delete; the editor's name, member search, select all, and the members picked.

use super::common::{
    Confirm, action_icon, card, list, loading_rows, locked_button, page, row, server_error,
    tone_chip,
};
use super::rules::{OpAction, Outcome, Pending, check_group_name, needs, op_about};
use crate::kit::{
    Alert, Button, Checkbox, Chip, Severity, TextField, Variant, spacing, text, text_state,
};
use crate::panel::common::error_block;
use crate::theme::SemTheme;
use gpui_kit::component::input::InputState;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{
    AliasGroupRow, AliasGroupView, AliasGroupsView, CommunityCaps, LoadState, MemberList, UserView,
};
use semaphore_design::Icon as DesignIcon;
use std::collections::BTreeSet;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MentionGroupsEvent {
    /// The editor opened on a group: the owner feeds `set_group` with `Core::alias_group(id)`.
    Open { group_id: String },
    /// "Create Group": `Core::create_alias_group(community, name, member_ids)`.
    Create {
        name: String,
        member_ids: Vec<String>,
    },
    /// "Save Changes": `Core::rename_alias_group(id, name)` when `name` is set, then
    /// `Core::set_alias_group_members(id, member_ids)`.
    Save {
        group_id: String,
        name: Option<String>,
        member_ids: Vec<String>,
    },
    /// Confirmed: `Core::delete_alias_group(id)`.
    Delete { group_id: String },
    /// The list or the group failed to load and the user asked again: `Core::retry_failed`.
    Retry,
}

struct Editor {
    /// `None` while making a new group.
    group_id: Option<String>,
    selected: BTreeSet<String>,
    /// The group's own members and name have been read into the editor.
    loaded: bool,
    original_name: String,
    tried: bool,
}

pub struct MentionGroupsTab {
    view: AliasGroupsView,
    group: AliasGroupView,
    community: Option<MemberList>,
    caps: CommunityCaps,
    last: Option<OpAction>,
    pending: Option<Pending>,
    editor: Option<Editor>,
    name: Entity<InputState>,
    search: Entity<InputState>,
    deleting: Option<AliasGroupRow>,
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<MentionGroupsEvent> for MentionGroupsTab {}

impl MentionGroupsTab {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let name = text_state(window, cx, false);
        let search = text_state(window, cx, false);
        let _subscriptions = vec![
            cx.observe(&name, |_, _, cx| cx.notify()),
            cx.observe(&search, |_, _, cx| cx.notify()),
        ];
        Self {
            view: AliasGroupsView::default(),
            group: AliasGroupView::default(),
            community: None,
            caps: CommunityCaps::default(),
            last: None,
            pending: None,
            editor: None,
            name,
            search,
            deleting: None,
            _subscriptions,
        }
    }

    pub fn set_caps(&mut self, caps: CommunityCaps, cx: &mut Context<Self>) {
        self.caps = caps;
        cx.notify();
    }

    /// `Core::alias_groups(community)`.
    pub fn set_groups(&mut self, view: AliasGroupsView, cx: &mut Context<Self>) {
        self.observe(&view.op, |action| {
            matches!(action, OpAction::CreateGroup | OpAction::DeleteGroup { .. })
        });
        self.view = view;
        cx.notify();
    }

    /// `Core::alias_group(id)` for the group open in the editor.
    pub fn set_group(&mut self, view: AliasGroupView, window: &mut Window, cx: &mut Context<Self>) {
        self.observe(&view.op, |action| {
            matches!(action, OpAction::SaveGroup { .. })
        });
        if let Some(editor) = self.editor.as_mut()
            && editor.group_id.as_deref() == Some(view.group_id.as_str())
            && !editor.loaded
            && matches!(view.state, LoadState::Ready)
        {
            editor.loaded = true;
            editor.selected = view.members.iter().map(|user| user.id.clone()).collect();
            editor.original_name = view.name.clone();
            let name = view.name.clone();
            self.name
                .update(cx, |field, cx| field.set_value(name, window, cx));
        }
        self.group = view;
        cx.notify();
    }

    /// `Core::members(community)`: whom the editor offers.
    pub fn set_members(&mut self, members: Option<MemberList>, cx: &mut Context<Self>) {
        self.community = members;
        cx.notify();
    }

    fn observe(&mut self, op: &semaphore_core::model::AdminOp, mine: impl Fn(&OpAction) -> bool) {
        let Some(pending) = self.pending.as_mut() else {
            return;
        };
        if !mine(&pending.action) {
            return;
        }
        match pending.observe(op) {
            Outcome::Waiting => {}
            Outcome::Failed => self.pending = None,
            Outcome::Succeeded => {
                if matches!(
                    pending.action,
                    OpAction::CreateGroup | OpAction::SaveGroup { .. }
                ) {
                    self.editor = None;
                }
                self.pending = None;
            }
        }
    }

    /// Opens the editor, for stories and tests: on a new group, or on `group_id`.
    #[cfg(feature = "stories")]
    pub(crate) fn open_editor(
        &mut self,
        group_id: Option<&str>,
        name: &str,
        search: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        match group_id {
            Some(id) => self.edit(id.to_owned(), window, cx),
            None => self.create(window, cx),
        }
        let (name, search) = (name.to_owned(), search.to_owned());
        if !name.is_empty() {
            self.name
                .update(cx, |field, cx| field.set_value(name, window, cx));
        }
        self.search
            .update(cx, |field, cx| field.set_value(search, window, cx));
    }

    /// As if `action` was sent: for stories and tests.
    #[cfg(feature = "stories")]
    pub(crate) fn mark_sent(&mut self, action: OpAction, tried: bool) {
        self.last = Some(action.clone());
        self.pending = Some(Pending::new(action));
        if let Some(editor) = self.editor.as_mut() {
            editor.tried = tried;
        }
    }

    fn create(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.editor = Some(Editor {
            group_id: None,
            selected: BTreeSet::new(),
            loaded: true,
            original_name: String::new(),
            tried: false,
        });
        self.name
            .update(cx, |field, cx| field.set_value("", window, cx));
        self.search
            .update(cx, |field, cx| field.set_value("", window, cx));
        cx.notify();
    }

    fn edit(&mut self, group_id: String, window: &mut Window, cx: &mut Context<Self>) {
        let name = self
            .view
            .groups
            .iter()
            .find(|group| group.id == group_id)
            .map(|group| group.name.clone())
            .unwrap_or_default();
        self.editor = Some(Editor {
            group_id: Some(group_id.clone()),
            selected: BTreeSet::new(),
            loaded: false,
            original_name: name.clone(),
            tried: false,
        });
        self.group = AliasGroupView {
            group_id: group_id.clone(),
            ..AliasGroupView::default()
        };
        self.name
            .update(cx, |field, cx| field.set_value(name, window, cx));
        self.search
            .update(cx, |field, cx| field.set_value("", window, cx));
        cx.emit(MentionGroupsEvent::Open { group_id });
        cx.notify();
    }

    pub(crate) fn save(&mut self, cx: &mut Context<Self>) {
        let name = self.name.read(cx).value().to_string();
        let Some(editor) = self.editor.as_mut() else {
            return;
        };
        editor.tried = true;
        if check_group_name(&name).is_err() {
            cx.notify();
            return;
        }
        let member_ids: Vec<String> = editor.selected.iter().cloned().collect();
        let (action, event) = match editor.group_id.clone() {
            None => {
                if !self.caps.create_alias_group {
                    return;
                }
                (
                    OpAction::CreateGroup,
                    MentionGroupsEvent::Create { name, member_ids },
                )
            }
            Some(group_id) => {
                if !editor.loaded {
                    return;
                }
                let renamed = name != editor.original_name;
                (
                    OpAction::SaveGroup {
                        group_id: group_id.clone(),
                    },
                    MentionGroupsEvent::Save {
                        group_id,
                        name: renamed.then_some(name),
                        member_ids,
                    },
                )
            }
        };
        self.last = Some(action.clone());
        self.pending = Some(Pending::new(action));
        cx.emit(event);
        cx.notify();
    }

    fn busy(&self) -> bool {
        self.pending.is_some() && (self.view.op.busy || self.group.op.busy)
    }

    fn list_view(&self, cx: &mut Context<Self>) -> AnyElement {
        let sem = cx.sem().clone();
        let deleting = match op_about(&self.view.op, self.last.as_ref(), |_| true) {
            Some(OpAction::DeleteGroup { group_id }) if self.view.op.busy => Some(group_id),
            _ => None,
        };
        let edit_locked = (!self.caps.update_alias_group && !self.caps.manage_alias_members)
            .then(|| needs("Edit mention groups"));
        let delete_locked = (!self.caps.delete_alias_group).then(|| needs("Delete mention groups"));
        let body: AnyElement = match &self.view.state {
            LoadState::Loading => loading_rows("groups-loading", "Loading mention groups", 3),
            LoadState::Failed { .. } => error_block(
                "groups-retry",
                "Failed to load mention groups",
                "Please try again.",
                cx.listener(|_, _, _, cx| cx.emit(MentionGroupsEvent::Retry)),
                cx,
            ),
            LoadState::Ready if self.view.groups.is_empty() => div()
                .flex()
                .flex_col()
                .items_center()
                .gap(px(4.))
                .py(spacing(3.))
                .child(text(Variant::Body2, "No mention groups yet").text_color(sem.text_secondary))
                .child(
                    text(Variant::Caption, "Create a group so members can mention several people at once, like @designers.")
                        .text_color(sem.text_secondary)
                        .text_center(),
                )
                .into_any_element(),
            LoadState::Ready => {
                let rows: Vec<_> = self
                    .view
                    .groups
                    .iter()
                    .map(|group| {
                        let (edit_id, delete_row) = (group.id.clone(), group.clone());
                        let count = group.member_count;
                        let busy = deleting.as_deref() == Some(group.id.as_str());
                        row(SharedString::from(format!("group-{}", group.id)), format!("@{}", group.name), cx)
                            .child(design_icon_at(cx))
                            .child(
                                div()
                                    .flex_1()
                                    .min_w_0()
                                    .flex()
                                    .flex_wrap()
                                    .items_center()
                                    .gap(spacing(1.))
                                    .child(
                                        text(Variant::Body1, format!("@{}", group.name))
                                            .font_weight(FontWeight(500.))
                                            .min_w_0()
                                            .truncate()
                                            .text_color(sem.text_primary),
                                    )
                                    .child(Chip::new(format!(
                                        "{count} member{}",
                                        if count == 1 { "" } else { "s" }
                                    ))),
                            )
                            .child(action_icon(
                                format!("group-edit-{}", group.id),
                                DesignIcon::Edit,
                                format!("Edit @{}", group.name),
                                edit_locked.clone(),
                                false,
                                Some(sem.primary),
                                cx.listener(move |tab, _, window, cx| tab.edit(edit_id.clone(), window, cx)),
                            ))
                            .child(action_icon(
                                format!("group-delete-{}", group.id),
                                DesignIcon::Delete,
                                format!("Delete @{}", group.name),
                                delete_locked.clone(),
                                busy,
                                Some(sem.error),
                                cx.listener(move |tab, _, _, cx| {
                                    tab.deleting = Some(delete_row.clone());
                                    cx.notify();
                                }),
                            ))
                            .into_any_element()
                    })
                    .collect();
                list("groups-list", "Mention groups").children(rows).into_any_element()
            }
        };
        let error = op_about(&self.view.op, self.last.as_ref(), |action| {
            matches!(action, OpAction::DeleteGroup { .. })
        })
        .and_then(|_| server_error(self.view.op.error.as_ref()));
        div()
            .flex()
            .flex_col()
            .gap(spacing(2.))
            .children(error)
            .child(card("Mention Groups", body, cx))
            .into_any_element()
    }

    fn editor_view(&self, cx: &mut Context<Self>) -> AnyElement {
        let sem = cx.sem().clone();
        let Some(editor) = self.editor.as_ref() else {
            return div().into_any_element();
        };
        let editing = editor.group_id.is_some();
        let busy = self.busy();
        let name_text = self.name.read(cx).value().to_string();
        let name_error = check_group_name(&name_text).err().filter(|_| editor.tried);
        let name_editable = !busy
            && if editing {
                self.caps.update_alias_group
            } else {
                self.caps.create_alias_group
            };
        let members_editable = !busy
            && if editing {
                self.caps.manage_alias_members
            } else {
                self.caps.create_alias_group
            };
        let mut name = TextField::new("group-name", &self.name, "Group Name")
            .required(true)
            .disabled(!name_editable)
            .error(name_error.is_some())
            .helper(name_error.clone().unwrap_or_else(|| {
                "This name will be used for @mentions (e.g., @designers)".to_owned()
            }));
        if name_error.is_some() {
            name = name.error(true);
        }
        let op = if editing {
            &self.group.op
        } else {
            &self.view.op
        };
        let error = op_about(op, self.last.as_ref(), |action| {
            matches!(action, OpAction::CreateGroup | OpAction::SaveGroup { .. })
        })
        .and_then(|_| server_error(op.error.as_ref()));
        let waiting_group = editing && !editor.loaded;
        let group_failed = editing && matches!(self.group.state, LoadState::Failed { .. });
        let members: AnyElement = if group_failed {
            error_block(
                "group-retry",
                "Failed to load this group",
                "Please try again.",
                cx.listener(|_, _, _, cx| cx.emit(MentionGroupsEvent::Retry)),
                cx,
            )
        } else if waiting_group || self.community.is_none() {
            loading_rows("group-members-loading", "Loading members", 4)
        } else {
            let community = self.community.clone().unwrap_or_default();
            let filter = self.search.read(cx).value().trim().to_lowercase();
            let shown: Vec<UserView> = community
                .members
                .iter()
                .map(|member| member.user.clone())
                .filter(|user| {
                    filter.is_empty()
                        || user.username.to_lowercase().contains(&filter)
                        || user
                            .display_name
                            .as_deref()
                            .is_some_and(|name| name.to_lowercase().contains(&filter))
                })
                .collect();
            if community.members.is_empty() {
                Alert::new(
                    Severity::Info,
                    "No members in this community yet. Add members to the community first.",
                )
                .into_any_element()
            } else if shown.is_empty() {
                Alert::new(Severity::Info, "No members match your search.").into_any_element()
            } else {
                let all = shown.iter().all(|user| editor.selected.contains(&user.id));
                let ids: Vec<String> = shown.iter().map(|user| user.id.clone()).collect();
                let toggle_all = cx.weak_entity();
                let rows: Vec<_> = shown
                    .iter()
                    .map(|user| {
                        let id = user.id.clone();
                        let checked = editor.selected.contains(&user.id);
                        let toggle = cx.weak_entity();
                        row(
                            SharedString::from(format!("group-member-{id}")),
                            super::common::who(user),
                            cx,
                        )
                        .child(
                            Checkbox::new(
                                SharedString::from(format!("group-pick-{id}")),
                                super::common::who(user),
                                checked,
                            )
                            .disabled(!members_editable)
                            .on_change(move |on, _, cx| {
                                toggle
                                    .update(cx, |tab, cx| {
                                        if let Some(editor) = tab.editor.as_mut() {
                                            if on {
                                                editor.selected.insert(id.clone());
                                            } else {
                                                editor.selected.remove(&id);
                                            }
                                        }
                                        cx.notify();
                                    })
                                    .ok();
                            }),
                        )
                        .child(div().flex_1())
                        .child(
                            text(Variant::Body2, format!("@{}", user.username))
                                .min_w_0()
                                .truncate()
                                .text_color(sem.text_secondary),
                        )
                        .into_any_element()
                    })
                    .collect();
                div()
                    .flex()
                    .flex_col()
                    .gap(spacing(1.))
                    .child(
                        div().flex().items_center().gap(spacing(1.)).child(
                            Checkbox::new(
                                "group-pick-all",
                                format!("Select all ({})", shown.len()),
                                all,
                            )
                            .disabled(!members_editable)
                            .on_change(move |on, _, cx| {
                                toggle_all
                                    .update(cx, |tab, cx| {
                                        if let Some(editor) = tab.editor.as_mut() {
                                            for id in &ids {
                                                if on {
                                                    editor.selected.insert(id.clone());
                                                } else {
                                                    editor.selected.remove(id);
                                                }
                                            }
                                        }
                                        cx.notify();
                                    })
                                    .ok();
                            }),
                        ),
                    )
                    .child(list("group-members", "Community members").children(rows))
                    .into_any_element()
            }
        };
        let selected = editor.selected.len();
        let save_label = if busy {
            "Saving..."
        } else if editing {
            "Save Changes"
        } else {
            "Create Group"
        };
        let save_locked = if editing {
            (!self.caps.update_alias_group && !self.caps.manage_alias_members)
                .then(|| needs("Edit mention groups"))
        } else {
            (!self.caps.create_alias_group).then(|| needs("Create mention groups"))
        };
        let save = locked_button(
            Button::new("group-save", save_label)
                .contained()
                .start_icon(DesignIcon::Save)
                .disabled(busy || waiting_group || name_text.trim().is_empty())
                .on_click(cx.listener(|tab, _, _, cx| tab.save(cx))),
            "group-save-locked",
            save_locked,
            cx,
        );
        let actions = div()
            .flex()
            .flex_wrap()
            .justify_end()
            .gap(spacing(1.))
            .child(
                Button::new("group-cancel", "Cancel")
                    .outlined()
                    .start_icon(DesignIcon::Cancel)
                    .disabled(busy)
                    .on_click(cx.listener(|tab, _, _, cx| {
                        tab.editor = None;
                        cx.notify();
                    })),
            )
            .child(save);
        card(
            if editing {
                "Edit Mention Group"
            } else {
                "New Mention Group"
            },
            div()
                .flex()
                .flex_col()
                .gap(spacing(2.))
                .children(error)
                .child(name)
                .child(
                    div()
                        .flex()
                        .flex_wrap()
                        .items_center()
                        .justify_between()
                        .gap(spacing(1.))
                        .child(text(Variant::Subtitle2, "Members").text_color(sem.text_primary))
                        .child(if selected > 0 {
                            tone_chip(format!("{selected} selected"), sem.primary)
                        } else {
                            Chip::new("0 selected")
                        }),
                )
                .child(
                    TextField::new("group-search", &self.search, "Search members")
                        .placeholder("Search members..."),
                )
                .child(members)
                .child(actions),
            cx,
        )
        .into_any_element()
    }
}

fn design_icon_at(cx: &App) -> Svg {
    crate::panel::common::design_icon(DesignIcon::AlternateEmail, 20., cx.sem().text_secondary)
}

impl Render for MentionGroupsTab {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let in_editor = self.editor.is_some();
        let create_locked = (!self.caps.create_alias_group).then(|| needs("Create mention groups"));
        let actions = if in_editor {
            Vec::new()
        } else {
            vec![locked_button(
                Button::new("group-create", "Create Group")
                    .contained()
                    .start_icon(DesignIcon::Add)
                    .on_click(cx.listener(|tab, _, window, cx| tab.create(window, cx))),
                "group-create-locked",
                create_locked,
                cx,
            )]
        };
        let body = if in_editor {
            self.editor_view(cx)
        } else {
            self.list_view(cx)
        };
        let dialog = self.deleting.clone().map(|group| {
            let confirm = cx.weak_entity();
            let cancel = cx.weak_entity();
            let id = group.id.clone();
            Confirm {
                id: "group-delete",
                title: "Delete Mention Group",
                message: format!(
                    "Are you sure you want to delete @{}? Members can no longer mention it. This action cannot be undone.",
                    group.name
                ),
                confirm: "Delete Group",
                busy: false,
            }
            .dialog(
                move |_, cx| {
                    confirm
                        .update(cx, |tab, cx| {
                            tab.deleting = None;
                            let action = OpAction::DeleteGroup { group_id: id.clone() };
                            tab.last = Some(action.clone());
                            tab.pending = Some(Pending::new(action));
                            cx.emit(MentionGroupsEvent::Delete { group_id: id.clone() });
                            cx.notify();
                        })
                        .ok();
                },
                move |_, cx| {
                    cancel
                        .update(cx, |tab, cx| {
                            tab.deleting = None;
                            cx.notify();
                        })
                        .ok();
                },
                cx,
            )
        });
        div()
            .relative()
            .size_full()
            .child(page(
                "community-mention-groups",
                "Mention Groups",
                Some("Groups members can @mention to reach everyone in them.".into()),
                actions,
                body,
                window,
                cx,
            ))
            .children(dialog)
    }
}
