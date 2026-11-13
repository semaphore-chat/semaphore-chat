//! The instance role editor, after `AdminRolesPage.tsx`'s create/edit dialog and the community's
//! `RoleEditor.tsx`: the name (locked on the default role) and the permission matrix in
//! `instance_action_groups()`, each group with a checkbox for all of it. Actions the user can't
//! grant are off with the permission they'd need; unknown actions this build doesn't know are kept
//! on save.

use super::InstanceRolesPage;
use super::rules::{Draft, Tri, check_name, groups, name_length};
use crate::community_settings::rules::needs;
use crate::kit::{
    Alert, Button, CheckState, Checkbox, Chip, IconButton, Severity, TextField, Variant, spacing,
    text, with_tip,
};
use crate::roles::rules::{label_of, permissions_count};
use crate::theme::SemTheme;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::component::input::{InputEvent, InputState};
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{AdminAction, InstanceActionGroup};
use semaphore_design::Icon as DesignIcon;
use std::collections::{BTreeSet, HashSet};

pub(super) struct EditorState {
    pub(super) role_id: Option<String>,
    pub(super) is_default: bool,
    pub(super) draft: Draft,
    pub(super) field: Entity<InputState>,
    /// The name was typed in, or Save pressed: its error may show.
    pub(super) touched: bool,
    pub(super) collapsed: HashSet<String>,
    _subscription: Subscription,
}

impl EditorState {
    pub(super) fn create(window: &mut Window, cx: &mut Context<InstanceRolesPage>) -> Self {
        let field = cx.new(|cx| InputState::new(window, cx));
        let subscription = subscribe(window, cx, &field);
        Self {
            role_id: None,
            is_default: false,
            draft: Draft::create(),
            field,
            touched: false,
            collapsed: HashSet::new(),
            _subscription: subscription,
        }
    }

    pub(super) fn edit(
        role: &semaphore_core::model::InstanceRoleRow,
        window: &mut Window,
        cx: &mut Context<InstanceRolesPage>,
    ) -> Self {
        let field = cx.new(|cx| InputState::new(window, cx));
        let name = role.name.clone();
        field.update(cx, |field, cx| field.set_value(name, window, cx));
        let subscription = subscribe(window, cx, &field);
        Self {
            role_id: Some(role.id.clone()),
            is_default: role.is_default,
            draft: Draft::edit(role),
            field,
            touched: false,
            collapsed: HashSet::new(),
            _subscription: subscription,
        }
    }

    /// The change a save of this editor is in `AdminOp::actions`.
    pub(super) fn action(&self) -> AdminAction {
        match &self.role_id {
            None => super::create_action(),
            Some(id) => super::update_action(id),
        }
    }
}

/// Typing into the name field lands in the draft; the field stays the source of the text.
fn subscribe(
    window: &mut Window,
    cx: &mut Context<InstanceRolesPage>,
    field: &Entity<InputState>,
) -> Subscription {
    cx.subscribe_in(field, window, |page, field, event, _, cx| {
        if let InputEvent::Change = event {
            let typed = field.read(cx).value().to_string();
            if let Some(editor) = page.editor.as_mut() {
                if editor.draft.name != typed {
                    editor.touched = true;
                }
                editor.draft.name = typed;
            }
            cx.notify();
        }
    })
}

impl InstanceRolesPage {
    fn grantable(&self) -> BTreeSet<String> {
        self.view.grantable.iter().cloned().collect()
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

    /// Save pressed: a new role goes out whole, an edit sends the same whole draft (the name and
    /// every action), as core's `update_instance_role` takes it.
    pub(crate) fn save(&mut self, cx: &mut Context<Self>) {
        let Some(editor) = self.editor.as_mut() else {
            return;
        };
        editor.touched = true;
        if editor.draft.problem().is_some() || !editor.draft.is_dirty() {
            cx.notify();
            return;
        }
        let action = editor.action();
        let role_id = editor.role_id.clone();
        let is_default = editor.is_default;
        let original_name = editor.draft.original_name.clone();
        let mut draft = editor.draft.draft();
        if is_default && let Some(original) = original_name {
            // A default role's name can't change; the field is locked anyway.
            draft.name = original;
        }
        match role_id {
            None => self.send(action, super::InstanceRolesEvent::Create(draft), cx),
            Some(role_id) => self.send(
                action,
                super::InstanceRolesEvent::Update { role_id, draft },
                cx,
            ),
        }
    }

    fn group_view(
        &self,
        group: &InstanceActionGroup,
        grantable: &BTreeSet<String>,
        busy: bool,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let sem = cx.sem().clone();
        let editor = self.editor.as_ref().expect("editing");
        let draft = &editor.draft;
        let state = draft.group_state(&group.actions);
        let on = group
            .actions
            .iter()
            .filter(|action| draft.actions.contains(*action))
            .count();
        let any_grantable = group
            .actions
            .iter()
            .any(|action| grantable.contains(action));
        let collapsed = editor.collapsed.contains(&group.label);
        let group_id = group.label.clone();
        let actions = group.actions.clone();
        let label = group.label.clone();
        let header = div()
            .flex()
            .items_center()
            .gap(spacing(1.))
            .px(spacing(1.))
            .when(state == Tri::Some, |header| header.bg(sem.action_hover))
            .child(
                Checkbox::new(
                    SharedString::from(format!("admin-role-group-{group_id}")),
                    format!("All of {label}"),
                    state == Tri::All,
                )
                .state(match state {
                    Tri::None => CheckState::Unchecked,
                    Tri::Some => CheckState::Indeterminate,
                    Tri::All => CheckState::Checked,
                })
                .disabled(busy || !any_grantable)
                .hide_label()
                .dense()
                .on_toggle({
                    let page = cx.weak_entity();
                    move |_, _, cx| {
                        page.update(cx, |page, cx| page.toggle_group(&actions, cx))
                            .ok();
                    }
                }),
            )
            .child(
                text(Variant::Subtitle2, label.clone())
                    .text_color(sem.text_primary)
                    .min_w_0(),
            )
            .child(if on > 0 {
                crate::community_settings::common::tone_chip(
                    format!("{on}/{}", group.actions.len()),
                    sem.primary,
                )
            } else {
                Chip::new(format!("{on}/{}", group.actions.len()))
            })
            .child(div().flex_1())
            .child(
                IconButton::new(
                    SharedString::from(format!("admin-role-group-toggle-{group_id}")),
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
                .on_click(cx.listener(move |page, _, _, cx| page.toggle_collapsed(&group_id, cx))),
            );
        let rows = (!collapsed).then(|| {
            div()
                .flex()
                .flex_col()
                .pl(spacing(2.))
                .pb(spacing(1.))
                .children(group.actions.iter().map(|action| {
                    let checked = draft.actions.contains(action);
                    let reason = (!grantable.contains(action)).then(|| needs(&label_of(action)));
                    let disabled = reason.is_some() || busy;
                    let target = action.clone();
                    let page = cx.weak_entity();
                    let checkbox = Checkbox::new(
                        SharedString::from(format!("admin-role-action-{action}")),
                        label_of(action),
                        checked,
                    )
                    .disabled(disabled)
                    .dense()
                    .on_toggle(move |_, _, cx| {
                        if !disabled {
                            page.update(cx, |page, cx| page.toggle_action(&target, cx))
                                .ok();
                        }
                    });
                    let checkbox: AnyElement = match reason {
                        Some(reason) => with_tip(
                            div()
                                .id(SharedString::from(format!(
                                    "admin-role-action-{action}-locked"
                                )))
                                .min_w_0(),
                            reason,
                        )
                        .test_support()
                        .child(checkbox)
                        .into_any_element(),
                        None => checkbox.into_any_element(),
                    };
                    div().flex().flex_col().child(checkbox).into_any_element()
                }))
        });
        div()
            .id(SharedString::from(format!(
                "admin-role-group-box-{}",
                group.label
            )))
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
        let busy = crate::community_settings::rules::running(&self.view.op, &editor.action());
        let error =
            crate::community_settings::rules::failure(&self.view.op, &editor.action()).cloned();
        let draft = &editor.draft;
        let title = match &draft.original_name {
            None => "Create New Role".to_owned(),
            Some(name) => format!("Edit Role: {name}"),
        };
        let name_error = check_name(&draft.name)
            .err()
            .filter(|_| editor.touched && !editor.is_default);
        let helper = if editor.is_default {
            "Default role name cannot be changed".to_owned()
        } else if let Some(error) = name_error {
            error.message().to_owned()
        } else {
            format!(
                "Enter a descriptive name for this role ({} of 50)",
                name_length(&draft.name)
            )
        };
        let name = TextField::new("admin-role-name", &editor.field, "Role Name")
            .required(true)
            .helper(helper)
            .error(name_error.is_some())
            .disabled(busy || editor.is_default);
        let grantable = self.grantable();
        let permission_groups = groups();
        let ungrantable = permission_groups
            .iter()
            .flat_map(|group| group.actions.iter())
            .any(|action| !grantable.contains(action));
        let problem = draft.problem();
        let can_save = problem.is_none() && draft.is_dirty() && !busy;
        let save_label = if draft.is_new() {
            "Create Role"
        } else {
            "Save Changes"
        };
        let buttons = |suffix: &'static str, cx: &mut Context<Self>| {
            div()
                .flex()
                .flex_wrap()
                .gap(spacing(1.))
                .child(
                    Button::new(
                        SharedString::from(format!("admin-role-editor-cancel{suffix}")),
                        "Cancel",
                    )
                    .outlined()
                    .disabled(busy)
                    .on_click(cx.listener(|page, _, _, cx| page.close_editor(cx))),
                )
                .child(
                    Button::new(
                        SharedString::from(format!("admin-role-editor-save{suffix}")),
                        save_label,
                    )
                    .contained()
                    .start_icon(DesignIcon::Save)
                    .loading(busy)
                    .disabled(!can_save)
                    .on_click(cx.listener(|page, _, _, cx| page.save(cx))),
                )
        };
        let top_buttons = buttons("", cx);
        let bottom_buttons = buttons("-bottom", cx);
        let heading = div()
            .flex()
            .when(narrow, |heading| heading.flex_col().items_start())
            .when(!narrow, |heading| heading.items_center().justify_between())
            .gap(spacing(1.))
            .child(
                text(Variant::H6, title)
                    .text_color(sem.text_primary)
                    .min_w_0(),
            )
            .when(!narrow, |heading| heading.child(top_buttons));
        let group_views: Vec<AnyElement> = permission_groups
            .iter()
            .map(|group| self.group_view(group, &grantable, busy, cx))
            .collect();
        let count = draft.actions.len();
        let body = div()
            .flex()
            .flex_col()
            .gap(spacing(2.))
            .child(heading)
            .children(error.map(|error| Alert::new(Severity::Error, error.message)))
            .when(editor.is_default, |body| {
                body.child(Alert::new(
                    Severity::Info,
                    "You are editing a default role. You can modify permissions but cannot change the role name.",
                ))
            })
            .child(name)
            .child(text(Variant::H6, "Permissions").text_color(sem.text_primary))
            .when(count == 0, |body| {
                body.child(
                    div()
                        .id("admin-role-editor-actions-error")
                        .test_support()
                        .child(Alert::new(
                            Severity::Warning,
                            "Role must have at least one permission",
                        )),
                )
            })
            .when(ungrantable, |body| {
                body.child(crate::community_settings::common::locked_note(
                    "admin-role-editor-ungrantable",
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
                        crate::community_settings::common::tone_chip(
                            format!("{count} selected"),
                            sem.primary,
                        )
                    } else {
                        Chip::new("0 selected")
                    }),
            )
            .child(
                div()
                    .id("admin-role-matrix")
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
                    .when(narrow, |footer| footer.flex_col().items_start())
                    .when(!narrow, |footer| footer.items_center().justify_between())
                    .flex_wrap()
                    .gap(spacing(1.))
                    .child(
                        text(
                            Variant::Body2,
                            if editor.is_default {
                                "You can change which permissions this role holds."
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
            .id("admin-roles-editor")
            .test_support()
            .rounded(px(8.))
            .border_1()
            .border_color(sem.divider)
            .bg(sem.paper)
            .p(spacing(if narrow { 2. } else { 3. }))
            .flex()
            .flex_col()
            .child(body)
            .into_any_element()
    }
}
