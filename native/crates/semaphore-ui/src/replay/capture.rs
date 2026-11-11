//! The capture dialog, after `CaptureReplayModal.tsx`: how much (a preset or a custom trim),
//! where it goes (library, a channel, a DM, or a download only), and the buffer's state.

use super::model::{self, BufferStatus, Choices, DEFAULT_PRESET, PRESETS};
use super::picker::{Picker, confirmed};
use super::trim::{TrimEvent, TrimTimeline};
use super::{CaptureEvent, CaptureTarget, DestinationKind};
use crate::kit::{Alert, Button, Dialog, Radio, Severity, Variant, text};
use crate::panel::common::{design_icon, is_phone};
use crate::theme::SemTheme as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{
    CaptureRequest, ClipDestination, ReplayMinutes, ReplaySessionView, ReplayState,
};
use semaphore_design::Icon as IconName;

pub struct CaptureReplayDialog {
    state: ReplayState,
    session: ReplaySessionView,
    minutes: ReplayMinutes,
    trim_on: bool,
    trim: Entity<TrimTimeline>,
    target: CaptureTarget,
    channels: Picker,
    dms: Picker,
    busy: bool,
    failed: Option<String>,
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<CaptureEvent> for CaptureReplayDialog {}

impl CaptureReplayDialog {
    /// A fresh dialog: 5 minutes to the library, as the web opens it. Make one per opening.
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let trim = cx.new(TrimTimeline::new);
        let channels = Picker::new(window, cx);
        let dms = Picker::new(window, cx);
        let subscriptions = vec![
            cx.subscribe(&trim, |_, _, event: &TrimEvent, cx| match event {
                TrimEvent::Changed(_) => cx.notify(),
                TrimEvent::Retry => cx.emit(CaptureEvent::Retry),
            }),
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
            state: ReplayState::Off,
            session: ReplaySessionView::default(),
            minutes: DEFAULT_PRESET,
            trim_on: false,
            trim,
            target: CaptureTarget::Library,
            channels,
            dms,
            busy: false,
            failed: None,
            _subscriptions: subscriptions,
        }
    }

    /// `VoiceView::replay` and `Core::replay_session()`, whenever either changes.
    pub fn set_state(
        &mut self,
        state: ReplayState,
        session: ReplaySessionView,
        cx: &mut Context<Self>,
    ) {
        self.state = state;
        self.session = session.clone();
        self.trim
            .update(cx, |trim, cx| trim.set_session(session, cx));
        cx.notify();
    }

    /// The current community's text channels, as `#name`; `None` while they load.
    pub fn set_channels(&mut self, choices: Choices, window: &mut Window, cx: &mut Context<Self>) {
        self.channels.set(choices, window, cx);
        cx.notify();
    }

    /// My DM conversations, named by their members; `None` while they load.
    pub fn set_dms(&mut self, choices: Choices, window: &mut Window, cx: &mut Context<Self>) {
        self.dms.set(choices, window, cx);
        cx.notify();
    }

    /// A capture or download is on its way: the controls wait.
    pub fn set_busy(&mut self, busy: bool, cx: &mut Context<Self>) {
        self.busy = busy;
        cx.notify();
    }

    /// Why the last capture failed, shown above the actions; `None` clears it.
    pub fn set_failed(&mut self, message: Option<String>, cx: &mut Context<Self>) {
        self.failed = message;
        cx.notify();
    }

    pub fn trim(&self) -> &Entity<TrimTimeline> {
        &self.trim
    }

    pub fn status(&self) -> BufferStatus {
        model::buffer_status(&self.state, &self.session)
    }

    pub fn set_minutes(&mut self, minutes: ReplayMinutes, cx: &mut Context<Self>) {
        self.minutes = minutes;
        self.trim_on = false;
        cx.notify();
    }

    pub fn set_trim_on(&mut self, on: bool, cx: &mut Context<Self>) {
        self.trim_on = on;
        cx.notify();
    }

    /// Picks where the clip goes. The first pick of a channel or DM asks the owner for the list.
    pub fn set_target(&mut self, target: CaptureTarget, cx: &mut Context<Self>) {
        if self.target == target {
            return;
        }
        self.target = target;
        self.failed = None;
        match target {
            CaptureTarget::Channel if self.channels.choices.is_none() => {
                cx.emit(CaptureEvent::NeedDestinations(DestinationKind::Channel))
            }
            CaptureTarget::Dm if self.dms.choices.is_none() => {
                cx.emit(CaptureEvent::NeedDestinations(DestinationKind::Dm))
            }
            _ => {}
        }
        cx.notify();
    }

    /// Picks a channel or DM by id (stories and tests).
    pub fn pick(&mut self, target: CaptureTarget, id: &str, window: &mut Window, cx: &mut App) {
        match target {
            CaptureTarget::Channel => self.channels.pick(id, window, cx),
            CaptureTarget::Dm => self.dms.pick(id, window, cx),
            _ => {}
        }
    }

    /// Capture: what the choices ask for, or why not.
    pub fn capture(&mut self, cx: &mut Context<Self>) {
        if self.busy || !self.status().can_capture() {
            return;
        }
        let destination = match self.target {
            CaptureTarget::Download => {
                // The stream endpoint takes a preset only (`/livekit/replay/stream`), as on the web.
                cx.emit(CaptureEvent::DownloadOnly {
                    minutes: self.minutes,
                });
                return;
            }
            CaptureTarget::Library => ClipDestination::Library,
            CaptureTarget::Channel => match &self.channels.picked {
                Some(channel_id) => ClipDestination::Channel {
                    channel_id: channel_id.clone(),
                },
                None => return self.refuse("Please select a channel", cx),
            },
            CaptureTarget::Dm => match &self.dms.picked {
                Some(dm_group_id) => ClipDestination::Dm {
                    dm_group_id: dm_group_id.clone(),
                },
                None => return self.refuse("Please select a DM conversation", cx),
            },
        };
        let trim = if self.trim_on {
            match self.trim.read(cx).range() {
                Some(range) => Some(range.trim()),
                None => return self.refuse("There's nothing to trim yet", cx),
            }
        } else {
            None
        };
        cx.emit(CaptureEvent::Capture(CaptureRequest {
            minutes: self.minutes,
            trim,
            destination,
        }));
    }

    fn refuse(&mut self, message: &str, cx: &mut Context<Self>) {
        self.failed = Some(message.to_owned());
        cx.notify();
    }

    fn presets(&self, phone: bool, cx: &mut Context<Self>) -> Div {
        let sem = cx.sem();
        let columns = if phone { 2 } else { 4 };
        let tile = |minutes: ReplayMinutes| {
            let selected = !self.trim_on && self.minutes == minutes;
            let (bg, border, fg) = if selected {
                (sem.primary, sem.primary, sem.primary_contrast)
            } else {
                (transparent_black(), sem.outlined_border, sem.primary)
            };
            div()
                .id(SharedString::from(format!(
                    "capture-preset-{}",
                    minutes.minutes()
                )))
                .test_support()
                .role(Role::RadioButton)
                .aria_label(SharedString::from(model::preset_label(minutes)))
                .aria_selected(selected)
                .flex_1()
                .min_w_0()
                .flex()
                .flex_col()
                .items_center()
                .py(px(if phone { 10. } else { 14. }))
                .rounded(px(4.))
                .border_1()
                .border_color(border)
                .bg(bg)
                .text_color(fg)
                .when(!self.busy, |tile| {
                    tile.cursor_pointer()
                        .hover(|style| style.bg(if selected { bg } else { sem.outlined_hover_bg }))
                        .on_click(
                            cx.listener(move |dialog, _, _, cx| dialog.set_minutes(minutes, cx)),
                        )
                })
                .child(text(
                    if phone { Variant::Body1 } else { Variant::H6 },
                    model::preset_label(minutes),
                ))
                .child(text(Variant::Caption, model::preset_size(minutes)).mt(px(2.)))
        };
        div()
            .flex()
            .flex_col()
            .gap(px(8.))
            .children(PRESETS.chunks(columns).map(|row| {
                div()
                    .flex()
                    .gap(px(8.))
                    .children(row.iter().map(|minutes| tile(*minutes)))
            }))
    }

    fn target_row(
        &self,
        target: CaptureTarget,
        title: &'static str,
        caption: &'static str,
        icon: IconName,
        cx: &mut Context<Self>,
    ) -> Div {
        let sem = cx.sem();
        div()
            .flex()
            .flex_col()
            .child(
                Radio::new(
                    SharedString::from(format!("capture-target-{}", target.key())),
                    title,
                    self.target == target,
                )
                .disabled(self.busy)
                .on_select({
                    let view = cx.weak_entity();
                    move |_, cx| {
                        view.update(cx, |dialog, cx| dialog.set_target(target, cx))
                            .ok();
                    }
                }),
            )
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(6.))
                    .ml(px(42.))
                    .mt(px(-10.))
                    .mb(px(4.))
                    .text_color(sem.text_secondary)
                    .child(design_icon(icon, 14., sem.text_secondary).flex_shrink_0())
                    .child(text(Variant::Caption, caption).flex_1().min_w_0()),
            )
    }

    fn status_line(&self, cx: &App) -> Option<AnyElement> {
        let status = self.status();
        // With the trim open, the timeline says it's warming up or not recording itself.
        if self.trim_on && matches!(status, BufferStatus::WarmingUp | BufferStatus::NotRecording) {
            return None;
        }
        let line = status.line();
        Some(match status {
            BufferStatus::Recording { .. } => {
                let sem = cx.sem();
                div()
                    .id("capture-status")
                    .test_support()
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .child(div().size(px(8.)).rounded_full().bg(sem.positive))
                    .child(text(Variant::Body2, line).text_color(sem.text_secondary))
                    .into_any_element()
            }
            BufferStatus::Failed { .. } => Alert::new(Severity::Error, line).into_any_element(),
            BufferStatus::WarmingUp | BufferStatus::Starting => {
                Alert::new(Severity::Info, line).into_any_element()
            }
            BufferStatus::NotRecording => Alert::new(Severity::Warning, line).into_any_element(),
        })
    }
}

impl CaptureTarget {
    fn key(self) -> &'static str {
        match self {
            Self::Library => "library",
            Self::Channel => "channel",
            Self::Dm => "dm",
            Self::Download => "download",
        }
    }
}

impl Render for CaptureReplayDialog {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let phone = is_phone(window);
        let viewport = window.viewport_size();
        let width = if phone {
            f32::from(viewport.width)
        } else if self.trim_on {
            (f32::from(viewport.width) * 0.9).min(1000.)
        } else {
            600.
        };
        let body_max = (f32::from(viewport.height) - 200.).max(240.);
        let sem = cx.sem().clone();
        let can_capture = self.status().can_capture();
        let view = cx.weak_entity();
        let close = {
            let view = view.clone();
            move |cx: &mut App| {
                view.update(cx, |_, cx| cx.emit(CaptureEvent::Close)).ok();
            }
        };
        let heading = |line: &'static str| {
            text(Variant::Body2, line)
                .text_color(sem.text_secondary)
                .mb(px(8.))
        };
        let trim_button = Button::new(
            "capture-trim",
            if self.trim_on {
                "Custom Trim (Active)"
            } else {
                "Custom Trim"
            },
        )
        .start_icon(IconName::ContentCut)
        .full_width()
        .disabled(self.busy)
        .on_click(cx.listener(|dialog, _, _, cx| {
            let on = !dialog.trim_on;
            dialog.set_trim_on(on, cx);
        }));
        let trim_button = if self.trim_on {
            trim_button.contained()
        } else {
            trim_button.outlined()
        };
        let picker = match self.target {
            CaptureTarget::Channel => Some(self.channels.field(
                "capture-channel",
                "Select Channel",
                "This community has no text channels.",
                self.busy,
                cx,
            )),
            CaptureTarget::Dm => Some(self.dms.field(
                "capture-dm",
                "Select DM",
                "You have no conversations yet.",
                self.busy,
                cx,
            )),
            _ => None,
        };
        let note = (!self.trim_on).then(|| {
            div()
                .mt(px(16.))
                .p(px(16.))
                .rounded(px(4.))
                .bg(sem.action_hover)
                .child(
                    text(
                        Variant::Body2,
                        format!(
                            "Note: The replay will be captured from your current screen share \
                             buffer. Make sure you've been sharing your screen for at least {} \
                             to capture the full duration.",
                            model::preset_label(self.minutes)
                        ),
                    )
                    .text_color(sem.text_secondary),
                )
        });
        let download_note = (self.trim_on && self.target == CaptureTarget::Download).then(|| {
            text(
                Variant::Caption,
                format!(
                    "A download takes the whole {} preset, not the trim.",
                    model::preset_label(self.minutes)
                ),
            )
            .text_color(sem.warning)
            .ml(px(42.))
        });
        let body = div()
            .id("capture-body")
            .test_support()
            .flex()
            .flex_col()
            .pt(px(8.))
            .max_h(px(body_max))
            .overflow_y_scroll()
            .children(
                self.status_line(cx)
                    .map(|line| div().mb(px(16.)).child(line)),
            )
            .child(heading("How much time would you like to capture?"))
            .child(self.presets(phone, cx))
            .child(div().mt(px(8.)).child(trim_button))
            .when(self.trim_on, |body| {
                body.child(div().mt(px(16.)).child(self.trim.clone()))
            })
            .child(
                div()
                    .mt(px(24.))
                    .child(heading("What would you like to do with the clip?")),
            )
            .child(self.target_row(
                CaptureTarget::Library,
                "Save to my library",
                "Access later from your profile",
                IconName::VideoLibrary,
                cx,
            ))
            .child(self.target_row(
                CaptureTarget::Channel,
                "Share to channel",
                "Post in a channel and save to your library",
                IconName::Send,
                cx,
            ))
            .child(self.target_row(
                CaptureTarget::Dm,
                "Share to DM",
                "Send to a conversation and save to your library",
                IconName::Send,
                cx,
            ))
            .child(self.target_row(
                CaptureTarget::Download,
                "Download only",
                "Download to your device without saving to server",
                IconName::Download,
                cx,
            ))
            .children(download_note)
            .children(picker.map(|picker| div().mt(px(12.)).child(picker)))
            .children(note)
            .children(self.failed.clone().map(|message| {
                div()
                    .mt(px(16.))
                    .child(Alert::new(Severity::Error, message))
            }));
        let label = match (self.busy, self.target) {
            (true, CaptureTarget::Download) => "Downloading...",
            (true, _) => "Capturing...",
            _ => "Capture",
        };
        Dialog::new("Capture Replay")
            .width(width)
            .on_close({
                let close = close.clone();
                move |_, cx| close(cx)
            })
            .body(body)
            .action(
                Button::new("capture-cancel", "Cancel")
                    .disabled(self.busy)
                    .on_click(move |_, _, cx| close(cx)),
            )
            .action(
                // The actions row is padded 8 px, the body 24: on desktop the button ends where
                // the body does instead of past it (a phone keeps the row's own edge).
                div().when(!phone, |end| end.mr(px(16.))).child(
                    Button::new("capture-go", label)
                        .contained()
                        .start_icon(IconName::VideocamOutlined)
                        .disabled(!can_capture)
                        .loading(self.busy)
                        .on_click(move |_, _, cx| {
                            view.update(cx, |dialog, cx| dialog.capture(cx)).ok();
                        }),
                ),
            )
    }
}
