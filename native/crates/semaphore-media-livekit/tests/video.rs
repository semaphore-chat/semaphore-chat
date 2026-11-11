//! Sending a camera and a screen through a real SFU and real libwebrtc, from fake capture
//! sources, to a second engine that decodes them.
//!
//!   native/crates/semaphore-media-livekit/proof/test-video.sh
//!
//! Each test skips, loudly, without `LK_URL`, because `cargo test` alone has no server.

#[path = "../examples/common/token.rs"]
mod token;

use semaphore_core::model::{
    LocalShare, ParticipantView, ScreenShareRequest, ShareResolution, VideoDemand,
};
use semaphore_core::platform::MediaEngine;
use semaphore_media_livekit::audio::virtual_io::VirtualIo;
use semaphore_media_livekit::testing::{FakeSystemAudio, FakeVideoSources};
use semaphore_media_livekit::{
    EngineOptions, LiveKitEngine, MediaSnapshot, VideoFrameRef, VideoSink,
};
use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const WAIT: Duration = Duration::from_secs(20);

macro_rules! server {
    () => {
        match std::env::var("LK_URL") {
            Ok(url) => url,
            Err(_) => {
                eprintln!("SKIPPED: no LK_URL");
                return;
            }
        }
    };
}

fn room_name(test: &str) -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .subsec_nanos();
    format!("av-{test}-{nanos}")
}

/// Frames per sid, and the last size, as a tile would get them.
#[derive(Default)]
struct Frames {
    seen: Mutex<HashMap<String, (u64, u32, u32)>>,
    ended: Mutex<Vec<String>>,
}

impl Frames {
    fn of(&self, sid: &str) -> (u64, u32, u32) {
        self.seen
            .lock()
            .unwrap()
            .get(sid)
            .copied()
            .unwrap_or_default()
    }
}

impl VideoSink for Frames {
    fn on_frame(&self, track_sid: &str, frame: &VideoFrameRef<'_>) {
        let mut seen = self.seen.lock().unwrap();
        let entry = seen.entry(track_sid.to_owned()).or_default();
        *entry = (entry.0 + 1, frame.width, frame.height);
    }

    fn on_track_ended(&self, track_sid: &str) {
        self.ended.lock().unwrap().push(track_sid.to_owned());
    }
}

struct Peer {
    engine: LiveKitEngine,
    frames: Arc<Frames>,
    sources: Arc<FakeVideoSources>,
    audio: Arc<FakeSystemAudio>,
    identity: String,
}

impl Peer {
    async fn join(url: &str, room: &str, identity: &str) -> Self {
        Self::join_with(url, room, identity, None).await
    }

    async fn join_with(url: &str, room: &str, identity: &str, sources: Option<&[&str]>) -> Self {
        let frames = Arc::new(Frames::default());
        let video = Arc::new(FakeVideoSources::default());
        let audio = Arc::new(FakeSystemAudio::default());
        let engine = LiveKitEngine::new(EngineOptions {
            audio_io: Arc::new(VirtualIo::new()),
            video_sources: video.clone(),
            system_audio: Some(audio.clone()),
            ..EngineOptions::default()
        });
        engine.set_video_sink(frames.clone());
        let token = token::dev_token_publishing(room, identity, identity, sources);
        engine
            .connect(url.to_owned(), token, 1)
            .await
            .expect("joins");
        Self {
            engine,
            frames,
            sources: video,
            audio,
            identity: identity.to_owned(),
        }
    }

    fn snapshot(&self) -> MediaSnapshot {
        self.engine.snapshot()
    }

    fn me(&self) -> ParticipantView {
        self.person(&self.identity)
    }

    fn person(&self, identity: &str) -> ParticipantView {
        self.snapshot()
            .voice
            .participants
            .into_iter()
            .find(|p| p.identity == identity)
            .unwrap_or_default()
    }

    /// Asks for `sid` at its top layer, as a focused tile does.
    fn watch(&self, sid: &str) {
        self.engine.set_video_demands(vec![VideoDemand {
            track_sid: sid.to_owned(),
            width_px: 1920,
            height_px: 1080,
            focused: true,
        }]);
    }
}

async fn eventually(what: &str, deadline: Duration, mut check: impl FnMut() -> bool) {
    let started = Instant::now();
    while started.elapsed() < deadline {
        if check() {
            println!("{what}: {} ms", started.elapsed().as_millis());
            return;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("{what}: still false after {deadline:?}");
}

fn share(resolution: ShareResolution, fps: u32, audio: bool) -> ScreenShareRequest {
    ScreenShareRequest {
        source_id: Some("screen:1".into()),
        resolution,
        fps,
        audio,
    }
}

/// The viewer decodes at least `frames` more of `sid`, at `size`.
async fn decodes(viewer: &Peer, sid: &str, size: (u32, u32), frames: u64) {
    let start = viewer.frames.of(sid).0;
    eventually(&format!("viewer decodes {sid} at {size:?}"), WAIT, || {
        let (count, width, height) = viewer.frames.of(sid);
        count >= start + frames && (width, height) == size
    })
    .await;
}

#[tokio::test(flavor = "multi_thread")]
async fn the_camera_reaches_a_viewer_and_shows_as_ours_with_a_preview() {
    let url = server!();
    let room = room_name("camera");
    let me = Peer::join(&url, &room, "sender").await;
    let viewer = Peer::join(&url, &room, "viewer").await;

    me.engine.set_camera(true).await.expect("the camera starts");
    let snapshot = me.snapshot();
    assert_eq!(snapshot.voice.local.camera, LocalShare::On);
    assert!(snapshot.voice.local.may_camera && snapshot.voice.local.may_share);
    let ours = me.me().camera.expect("our camera is in our own view");

    // Our preview tile gets frames under our own sid, small.
    eventually("our preview", WAIT, || me.frames.of(&ours.track_sid).0 >= 5).await;
    assert_eq!(me.frames.of(&ours.track_sid).1, 640);

    eventually("the viewer sees our camera", WAIT, || {
        viewer.person("sender").camera.is_some()
    })
    .await;
    let theirs = viewer.person("sender").camera.unwrap();
    assert_eq!(theirs.track_sid, ours.track_sid);
    viewer.watch(&theirs.track_sid);
    decodes(&viewer, &theirs.track_sid, (1280, 720), 30).await;

    me.engine.set_camera(false).await.unwrap();
    assert_eq!(me.snapshot().voice.local.camera, LocalShare::Off);
    assert!(me.sources.last_camera().unwrap().stopped());
    assert!(me.me().camera.is_none());
    assert!(me.frames.ended.lock().unwrap().contains(&ours.track_sid));
    eventually("the viewer sees it go", WAIT, || {
        viewer.person("sender").camera.is_none()
    })
    .await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_screen_share_goes_out_scaled_with_its_audio_and_stops_with_it() {
    let url = server!();
    let room = room_name("screen");
    let me = Peer::join(&url, &room, "sender").await;
    let viewer = Peer::join(&url, &room, "viewer").await;

    let started = me
        .engine
        .start_screen_share(share(ShareResolution::P720, 15, true))
        .await
        .expect("the share starts");
    assert_eq!(started.audio, Some(Ok(())));
    assert_eq!(me.audio.starts.load(Ordering::Relaxed), 1);
    let local = me.snapshot().voice.local;
    assert_eq!(
        (local.screen, local.screen_audio),
        (LocalShare::On, LocalShare::On)
    );
    // What the source was asked for is what the user picked.
    assert_eq!(
        me.sources.screen_requests.lock().unwrap()[0],
        share(ShareResolution::P720, 15, true)
    );

    eventually("the viewer sees our screen", WAIT, || {
        viewer.person("sender").screen_share.is_some()
    })
    .await;
    let sid = viewer.person("sender").screen_share.unwrap().track_sid;
    viewer.watch(&sid);
    // A 1920x1080 screen at the 720p setting goes out at 1280x720.
    decodes(&viewer, &sid, (1280, 720), 15).await;
    // The replay buffer's ids: the video the viewer sees, and the audio once it's out.
    eventually("the report has both sids", WAIT, || {
        me.snapshot()
            .voice
            .local
            .screen_tracks
            .is_some_and(|tracks| tracks.video_sid == sid && tracks.audio_sid.is_some())
    })
    .await;

    me.engine.stop_screen_share().await;
    let local = me.snapshot().voice.local;
    assert_eq!(
        (local.screen, local.screen_audio),
        (LocalShare::Off, LocalShare::Off)
    );
    assert_eq!(local.screen_tracks, None);
    assert!(me.sources.last_screen().unwrap().stopped());
    eventually("the viewer sees it go", WAIT, || {
        viewer.person("sender").screen_share.is_none()
    })
    .await;
}

#[tokio::test(flavor = "multi_thread")]
async fn audio_that_fails_leaves_the_screen_shared() {
    let url = server!();
    let room = room_name("noaudio");
    let me = Peer::join(&url, &room, "sender").await;
    let viewer = Peer::join(&url, &room, "viewer").await;
    *me.audio.fail_with.lock().unwrap() = Some("PipeWire isn't running".into());

    let started = me
        .engine
        .start_screen_share(share(ShareResolution::Native, 30, true))
        .await
        .expect("the screen is shared anyway");
    assert_eq!(started.audio, Some(Err("PipeWire isn't running".into())));
    // Said, so the replay buffer starts with the video alone at once.
    let local = me.snapshot().voice.local;
    assert_eq!(
        local.screen_audio,
        LocalShare::Failed {
            message: "PipeWire isn't running".into()
        }
    );
    let tracks = local.screen_tracks.expect("the video's sid");
    assert_eq!(tracks.audio_sid, None);
    eventually("the viewer sees our screen", WAIT, || {
        viewer.person("sender").screen_share.is_some()
    })
    .await;
    let sid = viewer.person("sender").screen_share.unwrap().track_sid;
    assert_eq!(tracks.video_sid, sid);
    viewer.watch(&sid);
    decodes(&viewer, &sid, (1920, 1080), 10).await;
    me.engine.stop_screen_share().await;
    assert_eq!(me.snapshot().voice.local.screen_audio, LocalShare::Off);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_share_that_ends_on_its_own_stops_and_says_so() {
    let url = server!();
    let room = room_name("ended");
    let me = Peer::join(&url, &room, "sender").await;
    let viewer = Peer::join(&url, &room, "viewer").await;
    me.engine
        .start_screen_share(share(ShareResolution::P1080, 15, true))
        .await
        .unwrap();
    eventually("the viewer sees our screen", WAIT, || {
        viewer.person("sender").screen_share.is_some()
    })
    .await;

    me.sources.last_screen().unwrap().end("the window closed");
    eventually("our share shows off", WAIT, || {
        me.snapshot().voice.local.screen == LocalShare::Off
    })
    .await;
    assert_eq!(me.snapshot().voice.local.screen_audio, LocalShare::Off);
    eventually("the viewer sees it go", WAIT, || {
        viewer.person("sender").screen_share.is_none()
    })
    .await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_failed_start_says_why_and_a_retry_works() {
    let url = server!();
    let room = room_name("retry");
    let me = Peer::join(&url, &room, "sender").await;
    *me.sources.fail_next_camera.lock().unwrap() = Some("the camera is busy".into());
    let error = me.engine.set_camera(true).await.unwrap_err();
    assert!(error.to_string().contains("busy"), "{error}");
    assert_eq!(me.snapshot().voice.local.camera, LocalShare::Off);
    me.engine.set_camera(true).await.expect("a retry starts");
    assert_eq!(me.snapshot().voice.local.camera, LocalShare::On);
}

#[tokio::test(flavor = "multi_thread")]
async fn what_the_room_forbids_is_refused_and_reported() {
    let url = server!();
    let room = room_name("forbidden");
    let me = Peer::join_with(&url, &room, "sender", Some(&["microphone"])).await;
    let local = me.snapshot().voice.local;
    assert!(!local.may_camera && !local.may_share, "{local:?}");
    assert!(me.engine.set_camera(true).await.is_err());
    assert!(
        me.engine
            .start_screen_share(share(ShareResolution::P1080, 30, false))
            .await
            .is_err()
    );
    // Nothing was even opened.
    assert!(me.sources.last_camera().is_none() && me.sources.last_screen().is_none());

    let sharer = Peer::join_with(
        &url,
        &room,
        "sharer",
        Some(&["microphone", "screen_share", "screen_share_audio"]),
    )
    .await;
    let local = sharer.snapshot().voice.local;
    assert!(!local.may_camera && local.may_share, "{local:?}");
}

#[tokio::test(flavor = "multi_thread")]
async fn leaving_stops_both() {
    let url = server!();
    let room = room_name("leave");
    let me = Peer::join(&url, &room, "sender").await;
    me.engine.set_camera(true).await.unwrap();
    me.engine
        .start_screen_share(share(ShareResolution::P1080, 15, true))
        .await
        .unwrap();
    me.engine.disconnect().await;
    assert!(me.sources.last_camera().unwrap().stopped());
    assert!(me.sources.last_screen().unwrap().stopped());
    let local = me.snapshot().voice.local;
    assert_eq!(
        (local.camera, local.screen),
        (LocalShare::Off, LocalShare::Off)
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_rejoin_republishes_the_camera_and_the_screen() {
    let url = server!();
    let room = room_name("rejoin");
    let me = Peer::join(&url, &room, "sender").await;
    let viewer = Peer::join(&url, &room, "viewer").await;
    me.engine.set_camera(true).await.unwrap();
    me.engine
        .start_screen_share(share(ShareResolution::P720, 15, true))
        .await
        .unwrap();
    eventually("the viewer sees both", WAIT, || {
        let them = viewer.person("sender");
        them.camera.is_some() && them.screen_share.is_some()
    })
    .await;
    let before = viewer.person("sender").screen_share.unwrap().track_sid;

    me.engine.drop_room_for_test();
    eventually("we rejoined", WAIT, || me.snapshot().rejoins == 1).await;
    // The same captures, never stopped, under new publications.
    assert!(!me.sources.last_camera().unwrap().stopped());
    assert!(!me.sources.last_screen().unwrap().stopped());
    assert_eq!(me.sources.cameras.lock().unwrap().len(), 1);
    eventually("the viewer sees both again", WAIT, || {
        let them = viewer.person("sender");
        them.camera.is_some()
            && them
                .screen_share
                .is_some_and(|screen| screen.track_sid != before)
    })
    .await;
    let sid = viewer.person("sender").screen_share.unwrap().track_sid;
    viewer.watch(&sid);
    decodes(&viewer, &sid, (1280, 720), 10).await;
    let local = me.snapshot().voice.local;
    assert_eq!(
        (local.camera, local.screen, local.screen_audio),
        (LocalShare::On, LocalShare::On, LocalShare::On)
    );
    // The report moves to the new room's sids.
    eventually("the new sids are reported", WAIT, || {
        me.snapshot()
            .voice
            .local
            .screen_tracks
            .is_some_and(|tracks| tracks.video_sid == sid && tracks.audio_sid.is_some())
    })
    .await;
}
