//! The role editor, after `RoleEditor.tsx`: the name (locked on a default role) and the
//! permission matrix in the web's groups, each with a checkbox for the whole group. Actions the
//! user can't grant are off with the reason; actions this build doesn't know show in "Other",
//! read-only, and are kept on save. A role the user can't edit opens read-only, with why.

use super::common::{locked_note, tri_checkbox};
use super::list::{RolesEvent, RolesPanel};
use super::rules::{
    NameError, OTHER_GROUP, RoleDraftState, RoleOp, Tri, check_role_name, clean_name, group_label,
    label_of, matrix_groups, permissions_count,
};
use crate::kit::{
    Alert, Button, Checkbox, Chip, IconButton, Severity, TextField, Variant, spacing, text,
    with_tip,
};
use crate::theme::SemTheme;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::component::input::{InputEvent, InputState};
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{PermissionGroup, RoleDraft, RoleRow};
use semaphore_design::Icon as DesignIcon;
use std::collections::{BTreeSet, HashSet};

pub(crate) struct EditorState {
    pub role_id: Option<String>,
    pub is_default: bool,
    /// Why the user can't edit it: then nothing can change.
    pub read_only: Option<String>,
    pub draft: RoleDraftState,
    pub field: Entity<InputState>,
    /// The name was typed in, or Save pressed: its error may show.
    pub touched: bool,
    pub collapsed: HashSet<String>,
    _subscription: Subscription,
}

impl EditorState {
    pub fn new(
        role: Option<&RoleRow>,
        read_only: Option<String>,
        window: &mut Window,
        cx: &mut Context<RolesPanel>,
    ) -> Self {
        let field = cx.new(|cx| InputState::new(window, cx));
        if let Some(role) = role {
            let name = role.name.clone();
            field.update(cx, |field, cx| field.set_value(name, window, cx));
        }
        let _subscription = cx.subscribe_in(&field, window, |panel, field, event, _, cx| {
            if let InputEvent::Change = event {
                let typed = field.read(cx).value().to_string();
                if let Some(editor) = panel.editor.as_mut() {
                    if editor.draft.name != typed {
                        editor.touched = true;
                    }
                    editor.draft.name = typed;
                }
                cx.notify();
            }
        });
        Self {
            role_id: role.map(|role| role.id.clone()),
            is_default: role.is_some_and(|role| role.is_default),
            read_only,
            draft: role.map_or_else(RoleDraftState::create, RoleDraftState::edit),
            field,
            touched: false,
            collapsed: HashSet::new(),
            _subscription,
        }
    }
}

impl RolesPanel {
    fn grantable(&self) -> BTreeSet<String> {
        let read_only = self
            .editor
            .as_ref()
            .is_some_and(|editor| editor.read_only.is_some());
        if read_only {
            BTreeSet::new()
        } else {
            self.view.grantable.iter().cloned().collect()
        }
    }

    fn other_names(&self) -> Vec<String> {
        let own = self.editor.as_ref().and_then(|e| e.role_id.clone());
        self.view
            .roles
            .iter()
            .filter(|role| Some(&role.id) != own.as_ref())
            .map(|role| role.name.clone())
            .collect()
    }

    pub(crate) fn toggle_action(&mut self, action: &str, cx: &mut Context<Self>) {
        let grantable = self.grantable();
        if let Some(editor) = self.editor.as_mut() {
            editor.draft.toggle(action, &grantable);
        }
        cx.notify();
    }

    pub(crate) fn toggle_group(&mut self, actions: &[String], cx: &mut Context<Self>) {
        let grantable = self.grantable();
        if let Some(editor) = self.editor.as_mut() {
            editor.draft.toggle_group(actions, &grantable);
        }
        cx.notify();
    }

    fn toggle_collapsed(&mut self, group: &str, cx: &mut Context<Self>) {
        if let Some(editor) = self.editor.as_mut()
            && !editor.collapsed.remove(group)
        {
            editor.collapsed.insert(group.to_owned());
        }
        cx.notify();
    }

    /// For stories and tests: types a name as if into the field.
    #[cfg(any(test, feature = "stories"))]
    pub(crate) fn type_name(&mut self, name: &str, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(editor) = self.editor.as_mut() {
            let typed = name.to_owned();
            editor
                .field
                .update(cx, |field, cx| field.set_value(typed, window, cx));
            editor.draft.name = name.to_owned();
            editor.touched = true;
        }
    }

    /// Save pressed.
    pub(crate) fn save(&mut self, cx: &mut Context<Self>) {
        let others = self.other_names();
        let Some(editor) = self.editor.as_mut() else {
            return;
        };
        if editor.read_only.is_some() {
            return;
        }
        editor.touched = true;
        if editor
            .draft
            .problem(others.iter().map(String::as_str))
            .is_some()
            || !editor.draft.is_dirty()
        {
            cx.notify();
            return;
        }
        let draft = editor.draft.clone();
        let role_id = editor.role_id.clone();
        let is_default = editor.is_default;
        match role_id {
            None => self.send(
                RoleOp::Create,
                RolesEvent::Create {
                    draft: RoleDraft {
                        name: clean_name(&draft.name).to_owned(),
                        actions: draft.actions.iter().cloned().collect(),
                    },
                },
                cx,
            ),
            Some(role_id) => {
                let mut changes = draft.changes();
                if is_default {
                    // A default role's name can't change; the field is locked anyway.
                    changes.name = None;
                }
                if changes.is_empty() {
                    return;
                }
                self.send(
                    RoleOp::Update {
                        role_id: role_id.clone(),
                    },
                    RolesEvent::Update { role_id, changes },
                    cx,
                )
            }
        }
    }

    fn group_view(
        &self,
        group: &PermissionGroup,
        grantable: &BTreeSet<String>,
        busy: bool,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let sem = cx.sem().clone();
        let editor = self.editor.as_ref().expect("editing");
        let draft = &editor.draft;
        let other = group.id == OTHER_GROUP;
        let state = draft.group_state(&group.actions);
        let on = group
            .actions
            .iter()
            .filter(|a| draft.actions.contains(*a))
            .count();
        let any_grantable = !other && group.actions.iter().any(|a| grantable.contains(a));
        let collapsed = editor.collapsed.contains(&group.id);
        let group_id = group.id.clone();
        let actions = group.actions.clone();
        let label = group_label(&group.id);
        let header = div()
            .flex()
            .items_center()
            .gap(spacing(1.))
            .px(spacing(1.))
            .when(state == Tri::Some, |h| h.bg(sem.action_hover))
            .child(tri_checkbox(
                SharedString::from(format!("role-group-{group_id}")),
                format!("All of {label}"),
                state,
                busy || !any_grantable,
                {
                    let entity = cx.weak_entity();
                    move |_, cx| {
                        entity
                            .update(cx, |panel, cx| panel.toggle_group(&actions, cx))
                            .ok();
                    }
                },
                cx,
            ))
            .child(
                text(Variant::Subtitle2, label.clone())
                    .text_color(sem.text_primary)
                    .min_w_0(),
            )
            .child(if on > 0 {
                super::common::tone_chip(format!("{on}/{}", group.actions.len()), sem.primary)
            } else {
                Chip::new(format!("{on}/{}", group.actions.len()))
            })
            .child(div().flex_1())
            .child(
                IconButton::new(
                    SharedString::from(format!("role-group-toggle-{group_id}")),
                    if collapsed {
                        DesignIcon::ExpandMore
                    } else {
                        DesignIcon::ExpandLess
                    },
                    if collapsed {
                        format!("Show {label}")
                    } else {
                        format!("Hide {label}")
                    },
                )
                .small()
                .on_click(cx.listener(move |panel, _, _, cx| {
                    panel.toggle_collapsed(&group_id, cx)
                })),
            );
        let rows = (!collapsed).then(|| {
            div()
                .flex()
                .flex_col()
                .pl(spacing(2.))
                .pb(spacing(1.))
                .children(group.actions.iter().map(|action| {
                    let checked = draft.actions.contains(action);
                    let reason = if other {
                        Some("This app doesn't know this permission: it is kept as it is".to_owned())
                    } else if editor.read_only.is_some() {
                        Some("Read-only".to_owned())
                    } else if !grantable.contains(action) {
                        Some("You don't have this permission, so you can't grant it".to_owned())
                    } else {
                        None
                    };
                    let disabled = reason.is_some() || busy;
                    let target = action.clone();
                    let mut checkbox = Checkbox::new(
                        SharedString::from(format!("role-action-{action}")),
                        label_of(action),
                        checked,
                    )
                    .disabled(disabled);
                    if !disabled {
                        let entity = cx.weak_entity();
                        checkbox = checkbox.on_change(move |_, _, cx| {
                            entity
                                .update(cx, |panel, cx| panel.toggle_action(&target, cx))
                                .ok();
                        });
                    }
                    let checkbox: AnyElement = match &reason {
                        Some(reason) if editor.read_only.is_none() => with_tip(
                            div().id(SharedString::from(format!("role-action-{action}-locked"))),
                            reason.clone(),
                        )
                        .test_support()
                        .child(checkbox)
                        .into_any_element(),
                        _ => checkbox.into_any_element(),
                    };
                    div()
                        .flex()
                        .flex_col()
                        .child(checkbox)
                        .child(
                            text(Variant::Caption, action.clone())
                                .pl(px(54.))
                                .mt(px(-10.))
                                .pb(px(4.))
                                .text_color(sem.text_secondary),
                        )
                        .into_any_element()
                }))
        });
        div()
            .id(SharedString::from(format!("role-group-box-{}", group.id)))
            .test_support()
            .flex()
            .flex_col()
            .rounded(px(4.))
            .border_1()
            .border_color(sem.divider)
            .child(header)
            .children(rows)
            .into_any_element()
    }

    pub(super) fn editor_view(&self, narrow: bool, cx: &mut Context<Self>) -> AnyElement {
        let sem = cx.sem().clone();
        let editor = self.editor.as_ref().expect("editing");
        let others = self.other_names();
        let busy = self.busy_with(|op| matches!(op, RoleOp::Create | RoleOp::Update { .. }));
        let error = self
            .about()
            .filter(|op| matches!(op, RoleOp::Create | RoleOp::Update { .. }))
            .and_then(|_| self.view.op.error.clone());
        let read_only = editor.read_only.clone();
        let draft = &editor.draft;
        let title = match (&draft.original_name, &read_only) {
            (None, _) => "Create New Role".to_owned(),
            (Some(name), Some(_)) => format!("Role: {name}"),
            (Some(name), None) => format!("Edit Role: {name}"),
        };
        let name_error = check_role_name(&draft.name, others.iter().map(String::as_str))
            .err()
            .filter(|_| editor.touched && read_only.is_none() && !editor.is_default);
        let helper = if editor.is_default {
            "Default role name cannot be changed".to_owned()
        } else if let Some(error) = name_error {
            error.message().to_owned()
        } else {
            format!(
                "Enter a descriptive name for this role ({} of 50)",
                clean_name(&draft.name).chars().count()
            )
        };
        let mut name = TextField::new("role-name", &editor.field, "Role Name")
            .required(true)
            .helper(helper)
            .error(name_error.is_some())
            .disabled(busy || read_only.is_some() || editor.is_default);
        if name_error == Some(NameError::Taken) {
            name = name.error(true);
        }
        let grantable = self.grantable();
        let groups = matrix_groups(&self.catalog, &draft.actions);
        let ungrantable = read_only.is_none()
            && groups
                .iter()
                .filter(|g| g.id != OTHER_GROUP)
                .flat_map(|g| g.actions.iter())
                .any(|a| !grantable.contains(a));
        let problem = draft.problem(others.iter().map(String::as_str));
        let can_save = read_only.is_none() && problem.is_none() && draft.is_dirty() && !busy;
        let save_label = if draft.is_new() {
            "Create Role"
        } else {
            "Update Role"
        };
        let buttons = |suffix: &'static str, cx: &mut Context<Self>| {
            div()
                .flex()
                .gap(spacing(1.))
                .child(
                    Button::new(
                        SharedString::from(format!("role-editor-cancel{suffix}")),
                        if read_only.is_some() { "Back" } else { "Cancel" },
                    )
                    .outlined()
                    .disabled(busy)
                    .on_click(cx.listener(|panel, _, _, cx| panel.close_editor(cx))),
                )
                .when(read_only.is_none(), |row| {
                    row.child(
                        Button::new(
                            SharedString::from(format!("role-editor-save{suffix}")),
                            save_label,
                        )
                        .contained()
                        .start_icon(DesignIcon::Save)
                        .loading(busy)
                        .disabled(!can_save)
                        .on_click(cx.listener(|panel, _, _, cx| panel.save(cx))),
                    )
                })
        };
        let top_buttons = buttons("", cx);
        let bottom_buttons = buttons("-bottom", cx);
        let heading = div()
            .flex()
            .when(narrow, |h| h.flex_col().items_start())
            .when(!narrow, |h| h.items_center().justify_between())
            .gap(spacing(1.))
            .child(
                text(Variant::H6, title.clone())
                    .text_color(sem.text_primary)
                    .min_w_0(),
            )
            .when(!narrow, |h| h.child(top_buttons));
        let group_views: Vec<AnyElement> = groups
            .iter()
            .map(|group| self.group_view(group, &grantable, busy || read_only.is_some(), cx))
            .collect();
        let count = draft.actions.len();
        let body = div()
            .flex()
            .flex_col()
            .gap(spacing(2.))
            .child(heading)
            .children(error.map(|error| Alert::new(Severity::Error, error.message)))
            .children(read_only.clone().map(|reason| {
                Alert::new(
                    Severity::Info,
                    format!("You can't change this role: {reason}."),
                )
            }))
            .when(editor.is_default && read_only.is_none(), |body| {
                body.child(Alert::new(
                    Severity::Info,
                    "You are editing a default role. You can modify permissions but cannot change the role name.",
                ))
            })
            .child(name)
            .child(text(Variant::H6, "Permissions").text_color(sem.text_primary))
            .when(count == 0 && read_only.is_none(), |body| {
                body.child(Alert::new(
                    Severity::Warning,
                    "Role must have at least one permission",
                ))
            })
            .when(ungrantable, |body| {
                body.child(locked_note(
                    "role-editor-ungrantable",
                    "Permissions you don't have are off: you can only grant what you hold.",
                    cx,
                ))
            })
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .child(
                        text(Variant::Body2, format!("Selected: {}", permissions_count(count)))
                            .text_color(sem.text_secondary),
                    )
                    .child(if count > 0 {
                        super::common::tone_chip(format!("{count} selected"), sem.primary)
                    } else {
                        Chip::new("0 selected")
                    }),
            )
            .child(
                div()
                    .id("role-matrix")
                    .test_support()
                    .flex()
                    .flex_col()
                    .gap(spacing(1.))
                    .children(group_views),
            )
            .child(div().h(px(1.)).bg(sem.divider))
            .child(
                div()
                    .flex()
                    .when(narrow, |f| f.flex_col().items_start())
                    .when(!narrow, |f| f.items_center().justify_between())
                    .gap(spacing(1.))
                    .child(
                        text(
                            Variant::Body2,
                            if read_only.is_some() {
                                "Only someone ranked above this role can change it."
                            } else if draft.is_new() {
                                "Role will be available for assignment after creation"
                            } else {
                                "Changes will take effect immediately"
                            },
                        )
                        .text_color(sem.text_secondary),
                    )
                    .child(bottom_buttons),
            );
        div()
            .id("role-editor")
            .test_support()
            .rounded(px(8.))
            .border_1()
            .border_color(sem.divider)
            .bg(sem.paper)
            .p(spacing(if narrow { 2. } else { 3. }))
            .child(body)
            .into_any_element()
    }
}
