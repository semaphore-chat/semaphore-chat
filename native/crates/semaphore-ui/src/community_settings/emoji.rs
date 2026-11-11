//! The custom emoji tab, after `CustomEmojiManagement.tsx`: upload a small image as `:shortcode:`,
//! then a table of the emoji with their preview, shortcode and who added them, and delete behind a
//! confirm.

use super::common::{
    Confirm, action_icon, card, empty_line, field_error, list, loading_rows, locked_note, mono,
    page, row, server_error, stored_image, upload_bar,
};
use super::rules::{
    OpAction, Outcome, Pending, check_emoji_file, check_emoji_name, needs, op_about, shortcode,
    size_label,
};
use crate::kit::{Button, ButtonSize, TextField, Variant, spacing, text, text_state};
use crate::panel::common::{design_icon, error_block};
use crate::theme::SemTheme;
use gpui_kit::component::input::InputState;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{CommunityCaps, CustomEmojiRow, CustomEmojiView, DraftFile, LoadState};
use semaphore_design::Icon as DesignIcon;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EmojiEvent {
    /// "Choose image": the owner opens the system's picker (PNG, GIF or WebP) and answers with
    /// `set_picked` (or `set_pick_error`).
    PickImage,
    /// "Upload": `Core::add_custom_emoji(community, name, file)`.
    Add { name: String, file: DraftFile },
    /// Confirmed: `Core::delete_custom_emoji(community, emoji_id)`.
    Delete { emoji_id: String },
    /// The list failed to load and the user asked again: `Core::retry_failed`.
    Retry,
}

pub struct EmojiTab {
    view: CustomEmojiView,
    caps: CommunityCaps,
    last: Option<OpAction>,
    pending: Option<Pending>,
    picked: Option<DraftFile>,
    form_error: Option<String>,
    name: Entity<InputState>,
    deleting: Option<CustomEmojiRow>,
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<EmojiEvent> for EmojiTab {}

impl EmojiTab {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let name = text_state(window, cx, false);
        let _subscriptions = vec![cx.observe(&name, |_, _, cx| cx.notify())];
        Self {
            view: CustomEmojiView::default(),
            caps: CommunityCaps::default(),
            last: None,
            pending: None,
            picked: None,
            form_error: None,
            name,
            deleting: None,
            _subscriptions,
        }
    }

    pub fn set_caps(&mut self, caps: CommunityCaps, cx: &mut Context<Self>) {
        self.caps = caps;
        cx.notify();
    }

    /// `Core::custom_emoji(community)`.
    pub fn set_view(&mut self, view: CustomEmojiView, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(pending) = self.pending.as_mut() {
            match pending.observe(&view.op) {
                Outcome::Waiting => {}
                Outcome::Failed => self.pending = None,
                Outcome::Succeeded => {
                    if pending.action == OpAction::AddEmoji {
                        self.picked = None;
                        self.name
                            .update(cx, |field, cx| field.set_value("", window, cx));
                    }
                    self.pending = None;
                }
            }
        }
        self.view = view;
        cx.notify();
    }

    /// The file the system's picker gave. One that isn't a small PNG, GIF or WebP shows why.
    pub fn set_picked(&mut self, file: DraftFile, cx: &mut Context<Self>) {
        match check_emoji_file(&file) {
            Ok(()) => {
                self.form_error = None;
                self.picked = Some(file);
            }
            Err(message) => {
                self.form_error = Some(message);
                self.picked = None;
            }
        }
        cx.notify();
    }

    pub fn set_pick_error(&mut self, message: String, cx: &mut Context<Self>) {
        self.form_error = Some(message);
        cx.notify();
    }

    /// Fills the form, for stories and tests.
    #[cfg(feature = "stories")]
    pub(crate) fn preset(
        &mut self,
        name: &str,
        file: Option<DraftFile>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let name = name.to_owned();
        self.name
            .update(cx, |field, cx| field.set_value(name, window, cx));
        self.picked = file;
    }

    /// As if `action` was sent: for stories and tests.
    #[cfg(feature = "stories")]
    pub(crate) fn mark_sent(&mut self, action: OpAction) {
        self.last = Some(action.clone());
        self.pending = Some(Pending::new(action));
    }

    pub(crate) fn submit(&mut self, cx: &mut Context<Self>) {
        if !self.caps.manage_emoji || self.busy() {
            return;
        }
        let name = self.name.read(cx).value().to_string();
        if let Err(message) = check_emoji_name(&name) {
            self.form_error = Some(message);
            cx.notify();
            return;
        }
        let Some(file) = self.picked.clone() else {
            self.form_error = Some("Choose an image file (PNG, GIF, or WebP, max 256KB).".into());
            cx.notify();
            return;
        };
        self.form_error = None;
        self.last = Some(OpAction::AddEmoji);
        self.pending = Some(Pending::new(OpAction::AddEmoji));
        cx.emit(EmojiEvent::Add {
            name: shortcode(&name).to_owned(),
            file,
        });
        cx.notify();
    }

    fn about(&self) -> Option<OpAction> {
        op_about(&self.view.op, self.last.as_ref(), |_| true)
    }

    fn busy(&self) -> bool {
        self.about().is_some() && (self.view.op.busy || self.view.op.upload.is_some())
    }

    fn form(&self, cx: &mut Context<Self>) -> AnyElement {
        let sem = cx.sem().clone();
        if !self.caps.manage_emoji {
            return locked_note("emoji-locked", needs("Manage custom emojis"), cx)
                .into_any_element();
        }
        let adding = matches!(self.about(), Some(OpAction::AddEmoji));
        let busy = self.busy();
        let picked = self
            .picked
            .as_ref()
            .map(|file| format!("{} ({})", file.name, size_label(file.bytes.len() as u64)))
            .unwrap_or_else(|| "No file chosen".to_owned());
        div()
            .flex()
            .flex_col()
            .gap(spacing(1.5))
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .items_center()
                    .gap(spacing(1.5))
                    .child(
                        Button::new("emoji-choose", "Choose image")
                            .outlined()
                            .size(ButtonSize::Small)
                            .start_icon(DesignIcon::UploadFile)
                            .disabled(busy)
                            .on_click(cx.listener(|_, _, _, cx| cx.emit(EmojiEvent::PickImage))),
                    )
                    .child(
                        text(Variant::Caption, picked)
                            .min_w_0()
                            .max_w(px(260.))
                            .truncate()
                            .text_color(sem.text_secondary),
                    ),
            )
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .items_start()
                    .gap(spacing(1.5))
                    .child(
                        div().flex_1().min_w(px(200.)).child(
                            TextField::new("emoji-name", &self.name, "Shortcode")
                                .placeholder("party_blob")
                                .disabled(busy),
                        ),
                    )
                    .child(
                        div().pt(px(10.)).child(
                            Button::new("emoji-upload", "Upload")
                                .contained()
                                .start_icon(DesignIcon::Upload)
                                .loading(busy && adding)
                                .disabled(busy)
                                .on_click(cx.listener(|tab, _, _, cx| tab.submit(cx))),
                        ),
                    ),
            )
            .children(
                self.form_error
                    .clone()
                    .map(|message| div().id("emoji-form-error").child(field_error(message, cx))),
            )
            .children(if adding {
                upload_bar("emoji-upload-progress", self.view.op.upload.as_ref(), cx)
            } else {
                None
            })
            .into_any_element()
    }

    fn table(&self, cx: &mut Context<Self>) -> AnyElement {
        let sem = cx.sem().clone();
        match &self.view.state {
            LoadState::Loading => loading_rows("emoji-loading", "Loading custom emoji", 4),
            LoadState::Failed { .. } => error_block(
                "emoji-retry",
                "Failed to load custom emoji",
                "Please try again.",
                cx.listener(|_, _, _, cx| cx.emit(EmojiEvent::Retry)),
                cx,
            ),
            LoadState::Ready if self.view.emojis.is_empty() => {
                empty_line("No custom emojis yet", cx).into_any_element()
            }
            LoadState::Ready => {
                let deleting = match self.about() {
                    Some(OpAction::DeleteEmoji { emoji_id }) if self.view.op.busy => Some(emoji_id),
                    _ => None,
                };
                let locked = (!self.caps.manage_emoji).then(|| needs("Manage custom emojis"));
                let rows: Vec<_> = self
                    .view
                    .emojis
                    .iter()
                    .map(|emoji| {
                        let picture = stored_image(Some(&emoji.file_id), cx)
                            .map(|image| {
                                image
                                    .size(px(28.))
                                    .object_fit(ObjectFit::Contain)
                                    .into_any_element()
                            })
                            .unwrap_or_else(|| {
                                design_icon(
                                    DesignIcon::EmojiEmotionsOutlined,
                                    24.,
                                    sem.text_secondary,
                                )
                                .into_any_element()
                            });
                        let row_emoji = emoji.clone();
                        let busy = deleting.as_deref() == Some(emoji.id.as_str());
                        row(
                            SharedString::from(format!("emoji-{}", emoji.id)),
                            format!(":{}:", emoji.name),
                            cx,
                        )
                        .child(
                            div()
                                .size(px(36.))
                                .flex_shrink_0()
                                .flex()
                                .items_center()
                                .justify_center()
                                .child(picture),
                        )
                        .child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .flex()
                                .flex_col()
                                .child(mono(format!(":{}:", emoji.name), cx).truncate())
                                .children(emoji.created_by.as_ref().map(|user| {
                                    text(
                                        Variant::Caption,
                                        format!("Added by {}", super::common::who(user)),
                                    )
                                    .truncate()
                                    .text_color(sem.text_secondary)
                                })),
                        )
                        .child(action_icon(
                            format!("emoji-delete-{}", emoji.id),
                            DesignIcon::Delete,
                            format!("Delete :{}:", emoji.name),
                            locked.clone(),
                            busy,
                            Some(sem.error),
                            cx.listener(move |tab, _, _, cx| {
                                tab.deleting = Some(row_emoji.clone());
                                cx.notify();
                            }),
                        ))
                        .into_any_element()
                    })
                    .collect();
                list("emoji-list", "Custom emoji")
                    .children(rows)
                    .into_any_element()
            }
        }
    }
}

impl Render for EmojiTab {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let error = self
            .about()
            .and_then(|_| server_error(self.view.op.error.as_ref()));
        let form = self.form(cx);
        let table = self.table(cx);
        let title = match self.view.state {
            LoadState::Ready => format!("Emoji ({})", self.view.emojis.len()),
            _ => "Emoji".to_owned(),
        };
        let body = div()
            .flex()
            .flex_col()
            .gap(spacing(3.))
            .children(error)
            .child(card("Add Emoji", form, cx))
            .child(card(title, table, cx));
        let dialog = self.deleting.clone().map(|emoji| {
            let confirm = cx.weak_entity();
            let cancel = cx.weak_entity();
            let id = emoji.id.clone();
            Confirm {
                id: "emoji-delete",
                title: "Delete Custom Emoji",
                message: format!(
                    "Delete :{}:? Messages and reactions that use it will show its shortcode instead.",
                    emoji.name
                ),
                confirm: "Delete",
                busy: false,
            }
            .dialog(
                move |_, cx| {
                    confirm
                        .update(cx, |tab, cx| {
                            tab.deleting = None;
                            let action = OpAction::DeleteEmoji { emoji_id: id.clone() };
                            tab.last = Some(action.clone());
                            tab.pending = Some(Pending::new(action));
                            cx.emit(EmojiEvent::Delete { emoji_id: id.clone() });
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
                "community-emoji",
                "Custom Emoji",
                Some("Upload small images (PNG, GIF, or WebP, max 256KB) and give them a shortcode members can use in messages and reactions.".into()),
                Vec::new(),
                body,
                window,
                cx,
            ))
            .children(dialog)
    }
}
