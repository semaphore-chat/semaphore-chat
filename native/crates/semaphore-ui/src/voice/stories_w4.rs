//! W4 stories: the incoming call, DM call buttons, the participant menu and kick confirm, server
//! mutes, the soundboard, the float card and its dock zones, and the debug panel.

use super::debug::{DebugActions, voice_debug_panel};
use super::dock::PipPlacement;
use super::float::FloatCard;
use super::frames::VideoFrames;
use super::incoming::{
    DmCallActions, DmCallState, IncomingActions, IncomingProps, dm_call_controls,
    incoming_call_banner,
};
use super::menu::{ParticipantMenu, ParticipantMenuModel};
use super::model::{NoController, VoiceStageModel};
use super::soundboard::SoundboardBar;
use super::stories::{camera, model, person, push_cards, stage_entity};
use crate::kit::{Variant, text};
use crate::stories::{Story, StoryEnv};
use crate::theme::SemTheme;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{
    ConnectionQuality, ErrorView, IncomingCallView, JoinFailure, JoinFailureClass, LoadState,
    MediaDiagnostics, ParticipantView, SoundboardSound, SoundboardView, UserView, VideoTrackView,
    VoiceDiagnosticEvent, VoiceDiagnosticsView, VoiceModerationCaps, VoiceStatus, VoiceView,
};
use std::rc::Rc;
use std::sync::Arc;

type Build = Box<dyn Fn(&mut Window, &mut App) -> AnyElement>;

/// Draws whatever `build` makes, on the page's background.
struct Frame {
    build: Build,
}

impl Render for Frame {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let sem = cx.sem();
        div()
            .size_full()
            .relative()
            .bg(sem.background_default)
            .text_color(sem.text_primary)
            .child((self.build)(window, cx))
    }
}

fn frame(cx: &mut App, build: impl Fn(&mut Window, &mut App) -> AnyElement + 'static) -> AnyView {
    cx.new(|_| Frame {
        build: Box::new(build),
    })
    .into()
}

fn noop() -> crate::kit::Action {
    Rc::new(|_, _| {})
}

fn is_phone(window: &Window) -> bool {
    f32::from(window.viewport_size().width) < 600.
}

/// A page under a strip: the strip, then something that reads as the app.
fn page_under(strip: AnyElement, cx: &App) -> AnyElement {
    let sem = cx.sem();
    div()
        .size_full()
        .flex()
        .flex_col()
        .child(strip)
        .child(
            div()
                .flex_1()
                .flex()
                .items_center()
                .justify_center()
                .text_color(sem.text_disabled)
                .child("Conversation"),
        )
        .into_any_element()
}

// Incoming call.

fn caller(name: &str, avatar: bool) -> UserView {
    let key = name.to_lowercase().replace(' ', "-");
    UserView {
        id: format!("u-{key}"),
        username: key.clone(),
        display_name: Some(name.to_owned()),
        avatar_file_id: avatar.then(|| format!("avatar:{key}:{}", name.replace(' ', "%20"))),
    }
}

fn ring(group: &str, from: UserView) -> IncomingCallView {
    IncomingCallView {
        dm_group_id: "dm-1".into(),
        group_name: group.into(),
        caller: from,
        is_group: false,
        started_at_ms: 0,
        expires_at_ms: 30_000,
    }
}

fn incoming(cx: &mut App, call: IncomingCallView, props: IncomingProps) -> AnyView {
    frame(cx, move |window, cx| {
        let props = IncomingProps {
            touch: is_phone(window),
            ..props.clone()
        };
        let banner = incoming_call_banner(
            &call,
            &props,
            IncomingActions {
                on_accept: noop(),
                on_decline: noop(),
            },
            cx,
        )
        .into_any_element();
        page_under(banner, cx)
    })
}

fn incoming_one(_: &StoryEnv, _: &mut Window, cx: &mut App) -> AnyView {
    let ava = caller("Ava Chen", true);
    incoming(cx, ring("Ava Chen", ava), IncomingProps::default())
}

fn incoming_group(_: &StoryEnv, _: &mut Window, cx: &mut App) -> AnyView {
    incoming(
        cx,
        ring("Weekend plans", caller("Devraj Patel", true)),
        IncomingProps {
            is_group: true,
            ..IncomingProps::default()
        },
    )
}

fn incoming_long(_: &StoryEnv, _: &mut Window, cx: &mut App) -> AnyView {
    incoming(
        cx,
        ring(
            "A group with a name that goes on far longer than any banner could hold",
            caller(
                "Someone With An Unreasonably Long Display Name Indeed",
                false,
            ),
        ),
        IncomingProps {
            is_group: true,
            ..IncomingProps::default()
        },
    )
}

fn incoming_accepting(_: &StoryEnv, _: &mut Window, cx: &mut App) -> AnyView {
    incoming(
        cx,
        ring("Ava Chen", caller("Ava Chen", true)),
        IncomingProps {
            accepting: true,
            ..IncomingProps::default()
        },
    )
}

fn incoming_error(_: &StoryEnv, _: &mut Window, cx: &mut App) -> AnyView {
    incoming(
        cx,
        ring("Ava Chen", caller("Ava Chen", true)),
        IncomingProps {
            error: Some("Couldn't join the call: the media server didn't answer".into()),
            ..IncomingProps::default()
        },
    )
}

// DM call buttons.

fn dm_controls(_: &StoryEnv, _: &mut Window, cx: &mut App) -> AnyView {
    frame(cx, |_, cx| {
        let sem = cx.sem().clone();
        let states = [
            ("Idle", DmCallState::Idle),
            ("Joining", DmCallState::Joining),
            ("In this call", DmCallState::InThisCall),
            ("In another call", DmCallState::InOtherCall),
            ("Not loaded", DmCallState::NotReady),
        ];
        div()
            .p(px(24.))
            .flex()
            .flex_col()
            .gap(px(8.))
            .children(states.into_iter().map(|(label, state)| {
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .max_w(px(420.))
                    .h(px(48.))
                    .px(px(16.))
                    .bg(sem.paper)
                    .border_b_1()
                    .border_color(sem.divider)
                    .child(text(Variant::Subtitle1, label).text_color(sem.text_primary))
                    .child(dm_call_controls(
                        state,
                        DmCallActions {
                            on_voice: noop(),
                            on_video: noop(),
                        },
                        cx,
                    ))
            }))
            .into_any_element()
    })
}

// The participant menu, over the call.

fn people() -> Vec<ParticipantView> {
    let mut people: Vec<_> = (0..4).map(person).collect();
    people[1].speaking = true;
    people[2].muted = true;
    people
}

struct MenuFrame {
    stage: AnyView,
    menu: Entity<ParticipantMenu>,
}

impl Render for MenuFrame {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div()
            .size_full()
            .relative()
            .child(self.stage.clone())
            .child(self.menu.clone())
    }
}

fn menu_story(
    target: ParticipantView,
    volume_percent: u32,
    caps: VoiceModerationCaps,
    in_channel: bool,
    kick: Option<(&'static str, bool, Option<&'static str>)>,
    window: &mut Window,
    cx: &mut App,
) -> AnyView {
    let mut call = model(people());
    if !in_channel {
        call.is_dm = true;
        call.channel_name = "Ava Chen".into();
    }
    if let Some(found) = call
        .voice
        .participants
        .iter_mut()
        .find(|p| p.identity == target.identity)
    {
        *found = target.clone();
    }
    let stage = stage_entity(call, window, cx).into();
    let phone = is_phone(window);
    let menu = cx.new(|cx| {
        let mut menu = ParticipantMenu::new(
            ParticipantMenuModel {
                participant: target,
                volume_percent,
                caps,
                in_channel,
            },
            point(px(if phone { 80. } else { 360. }), px(140.)),
            window,
            cx,
        );
        if let Some((reason, busy, error)) = kick {
            menu.open_kick_confirm(window, cx);
            menu.set_kick_reason(reason, window, cx);
            menu.set_kick_busy(busy, cx);
            if let Some(error) = error {
                menu.set_kick_error(Some(error.into()), cx);
            }
        }
        menu
    });
    cx.new(|_| MenuFrame { stage, menu }).into()
}

const MODERATOR: VoiceModerationCaps = VoiceModerationCaps {
    can_server_mute: true,
    can_kick: true,
};
const MEMBER: VoiceModerationCaps = VoiceModerationCaps {
    can_server_mute: false,
    can_kick: false,
};

fn menu_member(_: &StoryEnv, window: &mut Window, cx: &mut App) -> AnyView {
    menu_story(person(2), 100, MEMBER, true, None, window, cx)
}

fn menu_self(_: &StoryEnv, window: &mut Window, cx: &mut App) -> AnyView {
    menu_story(person(0), 100, MODERATOR, true, None, window, cx)
}

fn menu_moderator(_: &StoryEnv, window: &mut Window, cx: &mut App) -> AnyView {
    menu_story(person(2), 100, MODERATOR, true, None, window, cx)
}

fn menu_server_muted(_: &StoryEnv, window: &mut Window, cx: &mut App) -> AnyView {
    let mut target = person(2);
    target.server_muted = true;
    target.muted = true;
    menu_story(target, 100, MODERATOR, true, None, window, cx)
}

fn menu_mute_only(_: &StoryEnv, window: &mut Window, cx: &mut App) -> AnyView {
    let caps = VoiceModerationCaps {
        can_server_mute: true,
        can_kick: false,
    };
    menu_story(person(2), 100, caps, true, None, window, cx)
}

fn menu_kick_only(_: &StoryEnv, window: &mut Window, cx: &mut App) -> AnyView {
    let caps = VoiceModerationCaps {
        can_server_mute: false,
        can_kick: true,
    };
    menu_story(person(2), 100, caps, true, None, window, cx)
}

fn menu_silenced(_: &StoryEnv, window: &mut Window, cx: &mut App) -> AnyView {
    menu_story(person(2), 0, MEMBER, true, None, window, cx)
}

fn menu_loud(_: &StoryEnv, window: &mut Window, cx: &mut App) -> AnyView {
    menu_story(person(2), 200, MEMBER, true, None, window, cx)
}

fn menu_dm(_: &StoryEnv, window: &mut Window, cx: &mut App) -> AnyView {
    menu_story(person(1), 100, MODERATOR, false, None, window, cx)
}

fn kick_confirm(_: &StoryEnv, window: &mut Window, cx: &mut App) -> AnyView {
    menu_story(
        person(2),
        100,
        MODERATOR,
        true,
        Some(("", false, None)),
        window,
        cx,
    )
}

fn kick_reason(_: &StoryEnv, window: &mut Window, cx: &mut App) -> AnyView {
    menu_story(
        person(2),
        100,
        MODERATOR,
        true,
        Some(("Spamming the soundboard", false, None)),
        window,
        cx,
    )
}

fn kick_busy(_: &StoryEnv, window: &mut Window, cx: &mut App) -> AnyView {
    menu_story(
        person(2),
        100,
        MODERATOR,
        true,
        Some(("Spamming the soundboard", true, None)),
        window,
        cx,
    )
}

fn kick_error(_: &StoryEnv, window: &mut Window, cx: &mut App) -> AnyView {
    menu_story(
        person(2),
        100,
        MODERATOR,
        true,
        Some((
            "",
            false,
            Some("You can't kick someone with a role at or above yours."),
        )),
        window,
        cx,
    )
}

// Server mutes.

fn server_muted_me(_: &StoryEnv, window: &mut Window, cx: &mut App) -> AnyView {
    let mut people = people();
    people[0].server_muted = true;
    people[0].muted = true;
    let mut call = model(people);
    call.voice.server_muted = true;
    call.voice.muted = true;
    call.voice.local.may_speak = false;
    stage_entity(call, window, cx).into()
}

fn server_muted_others(_: &StoryEnv, window: &mut Window, cx: &mut App) -> AnyView {
    let mut people: Vec<_> = (0..8).map(person).collect();
    people[1].server_muted = true;
    people[1].muted = true;
    people[2].muted = true;
    people[3].server_muted = true;
    people[3].deafened = true;
    people[4].camera = camera(4);
    people[4].server_muted = true;
    stage_entity(model(people), window, cx).into()
}

// The replay buffer recording a share: Capture on the bar, the dot on the share button (in "more"
// at phone width).

fn bar_recording(_: &StoryEnv, window: &mut Window, cx: &mut App) -> AnyView {
    let mut model = model(people());
    model.voice.local.screen = semaphore_core::model::LocalShare::On;
    model.voice.local.may_share = true;
    model.voice.replay = semaphore_core::model::ReplayState::Recording {
        session_id: "session-1".into(),
    };
    let stage = stage_entity(model, window, cx);
    stage.update(cx, |stage, cx| {
        stage.set_soundboard(
            SoundboardBar {
                view: Some(board(LoadState::Ready, some_sounds())),
                open: false,
            },
            cx,
        )
    });
    stage.into()
}

// The soundboard, open over the bar.

fn sound(index: usize, name: &str, emoji: Option<&str>) -> SoundboardSound {
    SoundboardSound {
        id: format!("s{index}"),
        name: name.into(),
        emoji: emoji.map(str::to_owned),
        file_id: format!("file-s{index}"),
    }
}

fn some_sounds() -> Vec<SoundboardSound> {
    vec![
        sound(1, "Airhorn", Some("\u{1f4ef}")),
        sound(2, "Applause", Some("\u{1f44f}")),
        sound(3, "Drum roll", Some("\u{1f941}")),
        sound(4, "Sad trombone", Some("\u{1f3ba}")),
        sound(5, "Bruh", None),
    ]
}

fn soundboard_story(view: SoundboardView, window: &mut Window, cx: &mut App) -> AnyView {
    let stage = stage_entity(model(people()), window, cx);
    stage.update(cx, |stage, cx| {
        stage.set_soundboard(
            SoundboardBar {
                view: Some(view),
                open: true,
            },
            cx,
        )
    });
    stage.into()
}

fn board(state: LoadState, sounds: Vec<SoundboardSound>) -> SoundboardView {
    SoundboardView {
        community_id: "c1".into(),
        state,
        sounds,
        playing: None,
        error: None,
    }
}

fn failure(message: &str) -> ErrorView {
    ErrorView {
        code: "network".into(),
        message: message.into(),
        retryable: true,
        retry_after_ms: None,
    }
}

fn soundboard_loading(_: &StoryEnv, window: &mut Window, cx: &mut App) -> AnyView {
    soundboard_story(board(LoadState::Loading, Vec::new()), window, cx)
}

fn soundboard_empty(_: &StoryEnv, window: &mut Window, cx: &mut App) -> AnyView {
    soundboard_story(board(LoadState::Ready, Vec::new()), window, cx)
}

fn soundboard_error(_: &StoryEnv, window: &mut Window, cx: &mut App) -> AnyView {
    soundboard_story(
        board(
            LoadState::Failed {
                error: failure("The server didn't answer"),
            },
            Vec::new(),
        ),
        window,
        cx,
    )
}

fn soundboard_grid(_: &StoryEnv, window: &mut Window, cx: &mut App) -> AnyView {
    soundboard_story(board(LoadState::Ready, some_sounds()), window, cx)
}

fn soundboard_many(_: &StoryEnv, window: &mut Window, cx: &mut App) -> AnyView {
    let sounds = (0..20)
        .map(|index| {
            sound(
                index,
                &format!("A sound with a really long name number {index}"),
                (index % 3 != 0).then_some("\u{1f3b5}"),
            )
        })
        .collect();
    soundboard_story(board(LoadState::Ready, sounds), window, cx)
}

fn soundboard_starting(_: &StoryEnv, window: &mut Window, cx: &mut App) -> AnyView {
    let mut view = board(LoadState::Ready, some_sounds());
    view.playing = Some("s2".into());
    soundboard_story(view, window, cx)
}

fn soundboard_play_error(_: &StoryEnv, window: &mut Window, cx: &mut App) -> AnyView {
    let mut view = board(LoadState::Ready, some_sounds());
    view.error = Some(failure("the call refused the soundboard track"));
    soundboard_story(view, window, cx)
}

fn soundboard_closed(_: &StoryEnv, window: &mut Window, cx: &mut App) -> AnyView {
    let stage = stage_entity(model(people()), window, cx);
    stage.update(cx, |stage, cx| {
        stage.set_soundboard(
            SoundboardBar {
                view: Some(board(LoadState::Ready, some_sounds())),
                open: false,
            },
            cx,
        )
    });
    stage.into()
}

// The float card over a message column.

struct FloatFrame {
    card: Entity<FloatCard>,
}

impl Render for FloatFrame {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let sem = cx.sem().clone();
        let line = |width: f32| {
            div()
                .h(px(12.))
                .w(relative(width))
                .rounded(px(6.))
                .bg(sem.text_disabled.opacity(0.25))
        };
        div()
            .size_full()
            .relative()
            .bg(sem.background_default)
            .child(
                div()
                    .size_full()
                    .flex()
                    .flex_col()
                    .gap(px(18.))
                    .p(px(24.))
                    .children((0..12).map(move |index| line([0.6, 0.85, 0.4, 0.7][index % 4]))),
            )
            .child(self.card.clone())
    }
}

fn float_story(
    call: VoiceStageModel,
    placement: PipPlacement,
    drag: Option<(f32, f32)>,
    window: &mut Window,
    cx: &mut App,
) -> AnyView {
    let frames = VideoFrames::for_window(window);
    push_cards(&frames, &call);
    let card =
        cx.new(|cx| FloatCard::new(call, frames, Arc::new(NoController), placement, window, cx));
    if drag.is_some() {
        // Held until the card has measured its area on its first paint.
        card.update(cx, |card, cx| card.preview_drag(drag, cx));
    }
    cx.new(|_| FloatFrame { card }).into()
}

fn float_avatar(_: &StoryEnv, window: &mut Window, cx: &mut App) -> AnyView {
    float_story(model(people()), PipPlacement::default(), None, window, cx)
}

fn float_camera(_: &StoryEnv, window: &mut Window, cx: &mut App) -> AnyView {
    let mut people = people();
    people[1].camera = camera(1);
    float_story(model(people), PipPlacement::default(), None, window, cx)
}

fn float_screen(_: &StoryEnv, window: &mut Window, cx: &mut App) -> AnyView {
    let mut people = people();
    people[2].screen_share = Some(VideoTrackView {
        track_sid: "TR_screen2".into(),
        width: 1920,
        height: 1080,
    });
    let placement = PipPlacement {
        anchor: super::dock::PipAnchor::TopRight,
        ..PipPlacement::default()
    };
    float_story(model(people), placement, None, window, cx)
}

fn float_server_muted(_: &StoryEnv, window: &mut Window, cx: &mut App) -> AnyView {
    let mut call = model(people());
    call.voice.server_muted = true;
    call.voice.muted = true;
    float_story(call, PipPlacement::default(), None, window, cx)
}

fn float_pill(_: &StoryEnv, window: &mut Window, cx: &mut App) -> AnyView {
    let placement = PipPlacement {
        collapsed: true,
        ..PipPlacement::default()
    };
    float_story(model(people()), placement, None, window, cx)
}

fn float_long_name(_: &StoryEnv, window: &mut Window, cx: &mut App) -> AnyView {
    let mut call = model(people());
    call.channel_name =
        "a voice channel with a name that runs right off the end of the card".into();
    let placement = PipPlacement {
        anchor: super::dock::PipAnchor::BottomLeft,
        ..PipPlacement::default()
    };
    float_story(call, placement, None, window, cx)
}

fn float_long_name_pill(_: &StoryEnv, window: &mut Window, cx: &mut App) -> AnyView {
    let mut call = model(people());
    call.channel_name =
        "a voice channel with a name that runs right off the end of the pill".into();
    let placement = PipPlacement {
        collapsed: true,
        ..PipPlacement::default()
    };
    float_story(call, placement, None, window, cx)
}

fn float_drag(_: &StoryEnv, window: &mut Window, cx: &mut App) -> AnyView {
    float_story(
        model(people()),
        PipPlacement::default(),
        Some((60., 60.)),
        window,
        cx,
    )
}

fn float_drag_free(_: &StoryEnv, window: &mut Window, cx: &mut App) -> AnyView {
    let size = window.viewport_size();
    float_story(
        model(people()),
        PipPlacement::default(),
        Some((f32::from(size.width) / 2., f32::from(size.height) / 2.)),
        window,
        cx,
    )
}

// The debug panel.

fn diagnostics(status: VoiceStatus) -> VoiceDiagnosticsView {
    VoiceDiagnosticsView {
        status,
        server_host: Some("livekit.example.org".into()),
        media: Some(MediaDiagnostics {
            candidate_types: vec!["host".into(), "srflx".into()],
            rtt_ms: Some(42),
            packet_loss_pct: Some(0.4),
            audio_codec: Some("opus".into()),
            bitrate_in_kbps: Some(96),
            bitrate_out_kbps: Some(48),
        }),
        last_failure: None,
        events: vec![
            VoiceDiagnosticEvent {
                at_ms: 36_000_000,
                message: "Joining general-voice".into(),
            },
            VoiceDiagnosticEvent {
                at_ms: 36_001_250,
                message: "Connected to livekit.example.org".into(),
            },
            VoiceDiagnosticEvent {
                at_ms: 36_004_000,
                message: "Tobias Weber joined".into(),
            },
        ],
    }
}

fn debug_voice(status: VoiceStatus) -> VoiceView {
    let mut people = people();
    people[1].quality = ConnectionQuality::Excellent;
    people[2].quality = ConnectionQuality::Poor;
    people[3].quality = ConnectionQuality::Good;
    people[3].server_muted = true;
    people[0].quality = ConnectionQuality::Excellent;
    let mut voice = model(people).voice;
    voice.status = status;
    voice
}

fn debug_story(diag: VoiceDiagnosticsView, voice: VoiceView, cx: &mut App) -> AnyView {
    frame(cx, move |window, cx| {
        let phone = is_phone(window);
        let panel = voice_debug_panel(
            &diag,
            &voice,
            phone,
            DebugActions {
                on_refresh: noop(),
                on_copy: noop(),
                on_close: noop(),
            },
            cx,
        );
        div()
            .size_full()
            .flex()
            .justify_end()
            .items_start()
            .when(!phone, |area| area.p(px(16.)))
            .child(panel)
            .into_any_element()
    })
}

fn debug_disconnected(_: &StoryEnv, _: &mut Window, cx: &mut App) -> AnyView {
    let diag = VoiceDiagnosticsView {
        server_host: None,
        media: None,
        events: Vec::new(),
        ..diagnostics(VoiceStatus::Disconnected)
    };
    debug_story(diag, VoiceView::default(), cx)
}

fn debug_connecting(_: &StoryEnv, _: &mut Window, cx: &mut App) -> AnyView {
    let diag = VoiceDiagnosticsView {
        media: None,
        ..diagnostics(VoiceStatus::Connecting)
    };
    let mut voice = debug_voice(VoiceStatus::Connecting);
    voice.participants.truncate(1);
    debug_story(diag, voice, cx)
}

fn debug_connected(_: &StoryEnv, _: &mut Window, cx: &mut App) -> AnyView {
    debug_story(
        diagnostics(VoiceStatus::Connected),
        debug_voice(VoiceStatus::Connected),
        cx,
    )
}

fn debug_failure(_: &StoryEnv, _: &mut Window, cx: &mut App) -> AnyView {
    let diag = VoiceDiagnosticsView {
        media: None,
        last_failure: Some(JoinFailure {
            class: JoinFailureClass::MediaUnreachable,
            message: "Couldn't reach the media server: ICE gathering timed out after 15 s".into(),
            duration_ms: 15_230,
            at_ms: 36_100_000,
        }),
        ..diagnostics(VoiceStatus::Disconnected)
    };
    let voice = VoiceView {
        error: Some("Couldn't reach the media server".into()),
        ..VoiceView::default()
    };
    debug_story(diag, voice, cx)
}

fn debug_long_log(_: &StoryEnv, _: &mut Window, cx: &mut App) -> AnyView {
    let mut diag = diagnostics(VoiceStatus::Reconnecting);
    diag.events = (0..80)
        .map(|index| VoiceDiagnosticEvent {
            at_ms: 36_000_000 + index * 1_500,
            message: if index % 7 == 0 {
                format!(
                    "Reconnect attempt {index}: signal connection closed before the room answered, \
                     trying again with a fresh token"
                )
            } else {
                format!("Track subscribed: TR_mic{index}")
            },
        })
        .collect();
    let mut voice = debug_voice(VoiceStatus::Reconnecting);
    voice.reconnect_attempt = Some(3);
    debug_story(diag, voice, cx)
}

pub fn stories() -> Vec<Story> {
    vec![
        Story::new("voice-incoming", incoming_one),
        Story::new("voice-incoming-group", incoming_group),
        Story::new("voice-incoming-long", incoming_long),
        Story::new("voice-incoming-accepting", incoming_accepting),
        Story::new("voice-incoming-error", incoming_error),
        Story::new("voice-dm-controls", dm_controls),
        Story::new("voice-menu-member", menu_member),
        Story::new("voice-menu-self", menu_self),
        Story::new("voice-menu-moderator", menu_moderator),
        Story::new("voice-menu-server-muted", menu_server_muted),
        Story::new("voice-menu-mute-only", menu_mute_only),
        Story::new("voice-menu-kick-only", menu_kick_only),
        Story::new("voice-menu-silenced", menu_silenced),
        Story::new("voice-menu-loud", menu_loud),
        Story::new("voice-menu-dm", menu_dm),
        Story::new("voice-kick-confirm", kick_confirm),
        Story::new("voice-kick-reason", kick_reason),
        Story::new("voice-kick-busy", kick_busy),
        Story::new("voice-kick-error", kick_error),
        Story::new("voice-server-muted-me", server_muted_me),
        Story::new("voice-server-muted-others", server_muted_others),
        Story::new("voice-bar-recording", bar_recording),
        Story::new("voice-soundboard-closed", soundboard_closed),
        Story::new("voice-soundboard-loading", soundboard_loading),
        Story::new("voice-soundboard-empty", soundboard_empty),
        Story::new("voice-soundboard-error", soundboard_error),
        Story::new("voice-soundboard-grid", soundboard_grid),
        Story::new("voice-soundboard-many", soundboard_many),
        Story::new("voice-soundboard-starting", soundboard_starting),
        Story::new("voice-soundboard-play-error", soundboard_play_error),
        Story::new("voice-float-avatar", float_avatar),
        Story::new("voice-float-camera", float_camera),
        Story::new("voice-float-screen", float_screen),
        Story::new("voice-float-server-muted", float_server_muted),
        Story::new("voice-float-pill", float_pill),
        Story::new("voice-float-long-name", float_long_name),
        Story::new("voice-float-long-name-pill", float_long_name_pill),
        Story::new("voice-float-drag", float_drag),
        Story::new("voice-float-drag-free", float_drag_free),
        Story::new("voice-debug-disconnected", debug_disconnected),
        Story::new("voice-debug-connecting", debug_connecting),
        Story::new("voice-debug-connected", debug_connected),
        Story::new("voice-debug-failure", debug_failure),
        Story::new("voice-debug-long-log", debug_long_log),
    ]
}
