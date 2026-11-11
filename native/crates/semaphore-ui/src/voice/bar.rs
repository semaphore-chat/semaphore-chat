//! The bar along the bottom of a call: where you are, how the connection is, and the controls.

use super::icons::{self, VoiceIcon, icon};
use super::model::{
    ShareLook, VoiceController, VoiceStageModel, bar_subtitle, camera_label, screen_label,
};
use super::stage::quality_bars;
use super::theme::{self, alpha};
use gpui_kit::*;
use semaphore_core::model::VoiceStatus;
use std::sync::Arc;

#[derive(Clone, Copy)]
struct ButtonStyle {
    icon: Hsla,
    fill: Option<Hsla>,
    hover: Hsla,
    disabled: bool,
}

fn plain() -> ButtonStyle {
    ButtonStyle {
        icon: theme::white(),
        fill: None,
        hover: theme::action_hover(),
        disabled: false,
    }
}

fn round_button(
    id: &'static str,
    glyph: VoiceIcon,
    style: ButtonStyle,
    glow: bool,
    on_click: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
) -> Stateful<Div> {
    let mut button = div()
        .id(id)
        .size(px(40.))
        .flex_shrink_0()
        .rounded_full()
        .flex()
        .items_center()
        .justify_center()
        .child(icon(
            glyph,
            px(24.),
            // A filled button that can't be pressed is busy, not unavailable: it keeps its glyph.
            if style.disabled && style.fill.is_none() {
                theme::text_disabled()
            } else {
                style.icon
            },
        ));
    if let Some(fill) = style.fill {
        button = button.bg(fill);
    }
    if glow {
        button = button.shadow(vec![BoxShadow {
            color: theme::positive(),
            offset: point(px(0.), px(0.)),
            blur_radius: px(8.),
            spread_radius: px(0.),
            inset: false,
        }]);
    }
    if style.disabled {
        button
    } else {
        button
            .cursor_pointer()
            .hover(move |s| s.bg(style.hover))
            .on_click(on_click)
    }
}

/// A camera or screen button in one of `ShareLook`'s states.
fn share_button(
    id: &'static str,
    glyph: VoiceIcon,
    look: ShareLook,
    label: &'static str,
    toggle: impl Fn() + 'static,
) -> impl IntoElement {
    let style = match look {
        ShareLook::Off => plain(),
        ShareLook::Starting => ButtonStyle {
            icon: theme::white(),
            fill: Some(alpha(theme::primary(), 0.5)),
            hover: alpha(theme::primary(), 0.5),
            disabled: true,
        },
        ShareLook::On => ButtonStyle {
            icon: theme::white(),
            fill: Some(theme::primary()),
            hover: alpha(theme::primary(), 0.8),
            disabled: false,
        },
        ShareLook::Failed => ButtonStyle {
            icon: theme::error_main(),
            fill: None,
            hover: alpha(theme::error_main(), 0.2),
            disabled: false,
        },
        ShareLook::NotAllowed => ButtonStyle {
            disabled: true,
            ..plain()
        },
    };
    let mut button = round_button(id, glyph, style, false, move |_, _, _| toggle());
    if look == ShareLook::Starting {
        // Dimmed, but still the white glyph: it's on its way, not unavailable.
        button = button.opacity(0.7);
    }
    if look == ShareLook::Failed {
        button = button.border_2().border_color(theme::error_main());
    }
    button.role(Role::Button).aria_label(label).test_support()
}

fn vertical_divider() -> impl IntoElement {
    div().w(px(1.)).h(px(32.)).mx(px(8.)).bg(theme::divider())
}

pub(super) fn voice_bar(
    model: &VoiceStageModel,
    narrow: bool,
    controller: Arc<dyn VoiceController>,
) -> impl IntoElement {
    let voice = &model.voice;
    let name: SharedString = if model.channel_name.is_empty() {
        if model.is_dm {
            "Direct Message"
        } else {
            "Voice Channel"
        }
        .into()
    } else {
        model.channel_name.clone().into()
    };
    let subtitle: SharedString = bar_subtitle(model).into();
    let reconnecting = model
        .reconnect_attempt
        .or((voice.status == VoiceStatus::Reconnecting).then_some(1));
    let me_speaking = voice
        .participants
        .iter()
        .any(|participant| participant.is_self && participant.speaking);
    let ptt_held = model.ptt.as_ref().is_some_and(|ptt| ptt.held);

    let status = reconnecting.map(|attempt| {
        let leave = controller.clone();
        div()
            .flex()
            .items_center()
            .gap(px(4.))
            .min_w_0()
            .child(
                div()
                    .size(px(10.))
                    .flex_shrink_0()
                    .rounded_full()
                    .border_2()
                    .border_color(theme::warning()),
            )
            .child(
                div()
                    .text_xs()
                    .text_color(theme::warning())
                    .truncate()
                    .child(format!("Reconnecting voice ({attempt})\u{2026}")),
            )
            .child(
                div()
                    .id("voice-cancel-reconnect")
                    .text_xs()
                    .px(px(4.))
                    .flex_shrink_0()
                    .rounded(px(4.))
                    .text_color(theme::primary())
                    .cursor_pointer()
                    .hover(|s| s.bg(theme::action_hover()))
                    .on_click(move |_, _, _| leave.leave())
                    .child("Cancel"),
            )
    });

    let info = div()
        .flex()
        .items_center()
        .gap(px(if narrow { 4. } else { 16. }))
        .flex_1()
        .min_w_0()
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(if narrow { 4. } else { 8. }))
                .min_w_0()
                .pl(px(if narrow { 8. } else { 0. }))
                .child(icon(
                    icons::VOLUME_UP,
                    px(if narrow { 20. } else { 24. }),
                    theme::primary(),
                ))
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .min_w_0()
                        .child(
                            div()
                                .text_sm()
                                .font_weight(FontWeight::MEDIUM)
                                .text_color(theme::white())
                                .truncate()
                                .child(name),
                        )
                        .children(if narrow {
                            None
                        } else {
                            Some(match status {
                                Some(status) => status.into_any_element(),
                                None => div()
                                    .text_xs()
                                    .text_color(theme::text_secondary())
                                    .truncate()
                                    .child(subtitle)
                                    .into_any_element(),
                            })
                        }),
                ),
        )
        .children((!narrow).then(|| {
            quality_bars(if reconnecting.is_some() {
                super::model::QualityLevel::Poor
            } else {
                model.local_quality
            })
        }));

    // Muted reads as red-filled, deafened too; PTT held turns the mic green.
    let mic_style = if ptt_held {
        ButtonStyle {
            icon: theme::white(),
            fill: Some(theme::positive()),
            hover: theme::positive(),
            disabled: false,
        }
    } else if voice.muted {
        ButtonStyle {
            icon: theme::white(),
            fill: Some(theme::error_main()),
            hover: alpha(theme::error_main(), 0.8),
            disabled: false,
        }
    } else {
        plain()
    };
    let muted = voice.muted;
    let mic_controller = controller.clone();
    let push_to_talk = model.ptt.is_some();
    let mut mic = round_button(
        "voice-mic",
        if voice.muted && !ptt_held {
            icons::MIC_OFF
        } else {
            icons::MIC
        },
        mic_style,
        me_speaking && !voice.muted,
        // With push-to-talk the key decides, as on the web. A tap must not silently unmute.
        move |_, _, _| {
            if !push_to_talk {
                mic_controller.set_muted(!muted);
            }
        },
    );
    // Hold-to-talk with no keyboard to hold: the web gives touch screens this, and here it's free.
    if push_to_talk {
        let press = controller.clone();
        let release = controller.clone();
        mic = mic
            .on_mouse_down(MouseButton::Left, move |_, _, _| press.ptt_pressed(true))
            .on_mouse_up(MouseButton::Left, move |_, _, _| release.ptt_pressed(false));
    }

    let deafened = voice.deafened;
    let deafen_controller = controller.clone();
    let deafen = round_button(
        "voice-deafen",
        if deafened {
            icons::HEADSET_OFF
        } else {
            icons::HEADSET
        },
        if deafened {
            ButtonStyle {
                icon: theme::white(),
                fill: Some(theme::error_main()),
                hover: alpha(theme::error_main(), 0.8),
                disabled: false,
            }
        } else {
            plain()
        },
        false,
        move |_, _, _| deafen_controller.set_deafened(!deafened),
    );

    let local = &voice.local;
    let camera_look = ShareLook::of(&local.camera, local.may_camera);
    let camera_controller = controller.clone();
    let camera = share_button(
        "voice-camera",
        if camera_look == ShareLook::On {
            icons::VIDEOCAM
        } else {
            icons::VIDEOCAM_OFF
        },
        camera_look,
        camera_label(camera_look),
        move || camera_controller.set_camera(camera_look != ShareLook::On),
    );
    let screen_look = ShareLook::of(&local.screen, local.may_share);
    let screen_controller = controller.clone();
    let screen = share_button(
        "voice-share",
        if screen_look == ShareLook::On {
            icons::STOP_SCREEN_SHARE
        } else {
            icons::SCREEN_SHARE
        },
        screen_look,
        screen_label(screen_look),
        move || screen_controller.toggle_screen_share(),
    );

    let leave_controller = controller.clone();
    let leave = round_button(
        "voice-leave",
        icons::CALL_END,
        if narrow {
            ButtonStyle {
                icon: theme::white(),
                fill: Some(theme::error_main()),
                hover: alpha(theme::error_main(), 0.8),
                disabled: false,
            }
        } else {
            ButtonStyle {
                icon: theme::error_main(),
                fill: None,
                hover: alpha(theme::error_main(), 0.2),
                disabled: false,
            }
        },
        false,
        move |_, _, _| leave_controller.leave(),
    );

    let settings_controller = controller.clone();
    let mut controls = div()
        .flex()
        .items_center()
        .flex_shrink_0()
        .gap(px(if narrow { 2. } else { 8. }))
        .child(mic.test_support())
        .child(deafen.test_support());
    if !narrow {
        controls = controls.child(vertical_divider());
    }
    controls = controls.child(camera);
    if narrow {
        // Screen share lives in "more" here: there's no room for it on a phone-width bar.
        let more_controller = controller.clone();
        controls = controls.child(
            round_button(
                "voice-more",
                icons::MORE_HORIZ,
                plain(),
                false,
                move |_, _, _| more_controller.open_more(),
            )
            .role(Role::Button)
            .aria_label("More call options")
            .test_support(),
        );
    } else {
        controls = controls
            .child(screen)
            .child(vertical_divider())
            .child(
                round_button(
                    "voice-settings",
                    icons::SETTINGS,
                    plain(),
                    false,
                    move |_, _, _| settings_controller.open_settings(),
                )
                .role(Role::Button)
                .aria_label("Voice settings")
                .test_support(),
            )
            .child(vertical_divider());
    }
    controls = controls.child(leave.test_support());

    let row = div()
        .flex()
        .items_center()
        .justify_between()
        .px(px(if narrow { 4. } else { 24. }))
        .py(px(if narrow { 8. } else { 12. }))
        .min_h(px(if narrow { 72. } else { 64. }))
        .gap(px(if narrow { 0. } else { 8. }))
        .child(info)
        .child(controls);

    // On a phone the name column is too narrow for this, and Cancel needs a real target.
    let touch_row = if narrow {
        reconnecting.map(|attempt| {
            let leave = controller.clone();
            div()
                .flex()
                .items_center()
                .gap(px(4.))
                .px(px(12.))
                .min_h(px(44.))
                .border_b_1()
                .border_color(theme::divider())
                .child(
                    div()
                        .size(px(10.))
                        .flex_shrink_0()
                        .rounded_full()
                        .border_2()
                        .border_color(theme::warning()),
                )
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .text_xs()
                        .text_color(theme::warning())
                        .truncate()
                        .child(format!("Reconnecting voice ({attempt})\u{2026}")),
                )
                .child(
                    div()
                        .id("voice-cancel-reconnect-touch")
                        .flex()
                        .items_center()
                        .min_h(px(44.))
                        .px(px(8.))
                        .text_xs()
                        .text_color(theme::primary())
                        .cursor_pointer()
                        .on_click(move |_, _, _| leave.leave())
                        .child("Cancel"),
                )
        })
    } else {
        None
    };

    div()
        .flex_shrink_0()
        .w_full()
        .bg(theme::paper())
        .border_t_1()
        .border_color(theme::divider())
        .children(touch_row)
        .child(row)
}
