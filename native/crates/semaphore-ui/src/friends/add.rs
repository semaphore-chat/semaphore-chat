//! The add friend form and dialog, after `AddFriendForm.tsx` and `AddFriendDialog.tsx`.

use super::{AddFriendDialog, AddFriendDialogEvent, AddFriendEvent, AddFriendForm};
use crate::dms::picker::{UserPicker, UserPickerEvent};
use crate::kit::{Alert, Button, Dialog, Severity, spacing};
use crate::panel::common::is_phone;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{ErrorView, FriendsView};
use std::collections::HashMap;

/// Where the last "Send Friend Request" got to.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum AddOutcome {
    #[default]
    Idle,
    Sending,
    /// "Friend request sent!"
    Sent,
    Failed(ErrorView),
}

/// `FRIENDLY_409_MESSAGES`: the server's conflict messages, said as the web says them.
pub fn friendly_error(error: &ErrorView) -> String {
    match error.message.as_str() {
        "Already friends with this user" => "You are already friends with this user.".to_owned(),
        "Friend request already sent" => {
            "You have already sent a friend request to this user.".to_owned()
        }
        "" => "Failed to send friend request".to_owned(),
        message => message.to_owned(),
    }
}

/// `relationshipMap`: a chip for everyone this user already knows, who can't be picked.
pub fn relationship_tags(view: &FriendsView) -> HashMap<String, SharedString> {
    let mut tags = HashMap::new();
    for row in &view.friends {
        tags.insert(row.user.id.clone(), SharedString::from("Friends"));
    }
    for row in &view.outgoing {
        tags.insert(row.user.id.clone(), SharedString::from("Request Sent"));
    }
    for row in &view.incoming {
        tags.insert(row.user.id.clone(), SharedString::from("Request Received"));
    }
    tags
}

impl AddFriendForm {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let picker =
            cx.new(|cx| UserPicker::new("add-friend", "Search for a user", false, window, cx));
        let subscriptions = vec![
            cx.subscribe(&picker, |form, _, event: &UserPickerEvent, cx| {
                match event {
                    UserPickerEvent::Search { query } => cx.emit(AddFriendEvent::Search {
                        query: query.clone(),
                    }),
                    UserPickerEvent::Changed => {
                        // A new pick puts the last outcome away, as closing its alert would.
                        if !matches!(form.outcome, AddOutcome::Sending) {
                            form.outcome = AddOutcome::Idle;
                        }
                        cx.notify();
                    }
                }
            }),
        ];
        Self {
            picker,
            outcome: AddOutcome::Idle,
            _subscriptions: subscriptions,
        }
    }

    /// Who this user already knows, from `Core::friends`.
    pub fn set_friends(&mut self, view: &FriendsView, cx: &mut Context<Self>) {
        let tags = relationship_tags(view);
        self.picker
            .update(cx, |picker, cx| picker.set_tags(tags, cx));
    }

    /// What `Core::search_users` returned for `query`.
    pub fn set_results(
        &mut self,
        query: &str,
        results: Result<Vec<semaphore_core::model::UserView>, String>,
        cx: &mut Context<Self>,
    ) {
        self.picker
            .update(cx, |picker, cx| picker.set_results(query, results, cx));
    }

    /// This user, never offered.
    pub fn set_excluded(&mut self, user_ids: Vec<String>, cx: &mut Context<Self>) {
        self.picker
            .update(cx, |picker, cx| picker.set_excluded(user_ids, cx));
    }

    /// Where the request is. `Sent` clears the pick, as the web's `reset` does.
    pub fn set_outcome(
        &mut self,
        outcome: AddOutcome,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let sending = matches!(outcome, AddOutcome::Sending);
        if matches!(outcome, AddOutcome::Sent) {
            self.picker
                .update(cx, |picker, cx| picker.clear(window, cx));
        }
        self.picker
            .update(cx, |picker, cx| picker.set_disabled(sending, cx));
        self.outcome = outcome;
        cx.notify();
    }

    pub fn outcome(&self) -> &AddOutcome {
        &self.outcome
    }

    /// Empties the form, as closing the dialog does.
    pub fn reset(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.picker.update(cx, |picker, cx| {
            picker.clear(window, cx);
            picker.set_disabled(false, cx);
        });
        self.outcome = AddOutcome::Idle;
        cx.notify();
    }

    pub fn focus_field(&self, window: &mut Window, cx: &mut App) {
        let picker = self.picker.clone();
        picker.update(cx, |picker, cx| picker.focus_field(window, cx));
    }

    pub(crate) fn send(&mut self, cx: &mut Context<Self>) {
        if matches!(self.outcome, AddOutcome::Sending) {
            return;
        }
        if let Some(user) = self.picker.read(cx).picked().first() {
            cx.emit(AddFriendEvent::Send {
                user_id: user.id.clone(),
            });
        }
    }

    /// "Send Friend Request", for the dialog's actions or under the inline form.
    pub(crate) fn send_button(&self, full_width: bool, cx: &mut Context<Self>) -> Button {
        let picked = !self.picker.read(cx).picked().is_empty();
        let view = cx.weak_entity();
        Button::new("add-friend-send", "Send Friend Request")
            .contained()
            .when(full_width, |button| button.full_width())
            .disabled(!picked)
            .loading(matches!(self.outcome, AddOutcome::Sending))
            .on_click(move |_, _, cx| {
                view.update(cx, |form, cx| form.send(cx)).ok();
            })
    }

    fn fields(&self) -> Div {
        let alert = match &self.outcome {
            AddOutcome::Sent => Some(Alert::new(Severity::Success, "Friend request sent!")),
            AddOutcome::Failed(error) => Some(Alert::new(Severity::Error, friendly_error(error))),
            _ => None,
        };
        div()
            .flex()
            .flex_col()
            .gap(spacing(2.))
            .children(alert)
            .child(self.picker.clone())
    }
}

/// The form on its own, with the send button under it: the wide Friends page's side panel.
impl Render for AddFriendForm {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .id("add-friend-form")
            .test_support()
            .role(Role::Group)
            .aria_label("Add friend")
            .flex()
            .flex_col()
            .gap(spacing(2.))
            .child(self.fields())
            .child(self.send_button(true, cx))
    }
}

impl AddFriendDialog {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let form = cx.new(|cx| AddFriendForm::new(window, cx));
        let subscriptions = vec![
            cx.subscribe(&form, |_, _, event: &AddFriendEvent, cx| {
                cx.emit(AddFriendDialogEvent::Form(event.clone()));
            }),
            cx.observe(&form, |_, _, cx| cx.notify()),
        ];
        Self {
            form,
            _subscriptions: subscriptions,
        }
    }

    /// The form inside, for `set_friends`, `set_results`, `set_excluded` and `set_outcome`.
    pub fn form(&self) -> &Entity<AddFriendForm> {
        &self.form
    }

    fn close(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.form.update(cx, |form, cx| form.reset(window, cx));
        cx.emit(AddFriendDialogEvent::Close);
    }
}

impl Render for AddFriendDialog {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let width = if is_phone(window) {
            f32::from(window.viewport_size().width)
        } else {
            600.
        };
        let fields = self.form.read(cx).fields();
        let send = self.form.update(cx, |form, cx| form.send_button(false, cx));
        let view = cx.weak_entity();
        Dialog::new("Add Friend")
            .width(width)
            .on_close({
                let view = view.clone();
                move |window, cx| {
                    view.update(cx, |dialog, cx| dialog.close(window, cx)).ok();
                }
            })
            .body(div().id("add-friend").pt(px(8.)).child(fields))
            .action(
                Button::new("add-friend-cancel", "Cancel").on_click(move |_, window, cx| {
                    view.update(cx, |dialog, cx| dialog.close(window, cx)).ok();
                }),
            )
            .action(send)
    }
}
