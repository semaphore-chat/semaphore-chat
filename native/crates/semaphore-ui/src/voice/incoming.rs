//! A DM call ringing for me, and the buttons that start one: the web's `IncomingCallBanner.tsx` and
//! `DMVoiceControls.tsx`.
//!
//! - [`incoming_call_banner`]: a full-width strip for the top of the window. The owner lays it out
//!   above the columns, so it pushes them down instead of covering a DM's own call button.
//! - [`dm_call_controls`]: "Start voice call" and "Start video call" for a DM header, or "In Call".

use crate::dms::face::user_face;
use crate::dms::names::user_name;
use crate::kit::{Action, Icon, Spinner, Variant, reduced_motion, text, with_tip};
use crate::theme::SemTheme;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{IncomingCallView, VoiceRoom, VoiceStatus, VoiceView};
use semaphore_design::Icon as IconName;
use std::time::Duration;

/// What the banner shows besides the call itself.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct IncomingProps {
    /// A group DM: the second line names the group. Core's `IncomingCallView` will carry it.
    pub is_group: bool,
    /// Accept was pressed and the join hasn't finished: a spinner, both buttons held.
    pub accepting: bool,
    /// Why accepting failed. The ring carries on, so trying again is one press.
    pub error: Option<String>,
    /// Phone and tablet: 44px targets.
    pub touch: bool,
}

pub struct IncomingActions {
    /// `Core::accept_incoming_call`.
    pub on_accept: Action,
    /// `Core::decline_incoming_call`: local only, the caller isn't told.
    pub on_decline: Action,
}

/// The second line: "Incoming voice call", with the group's name for a group.
pub fn incoming_subtitle(call: &IncomingCallView, is_group: bool) -> String {
    if is_group && !call.group_name.is_empty() {
        format!("Incoming group call \u{b7} {}", call.group_name)
    } else {
        "Incoming voice call".to_owned()
    }
}

fn round_action(
    id: &'static str,
    glyph: IconName,
    label: &'static str,
    fill: Hsla,
    size: f32,
    (disabled, busy): (bool, bool),
    on_click: Action,
) -> impl IntoElement {
    let button = div()
        .id(id)
        .test_support()
        .size(px(size))
        .flex_shrink_0()
        .rounded_full()
        .flex()
        .items_center()
        .justify_center()
        .bg(fill)
        .role(Role::Button)
        .aria_label(label)
        .child(if busy {
            Spinner::new(SharedString::from(format!("{id}-busy")))
                .size(20.)
                .color(gpui_kit::white())
                .into_any_element()
        } else {
            Icon::new(glyph)
                .size(24.)
                .color(gpui_kit::white())
                .into_any_element()
        });
    let button = if disabled {
        button.opacity(0.6)
    } else {
        button
            .cursor_pointer()
            .hover(move |style| style.bg(fill.opacity(0.85)))
            .on_click(move |_, window, cx| on_click(window, cx))
    };
    with_tip(button, label)
}

pub fn incoming_call_banner(
    call: &IncomingCallView,
    props: &IncomingProps,
    actions: IncomingActions,
    cx: &App,
) -> impl IntoElement + use<> {
    let sem = cx.sem();
    let success = sem.success;
    let size = if props.touch { 44. } else { 40. };
    let name = user_name(&call.caller);
    let busy = props.accepting;
    let banner = div()
        .id("incoming-call")
        .test_support()
        .role(Role::Alert)
        .aria_label(format!(
            "{name}: {}",
            incoming_subtitle(call, props.is_group)
        ))
        .w_full()
        .flex_shrink_0()
        .flex()
        .items_center()
        .gap(px(16.))
        .px(px(if props.touch { 16. } else { 24. }))
        .py(px(12.))
        .bg(sem.paper)
        .border_b_2()
        .border_color(success)
        .shadow_md()
        .child(user_face(&call.caller, 40., None, cx))
        .child(
            div()
                .flex_1()
                .min_w_0()
                .flex()
                .flex_col()
                .child(
                    text(Variant::Subtitle1, name)
                        .font_weight(FontWeight::BOLD)
                        .text_color(sem.text_primary)
                        .truncate(),
                )
                .child(
                    text(Variant::Body2, incoming_subtitle(call, props.is_group))
                        .text_color(sem.text_secondary)
                        .truncate(),
                )
                .children(
                    props
                        .error
                        .clone()
                        .map(|error| text(Variant::Body2, error).text_color(sem.error).truncate()),
                ),
        )
        .child(
            div()
                .flex()
                .flex_shrink_0()
                .gap(px(8.))
                .child(round_action(
                    "incoming-accept",
                    IconName::Phone,
                    "Accept call",
                    success,
                    size,
                    (busy, busy),
                    actions.on_accept,
                ))
                .child(round_action(
                    "incoming-decline",
                    IconName::CallEnd,
                    "Decline call",
                    sem.error,
                    size,
                    (busy, false),
                    actions.on_decline,
                )),
        );
    // The web's pulse: a green ring that swells and fades. Held still when motion is off.
    let ring = move |spread: f32, alpha: f32| {
        vec![BoxShadow {
            color: success.opacity(alpha),
            offset: point(px(0.), px(0.)),
            blur_radius: px(0.),
            spread_radius: px(spread),
            inset: false,
        }]
    };
    if reduced_motion(cx) {
        banner.shadow(ring(2., 0.4)).into_any_element()
    } else {
        banner
            .with_animation(
                "incoming-pulse",
                Animation::new(Duration::from_secs(2)).repeat(),
                move |banner, delta| {
                    let swell = if delta < 0.5 { delta * 2. } else { 1. };
                    banner.shadow(ring(8. * swell, 0.7 * (1. - delta)))
                },
            )
            .into_any_element()
    }
}

/// Where this DM stands for calling, from the voice view.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DmCallState {
    /// The conversation hasn't loaded: a call needs its name.
    NotReady,
    Idle,
    /// Joining this DM's call.
    Joining,
    InThisCall,
    /// In another call, which has to be left first.
    InOtherCall,
}

impl DmCallState {
    pub fn of(voice: &VoiceView, dm_group_id: &str, ready: bool) -> Self {
        let here =
            matches!(&voice.room, Some(VoiceRoom::Dm { dm_group_id: id }) if id == dm_group_id);
        match voice.status {
            VoiceStatus::Disconnected if ready => Self::Idle,
            VoiceStatus::Disconnected => Self::NotReady,
            VoiceStatus::Connecting if here => Self::Joining,
            _ if here => Self::InThisCall,
            _ => Self::InOtherCall,
        }
    }
}

pub struct DmCallActions {
    /// `Core::join_dm_call`.
    pub on_voice: Action,
    /// `Core::join_dm_call`, then the camera on and the call shown.
    pub on_video: Action,
}

fn call_button(
    id: &'static str,
    glyph: IconName,
    label: &'static str,
    state: DmCallState,
    on_click: Action,
    cx: &App,
) -> impl IntoElement {
    let sem = cx.sem();
    let disabled = !matches!(state, DmCallState::Idle);
    let tip = if state == DmCallState::InOtherCall {
        "Leave current call first"
    } else {
        label
    };
    let hover = sem.icon_button_hover;
    let primary = sem.primary;
    let button = div()
        .id(id)
        .test_support()
        .size(px(34.))
        .flex_shrink_0()
        .rounded_full()
        .flex()
        .items_center()
        .justify_center()
        .role(Role::Button)
        .aria_label(tip)
        .child(if state == DmCallState::Joining {
            Spinner::new(SharedString::from(format!("{id}-busy")))
                .size(20.)
                .into_any_element()
        } else {
            Icon::new(glyph)
                .size(20.)
                .color(if disabled {
                    sem.action_disabled
                } else {
                    sem.text_secondary
                })
                .into_any_element()
        });
    let button = if disabled {
        button
    } else {
        button
            .cursor_pointer()
            .hover(move |style| style.bg(hover).text_color(primary))
            .on_click(move |_, window, cx| on_click(window, cx))
    };
    with_tip(button, tip)
}

pub fn dm_call_controls(
    state: DmCallState,
    actions: DmCallActions,
    cx: &App,
) -> impl IntoElement + use<> {
    if state == DmCallState::InThisCall {
        let sem = cx.sem();
        let success = sem.success;
        // MUI's success chip: dark text on the light green of a dark theme.
        let ink = if sem.is_dark {
            hsla(0., 0., 0., 0.87)
        } else {
            gpui_kit::white()
        };
        return div()
            .id("dm-call-in-call")
            .test_support()
            .flex()
            .items_center()
            .gap(px(4.))
            .h(px(24.))
            .px(px(8.))
            .rounded_full()
            .bg(success)
            .text_color(ink)
            .child(Icon::new(IconName::Phone).size(16.).color(ink))
            .child(text(Variant::Body2, "In Call").font_weight(FontWeight::MEDIUM))
            .into_any_element();
    }
    div()
        .flex()
        .items_center()
        .gap(px(4.))
        .child(call_button(
            "dm-call-voice",
            IconName::Phone,
            "Start voice call",
            state,
            actions.on_voice,
            cx,
        ))
        .child(call_button(
            "dm-call-video",
            IconName::Videocam,
            "Start video call",
            state,
            actions.on_video,
            cx,
        ))
        .into_any_element()
}

#[cfg(test)]
mod tests {
    use super::*;
    use semaphore_core::model::UserView;
    use std::prelude::rust_2024::test;

    fn call(group: &str) -> IncomingCallView {
        IncomingCallView {
            dm_group_id: "dm-1".into(),
            group_name: group.into(),
            caller: UserView {
                id: "u1".into(),
                username: "ava".into(),
                display_name: Some("Ava".into()),
                avatar_file_id: None,
            },
            is_group: false,
            started_at_ms: 0,
            expires_at_ms: 30_000,
        }
    }

    #[test]
    fn a_group_call_names_the_group() {
        assert_eq!(
            incoming_subtitle(&call("Ava"), false),
            "Incoming voice call"
        );
        assert_eq!(
            incoming_subtitle(&call("Weekend plans"), true),
            "Incoming group call \u{b7} Weekend plans"
        );
    }

    #[test]
    fn dm_call_state_follows_the_voice_view() {
        let mut voice = VoiceView::default();
        assert_eq!(
            DmCallState::of(&voice, "dm-1", false),
            DmCallState::NotReady
        );
        assert_eq!(DmCallState::of(&voice, "dm-1", true), DmCallState::Idle);
        voice.status = VoiceStatus::Connecting;
        voice.room = Some(VoiceRoom::Dm {
            dm_group_id: "dm-1".into(),
        });
        assert_eq!(DmCallState::of(&voice, "dm-1", true), DmCallState::Joining);
        voice.status = VoiceStatus::Connected;
        assert_eq!(
            DmCallState::of(&voice, "dm-1", true),
            DmCallState::InThisCall
        );
        assert_eq!(
            DmCallState::of(&voice, "dm-2", true),
            DmCallState::InOtherCall
        );
        voice.room = Some(VoiceRoom::Channel {
            channel_id: "c".into(),
            community_id: None,
        });
        assert_eq!(
            DmCallState::of(&voice, "dm-1", true),
            DmCallState::InOtherCall
        );
    }
}
