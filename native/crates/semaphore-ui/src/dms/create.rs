//! The new conversation dialog, after `CreateDmDialog.tsx`: pick one user for a DM, or several for
//! a group with an optional name.

use super::picker::{UserPicker, UserPickerEvent};
use super::{CreateDmDialog, CreateDmEvent};
use crate::kit::{Alert, Button, Dialog, Severity, TextField};
use crate::panel::common::is_phone;
use gpui_kit::component::input::InputState;
use gpui_kit::prelude::*;
use gpui_kit::*;

/// What a Create press asks for: the picked users, and the name only for a group with one.
pub fn create_request(user_ids: Vec<String>, name: &str) -> Option<CreateDmEvent> {
    if user_ids.is_empty() {
        return None;
    }
    let name = name.trim();
    let name = (user_ids.len() > 1 && !name.is_empty()).then(|| name.to_owned());
    Some(CreateDmEvent::Create { user_ids, name })
}

impl CreateDmDialog {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let picker = cx.new(|cx| UserPicker::new("create-dm", "Select users", true, window, cx));
        let name = cx.new(|cx| InputState::new(window, cx));
        let subscriptions =
            vec![
                cx.subscribe(&picker, |_, _, event: &UserPickerEvent, cx| match event {
                    UserPickerEvent::Search { query } => cx.emit(CreateDmEvent::Search {
                        query: query.clone(),
                    }),
                    UserPickerEvent::Changed => cx.notify(),
                }),
            ];
        Self {
            picker,
            name,
            busy: false,
            failed: None,
            _subscriptions: subscriptions,
        }
    }

    /// The picker, for `set_results` and `set_excluded` (this user).
    pub fn picker(&self) -> &Entity<UserPicker> {
        &self.picker
    }

    /// A create is on its way: the controls wait.
    pub fn set_busy(&mut self, busy: bool, cx: &mut Context<Self>) {
        self.busy = busy;
        self.picker
            .update(cx, |picker, cx| picker.set_disabled(busy, cx));
        cx.notify();
    }

    /// Why the last create failed, shown above the actions; `None` clears it.
    pub fn set_failed(&mut self, message: Option<String>, cx: &mut Context<Self>) {
        self.failed = message;
        cx.notify();
    }

    /// Empties the picks and the name, as the web does after a create.
    pub fn reset(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.picker
            .update(cx, |picker, cx| picker.clear(window, cx));
        self.name
            .update(cx, |name, cx| name.set_value("", window, cx));
        self.busy = false;
        self.failed = None;
        cx.notify();
    }

    pub fn focus_field(&self, window: &mut Window, cx: &mut App) {
        let picker = self.picker.clone();
        picker.update(cx, |picker, cx| picker.focus_field(window, cx));
    }

    pub(crate) fn create(&mut self, cx: &mut Context<Self>) {
        if self.busy {
            return;
        }
        let user_ids = self
            .picker
            .read(cx)
            .picked()
            .iter()
            .map(|user| user.id.clone())
            .collect();
        let name = self.name.read(cx).value().to_string();
        if let Some(event) = create_request(user_ids, &name) {
            cx.emit(event);
        }
    }
}

impl Render for CreateDmDialog {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let picked = self.picker.read(cx).picked().len();
        let width = if is_phone(window) {
            f32::from(window.viewport_size().width)
        } else {
            600.
        };
        let view = cx.weak_entity();
        Dialog::new("Start a Direct Message")
            .width(width)
            .on_close({
                let view = view.clone();
                move |_, cx| {
                    view.update(cx, |_, cx| cx.emit(CreateDmEvent::Cancel)).ok();
                }
            })
            .body(
                div()
                    .id("create-dm")
                    .flex()
                    .flex_col()
                    .gap(px(16.))
                    .pt(px(8.))
                    .child(self.picker.clone())
                    .when(picked > 1, |body| {
                        body.child(
                            TextField::new("create-dm-name", &self.name, "Group name (optional)")
                                .placeholder("Enter a name for your group...")
                                .disabled(self.busy),
                        )
                    })
                    .children(
                        self.failed
                            .clone()
                            .map(|message| Alert::new(Severity::Error, message)),
                    ),
            )
            .action(Button::new("create-dm-cancel", "Cancel").on_click({
                let view = view.clone();
                move |_, _, cx| {
                    view.update(cx, |_, cx| cx.emit(CreateDmEvent::Cancel)).ok();
                }
            }))
            .action(
                Button::new("create-dm-create", "Create")
                    .contained()
                    .disabled(picked == 0)
                    .loading(self.busy)
                    .on_click(move |_, _, cx| {
                        view.update(cx, |dialog, cx| dialog.create(cx)).ok();
                    }),
            )
    }
}
