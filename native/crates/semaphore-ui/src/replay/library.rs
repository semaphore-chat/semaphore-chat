//! The clip library, after `ClipLibrary.tsx`: my clips (public switch, share, delete with a
//! confirm, download) or another user's public ones (download only), each playing in the W3
//! video player.

use super::ClipEvent;
use super::model::{self, clip_attachment};
use crate::kit::{
    Alert, Button, Dialog, IconButton, Severity, Skeleton, Spinner, Switch, Variant, text, with_tip,
};
use crate::messages::TimeFormat;
use crate::panel::common::{design_icon, empty_block, error_block, is_phone};
use crate::player::{AttachmentPlayer, PlayerViewEvent, Players, file_size};
use crate::theme::SemTheme as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{Clip, ClipsView, LoadState};
use semaphore_design::Icon as IconName;
use std::collections::HashMap;

/// Cards are at least this wide (the web's `minmax(260px, 1fr)` grid).
const CARD_MIN: f32 = 260.;
const GAP: f32 = 16.;

pub struct ClipLibrary {
    own: bool,
    view: ClipsView,
    downloading: Vec<String>,
    players: Option<Players>,
    made: HashMap<String, (AttachmentPlayer, Option<Subscription>)>,
    /// The clip the delete confirm is open for, and whether its delete has been asked.
    confirm: Option<(String, bool)>,
    width: std::rc::Rc<std::cell::Cell<f32>>,
    time: TimeFormat,
}

impl EventEmitter<ClipEvent> for ClipLibrary {}

impl ClipLibrary {
    /// `own`: my library (`Core::clips`), else another user's public clips (`Core::user_clips`).
    /// Without `players` (an app built without its player) a card shows a still box.
    pub fn new(own: bool, players: Option<Players>, _: &mut Context<Self>) -> Self {
        Self {
            own,
            view: ClipsView::default(),
            downloading: Vec::new(),
            players,
            made: HashMap::new(),
            confirm: None,
            width: std::rc::Rc::new(std::cell::Cell::new(0.)),
            time: TimeFormat::default(),
        }
    }

    /// The zone a card's "Captured …" is written in: the app's, unless a story fixes it.
    pub fn set_time(&mut self, time: TimeFormat, cx: &mut Context<Self>) {
        self.time = time;
        cx.notify();
    }

    pub fn set_view(&mut self, view: ClipsView, cx: &mut Context<Self>) {
        // Players of clips that left go, which stops them.
        self.made
            .retain(|id, _| view.clips.iter().any(|clip| &clip.id == id));
        if let Some((id, asked)) = &self.confirm {
            let gone = !view.clips.iter().any(|clip| &clip.id == id);
            let settled = *asked && !view.busy.contains(id);
            if gone || settled {
                self.confirm = None;
            }
        }
        self.view = view;
        cx.notify();
    }

    /// The clips whose download is on its way.
    pub fn set_downloading(&mut self, clip_ids: Vec<String>, cx: &mut Context<Self>) {
        self.downloading = clip_ids;
        cx.notify();
    }

    pub fn is_own(&self) -> bool {
        self.own
    }

    /// Opens the delete confirm for a clip (the card's Delete).
    pub fn ask_delete(&mut self, clip_id: &str, cx: &mut Context<Self>) {
        self.confirm = Some((clip_id.to_owned(), false));
        cx.notify();
    }

    pub(crate) fn confirm_delete(&mut self, cx: &mut Context<Self>) {
        let Some((id, asked)) = &mut self.confirm else {
            return;
        };
        if *asked {
            return;
        }
        *asked = true;
        let clip_id = id.clone();
        cx.emit(ClipEvent::Delete { clip_id });
        cx.notify();
    }

    fn player(&mut self, clip: &Clip, cx: &mut Context<Self>) -> Option<AnyElement> {
        let players = self.players.clone()?;
        let (player, _) = self.made.entry(clip.id.clone()).or_insert_with(|| {
            let player = players.create(&clip_attachment(clip), cx);
            let subscription = match &player {
                AttachmentPlayer::Video(video) => {
                    let (clip_id, file_id, filename) =
                        (clip.id.clone(), clip.file_id.clone(), clip.filename.clone());
                    Some(
                        cx.subscribe(video, move |_, _, event: &PlayerViewEvent, cx| {
                            if let PlayerViewEvent::Download { .. } = event {
                                cx.emit(ClipEvent::Download {
                                    clip_id: clip_id.clone(),
                                    file_id: file_id.clone(),
                                    filename: filename.clone(),
                                });
                            }
                        }),
                    )
                }
                AttachmentPlayer::Audio(_) => None,
            };
            (player, subscription)
        });
        Some(match player {
            AttachmentPlayer::Video(video) => video.clone().into_any_element(),
            AttachmentPlayer::Audio(audio) => audio.clone().into_any_element(),
        })
    }

    fn still(cx: &App) -> AnyElement {
        let sem = cx.sem();
        div()
            .w_full()
            .h(px(146.))
            .rounded(px(8.))
            .bg(sem.action_selected)
            .flex()
            .items_center()
            .justify_center()
            .child(design_icon(IconName::MovieCreation, 40., sem.text_disabled))
            .into_any_element()
    }

    fn card(&mut self, clip: &Clip, width: Length, cx: &mut Context<Self>) -> AnyElement {
        let busy = self.view.busy.contains(&clip.id);
        let downloading = self.downloading.contains(&clip.id);
        let media = self.player(clip, cx).unwrap_or_else(|| Self::still(cx));
        let sem = cx.sem();
        let id = clip.id.clone();
        let event = |make: fn(&Clip) -> ClipEvent, clip: &Clip| {
            let event = make(clip);
            cx.listener(move |_, _: &ClickEvent, _, cx| cx.emit(event.clone()))
        };
        let download = with_tip(
            div()
                .id(SharedString::from(format!("clip-download-tip-{id}")))
                .child(if downloading {
                    div()
                        .size(px(34.))
                        .flex()
                        .items_center()
                        .justify_center()
                        .child(Spinner::new(SharedString::from(format!("clip-dl-{id}"))).size(18.))
                        .into_any_element()
                } else {
                    IconButton::new(
                        SharedString::from(format!("clip-download-{id}")),
                        IconName::Download,
                        format!("Download {}", clip.filename),
                    )
                    .small()
                    .on_click(event(
                        |clip| ClipEvent::Download {
                            clip_id: clip.id.clone(),
                            file_id: clip.file_id.clone(),
                            filename: clip.filename.clone(),
                        },
                        clip,
                    ))
                    .into_any_element()
                }),
            if downloading {
                "Downloading..."
            } else {
                "Download"
            },
        );
        let mine = self.own.then(|| {
            let share = with_tip(
                div()
                    .id(SharedString::from(format!("clip-share-tip-{id}")))
                    .child(
                        IconButton::new(
                            SharedString::from(format!("clip-share-{id}")),
                            IconName::Share,
                            format!("Share {}", clip.filename),
                        )
                        .small()
                        .disabled(busy)
                        .on_click(event(
                            |clip| ClipEvent::Share {
                                clip_id: clip.id.clone(),
                            },
                            clip,
                        )),
                    ),
                "Share to channel or DM",
            );
            let delete_id = clip.id.clone();
            let delete =
                with_tip(
                    div()
                        .id(SharedString::from(format!("clip-delete-tip-{id}")))
                        .child(
                            IconButton::new(
                                SharedString::from(format!("clip-delete-{id}")),
                                IconName::Delete,
                                format!("Delete {}", clip.filename),
                            )
                            .small()
                            .color(sem.error)
                            .disabled(busy)
                            .on_click(cx.listener(
                                move |library, _, _, cx| library.ask_delete(&delete_id, cx),
                            )),
                        ),
                    "Delete",
                );
            (share, delete)
        });
        let public = self.own.then(|| {
            let (clip_id, public) = (clip.id.clone(), clip.is_public);
            let view = cx.weak_entity();
            let label = if public {
                "Visible on profile"
            } else {
                "Private"
            };
            div()
                .flex()
                .items_center()
                .gap(px(4.))
                .ml(px(-12.))
                .child(
                    Switch::new(
                        SharedString::from(format!("clip-public-{}", clip.id)),
                        label,
                        public,
                    )
                    .disabled(busy)
                    .on_change(move |on, _, cx| {
                        let clip_id = clip_id.clone();
                        view.update(cx, |_, cx| {
                            cx.emit(ClipEvent::SetPublic {
                                clip_id,
                                public: on,
                            })
                        })
                        .ok();
                    }),
                )
                .child(design_icon(
                    if public {
                        IconName::Public
                    } else {
                        IconName::PublicOff
                    },
                    18.,
                    if public {
                        sem.primary
                    } else {
                        sem.text_disabled
                    },
                ))
                .child(text(Variant::Body2, label).text_color(sem.text_secondary))
        });
        let (share, delete) = match mine {
            Some((share, delete)) => (Some(share), Some(delete)),
            None => (None, None),
        };
        div()
            .id(SharedString::from(format!("clip-card-{id}")))
            .test_support()
            .w(width)
            .min_w_0()
            .flex()
            .flex_col()
            .rounded(px(8.))
            .border_1()
            .border_color(sem.card_border)
            .bg(sem.paper)
            .overflow_hidden()
            .child(div().w_full().p(px(8.)).pb_0().child(media))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .px(px(16.))
                    .pt(px(12.))
                    .pb(px(4.))
                    .min_w_0()
                    .child(
                        text(Variant::Subtitle2, clip.filename.clone())
                            .text_color(sem.text_primary)
                            .truncate()
                            .mb(px(4.)),
                    )
                    .child(
                        div()
                            .flex()
                            .flex_wrap()
                            .gap(px(16.))
                            .text_color(sem.text_secondary)
                            .child(text(Variant::Caption, model::clock(clip.duration_seconds)))
                            .child(text(Variant::Caption, file_size(clip.size_bytes))),
                    )
                    .child(
                        text(
                            Variant::Caption,
                            model::captured_at(&self.time, clip.captured_at_ms),
                        )
                        .text_color(sem.text_secondary),
                    )
                    .children(public),
            )
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(4.))
                    .px(px(8.))
                    .pb(px(8.))
                    .child(download)
                    .when(busy, |row| {
                        row.child(
                            Spinner::new(SharedString::from(format!("clip-busy-{id}"))).size(18.),
                        )
                    })
                    .child(div().flex_1())
                    .children(share)
                    .children(delete),
            )
            .into_any_element()
    }

    fn heading(&self, cx: &App) -> Div {
        let sem = cx.sem();
        let line = if self.own {
            "Manage your saved replay clips. Turn on \"Visible on profile\" to show a clip to others."
                .to_owned()
        } else {
            model::public_count(self.view.clips.len())
        };
        div()
            .flex()
            .flex_col()
            .mb(px(24.))
            .child(
                text(
                    Variant::H6,
                    if self.own {
                        "My Clip Library"
                    } else {
                        "Public Clips"
                    },
                )
                .text_color(sem.text_primary)
                .mb(px(4.)),
            )
            .child(text(Variant::Body2, line).text_color(sem.text_secondary))
    }

    /// Over the whole window, wherever the library sits in its page.
    fn confirm_dialog(&self, window: &Window, cx: &mut Context<Self>) -> Option<AnyElement> {
        let (_, asked) = self.confirm.as_ref()?;
        let asked = *asked;
        let view = cx.weak_entity();
        let cancel = {
            let view = view.clone();
            move |cx: &mut App| {
                view.update(cx, |library, cx| {
                    library.confirm = None;
                    cx.notify();
                })
                .ok();
            }
        };
        let dialog = Dialog::new("Delete Clip")
            .on_close({
                let cancel = cancel.clone();
                move |_, cx| cancel(cx)
            })
            .body(text(
                Variant::Body1,
                "Are you sure you want to delete this clip? This action cannot be undone.",
            ))
            .action(
                Button::new("clip-delete-cancel", "Cancel")
                    .disabled(asked)
                    .on_click(move |_, _, cx| cancel(cx)),
            )
            .action(
                Button::new(
                    "clip-delete-confirm",
                    if asked { "Deleting..." } else { "Delete" },
                )
                .color(cx.sem().error)
                .disabled(asked)
                .on_click(move |_, _, cx| {
                    view.update(cx, |library, cx| library.confirm_delete(cx))
                        .ok();
                }),
            );
        let viewport = window.viewport_size();
        Some(
            deferred(
                anchored().position(Point::default()).child(
                    div()
                        .relative()
                        .w(viewport.width)
                        .h(viewport.height)
                        .child(dialog),
                ),
            )
            .with_priority(2)
            .into_any_element(),
        )
    }
}

impl Render for ClipLibrary {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let phone = is_phone(window);
        let width_cell = self.width.clone();
        let measure = canvas(
            move |bounds, _, _| width_cell.set(f32::from(bounds.size.width)),
            |_, _, _, _| {},
        )
        .absolute()
        .size_full();
        // The web's auto-fill grid: as many columns as fit at CARD_MIN, sharing the row.
        let available = self.width.get();
        let columns = if phone || available <= 0. {
            1
        } else {
            (((available + GAP) / (CARD_MIN + GAP)).floor() as usize).max(1)
        };
        let card_width = if columns == 1 {
            relative(1.).into()
        } else {
            px((available - GAP * (columns - 1) as f32) / columns as f32).into()
        };
        let body = match &self.view.state {
            LoadState::Loading if self.view.clips.is_empty() => {
                let sem = cx.sem();
                div()
                    .flex()
                    .flex_col()
                    .child(
                        text(
                            Variant::H6,
                            if self.own {
                                "My Clip Library"
                            } else {
                                "Public Clips"
                            },
                        )
                        .text_color(sem.text_primary)
                        .mb(px(8.)),
                    )
                    .child(
                        div()
                            .mb(px(24.))
                            .child(Skeleton::rect("clips-sub", px(200.), 16.)),
                    )
                    .child(
                        div()
                            .flex()
                            .flex_wrap()
                            .gap(px(GAP))
                            .children((0..3).map(|i| {
                                div()
                                    .w(card_width)
                                    .flex()
                                    .flex_col()
                                    .gap(px(8.))
                                    .child(Skeleton::rect(
                                        SharedString::from(format!("clip-sk-{i}")),
                                        relative(1.),
                                        146.,
                                    ))
                                    .child(Skeleton::rect(
                                        SharedString::from(format!("clip-sk-t-{i}")),
                                        px(160.),
                                        16.,
                                    ))
                                    .child(Skeleton::rect(
                                        SharedString::from(format!("clip-sk-m-{i}")),
                                        px(100.),
                                        12.,
                                    ))
                            })),
                    )
                    .into_any_element()
            }
            LoadState::Failed { .. } if self.view.clips.is_empty() => error_block(
                "clips-retry",
                "Failed to load clips",
                "Something went wrong loading the clips.",
                cx.listener(|_, _, _, cx| cx.emit(ClipEvent::Retry)),
                cx,
            ),
            _ if self.view.clips.is_empty() => empty_block(
                IconName::VideoLibrary,
                "No clips yet",
                if self.own {
                    "Capture a replay while screen sharing to save your best moments."
                } else {
                    "This user has no public clips to show."
                },
                cx,
            )
            .into_any_element(),
            _ => {
                let clips = self.view.clips.clone();
                let cards: Vec<AnyElement> = clips
                    .iter()
                    .map(|clip| self.card(clip, card_width, cx))
                    .collect();
                let error = self.view.error.as_ref().map(|error| {
                    div()
                        .mb(px(16.))
                        .child(Alert::new(Severity::Error, error.message.clone()))
                });
                div()
                    .flex()
                    .flex_col()
                    .child(self.heading(cx))
                    .children(error)
                    .child(div().flex().flex_wrap().gap(px(GAP)).children(cards))
                    .into_any_element()
            }
        };
        div()
            .id(if self.own {
                "clip-library"
            } else {
                "user-clips"
            })
            .test_support()
            .relative()
            .w_full()
            .child(measure)
            .child(body)
            .children(self.confirm_dialog(window, cx))
    }
}
