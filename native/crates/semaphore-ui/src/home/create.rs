//! `CreateCommunityForm`: the web's `useCommunityForm` rules and the server's limits
//! (`CreateCommunityDto`), in a dialog.

use super::{CreateCommunityEvent, CreateCommunityForm};
use crate::kit::{Alert, Button, Dialog, Severity, TextField, spacing, text_state};
use crate::panel::common::is_phone;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::NewCommunity;

/// "Community name must be at least 2 characters".
pub const COMMUNITY_NAME_MIN: usize = 2;
/// `@MaxLength(100)`.
pub const COMMUNITY_NAME_MAX: usize = 100;
/// `@MaxLength(500)`.
pub const COMMUNITY_DESCRIPTION_MAX: usize = 500;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum CommunityField {
    Name,
    Description,
}

/// What's wrong with each field, in the web's words where it has them.
pub fn validate_community(name: &str, description: &str) -> Vec<(CommunityField, String)> {
    let mut errors = Vec::new();
    let name = name.trim();
    if name.is_empty() {
        errors.push((
            CommunityField::Name,
            "Community name is required".to_owned(),
        ));
    } else if name.chars().count() < COMMUNITY_NAME_MIN {
        errors.push((
            CommunityField::Name,
            format!("Community name must be at least {COMMUNITY_NAME_MIN} characters"),
        ));
    } else if name.chars().count() > COMMUNITY_NAME_MAX {
        errors.push((
            CommunityField::Name,
            format!("Community name must be {COMMUNITY_NAME_MAX} characters or less"),
        ));
    }
    if description.trim().chars().count() > COMMUNITY_DESCRIPTION_MAX {
        errors.push((
            CommunityField::Description,
            format!("Description must be {COMMUNITY_DESCRIPTION_MAX} characters or less"),
        ));
    }
    errors
}

impl CreateCommunityForm {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let name = text_state(window, cx, false);
        let description = text_state(window, cx, false);
        let _subscriptions = vec![
            cx.observe(&name, |_, _, cx| cx.notify()),
            cx.observe(&description, |_, _, cx| cx.notify()),
        ];
        Self {
            name,
            description,
            busy: false,
            error: None,
            tried: false,
            took_focus: false,
            _subscriptions,
        }
    }

    /// Fills the fields, for stories and tests.
    #[cfg(any(test, feature = "stories"))]
    pub(crate) fn preset(
        &mut self,
        name: &str,
        description: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let (name, description) = (name.to_owned(), description.to_owned());
        self.name
            .update(cx, |field, cx| field.set_value(name, window, cx));
        self.description
            .update(cx, |field, cx| field.set_value(description, window, cx));
        cx.notify();
    }

    /// "Create Community": shows the errors, or emits the community.
    pub(crate) fn submit(&mut self, cx: &mut Context<Self>) {
        if self.busy {
            return;
        }
        self.tried = true;
        let name = self.name.read(cx).value().to_string();
        let description = self.description.read(cx).value().to_string();
        if validate_community(&name, &description).is_empty() {
            let description = description.trim().to_owned();
            cx.emit(CreateCommunityEvent::Submit(NewCommunity {
                name: name.trim().to_owned(),
                description: (!description.is_empty()).then_some(description),
            }));
        }
        cx.notify();
    }
}

impl Render for CreateCommunityForm {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if !self.took_focus {
            // `autoFocusName`.
            self.took_focus = true;
            self.name.update(cx, |field, cx| field.focus(window, cx));
        }
        let width = if is_phone(window) {
            f32::from(window.viewport_size().width)
        } else {
            520.
        };
        let name = self.name.read(cx).value().to_string();
        let description = self.description.read(cx).value().to_string();
        let errors = if self.tried {
            validate_community(&name, &description)
        } else {
            Vec::new()
        };
        let error_of = |field: CommunityField| {
            errors
                .iter()
                .find(|(at, _)| *at == field)
                .map(|(_, message)| message.clone())
        };
        let name_error = error_of(CommunityField::Name);
        let description_error = error_of(CommunityField::Description);
        let failure = self.error.clone().map(|message| {
            div()
                .id("create-community-error")
                .test_support()
                .w_full()
                .child(Alert::new(
                    Severity::Error,
                    if message.is_empty() {
                        "Failed to create community. Please try again.".to_owned()
                    } else {
                        message
                    },
                ))
        });
        let busy = self.busy;
        let view = cx.weak_entity();
        let cancel = view.clone();
        let close = view.clone();
        Dialog::new("Create Community")
            .width(width)
            .on_close(move |_, cx| {
                close
                    .update(cx, |form, cx| {
                        if !form.busy {
                            cx.emit(CreateCommunityEvent::Cancel)
                        }
                    })
                    .ok();
            })
            .body(
                div()
                    .id("create-community")
                    .pt(px(8.))
                    .flex()
                    .flex_col()
                    .gap(spacing(2.))
                    .children(failure)
                    .child(
                        TextField::new("create-community-name", &self.name, "Community Name")
                            .required(true)
                            .disabled(busy)
                            .error(name_error.is_some())
                            .helper(name_error.unwrap_or_else(|| {
                                format!(
                                    "{} of {COMMUNITY_NAME_MAX} characters",
                                    name.trim().chars().count()
                                )
                            })),
                    )
                    .child(
                        TextField::new(
                            "create-community-description",
                            &self.description,
                            "Description",
                        )
                        .disabled(busy)
                        .error(description_error.is_some())
                        .helper(
                            description_error.unwrap_or_else(|| {
                                "Optional: what the community is about".to_owned()
                            }),
                        ),
                    ),
            )
            .action(
                Button::new("create-community-cancel", "Cancel")
                    .disabled(busy)
                    .on_click(move |_, _, cx| {
                        cancel
                            .update(cx, |_, cx| cx.emit(CreateCommunityEvent::Cancel))
                            .ok();
                    }),
            )
            .action(
                Button::new(
                    "create-community-submit",
                    if busy {
                        "Creating..."
                    } else {
                        "Create Community"
                    },
                )
                .contained()
                .loading(busy)
                .disabled(busy || name.trim().is_empty())
                .on_click(move |_, _, cx| {
                    view.update(cx, |form, cx| form.submit(cx)).ok();
                }),
            )
    }
}
