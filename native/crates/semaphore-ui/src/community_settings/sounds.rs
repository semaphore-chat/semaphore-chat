//! The soundboard tab, after `SoundboardManagement.tsx`: the community's sounds with their emoji,
//! a preview button and delete; "Add Sound" opens a dialog with a name, an optional emoji and the
//! audio file (1 MB at most).

use super::OpLedger;
use super::common::{
    Confirm, action_icon, card, empty_line, field_error, list, loading_rows, locked_button, page,
    row, server_error, upload_bar,
};
use super::rules::{
    OpAction, Outcome, Pending, check_sound_emoji, check_sound_file, check_sound_name, needs,
    op_about, size_label, sound_name_from_file,
};
use crate::kit::{Button, ButtonSize, Dialog, TextField, Variant, spacing, text, text_state};
use crate::panel::common::{design_icon, error_block};
use crate::theme::SemTheme;
use gpui_kit::component::input::InputState;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{
    AdminOp, CommunityCaps, DraftFile, LoadState, SoundDraft, SoundboardSound, SoundboardView,
};
use semaphore_design::Icon as DesignIcon;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SoundboardEvent {
    /// "Choose file": the owner opens the system's picker for audio and answers with `set_picked`
    /// (or `set_pick_error`).
    PickAudio,
    /// "Add": `Core::add_sound(community, draft)`. Its progress is the settings op.
    Add(SoundDraft),
    /// Confirmed: `Core::delete_sound(community, sound_id)`.
    Delete { sound_id: String },
    /// The preview button: the owner plays the file locally, for this user only.
    Preview { file_id: String },
    /// The list failed to load and the user asked again: `Core::retry_failed`.
    Retry,
}

pub struct SoundboardTab {
    view: SoundboardView,
    caps: CommunityCaps,
    ledger: OpLedger,
    op: AdminOp,
    pending: Option<Pending>,
    adding: bool,
    tried: bool,
    name: Entity<InputState>,
    emoji: Entity<InputState>,
    picked: Option<DraftFile>,
    file_error: Option<String>,
    deleting: Option<SoundboardSound>,
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<SoundboardEvent> for SoundboardTab {}

impl SoundboardTab {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        Self::with_ledger(OpLedger::default(), window, cx)
    }

    pub(crate) fn with_ledger(
        ledger: OpLedger,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let name = text_state(window, cx, false);
        let emoji = text_state(window, cx, false);
        let _subscriptions = vec![
            cx.observe(&name, |_, _, cx| cx.notify()),
            cx.observe(&emoji, |_, _, cx| cx.notify()),
        ];
        Self {
            view: SoundboardView::default(),
            caps: CommunityCaps::default(),
            ledger,
            op: AdminOp::default(),
            pending: None,
            adding: false,
            tried: false,
            name,
            emoji,
            picked: None,
            file_error: None,
            deleting: None,
            _subscriptions,
        }
    }

    pub fn set_caps(&mut self, caps: CommunityCaps, cx: &mut Context<Self>) {
        self.caps = caps;
        cx.notify();
    }

    /// `Core::soundboard(community)`.
    pub fn set_view(&mut self, view: SoundboardView, cx: &mut Context<Self>) {
        self.view = view;
        cx.notify();
    }

    /// `CommunitySettingsView::op`, which adding and deleting sounds report on.
    pub fn set_op(&mut self, op: AdminOp, cx: &mut Context<Self>) {
        if let Some(pending) = self.pending.as_mut() {
            match pending.observe(&op) {
                Outcome::Waiting => {}
                Outcome::Failed => self.pending = None,
                Outcome::Succeeded => {
                    if pending.action == OpAction::AddSound {
                        self.adding = false;
                    }
                    self.pending = None;
                }
            }
        }
        self.op = op;
        cx.notify();
    }

    /// The file the system's picker gave. With no name typed yet, the file's name fills it.
    pub fn set_picked(&mut self, file: DraftFile, window: &mut Window, cx: &mut Context<Self>) {
        match check_sound_file(&file) {
            Ok(()) => {
                self.file_error = None;
                if self.name.read(cx).value().trim().is_empty() {
                    let name = sound_name_from_file(&file.name);
                    self.name
                        .update(cx, |field, cx| field.set_value(name, window, cx));
                }
                self.picked = Some(file);
            }
            Err(message) => {
                self.file_error = Some(message);
                self.picked = None;
            }
        }
        cx.notify();
    }

    pub fn set_pick_error(&mut self, message: String, cx: &mut Context<Self>) {
        self.file_error = Some(message);
        cx.notify();
    }

    /// Opens the add dialog filled in, for stories and tests.
    #[cfg(feature = "stories")]
    pub(crate) fn open_add(
        &mut self,
        name: &str,
        emoji: &str,
        file: Option<DraftFile>,
        tried: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.adding = true;
        self.tried = tried;
        let (name, emoji) = (name.to_owned(), emoji.to_owned());
        self.name
            .update(cx, |field, cx| field.set_value(name, window, cx));
        self.emoji
            .update(cx, |field, cx| field.set_value(emoji, window, cx));
        self.picked = file;
    }

    /// As if `action` was sent: for stories and tests.
    #[cfg(feature = "stories")]
    pub(crate) fn mark_sent(&mut self, action: OpAction) {
        self.ledger.sent(action.clone());
        self.pending = Some(Pending::new(action));
    }

    fn about(&self) -> Option<OpAction> {
        op_about(&self.op, self.ledger.last().as_ref(), |action| {
            matches!(action, OpAction::AddSound | OpAction::DeleteSound { .. })
        })
    }

    fn busy_adding(&self) -> bool {
        matches!(self.about(), Some(OpAction::AddSound))
            && (self.op.busy || self.op.upload.is_some())
    }

    pub(crate) fn submit(&mut self, cx: &mut Context<Self>) {
        if !self.caps.create_sound || self.busy_adding() {
            return;
        }
        self.tried = true;
        let name = self.name.read(cx).value().trim().to_owned();
        let emoji = self.emoji.read(cx).value().trim().to_owned();
        let ok = check_sound_name(&name).is_ok() && check_sound_emoji(&emoji).is_ok();
        let Some(file) = self.picked.clone().filter(|_| ok) else {
            if self.picked.is_none() && self.file_error.is_none() {
                self.file_error = Some("Choose an audio file.".into());
            }
            cx.notify();
            return;
        };
        self.ledger.sent(OpAction::AddSound);
        self.pending = Some(Pending::new(OpAction::AddSound));
        cx.emit(SoundboardEvent::Add(SoundDraft {
            name,
            emoji: (!emoji.is_empty()).then_some(emoji),
            file,
        }));
        cx.notify();
    }

    fn add_dialog(&self, cx: &mut Context<Self>) -> Dialog {
        let sem = cx.sem().clone();
        let busy = self.busy_adding();
        let mine = matches!(self.about(), Some(OpAction::AddSound));
        let name_error = check_sound_name(&self.name.read(cx).value())
            .err()
            .filter(|_| self.tried);
        let emoji_error = check_sound_emoji(&self.emoji.read(cx).value()).err();
        let mut name = TextField::new("sound-name", &self.name, "Name")
            .required(true)
            .disabled(busy)
            .error(name_error.is_some());
        if let Some(error) = name_error {
            name = name.helper(error);
        }
        let mut emoji = TextField::new("sound-emoji", &self.emoji, "Emoji (optional)")
            .placeholder("\u{1f4ef}")
            .disabled(busy)
            .error(emoji_error.is_some());
        if let Some(error) = emoji_error {
            emoji = emoji.helper(error);
        }
        let picked = self
            .picked
            .as_ref()
            .map(|file| format!("{} ({})", file.name, size_label(file.bytes.len() as u64)))
            .unwrap_or_else(|| "No file chosen".to_owned());
        let cancel = cx.weak_entity();
        let close = cx.weak_entity();
        let submit = cx.weak_entity();
        Dialog::new("Add Sound")
            .width(480.)
            .body(
                div()
                    .pt(spacing(1.))
                    .flex()
                    .flex_col()
                    .gap(spacing(2.))
                    .children(mine.then(|| server_error(self.op.error.as_ref())).flatten())
                    .child(name)
                    .child(emoji)
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(spacing(1.))
                            .child(
                                div()
                                    .flex()
                                    .flex_wrap()
                                    .items_center()
                                    .gap(spacing(1.5))
                                    .child(
                                        Button::new("sound-choose", "Choose file")
                                            .outlined()
                                            .size(ButtonSize::Small)
                                            .start_icon(DesignIcon::AudioFile)
                                            .disabled(busy)
                                            .on_click(cx.listener(|_, _, _, cx| {
                                                cx.emit(SoundboardEvent::PickAudio)
                                            })),
                                    )
                                    .child(
                                        text(Variant::Caption, picked)
                                            .min_w_0()
                                            .max_w(px(240.))
                                            .truncate()
                                            .text_color(sem.text_secondary),
                                    ),
                            )
                            .child(
                                text(Variant::Caption, "MP3, WAV, OGG, WebM, or AAC. Max 1MB.")
                                    .text_color(sem.text_secondary),
                            )
                            .children(self.file_error.clone().map(|message| {
                                div().id("sound-file-error").child(field_error(message, cx))
                            })),
                    )
                    .children(if mine {
                        upload_bar("sound-upload", self.op.upload.as_ref(), cx)
                    } else {
                        None
                    }),
            )
            .action(
                Button::new("sound-cancel", "Cancel")
                    .disabled(busy)
                    .on_click(move |_, _, cx| {
                        cancel
                            .update(cx, |tab, cx| {
                                tab.adding = false;
                                cx.notify();
                            })
                            .ok();
                    }),
            )
            .action(
                Button::new("sound-submit", "Add")
                    .contained()
                    .loading(busy)
                    .disabled(self.name.read(cx).value().trim().is_empty() || self.picked.is_none())
                    .on_click(move |_, _, cx| {
                        submit.update(cx, |tab, cx| tab.submit(cx)).ok();
                    }),
            )
            .on_close(move |_, cx| {
                close
                    .update(cx, |tab, cx| {
                        if !tab.busy_adding() {
                            tab.adding = false;
                            cx.notify();
                        }
                    })
                    .ok();
            })
    }

    fn table(&self, cx: &mut Context<Self>) -> AnyElement {
        let sem = cx.sem().clone();
        match &self.view.state {
            LoadState::Loading => loading_rows("sounds-loading", "Loading sounds", 4),
            LoadState::Failed { .. } => error_block(
                "sounds-retry",
                "Failed to load soundboard",
                "Please try again.",
                cx.listener(|_, _, _, cx| cx.emit(SoundboardEvent::Retry)),
                cx,
            ),
            LoadState::Ready if self.view.sounds.is_empty() => {
                empty_line("No sounds yet", cx).into_any_element()
            }
            LoadState::Ready => {
                let deleting = match self.about() {
                    Some(OpAction::DeleteSound { sound_id }) if self.op.busy => Some(sound_id),
                    _ => None,
                };
                let locked = (!self.caps.delete_sound).then(|| needs("Delete soundboard sounds"));
                let rows: Vec<_> = self
                    .view
                    .sounds
                    .iter()
                    .map(|sound| {
                        let file_id = sound.file_id.clone();
                        let row_sound = sound.clone();
                        let busy = deleting.as_deref() == Some(sound.id.as_str());
                        let face: AnyElement =
                            match sound.emoji.as_deref().filter(|e| !e.is_empty()) {
                                Some(emoji) => {
                                    text(Variant::H6, emoji.to_owned()).into_any_element()
                                }
                                None => design_icon(DesignIcon::MusicNote, 20., sem.text_secondary)
                                    .into_any_element(),
                            };
                        row(
                            SharedString::from(format!("sound-{}", sound.id)),
                            sound.name.clone(),
                            cx,
                        )
                        .child(
                            div()
                                .size(px(32.))
                                .flex_shrink_0()
                                .flex()
                                .items_center()
                                .justify_center()
                                .child(face),
                        )
                        .child(
                            text(Variant::Body2, sound.name.clone())
                                .flex_1()
                                .min_w_0()
                                .truncate()
                                .text_color(sem.text_primary),
                        )
                        .child(action_icon(
                            format!("sound-preview-{}", sound.id),
                            DesignIcon::PlayArrow,
                            format!("Preview {}", sound.name),
                            None,
                            false,
                            Some(sem.primary),
                            cx.listener(move |_, _, _, cx| {
                                cx.emit(SoundboardEvent::Preview {
                                    file_id: file_id.clone(),
                                })
                            }),
                        ))
                        .child(action_icon(
                            format!("sound-delete-{}", sound.id),
                            DesignIcon::Delete,
                            format!("Delete {}", sound.name),
                            locked.clone(),
                            busy,
                            Some(sem.error),
                            cx.listener(move |tab, _, _, cx| {
                                tab.deleting = Some(row_sound.clone());
                                cx.notify();
                            }),
                        ))
                        .into_any_element()
                    })
                    .collect();
                list("sounds-list", "Sounds")
                    .children(rows)
                    .into_any_element()
            }
        }
    }
}

impl Render for SoundboardTab {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let add = locked_button(
            Button::new("sound-add", "Add Sound")
                .contained()
                .start_icon(DesignIcon::Add)
                .on_click(cx.listener(|tab, _, window, cx| {
                    tab.adding = true;
                    tab.tried = false;
                    tab.picked = None;
                    tab.file_error = None;
                    tab.name
                        .update(cx, |field, cx| field.set_value("", window, cx));
                    tab.emoji
                        .update(cx, |field, cx| field.set_value("", window, cx));
                    cx.notify();
                })),
            "sound-add-locked",
            (!self.caps.create_sound).then(|| needs("Add soundboard sounds")),
            cx,
        );
        let delete_error = match self.about() {
            Some(OpAction::DeleteSound { .. }) => server_error(self.op.error.as_ref()),
            _ => None,
        };
        let title = match self.view.state {
            LoadState::Ready => format!("Sounds ({})", self.view.sounds.len()),
            _ => "Sounds".to_owned(),
        };
        let table = self.table(cx);
        let body = div()
            .flex()
            .flex_col()
            .gap(spacing(2.))
            .children(delete_error)
            .child(card(title, table, cx));
        let mut overlays: Vec<AnyElement> = Vec::new();
        if self.adding {
            overlays.push(self.add_dialog(cx).into_any_element());
        }
        if let Some(sound) = self.deleting.clone() {
            let confirm = cx.weak_entity();
            let cancel = cx.weak_entity();
            let id = sound.id.clone();
            overlays.push(
                Confirm {
                    id: "sound-delete",
                    title: "Delete Sound",
                    message: format!(
                        "Delete \u{201c}{}\u{201d}? Members can no longer play it.",
                        sound.name
                    ),
                    confirm: "Delete",
                    busy: false,
                }
                .dialog(
                    move |_, cx| {
                        confirm
                            .update(cx, |tab, cx| {
                                tab.deleting = None;
                                let action = OpAction::DeleteSound {
                                    sound_id: id.clone(),
                                };
                                tab.ledger.sent(action.clone());
                                tab.pending = Some(Pending::new(action));
                                cx.emit(SoundboardEvent::Delete {
                                    sound_id: id.clone(),
                                });
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
                .into_any_element(),
            );
        }
        div()
            .relative()
            .size_full()
            .child(page(
                "community-soundboard",
                "Soundboard",
                Some("Upload short audio clips (max 1MB). Members can play them for everyone in a voice channel.".into()),
                vec![add],
                body,
                window,
                cx,
            ))
            .children(overlays)
    }
}
