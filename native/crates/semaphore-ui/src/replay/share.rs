//! The share dialog, after `ShareClipDialog.tsx`: a clip from the library to a channel (pick a
//! community, then one of its text channels) or a DM.

use super::model::Choices;
use super::picker::{Picker, confirmed};
use super::{DestinationKind, ShareEvent};
use crate::kit::{Alert, Button, Dialog, Radio, Severity};
use crate::panel::common::is_phone;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::ClipDestination;

pub struct ShareClipDialog {
    clip_id: String,
    kind: DestinationKind,
    communities: Picker,
    channels: Picker,
    /// The community the channel list is for.
    channels_of: Option<String>,
    dms: Picker,
    busy: bool,
    failed: Option<String>,
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<ShareEvent> for ShareClipDialog {}

impl ShareClipDialog {
    /// Opens on "Share to channel", as the web does: the owner loads my communities with it.
    pub fn new(clip_id: impl Into<String>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let communities = Picker::new(window, cx);
        let channels = Picker::new(window, cx);
        let dms = Picker::new(window, cx);
        let subscriptions = vec![
            cx.subscribe_in(
                &communities.state,
                window,
                |dialog, _, event, window, cx| {
                    if confirmed(&mut dialog.communities, event, cx) {
                        // A new community clears the channel, as on the web.
                        dialog.channels.picked = None;
                        dialog.channels.set(None, window, cx);
                        dialog.channels_of = dialog.communities.picked.clone();
                        dialog.failed = None;
                        if let Some(community_id) = dialog.communities.picked.clone() {
                            cx.emit(ShareEvent::PickCommunity { community_id });
                        }
                        cx.notify();
                    }
                },
            ),
            cx.subscribe(&channels.state, |dialog, _, event, cx| {
                if confirmed(&mut dialog.channels, event, cx) {
                    dialog.failed = None;
                    cx.notify();
                }
            }),
            cx.subscribe(&dms.state, |dialog, _, event, cx| {
                if confirmed(&mut dialog.dms, event, cx) {
                    dialog.failed = None;
                    cx.notify();
                }
            }),
        ];
        Self {
            clip_id: clip_id.into(),
            kind: DestinationKind::Channel,
            communities,
            channels,
            channels_of: None,
            dms,
            busy: false,
            failed: None,
            _subscriptions: subscriptions,
        }
    }

    pub fn clip_id(&self) -> &str {
        &self.clip_id
    }

    /// My communities; `None` while they load.
    pub fn set_communities(
        &mut self,
        choices: Choices,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.communities.set(choices, window, cx);
        cx.notify();
    }

    /// The text channels of `community_id` (an answer to `PickCommunity`); `None` while they
    /// load. An answer for a community no longer picked is dropped.
    pub fn set_channels(
        &mut self,
        community_id: &str,
        choices: Choices,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.channels_of.as_deref() != Some(community_id) {
            return;
        }
        self.channels.set(choices, window, cx);
        cx.notify();
    }

    /// My DM conversations; `None` while they load.
    pub fn set_dms(&mut self, choices: Choices, window: &mut Window, cx: &mut Context<Self>) {
        self.dms.set(choices, window, cx);
        cx.notify();
    }

    pub fn set_busy(&mut self, busy: bool, cx: &mut Context<Self>) {
        self.busy = busy;
        cx.notify();
    }

    /// Why the last share failed (the server's message); `None` clears it.
    pub fn set_failed(&mut self, message: Option<String>, cx: &mut Context<Self>) {
        self.failed = message;
        cx.notify();
    }

    /// Channel or DM. The first DM pick asks the owner for the conversations.
    pub fn set_kind(&mut self, kind: DestinationKind, cx: &mut Context<Self>) {
        if self.kind == kind {
            return;
        }
        self.kind = kind;
        self.failed = None;
        if kind == DestinationKind::Dm && self.dms.choices.is_none() {
            cx.emit(ShareEvent::NeedDms);
        }
        cx.notify();
    }

    /// Picks a community, channel or DM by id (stories and tests).
    pub fn pick_community(&mut self, community_id: &str, window: &mut Window, cx: &mut App) {
        self.communities.pick(community_id, window, cx);
        self.channels_of = Some(community_id.to_owned());
    }

    pub fn pick(&mut self, kind: DestinationKind, id: &str, window: &mut Window, cx: &mut App) {
        match kind {
            DestinationKind::Channel => self.channels.pick(id, window, cx),
            DestinationKind::Dm => self.dms.pick(id, window, cx),
        }
    }

    pub fn share(&mut self, cx: &mut Context<Self>) {
        if self.busy {
            return;
        }
        let destination = match self.kind {
            DestinationKind::Channel => match &self.channels.picked {
                Some(channel_id) => ClipDestination::Channel {
                    channel_id: channel_id.clone(),
                },
                None => return self.refuse("Please select a channel", cx),
            },
            DestinationKind::Dm => match &self.dms.picked {
                Some(dm_group_id) => ClipDestination::Dm {
                    dm_group_id: dm_group_id.clone(),
                },
                None => return self.refuse("Please select a DM conversation", cx),
            },
        };
        cx.emit(ShareEvent::Share {
            clip_id: self.clip_id.clone(),
            destination,
        });
    }

    fn refuse(&mut self, message: &str, cx: &mut Context<Self>) {
        self.failed = Some(message.to_owned());
        cx.notify();
    }
}

impl Render for ShareClipDialog {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let width = if is_phone(window) {
            f32::from(window.viewport_size().width)
        } else {
            444.
        };
        let view = cx.weak_entity();
        let close = {
            let view = view.clone();
            move |cx: &mut App| {
                view.update(cx, |_, cx| cx.emit(ShareEvent::Close)).ok();
            }
        };
        let radio = |kind: DestinationKind, id: &'static str, label: &'static str| {
            let view = view.clone();
            Radio::new(id, label, self.kind == kind)
                .disabled(self.busy)
                .on_select(move |_, cx| {
                    view.update(cx, |dialog, cx| dialog.set_kind(kind, cx)).ok();
                })
        };
        let pickers = match self.kind {
            DestinationKind::Channel => div()
                .flex()
                .flex_col()
                .gap(px(16.))
                .child(self.communities.field(
                    "share-community",
                    "Select Community",
                    "You aren't in any communities.",
                    self.busy,
                    cx,
                ))
                .when(self.communities.picked.is_some(), |pickers| {
                    pickers.child(self.channels.field(
                        "share-channel",
                        "Select Channel",
                        "This community has no text channels.",
                        self.busy,
                        cx,
                    ))
                }),
            DestinationKind::Dm => div().child(self.dms.field(
                "share-dm",
                "Select DM",
                "You have no conversations yet.",
                self.busy,
                cx,
            )),
        };
        Dialog::new("Share Clip")
            .width(width)
            .on_close({
                let close = close.clone();
                move |_, cx| close(cx)
            })
            .body(
                div()
                    .id("share-clip")
                    .flex()
                    .flex_col()
                    .gap(px(8.))
                    .child(
                        div()
                            .flex()
                            .flex_wrap()
                            .child(radio(
                                DestinationKind::Channel,
                                "share-kind-channel",
                                "Share to channel",
                            ))
                            .child(radio(DestinationKind::Dm, "share-kind-dm", "Share to DM")),
                    )
                    .child(div().mt(px(8.)).child(pickers))
                    .children(self.failed.clone().map(|message| {
                        div().mt(px(8.)).child(Alert::new(Severity::Error, message))
                    })),
            )
            .action(
                Button::new("share-cancel", "Cancel")
                    .disabled(self.busy)
                    .on_click(move |_, _, cx| close(cx)),
            )
            .action(
                Button::new("share-go", "Share")
                    .contained()
                    .loading(self.busy)
                    .on_click(move |_, _, cx| {
                        view.update(cx, |dialog, cx| dialog.share(cx)).ok();
                    }),
            )
    }
}
