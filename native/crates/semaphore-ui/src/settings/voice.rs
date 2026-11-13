//! The voice and video tab, after `Settings/AudioVideoSettingsPanel.tsx`: input mode and the
//! push-to-talk key, processing, mic quality, devices, the mic test, the camera test with its
//! preview, and camera and screen share. No "Voice isolation". Each change goes out at once as the
//! whole new state.

use super::camera_test::{self, CameraTestEvent, CameraTestState};
use super::key_capture::{Capture, ptt_key_from, ptt_key_label};
use super::shell::{caption, section, segmented, switch_row, tab_page};
use super::{
    DeviceLists, DeviceOption, InputMode, MicQuality, VoiceLimits, VoiceSettingsEvent,
    VoiceVideoSettings, VoiceVideoState,
};
use crate::kit::{
    Button, ButtonSize, Radio, SelectField, Skeleton, Slider, Spinner, Switch, Variant,
};
use crate::kit::{select_state, spacing, text};
use crate::panel::common::{design_icon, error_block, icon_button};
use crate::theme::SemTheme;
use crate::voice::{Fit, VideoFrames};
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::component::IndexPath;
use gpui_kit::component::select::SelectEvent;
use gpui_kit::component::slider::{SliderEvent, SliderState, SliderValue};
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{CAMERA_TEST_TRACK_SID, LoadState, ShareResolution};
use semaphore_design::Icon as DesignIcon;
use std::sync::Arc;

/// A device select's row: what it says, and the device it picks (`None` = the system default).
pub(crate) type DeviceRow = (SharedString, Option<String>);

/// `MIC_QUALITY_OPTIONS[q].label`.
pub fn mic_quality_label(quality: MicQuality) -> &'static str {
    match quality {
        MicQuality::Standard => "Standard (48 kbps)",
        MicQuality::High => "High (96 kbps)",
        MicQuality::Music => "Music (128 kbps)",
    }
}

fn mic_quality_description(quality: MicQuality) -> &'static str {
    match quality {
        MicQuality::Standard => "Clear speech with the least bandwidth.",
        MicQuality::High => "Transparent voice. Recommended.",
        MicQuality::Music => "For instruments and music: highest bitrate, never gates silence.",
    }
}

/// The screen share sizes offered, largest first.
pub const SHARE_SIZES: [ShareResolution; 6] = [
    ShareResolution::Native,
    ShareResolution::P2160,
    ShareResolution::P1440,
    ShareResolution::P1080,
    ShareResolution::P720,
    ShareResolution::P480,
];

/// The frame rates offered.
pub const SHARE_FPS: [u32; 3] = [15, 30, 60];

/// The same words as the app's `ShareSize::label`.
pub fn share_size_label(size: ShareResolution) -> &'static str {
    match size {
        ShareResolution::Native => "Native",
        ShareResolution::P2160 => "4K",
        ShareResolution::P1440 => "1440p",
        ShareResolution::P1080 => "1080p",
        ShareResolution::P720 => "720p",
        ShareResolution::P480 => "480p",
    }
}

fn share_size_key(size: ShareResolution) -> &'static str {
    match size {
        ShareResolution::Native => "native",
        ShareResolution::P2160 => "2160",
        ShareResolution::P1440 => "1440",
        ShareResolution::P1080 => "1080",
        ShareResolution::P720 => "720",
        ShareResolution::P480 => "480",
    }
}

/// A device select's rows: the system default, a selected device that's gone (as the web's
/// "Previously selected device (disconnected)"), then each device, with a repeated name told
/// apart. With no devices at all there is one row, `empty`.
pub(crate) fn device_rows(
    devices: &[DeviceOption],
    selected: Option<&str>,
    empty: &'static str,
) -> Vec<DeviceRow> {
    if devices.is_empty() {
        return vec![(empty.into(), None)];
    }
    let mut rows: Vec<DeviceRow> = vec![("System default".into(), None)];
    if let Some(id) = selected
        && !devices.iter().any(|device| device.id == id)
    {
        rows.push((
            "Previously selected device (disconnected)".into(),
            Some(id.to_owned()),
        ));
    }
    for device in devices {
        let base = if device.is_default {
            format!("{} (default)", device.name)
        } else {
            device.name.clone()
        };
        let mut label = base.clone();
        let mut n = 2;
        while rows.iter().any(|(existing, _)| existing.as_ref() == label) {
            label = format!("{base} ({n})");
            n += 1;
        }
        rows.push((label.into(), Some(device.id.clone())));
    }
    rows
}

/// The web's gate: the level is above the threshold.
pub(crate) fn transmitting(level: f32, threshold: u8) -> bool {
    // Rounded as the web's 0..100 level is, so 0.3 at a threshold of 30 stays gated.
    (level * 100.).round() > f32::from(threshold)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ModeKind {
    VoiceActivity,
    PushToTalk,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DeviceKind {
    Input,
    Output,
    Camera,
}

impl VoiceVideoSettings {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let state = VoiceVideoState::default();
        let quality = select_state(
            MicQuality::ALL
                .iter()
                .map(|quality| SharedString::from(mic_quality_label(*quality)))
                .collect(),
            MicQuality::ALL.iter().position(|q| *q == state.mic_quality),
            window,
            cx,
        );
        let input = select_state(vec!["System default".into()], Some(0), window, cx);
        let output = select_state(vec!["System default".into()], Some(0), window, cx);
        let camera = select_state(vec!["System default".into()], Some(0), window, cx);
        let threshold = cx.new(|_| {
            SliderState::new()
                .min(0.)
                .max(100.)
                .step(1.)
                .default_value(0.)
        });
        let capture_focus = cx.focus_handle();
        let subscriptions = vec![
            cx.subscribe_in(&quality, window, |this, _, event, _, cx| {
                let SelectEvent::Confirm(Some(label)) = event else {
                    return;
                };
                if let Some(quality) = MicQuality::ALL
                    .into_iter()
                    .find(|quality| mic_quality_label(*quality) == label.as_ref())
                {
                    this.change(cx, |state| state.mic_quality = quality);
                }
            }),
            cx.subscribe_in(&input, window, |this, _, event, _, cx| {
                this.on_device(DeviceKind::Input, event, cx)
            }),
            cx.subscribe_in(&output, window, |this, _, event, _, cx| {
                this.on_device(DeviceKind::Output, event, cx)
            }),
            cx.subscribe_in(&camera, window, |this, _, event, _, cx| {
                this.on_device(DeviceKind::Camera, event, cx)
            }),
            cx.subscribe_in(&threshold, window, |this, _, event, _, cx| {
                let (SliderEvent::Change(value) | SliderEvent::Release(value)) = event;
                let SliderValue::Single(value) = value else {
                    return;
                };
                let value = value.round().clamp(0., 100.) as u8;
                if let InputMode::VoiceActivity { threshold } = this.state.input_mode
                    && threshold != value
                {
                    this.last_threshold = value;
                    this.change(cx, |state| {
                        state.input_mode = InputMode::VoiceActivity { threshold: value }
                    });
                }
            }),
            cx.on_blur(&capture_focus, window, |this, _, cx| {
                if this.capturing {
                    this.capturing = false;
                    cx.notify();
                }
            }),
        ];
        let mut this = Self {
            state,
            limits: VoiceLimits::default(),
            devices: DeviceLists::default(),
            mic_level: None,
            camera_test: CameraTestState::default(),
            camera_published: false,
            frames: None,
            last_threshold: 0,
            capturing: false,
            capture_focus,
            quality,
            input,
            output,
            camera,
            input_rows: Vec::new(),
            output_rows: Vec::new(),
            camera_rows: Vec::new(),
            threshold,
            _subscriptions: subscriptions,
        };
        this.sync(window, cx);
        this
    }

    /// The app's local settings for voice.
    pub fn set_state(
        &mut self,
        state: VoiceVideoState,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if let InputMode::VoiceActivity { threshold } = state.input_mode {
            self.last_threshold = threshold;
        }
        self.state = state;
        self.sync(window, cx);
        cx.notify();
    }

    /// The media engine's devices; `state: Loading` while they're listed.
    pub fn set_devices(
        &mut self,
        devices: DeviceLists,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.devices = devices;
        self.sync(window, cx);
        cx.notify();
    }

    /// What this build can't do: said in place of it.
    pub fn set_limits(&mut self, limits: VoiceLimits, cx: &mut Context<Self>) {
        self.limits = limits;
        cx.notify();
    }

    /// The mic's level, 0..1, while a test runs; `None` when no test runs.
    pub fn set_mic_level(&mut self, level: Option<f32>, cx: &mut Context<Self>) {
        self.mic_level = level.map(|level| level.clamp(0., 1.));
        cx.notify();
    }

    /// The window's frames, so the camera test's preview draws on the same surfaces a call's own
    /// camera tile does.
    pub fn set_frames(&mut self, frames: Arc<VideoFrames>, cx: &mut Context<Self>) {
        self.frames = Some(frames);
        cx.notify();
    }

    /// Whether the call is sending the camera. It can't be tested then: the test says so and its
    /// button is off.
    pub fn set_camera_published(&mut self, published: bool, cx: &mut Context<Self>) {
        if self.camera_published != published {
            self.camera_published = published;
            cx.notify();
        }
    }

    /// What the camera test did: it started, a frame reached the preview, it failed, or it stopped.
    pub fn camera_test_event(&mut self, event: CameraTestEvent, cx: &mut Context<Self>) {
        let next = camera_test::next(&self.camera_test, &event);
        if next != self.camera_test {
            self.camera_test = next;
            cx.notify();
        } else if matches!(event, CameraTestEvent::Frame) {
            // A new picture in the same state: draw it again.
            cx.notify();
        }
    }

    /// What the camera test is doing now, for the owner and the rigs.
    pub fn camera_test_state(&self) -> &CameraTestState {
        &self.camera_test
    }

    pub fn state(&self) -> &VoiceVideoState {
        &self.state
    }

    /// "Press a key…" is showing.
    pub fn is_capturing(&self) -> bool {
        self.capturing
    }

    /// Puts the selects and the slider where the state says.
    fn sync(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let quality = MicQuality::ALL
            .iter()
            .position(|quality| *quality == self.state.mic_quality);
        self.quality.update(cx, |select, cx| {
            select.set_selected_index(quality.map(|row| IndexPath::default().row(row)), window, cx)
        });
        self.input_rows = device_rows(
            &self.devices.inputs,
            self.state.input_device.as_deref(),
            "No devices found",
        );
        self.output_rows = device_rows(
            &self.devices.outputs,
            self.state.output_device.as_deref(),
            "No devices found",
        );
        self.camera_rows = device_rows(
            &self.devices.cameras,
            self.state.camera.as_deref(),
            "No cameras found",
        );
        for (select, rows, chosen) in [
            (&self.input, &self.input_rows, &self.state.input_device),
            (&self.output, &self.output_rows, &self.state.output_device),
            (&self.camera, &self.camera_rows, &self.state.camera),
        ] {
            let labels: Vec<SharedString> = rows.iter().map(|(label, _)| label.clone()).collect();
            let index = rows.iter().position(|(_, id)| id == chosen).unwrap_or(0);
            select.update(cx, |select, cx| {
                select.set_items(labels, window, cx);
                select.set_selected_index(Some(IndexPath::default().row(index)), window, cx);
            });
        }
        let threshold = f32::from(self.last_threshold);
        self.threshold.update(cx, |slider, cx| {
            if slider.value() != SliderValue::Single(threshold) {
                slider.set_value(threshold, window, cx);
            }
        });
    }

    fn change(&mut self, cx: &mut Context<Self>, edit: impl FnOnce(&mut VoiceVideoState)) {
        let mut next = self.state.clone();
        edit(&mut next);
        if next != self.state {
            self.state = next.clone();
            cx.emit(VoiceSettingsEvent::Changed(next));
        }
        cx.notify();
    }

    fn on_device(
        &mut self,
        kind: DeviceKind,
        event: &SelectEvent<Vec<SharedString>>,
        cx: &mut Context<Self>,
    ) {
        let SelectEvent::Confirm(Some(label)) = event else {
            return;
        };
        let rows = match kind {
            DeviceKind::Input => &self.input_rows,
            DeviceKind::Output => &self.output_rows,
            DeviceKind::Camera => &self.camera_rows,
        };
        let Some((_, id)) = rows.iter().find(|(row, _)| row == label).cloned() else {
            return;
        };
        self.change(cx, |state| match kind {
            DeviceKind::Input => state.input_device = id,
            DeviceKind::Output => state.output_device = id,
            DeviceKind::Camera => state.camera = id,
        });
    }

    fn set_mode(&mut self, mode: ModeKind, cx: &mut Context<Self>) {
        let threshold = self.last_threshold;
        if mode == ModeKind::VoiceActivity {
            self.capturing = false;
        }
        self.change(cx, |state| {
            state.input_mode = match mode {
                ModeKind::VoiceActivity => InputMode::VoiceActivity { threshold },
                ModeKind::PushToTalk => InputMode::PushToTalk,
            }
        });
    }

    fn start_capture(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.capturing = true;
        window.focus(&self.capture_focus, cx);
        cx.notify();
    }

    fn cancel_capture(&mut self, cx: &mut Context<Self>) {
        self.capturing = false;
        cx.notify();
    }

    /// While capturing, every key stops here, so the app's own key handlers don't see it.
    fn on_capture_key(&mut self, event: &KeyDownEvent, _: &mut Window, cx: &mut Context<Self>) {
        if !self.capturing {
            return;
        }
        cx.stop_propagation();
        match ptt_key_from(&event.keystroke) {
            Capture::Key(key) => {
                self.capturing = false;
                self.change(cx, |state| state.ptt_key = Some(key));
            }
            Capture::Cancel => self.cancel_capture(cx),
            Capture::Ignore => {}
        }
    }

    fn testing(&self) -> bool {
        self.mic_level.is_some()
    }
}

impl Render for VoiceVideoSettings {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let sem = cx.sem().clone();
        let refresh = icon_button(
            "voice-refresh-devices",
            DesignIcon::Refresh,
            "Refresh devices",
            false,
            sem.action_active,
            cx,
        )
        .on_click(cx.listener(|_, _, _, cx| cx.emit(VoiceSettingsEvent::RefreshDevices)))
        .into_any_element();
        let body = div()
            .flex()
            .flex_col()
            .gap(spacing(3.))
            .child(self.input_mode(cx))
            .children(
                matches!(self.state.input_mode, InputMode::PushToTalk).then(|| self.ptt_key(cx)),
            )
            // The mic test sits under the input mode, beside the threshold it sets.
            .child(self.mic_test(cx))
            .child(self.processing(cx))
            .child(self.quality_section(cx))
            .child(self.devices_section(cx))
            .child(self.share(cx));
        tab_page(
            "voice-settings",
            DesignIcon::VolumeUp,
            "Voice & Video",
            vec![refresh],
            body,
            cx,
        )
    }
}

impl VoiceVideoSettings {
    fn input_mode(&self, cx: &mut Context<Self>) -> Div {
        let view = cx.weak_entity();
        let (kind, hint) = match self.state.input_mode {
            InputMode::VoiceActivity { .. } => (
                ModeKind::VoiceActivity,
                "Your microphone is always active when unmuted",
            ),
            InputMode::PushToTalk => (ModeKind::PushToTalk, "Hold a key to transmit audio"),
        };
        section("Input Mode", cx)
            .child(segmented(
                "voice-mode",
                &[
                    (ModeKind::VoiceActivity, "Voice Activity"),
                    (ModeKind::PushToTalk, "Push to Talk"),
                ],
                kind,
                move |mode, _, cx| {
                    view.update(cx, |this, cx| this.set_mode(mode, cx)).ok();
                },
            ))
            .child(caption(hint, cx))
    }

    fn ptt_key(&self, cx: &mut Context<Self>) -> Div {
        let sem = cx.sem().clone();
        let capturing = self.capturing;
        let shown: SharedString = if capturing {
            "Press a key…".into()
        } else {
            match &self.state.ptt_key {
                Some(key) => ptt_key_label(key).into(),
                None => "Not set".into(),
            }
        };
        let (ground, ink) = if capturing {
            (sem.primary, sem.primary_contrast)
        } else {
            (sem.background_default, sem.text_primary)
        };
        let key_box = div()
            .id("voice-ptt-key")
            .test_support()
            .track_focus(&self.capture_focus)
            .on_key_down(cx.listener(Self::on_capture_key))
            .role(Role::Status)
            .aria_label(SharedString::from(format!("Push to talk key: {shown}")))
            .min_w(px(140.))
            .h(px(36.))
            .px(spacing(2.))
            .flex()
            .items_center()
            .justify_center()
            .gap(spacing(1.))
            .rounded(px(4.))
            .border_1()
            .border_color(sem.divider)
            .bg(ground)
            .text_color(ink)
            .child(design_icon(DesignIcon::Keyboard, 20., ink))
            .child(text(Variant::Body2, shown).font_weight(FontWeight(500.)));
        let change = Button::new(
            "voice-ptt-change",
            if capturing { "Cancel" } else { "Change Key" },
        )
        .outlined()
        .size(ButtonSize::Small)
        .on_click(cx.listener(move |this, _, window, cx| {
            if capturing {
                this.cancel_capture(cx);
            } else {
                this.start_capture(window, cx);
            }
        }));
        section("Push to Talk Key", cx)
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .items_center()
                    .gap(spacing(2.))
                    .child(key_box)
                    .child(change),
            )
            .child(caption(
                if capturing {
                    "Press the key to use. Escape keeps the current one."
                } else {
                    "This key will activate your microphone while held"
                },
                cx,
            ))
    }

    fn processing(&self, cx: &mut Context<Self>) -> Div {
        let view = cx.weak_entity();
        let processing = self.state.processing;
        let toggle = |id: &'static str,
                      label: &'static str,
                      hint: &'static str,
                      checked: bool,
                      set: fn(&mut VoiceVideoState, bool),
                      cx: &App| {
            let view = view.clone();
            switch_row(
                Switch::new(id, label, checked).on_change(move |on, _, cx| {
                    view.update(cx, |this, cx| this.change(cx, |state| set(state, on)))
                        .ok();
                }),
                label,
                Some(hint.into()),
                cx,
            )
        };
        section("Audio Processing", cx)
            .child(toggle(
                "voice-echo-cancellation",
                "Echo Cancellation",
                "Reduces echo from your speakers",
                processing.echo_cancellation,
                |state, on| state.processing.echo_cancellation = on,
                cx,
            ))
            .child(toggle(
                "voice-noise-suppression",
                "Noise Suppression",
                "Filters out steady background noise",
                processing.noise_suppression,
                |state, on| state.processing.noise_suppression = on,
                cx,
            ))
            .child(toggle(
                "voice-auto-gain",
                "Auto Gain Control",
                "Automatically adjusts microphone volume",
                processing.auto_gain,
                |state, on| state.processing.auto_gain = on,
                cx,
            ))
    }

    fn quality_section(&self, cx: &mut Context<Self>) -> Div {
        section("Microphone Quality", cx)
            .child(SelectField::new(
                "voice-mic-quality",
                &self.quality,
                "Microphone quality",
            ))
            .child(caption(
                format!(
                    "{} Applies the next time you join voice.",
                    mic_quality_description(self.state.mic_quality)
                ),
                cx,
            ))
    }

    fn device_select(
        &self,
        id: &'static str,
        select: &Entity<gpui_kit::component::select::SelectState<Vec<SharedString>>>,
        label: &'static str,
        empty: bool,
    ) -> AnyElement {
        match &self.devices.state {
            LoadState::Loading => div()
                .id(SharedString::from(format!("{id}-loading")))
                .test_support()
                .role(Role::ProgressIndicator)
                .aria_label(SharedString::from(format!("Loading {label}")))
                .child(Skeleton::rect(
                    SharedString::from(format!("{id}-skeleton")),
                    relative(1.),
                    56.,
                ))
                .into_any_element(),
            _ => SelectField::new(id, select, label)
                .disabled(empty)
                .into_any_element(),
        }
    }

    fn devices_section(&self, cx: &mut Context<Self>) -> Div {
        let view_failed = matches!(self.devices.state, LoadState::Failed { .. });
        if view_failed {
            return div().child(error_block(
                "voice-devices-retry",
                "Couldn't list your devices",
                "Check that your microphone and speakers are connected, then try again.",
                cx.listener(|_, _, _, cx| cx.emit(VoiceSettingsEvent::RefreshDevices)),
                cx,
            ));
        }
        let ready = matches!(self.devices.state, LoadState::Ready);
        let test_sound = Button::new("voice-test-sound", "Play test sound")
            .outlined()
            .size(ButtonSize::Small)
            .start_icon(DesignIcon::PlayArrow)
            .disabled(ready && self.devices.outputs.is_empty())
            .on_click(cx.listener(|_, _, _, cx| cx.emit(VoiceSettingsEvent::PlayTestSound)));
        div()
            .flex()
            .flex_col()
            .gap(spacing(3.))
            .child(section("Microphone", cx).child(self.device_select(
                "voice-input-device",
                &self.input,
                "Microphone",
                self.devices.inputs.is_empty(),
            )))
            .child(
                section("Speakers", cx)
                    .child(self.device_select(
                        "voice-output-device",
                        &self.output,
                        "Speakers",
                        self.devices.outputs.is_empty(),
                    ))
                    .child(div().flex().child(test_sound)),
            )
            .child(
                section("Camera", cx)
                    .child(self.device_select(
                        "voice-camera-device",
                        &self.camera,
                        "Camera",
                        self.devices.cameras.is_empty(),
                    ))
                    .child(self.camera_test_section(cx)),
            )
    }

    /// The web's "Test Camera" paper: the button, then the preview surface under it, drawn from
    /// the same frames a call's own camera tile takes. Nothing is published; the owner opens the
    /// selected camera and feeds `camera_test_event`.
    fn camera_test_section(&self, cx: &mut Context<Self>) -> Div {
        let sem = cx.sem().clone();
        let loading = matches!(self.devices.state, LoadState::Loading);
        let no_camera =
            matches!(self.devices.state, LoadState::Ready) && self.devices.cameras.is_empty();
        let active = self.camera_test.is_active();
        let blocked = self.camera_published;
        let button = Button::new(
            "voice-camera-test",
            if active { "Stop" } else { "Test camera" },
        )
        .outlined()
        .size(ButtonSize::Small)
        .start_icon(if active {
            DesignIcon::VideocamOff
        } else {
            DesignIcon::Videocam
        })
        .disabled(!active && (loading || no_camera || blocked))
        .on_click(cx.listener(move |_, _, _, cx| {
            cx.emit(if active {
                VoiceSettingsEvent::StopCameraTest
            } else {
                VoiceSettingsEvent::StartCameraTest
            })
        }));
        let surface = if blocked {
            self.camera_test_note(
                "voice-camera-test-blocked",
                DesignIcon::VideocamOff,
                "The call is using your camera.",
                Some("Turn your camera off in the call to test it here."),
                cx,
            )
        } else if loading {
            div()
                .id("voice-camera-test-loading")
                .test_support()
                .role(Role::ProgressIndicator)
                .aria_label("Loading cameras")
                .absolute()
                .inset_0()
                .child(Skeleton::rect(
                    "voice-camera-test-skeleton",
                    relative(1.),
                    200.,
                ))
                .into_any_element()
        } else if no_camera {
            self.camera_test_note(
                "voice-camera-test-no-camera",
                DesignIcon::VideocamOff,
                "No camera found.",
                Some("Connect a camera, then refresh the list."),
                cx,
            )
        } else {
            match &self.camera_test {
                CameraTestState::Idle => self.camera_test_note(
                    "voice-camera-test-idle",
                    DesignIcon::Videocam,
                    "Click \"Test camera\" to preview your camera",
                    None,
                    cx,
                ),
                CameraTestState::Starting => div()
                    .id("voice-camera-test-starting")
                    .test_support()
                    .role(Role::ProgressIndicator)
                    .aria_label("Opening the camera")
                    .absolute()
                    .inset_0()
                    .flex()
                    .flex_col()
                    .items_center()
                    .justify_center()
                    .gap(spacing(1.))
                    .child(Spinner::new("voice-camera-test-spinner").size(32.))
                    .child(caption("Opening the camera…", cx))
                    .into_any_element(),
                CameraTestState::Running => self.camera_preview(cx),
                CameraTestState::Failed { reason } => error_block(
                    "voice-camera-test-failed",
                    "Couldn't start the camera",
                    reason.clone(),
                    cx.listener(|_, _, _, cx| cx.emit(VoiceSettingsEvent::StartCameraTest)),
                    cx,
                ),
            }
        };
        section("Test Camera", cx)
            .child(div().flex().child(button))
            .child(
                div()
                    .id("voice-camera-test-surface")
                    .test_support()
                    .relative()
                    .h(px(200.))
                    .w_full()
                    .overflow_hidden()
                    .rounded(px(8.))
                    .bg(sem.action_selected)
                    .child(surface),
            )
    }

    /// A note in place of the picture: what to do, or why there can't be one.
    fn camera_test_note(
        &self,
        id: &'static str,
        icon: DesignIcon,
        title: impl Into<SharedString>,
        hint: Option<&'static str>,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let sem = cx.sem().clone();
        let title = title.into();
        div()
            .id(id)
            .test_support()
            .role(Role::Note)
            .aria_label(title.clone())
            .absolute()
            .inset_0()
            .flex()
            .flex_col()
            .items_center()
            .justify_center()
            .gap(spacing(1.))
            .px(spacing(2.))
            .child(design_icon(icon, 40., sem.text_secondary))
            .child(
                text(Variant::Body2, title)
                    .text_color(sem.text_secondary)
                    .text_center(),
            )
            .children(hint.map(|hint| caption(hint, cx)))
            .into_any_element()
    }

    /// The camera's picture, through the window's `VideoFrames` and under the test's track id, as
    /// a call's own camera tile draws under its publication's sid.
    fn camera_preview(&self, cx: &mut Context<Self>) -> AnyElement {
        let background = cx.sem().action_selected;
        let Some(frames) = self.frames.clone() else {
            return self.camera_test_note(
                "voice-camera-test-no-surface",
                DesignIcon::VideocamOff,
                "This window can't show the camera preview.",
                None,
                cx,
            );
        };
        div()
            .id("voice-camera-preview")
            .test_support()
            .absolute()
            .size_full()
            .child(
                canvas(
                    |_, _, _| (),
                    move |bounds, _, window, cx| {
                        frames.paint(
                            CAMERA_TEST_TRACK_SID,
                            bounds,
                            px(0.),
                            Fit::Cover {
                                corners: background,
                            },
                            window,
                            cx,
                        );
                    },
                )
                .absolute()
                .size_full(),
            )
            .into_any_element()
    }

    fn mic_test(&self, cx: &mut Context<Self>) -> Div {
        let sem = cx.sem().clone();
        let testing = self.testing();
        let no_mic =
            matches!(self.devices.state, LoadState::Ready) && self.devices.inputs.is_empty();
        let button = Button::new("voice-mic-test", if testing { "Stop" } else { "Test" })
            .outlined()
            .size(ButtonSize::Small)
            .start_icon(if testing {
                DesignIcon::MicOff
            } else {
                DesignIcon::Mic
            })
            .disabled(no_mic && !testing)
            .on_click(cx.listener(move |_, _, _, cx| {
                cx.emit(if testing {
                    VoiceSettingsEvent::StopMicTest
                } else {
                    VoiceSettingsEvent::StartMicTest
                })
            }));
        let threshold = match self.state.input_mode {
            InputMode::VoiceActivity { threshold } => Some(threshold),
            InputMode::PushToTalk => None,
        };
        let sensitivity = threshold.map(|_| {
            div()
                .flex()
                .flex_col()
                .gap(px(4.))
                .child(caption("Input Sensitivity", cx))
                .child(Slider::new(&self.threshold, "Input sensitivity"))
                .child(
                    div()
                        .flex()
                        .justify_between()
                        .child(caption("High", cx))
                        .child(caption("Medium", cx))
                        .child(caption("Low", cx)),
                )
                .child(caption(
                    "Drag the slider to set the threshold: audio above it is transmitted.",
                    cx,
                ))
        });
        let meter = self.mic_level.map(|level| {
            let (status, status_color, fill) = match threshold {
                Some(threshold) if transmitting(level, threshold) => {
                    ("Transmitting".to_owned(), sem.success, sem.success)
                }
                Some(_) => ("Gated".to_owned(), sem.text_secondary, sem.text_disabled),
                None => {
                    let percent = (level * 100.).round();
                    let fill = if percent > 80. {
                        sem.error
                    } else if percent > 50. {
                        sem.warning
                    } else {
                        sem.success
                    };
                    (format!("{percent}%"), sem.text_secondary, fill)
                }
            };
            div()
                .id("voice-mic-meter")
                .test_support()
                .role(Role::ProgressIndicator)
                .aria_label(SharedString::from(format!("Microphone level: {status}")))
                .flex()
                .flex_col()
                .gap(spacing(1.))
                .child(
                    div()
                        .flex()
                        .justify_between()
                        .child(caption("Microphone Level", cx))
                        .child(
                            text(Variant::Caption, status)
                                .font_weight(FontWeight(500.))
                                .text_color(status_color),
                        ),
                )
                .child(
                    div()
                        .relative()
                        .h(px(8.))
                        .w_full()
                        .rounded(px(4.))
                        .bg(sem.action_selected)
                        .child(
                            div()
                                .absolute()
                                .left_0()
                                .top_0()
                                .h_full()
                                .w(relative(level))
                                .rounded(px(4.))
                                .bg(fill),
                        )
                        .children(threshold.map(|threshold| {
                            div()
                                .absolute()
                                .top(px(-4.))
                                .left(relative(f32::from(threshold) / 100.))
                                .w(px(2.))
                                .h(px(16.))
                                .bg(sem.primary)
                        })),
                )
        });
        if let Some(note) = self.limits.mic_test.clone() {
            return section("Test Microphone", cx)
                .child(
                    div()
                        .id("voice-mic-test-limit")
                        .test_support()
                        .role(Role::Note)
                        .aria_label(note.clone())
                        .child(caption(note, cx)),
                )
                .children(sensitivity);
        }
        section("Test Microphone", cx)
            .child(div().flex().child(button))
            .children(sensitivity)
            .children(meter)
    }

    fn share(&self, cx: &mut Context<Self>) -> Div {
        let sem = cx.sem().clone();
        let share = self.state.share;
        let view = cx.weak_entity();
        let sizes = SHARE_SIZES.iter().map(|&size| {
            let view = view.clone();
            Radio::new(
                SharedString::from(format!("share-size-{}", share_size_key(size))),
                share_size_label(size),
                share.resolution == size,
            )
            .on_select(move |_, cx| {
                view.update(cx, |this, cx| {
                    this.change(cx, |state| state.share.resolution = size)
                })
                .ok();
            })
        });
        let rates = SHARE_FPS.iter().map(|&fps| {
            let view = view.clone();
            Radio::new(
                SharedString::from(format!("share-fps-{fps}")),
                format!("{fps} fps"),
                share.fps == fps,
            )
            .on_select(move |_, cx| {
                view.update(cx, |this, cx| {
                    this.change(cx, |state| state.share.fps = fps)
                })
                .ok();
            })
        });
        let audio_view = view.clone();
        section("Screen Share", cx)
            .child(text(Variant::Body2, "Resolution").text_color(sem.text_secondary))
            .child(div().flex().flex_wrap().gap_x(spacing(1.)).children(sizes))
            .child(text(Variant::Body2, "Frame rate").text_color(sem.text_secondary))
            .child(div().flex().flex_wrap().gap_x(spacing(1.)).children(rates))
            .child(switch_row(
                Switch::new("share-audio", "Share system audio", share.audio).on_change(
                    move |on, _, cx| {
                        audio_view
                            .update(cx, |this, cx| {
                                this.change(cx, |state| state.share.audio = on)
                            })
                            .ok();
                    },
                ),
                "Share system audio",
                Some("Everything you hear, except this call".into()),
                cx,
            ))
    }
}
