//! W4 over the real transports: DM calls and the incoming call, server mute, kick, the
//! soundboard, the replay buffer, captures and clips, by `Core` on `HttpBackend` and
//! `SocketRealtime` against `semaphore-fake-server`'s showcase. The media engine is a stand-in that
//! connects at once; what it would report is handed to `Core::ingest_media` by the test.

mod common;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use async_trait::async_trait;
use common::until;
use semaphore_core::lifecycle::ConnectionState;
use semaphore_core::model::{
    CaptureRequest, ClipDestination, LoadState, LocalMediaView, LocalShare, ReplayMinutes,
    ReplayState, ScreenShareRequest, SessionState, ShareTracks, SoundCue, VideoDemand, VoiceRoom,
    VoiceStatus, VoiceView,
};
use semaphore_core::platform::{
    Clock, CoreError, CoreEvent, EventSink, MediaEngine, ScreenShareStarted, SecretStore,
};
use semaphore_core::{Core, Services};
use semaphore_fake_server::{FakeServer, Record, ScenarioSource, entity_uuid};
use semaphore_net::socket::SocketConfig;
use semaphore_net::{HttpBackend, SocketRealtime};

fn id(readable: &str) -> String {
    entity_uuid(readable)
}

#[derive(Default)]
struct MemSecrets(Mutex<HashMap<String, String>>);

impl SecretStore for MemSecrets {
    fn load(&self, key: String) -> Result<Option<String>, CoreError> {
        Ok(self.0.lock().unwrap().get(&key).cloned())
    }
    fn save(&self, key: String, value: String) -> Result<(), CoreError> {
        self.0.lock().unwrap().insert(key, value);
        Ok(())
    }
    fn delete(&self, key: String) -> Result<(), CoreError> {
        self.0.lock().unwrap().remove(&key);
        Ok(())
    }
}

struct WallClock;
impl Clock for WallClock {
    fn now_ms(&self) -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |elapsed| elapsed.as_millis() as u64)
    }
}

#[derive(Default)]
struct Recorder(Mutex<Vec<CoreEvent>>);
impl EventSink for Recorder {
    fn on_event(&self, event: CoreEvent) {
        self.0.lock().unwrap().push(event);
    }
}

impl Recorder {
    fn cues(&self) -> Vec<SoundCue> {
        self.0
            .lock()
            .unwrap()
            .iter()
            .filter_map(|event| match event {
                CoreEvent::Sound { cue } => Some(*cue),
                _ => None,
            })
            .collect()
    }
}

/// Connects at once and remembers what it was asked; a share starts without audio.
#[derive(Default)]
struct StandInMedia {
    calls: Mutex<Vec<String>>,
    last_call: Mutex<u64>,
    sounds: Mutex<Vec<(String, Vec<u8>)>>,
}

#[async_trait]
impl MediaEngine for StandInMedia {
    async fn connect(&self, url: String, _token: String, call: u64) -> Result<(), CoreError> {
        self.calls.lock().unwrap().push(format!("connect {url}"));
        *self.last_call.lock().unwrap() = call;
        Ok(())
    }
    async fn disconnect(&self) {
        self.calls.lock().unwrap().push("disconnect".into());
    }
    fn set_muted(&self, _muted: bool) {}
    fn set_deafened(&self, _deafened: bool) {}
    fn set_video_demands(&self, _demands: Vec<VideoDemand>) {}
    async fn start_screen_share(
        &self,
        _request: ScreenShareRequest,
    ) -> Result<ScreenShareStarted, CoreError> {
        Ok(ScreenShareStarted { audio: None })
    }
    async fn play_soundboard(&self, sound_id: String, bytes: Vec<u8>) -> Result<(), CoreError> {
        self.sounds.lock().unwrap().push((sound_id, bytes));
        Ok(())
    }
}

struct Client {
    core: Core,
    events: Arc<Recorder>,
    media: Arc<StandInMedia>,
}

impl Client {
    /// What the engine would report while our share is published, with its video track's sid.
    fn report_share(&self, video_sid: &str) {
        let call = *self.media.last_call.lock().unwrap();
        self.core.ingest_media(
            call,
            VoiceView {
                status: VoiceStatus::Connected,
                local: LocalMediaView {
                    screen: LocalShare::On,
                    may_share: true,
                    screen_tracks: Some(ShareTracks {
                        video_sid: video_sid.into(),
                        audio_sid: None,
                    }),
                    ..LocalMediaView::default()
                },
                ..VoiceView::default()
            },
        );
    }
}

async fn signed_in(server: &FakeServer) -> Client {
    signed_in_as(server, "me").await
}

/// Signed in as `username`, which `FakeServer::sign_in_as` maps to a scenario user.
async fn signed_in_as(server: &FakeServer, username: &str) -> Client {
    let backend = HttpBackend::new(Arc::new(MemSecrets::default()));
    let mut config = SocketConfig::new("unused");
    config.reconnect_delay = Duration::from_millis(50);
    let realtime = SocketRealtime::new(config, backend.clone());
    let events = Arc::new(Recorder::default());
    let media = Arc::new(StandInMedia::default());
    let core = Core::with_services(
        Arc::new(WallClock),
        events.clone(),
        Services {
            backend: Arc::new(backend.clone()),
            realtime: realtime.clone(),
            media: Some(media.clone()),
        },
    );
    realtime.attach(core.clone());
    let driver = core.clone();
    tokio::spawn(async move { driver.drive().await });
    core.sign_in(server.base_url(), username.into(), "pw".into())
        .await
        .unwrap();
    until("sign-in", || {
        matches!(core.session(), SessionState::SignedIn { .. })
    })
    .await;
    until("the socket", || {
        core.connection() == ConnectionState::Connected
    })
    .await;
    Client {
        core,
        events,
        media,
    }
}

async fn server() -> FakeServer {
    FakeServer::start(ScenarioSource::Named("showcase"))
        .await
        .expect("the scenario loads")
}

fn count(server: &FakeServer, operation: &str) -> usize {
    server
        .requests()
        .into_iter()
        .filter(
            |record| matches!(record, Record::Http { operation: Some(op), .. } if *op == operation),
        )
        .count()
}

/// The statuses the fake answered `operation` with, in order.
fn statuses(server: &FakeServer, operation: &str) -> Vec<u16> {
    server
        .requests()
        .into_iter()
        .filter_map(|record| match record {
            Record::Http {
                operation: Some(op),
                status,
                ..
            } if op == operation => Some(status),
            _ => None,
        })
        .collect()
}

fn participants(core: &Core) -> Vec<String> {
    let mut ids: Vec<String> = core
        .voice()
        .participants
        .iter()
        .map(|participant| participant.identity.clone())
        .collect();
    ids.sort();
    ids
}

// --- DM calls and the incoming call ---

#[tokio::test]
async fn a_dm_call_rings_is_answered_and_ends_when_the_caller_leaves() {
    let server = server().await;
    let client = signed_in(&server).await;
    let core = &client.core;
    let dm = id("dm-priya");
    assert!(server.dm_call_join(&dm, &id("u-priya")));
    until("the ring", || core.incoming_call().is_some()).await;
    let call = core.incoming_call().unwrap();
    assert_eq!(call.dm_group_id, dm);
    assert_eq!(call.caller.id, id("u-priya"));
    assert_eq!(call.group_name, "pri");

    core.accept_incoming_call().await.unwrap();
    assert_eq!(core.incoming_call(), None);
    let voice = core.voice();
    assert_eq!(voice.status, VoiceStatus::Connected);
    assert_eq!(
        voice.room,
        Some(VoiceRoom::Dm {
            dm_group_id: dm.clone()
        })
    );
    assert_eq!(
        statuses(&server, "LivekitController_generateDmToken"),
        [201]
    );
    assert_eq!(
        statuses(&server, "DmVoicePresenceController_refreshDmPresence"),
        [201]
    );
    assert_eq!(count(&server, "VoicePresenceController_joinPresence"), 0);
    // The refresh listed me; the call's presence names us both.
    until("both in the call", || {
        participants(core) == vec![id("me"), id("u-priya")]
    })
    .await;
    core.refresh_voice_presence().await;
    assert_eq!(
        count(&server, "DmVoicePresenceController_refreshDmPresence"),
        2
    );

    assert!(server.dm_call_leave(&dm, &id("u-priya")));
    until("the call ending", || {
        client.events.cues().contains(&SoundCue::CallEnded)
    })
    .await;
    assert_eq!(participants(core), vec![id("me")]);
    let cues = client.events.cues();
    assert_eq!(
        cues,
        [
            SoundCue::IncomingRingStart,
            SoundCue::IncomingRingStop,
            SoundCue::Connected,
            SoundCue::CallEnded
        ]
    );
    core.leave_voice().await.unwrap();
    assert_eq!(count(&server, "VoicePresenceController_leavePresence"), 0);
}

#[tokio::test]
async fn the_ring_stops_when_the_caller_gives_up() {
    let server = server().await;
    let client = signed_in(&server).await;
    let dm = id("dm-marcus");
    server.dm_call_join(&dm, &id("u-marcus"));
    until("the ring", || client.core.incoming_call().is_some()).await;
    until("the call's presence read", || {
        count(&server, "DmVoicePresenceController_getDmPresence") == 1
    })
    .await;
    server.dm_call_leave(&dm, &id("u-marcus"));
    until("the ring to stop", || client.core.incoming_call().is_none()).await;
}

#[tokio::test]
async fn every_ringing_callee_stops_when_the_caller_hangs_up_before_anyone_answers() {
    let server = server().await;
    server.sign_in_as("aiko", &id("u-aiko"));
    let me = signed_in(&server).await;
    let aiko = signed_in_as(&server, "aiko").await;
    let dm = id("dm-launch");
    assert!(server.dm_call_join(&dm, &id("u-samira")));
    until("both rings", || {
        me.core.incoming_call().is_some() && aiko.core.incoming_call().is_some()
    })
    .await;
    assert_eq!(me.core.incoming_call().unwrap().caller.id, id("u-samira"));

    // Nobody answers: the caller hangs up, and the call's presence empties.
    assert!(server.dm_call_leave(&dm, &id("u-samira")));
    until("both rings to stop", || {
        me.core.incoming_call().is_none() && aiko.core.incoming_call().is_none()
    })
    .await;
    for client in [&me, &aiko] {
        let cues = client.events.cues();
        assert!(
            cues.contains(&SoundCue::IncomingRingStart),
            "it rang: {cues:?}"
        );
        assert!(
            cues.contains(&SoundCue::IncomingRingStop),
            "the ring stopped: {cues:?}"
        );
        assert_eq!(client.core.voice().room, None, "nobody answered");
    }
}

#[tokio::test]
async fn the_ring_stops_when_another_of_my_devices_answers() {
    let server = server().await;
    let client = signed_in(&server).await;
    let dm = id("dm-launch");
    server.dm_call_join(&dm, &id("u-samira"));
    // Not listed yet: named after the caller, then by the group's own name once the list is in.
    until("the ring", || client.core.incoming_call().is_some()).await;
    until("the group's name", || {
        client.core.incoming_call().unwrap().group_name == "Launch crew 🚀"
    })
    .await;
    // My other device joins: presence names me.
    server.dm_call_join(&dm, &id("me"));
    until("the ring to stop", || client.core.incoming_call().is_none()).await;
    assert!(client.core.voice().room.is_none(), "this device stays out");
}

#[tokio::test]
async fn a_call_i_start_does_not_ring_me() {
    let server = server().await;
    let client = signed_in(&server).await;
    let dm = id("dm-grace");
    client.core.join_dm_call(dm.clone()).await.unwrap();
    // The real backend sends dmVoiceCallStarted to the whole group, the caller included. The
    // socket keeps order, so once grace's join is in, so is that start.
    server.dm_call_join(&dm, &id("u-grace"));
    until("grace in the call", || {
        participants(&client.core).contains(&id("u-grace"))
    })
    .await;
    assert_eq!(client.core.incoming_call(), None);
    assert!(!client.events.cues().contains(&SoundCue::IncomingRingStart));
    assert!(client.events.cues().contains(&SoundCue::UserJoined));
}

#[tokio::test]
async fn a_decline_over_the_real_transports_ends_the_callers_one_to_one_call() {
    let server = server().await;
    server.sign_in_as("pri", &id("u-priya"));
    let caller = signed_in(&server).await;
    let callee = signed_in_as(&server, "pri").await;
    let dm = id("dm-priya");
    caller.core.join_dm_call(dm.clone()).await.unwrap();
    until("the ring", || callee.core.incoming_call().is_some()).await;
    assert_eq!(caller.core.voice().status, VoiceStatus::Connected);

    callee.core.decline_incoming_call();
    assert_eq!(
        callee.core.incoming_call(),
        None,
        "the ring stops here at once"
    );
    until("the caller's call to end", || {
        caller.core.voice().status == VoiceStatus::Disconnected
    })
    .await;
    assert_eq!(caller.core.voice().room, None);
    assert!(
        caller
            .media
            .calls
            .lock()
            .unwrap()
            .iter()
            .any(|call| call == "disconnect"),
        "{:?}",
        caller.media.calls.lock().unwrap()
    );
    assert_eq!(
        statuses(&server, "DmVoicePresenceController_declineDmVoiceCall"),
        [201]
    );
    // The callee's device heard its own decline on the socket too: still nothing ringing.
    until("the callee's ring to stay down", || {
        callee.core.incoming_call().is_none()
    })
    .await;
}

// --- Server mute and kick ---

#[tokio::test]
async fn a_moderator_mutes_someone_and_a_mute_on_me_holds_my_mic() {
    let server = server().await;
    let client = signed_in(&server).await;
    let core = &client.core;
    let squad = id("vc-squad");
    core.join_voice(squad.clone()).await.unwrap();
    until("the squad listed", || participants(core).len() == 3).await;

    core.server_mute(id("u-marcus"), true).await.unwrap();
    assert_eq!(
        statuses(&server, "LivekitController_muteParticipant"),
        [201]
    );
    until("marcus muted", || {
        core.voice()
            .participants
            .iter()
            .any(|p| p.identity == id("u-marcus") && p.server_muted && p.muted)
    })
    .await;
    // Myself: refused by rank, with the server's message.
    let error = core.server_mute(id("me"), true).await.unwrap_err();
    assert!(error.to_string().contains("outrank"), "{error}");

    server.server_mute(&squad, &id("me"), true);
    until("my server mute", || core.voice().server_muted).await;
    assert!(core.set_muted(false).await.is_err());
    server.server_mute(&squad, &id("me"), false);
    until("lifted", || !core.voice().server_muted).await;
    core.set_muted(false).await.unwrap();
}

#[tokio::test]
async fn kicking_a_member_sends_the_reason() {
    let server = server().await;
    // W5: kicking needs a role that outranks theirs; `me` is only a Member there.
    server.act_as(&id("c-couch"), None, &["role-community-admin-c-couch"]);
    let client = signed_in(&server).await;
    client
        .core
        .kick_member(id("c-couch"), id("u-kwame"), Some("spam".into()))
        .await
        .unwrap();
    assert_eq!(statuses(&server, "ModerationController_kickUser"), [200]);
}

// --- Soundboard ---

#[tokio::test]
async fn the_soundboard_lists_the_calls_community_and_reads_each_file_once() {
    let server = server().await;
    let client = signed_in(&server).await;
    let core = &client.core;
    let couch = id("c-couch");
    until("couch's channels", || {
        !core.channels(couch.clone()).is_empty()
    })
    .await;
    core.join_voice(id("vc-squad")).await.unwrap();
    until("the soundboard", || {
        core.soundboard(couch.clone()).state == LoadState::Ready
    })
    .await;
    let board = core.soundboard(couch.clone());
    let names: Vec<&str> = board
        .sounds
        .iter()
        .map(|sound| sound.name.as_str())
        .collect();
    assert_eq!(names, ["Airhorn", "Rimshot", "Silence"]);
    let (airhorn, _) = FakeServer::sound_ids(&couch, "Airhorn");
    core.play_sound(airhorn.clone()).await.unwrap();
    core.play_sound(airhorn.clone()).await.unwrap();
    assert_eq!(count(&server, "FileController_getFile"), 1);
    let sounds = client.media.sounds.lock().unwrap().clone();
    assert_eq!(sounds.len(), 2);
    assert_eq!(sounds[0].0, airhorn);
    assert!(sounds[0].1.starts_with(b"ID3"));
}

// --- Replay and clips ---

/// Me in vc-squad's call, sharing, with the buffer running.
async fn recording(server: &FakeServer) -> Client {
    let client = signed_in(server).await;
    let core = &client.core;
    core.join_voice(id("vc-squad")).await.unwrap();
    core.start_screen_share(ScreenShareRequest {
        audio: false,
        ..ScreenShareRequest::default()
    })
    .await
    .unwrap();
    client.report_share("TR_v");
    until("the buffer", || {
        matches!(core.voice().replay, ReplayState::Recording { .. })
    })
    .await;
    assert_eq!(
        statuses(server, "LivekitController_startReplayBuffer"),
        [201]
    );
    client
}

#[tokio::test]
async fn the_buffer_records_previews_captures_everywhere_and_stops_with_the_share() {
    let server = server().await;
    let client = recording(&server).await;
    let core = &client.core;

    assert_eq!(core.replay_session().state, LoadState::Loading);
    until("the session", || {
        core.replay_session().state == LoadState::Ready
    })
    .await;
    assert!(server.emit_segments_ready(3));
    until("three segments", || {
        core.replay_session().total_segments == 3
    })
    .await;
    assert_eq!(core.replay_session().total_seconds, 30);

    let segments = core.replay_preview().await.unwrap();
    assert_eq!(segments.len(), 3);
    assert!(segments[0].url.starts_with(&server.base_url()));
    assert_eq!(
        segments.iter().map(|s| s.duration_ms).collect::<Vec<_>>(),
        [10_000; 3]
    );
    let bytes = core.replay_segment(segments[0].clone()).await.unwrap();
    assert!(!bytes.is_empty());
    // MPEG-TS the player reads: sync bytes every 188.
    assert!(bytes.len() > 10_000 && bytes.len() % 188 == 0);
    assert!(bytes.iter().step_by(188).all(|byte| *byte == 0x47));
    // A segment that isn't there is refused for good: the player doesn't retry it.
    let gone = semaphore_core::model::PreviewSegment {
        url: format!(
            "{}/api/livekit/replay/preview/segment/missing-segment_00009.ts",
            server.base_url()
        ),
        duration_ms: 10_000,
    };
    let failure = core.fetch_replay_segment(gone).await.unwrap_err();
    assert!(!failure.transient, "{failure:?}");

    let library = core
        .capture_replay(CaptureRequest {
            minutes: ReplayMinutes::One,
            trim: None,
            destination: ClipDestination::Library,
        })
        .await
        .unwrap();
    assert_eq!(library.message_id, None);
    let posted = core
        .capture_replay(CaptureRequest {
            minutes: ReplayMinutes::One,
            trim: Some(semaphore_core::model::ReplayTrim {
                start_seconds: 5,
                end_seconds: 25,
            }),
            destination: ClipDestination::Channel {
                channel_id: id("cc-clips"),
            },
        })
        .await
        .unwrap();
    assert!(posted.message_id.is_some());
    core.capture_replay(CaptureRequest {
        minutes: ReplayMinutes::Two,
        trim: None,
        destination: ClipDestination::Dm {
            dm_group_id: id("dm-priya"),
        },
    })
    .await
    .unwrap();
    assert_eq!(
        statuses(&server, "LivekitController_captureReplay"),
        [201, 201, 201]
    );
    until("the new clips", || core.clips().clips.len() >= 3).await;

    core.stop_screen_share().await.unwrap();
    until("the stop", || {
        count(&server, "LivekitController_stopReplayBuffer") == 1
    })
    .await;
    assert_eq!(core.voice().replay, ReplayState::Off);
}

#[tokio::test]
async fn a_failed_egress_shows_why_and_is_not_restarted() {
    let server = server().await;
    let client = recording(&server).await;
    assert!(server.emit_replay_failed("egress died"));
    until("the failure", || {
        client.core.voice().replay
            == ReplayState::Failed {
                message: "egress died".into(),
            }
    })
    .await;
    client.report_share("TR_v");
    assert_eq!(count(&server, "LivekitController_startReplayBuffer"), 1);
}

#[tokio::test]
async fn the_clip_library_lists_toggles_deletes_and_shares() {
    let server = server().await;
    let (kept, _) = server.seed_clip(&id("me"), false, 30);
    let (gone, _) = server.seed_clip(&id("me"), false, 45);
    let client = signed_in(&server).await;
    let core = &client.core;
    until("the library", || core.clips().clips.len() == 2).await;
    core.set_clip_public(kept.clone(), true).await.unwrap();
    assert!(
        core.clips()
            .clips
            .iter()
            .any(|clip| clip.id == kept && clip.is_public)
    );
    core.delete_clip(gone.clone()).await.unwrap();
    assert_eq!(core.clips().clips.len(), 1);
    core.share_clip(
        kept.clone(),
        ClipDestination::Channel {
            channel_id: id("cc-clips"),
        },
    )
    .await
    .unwrap();
    core.share_clip(
        kept.clone(),
        ClipDestination::Dm {
            dm_group_id: id("dm-priya"),
        },
    )
    .await
    .unwrap();
    assert_eq!(statuses(&server, "LivekitController_shareClip"), [201, 201]);
    assert!(core.clips().error.is_none());
    // Mine, public, as others see them.
    until("my public clips", || {
        core.user_clips(id("me")).clips.len() == 1
    })
    .await;
}

#[tokio::test]
async fn a_trim_counts_from_the_buffers_start_and_download_only_keeps_nothing() {
    let server = server().await;
    let client = recording(&server).await;
    let core = &client.core;
    // A buffer of 13:20 (80 segments of 10 s).
    assert!(server.emit_segments_ready(80));
    until("the buffer's length", || {
        core.replay_session().total_seconds == 800
    })
    .await;
    let trimmed = |start_seconds, end_seconds| CaptureRequest {
        minutes: ReplayMinutes::One,
        trim: Some(semaphore_core::model::ReplayTrim {
            start_seconds,
            end_seconds,
        }),
        destination: ClipDestination::Library,
    };
    // 11:40 to 13:10, with the one-minute preset showing: the range is what's taken.
    let late = core.capture_replay(trimmed(700, 790)).await.unwrap();
    assert_eq!(late.duration_seconds, 90);
    // From the very start: a start of 0 is still a range.
    let early = core.capture_replay(trimmed(0, 20)).await.unwrap();
    assert_eq!(early.duration_seconds, 20);
    // Past the buffer: refused before asking.
    assert!(core.capture_replay(trimmed(790, 810)).await.is_err());
    assert_eq!(
        statuses(&server, "LivekitController_captureReplay"),
        [201, 201]
    );

    let bytes = core.download_replay(ReplayMinutes::Two).await.unwrap();
    assert_eq!(&bytes[4..8], b"ftyp");
    assert_eq!(statuses(&server, "LivekitController_streamReplay"), [200]);
    // The two captures only: the download is kept nowhere.
    until("the library", || core.clips().clips.len() == 2).await;
    let clip = core.clips().clips.remove(0);
    assert_eq!(clip.mime_type, "video/mp4");
    assert!(!clip.has_thumbnail);
}

// --- Join-failure reports ---

/// The web's upload, over the real client: a failed join reaches the server once, with the
/// contract's fields and `platform: native`, and the server's own answer is all it takes.
#[tokio::test]
async fn a_failed_join_reaches_the_server_as_a_native_join_failure_report() {
    let server = server().await;
    let client = signed_in(&server).await;
    let core = &client.core;
    core.set_app_version("0.9.0".into());
    server.fail_route("LivekitController_generateToken", 403, "FORBIDDEN");
    let channel = id("vc-squad");
    assert!(core.join_voice(channel.clone()).await.is_err());
    until("the report", || !server.join_failures().is_empty()).await;
    let reports = server.join_failures();
    assert_eq!(reports.len(), 1);
    let report = &reports[0];
    assert_eq!(report["platform"], "native");
    assert_eq!(report["errorClass"], "permission");
    assert_eq!(report["channelId"], channel);
    assert_eq!(report["isDm"], false);
    assert_eq!(report["appVersion"], "0.9.0");
    assert!(report["os"].is_string(), "{report}");
    assert!(report["message"].is_string(), "{report}");
    assert_eq!(
        statuses(&server, "VoiceDiagnosticsController_reportJoinFailure"),
        [204]
    );
}
