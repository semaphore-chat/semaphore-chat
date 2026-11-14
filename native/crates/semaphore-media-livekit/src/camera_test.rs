//! W15: the settings page's camera test: the selected camera open, its picture on our own preview
//! tile, and nothing published. It runs while a call's camera is off, and `Inner::set_camera`
//! stops it the moment the call turns its camera on, so the test and the call never hold the same
//! camera at once. A newer test replaces an older one, which is how a changed camera selection
//! restarts the capture.
//!
//! Frames take the same way out as a published camera's own tile: `PreviewFrame` scales them and
//! hands NV12 to the window's `VideoSink`, here under `CAMERA_TEST_TRACK_SID` instead of a
//! publication's sid. No LiveKit type appears in the handle's API, so the app and the rigs can
//! drive it without the SDK.

use crate::video::local::{
    Capturing, OnEnded, OnFrame, PreviewFrame, SourceFrame, VideoCaptureSource, to_i420,
};
use crate::video::publish::fit_capture;
use crate::{LiveKitEngine, VideoSink};

/// Why a camera test can't run: the call has the camera, or is opening it.
pub(crate) const CAMERA_IN_USE: &str = "the camera is in use by the call";
use semaphore_core::model::{CAMERA_TEST_TRACK_SID, ShareResolution};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

/// What the handle, the capture thread and the engine share.
pub(crate) struct CameraTestShared {
    /// Frames that reached the preview.
    frames: AtomicU64,
    running: AtomicBool,
    /// The camera's size, from its first frame.
    size: Mutex<Option<(u32, u32)>>,
    /// The camera opened, as `VideoSources::camera` was asked for it.
    device: Mutex<Option<String>>,
    /// Why a running capture ended on its own.
    failed: Mutex<Option<String>>,
    /// The capture; dropping it closes the camera.
    capture: Mutex<Option<Capturing>>,
    /// Where the preview frames go, and the notice that the track is gone.
    sink: Arc<dyn VideoSink>,
    /// Held while the camera opens, so a call taking the camera over can wait for it.
    opening: Mutex<()>,
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|p| p.into_inner())
}

impl CameraTestShared {
    /// Closes the camera and takes the picture away. Safe from any thread, and twice.
    pub(crate) fn stop(&self) {
        if !self.running.swap(false, Ordering::SeqCst) {
            return;
        }
        let capture = lock(&self.capture).take();
        drop(capture);
        self.sink.on_track_ended(CAMERA_TEST_TRACK_SID);
    }

    /// Returns once the test is past opening its camera (and, when stopped meanwhile, has closed
    /// it again).
    pub(crate) fn wait_started(&self) {
        drop(lock(&self.opening));
    }

    /// The camera ended on its own: the picture goes, and `failed()` says why.
    fn ended(&self, why: String) {
        if self.running.swap(false, Ordering::SeqCst) {
            *lock(&self.failed) = Some(why);
            self.sink.on_track_ended(CAMERA_TEST_TRACK_SID);
        }
    }
}

/// What `LiveKitEngine::camera_test_setup` hands `start_camera_test`: the window's surface, the
/// camera asked for, and its capture source.
pub(crate) struct CameraTestSetup {
    pub sink: Arc<dyn VideoSink>,
    pub device: Option<String>,
    pub source: Box<dyn VideoCaptureSource>,
}

/// A running camera test. Dropping it stops the test and closes the camera.
pub struct CameraTest {
    shared: Arc<CameraTestShared>,
}

impl CameraTest {
    /// Frames that have reached the preview so far.
    pub fn frames(&self) -> u64 {
        self.shared.frames.load(Ordering::Relaxed)
    }

    /// False once the test was stopped or its camera ended.
    pub fn is_running(&self) -> bool {
        self.shared.running.load(Ordering::SeqCst)
    }

    /// Why the capture ended on its own, if it did.
    pub fn failed(&self) -> Option<String> {
        lock(&self.shared.failed).clone()
    }

    /// The camera that was opened: the id given to `VideoSources::camera`, `None` for the first one.
    pub fn device(&self) -> Option<String> {
        lock(&self.shared.device).clone()
    }

    /// The camera's size, once its first frame has arrived.
    pub fn size(&self) -> Option<(u32, u32)> {
        *lock(&self.shared.size)
    }
}

impl Drop for CameraTest {
    fn drop(&mut self) {
        self.shared.stop();
    }
}

impl LiveKitEngine {
    /// Opens the selected camera for a test, publishing nothing: its picture goes to the window's
    /// `VideoSink` under `CAMERA_TEST_TRACK_SID`, as our published camera's preview goes under its
    /// sid. Fails while the call is sending the camera, when this window has no video surface, or
    /// when the camera can't be opened, with why. A newer test stops an older one.
    pub fn start_camera_test(&self) -> Result<CameraTest, String> {
        let CameraTestSetup {
            sink,
            device,
            source,
        } = self.camera_test_setup()?;
        let shared = Arc::new(CameraTestShared {
            frames: AtomicU64::new(0),
            running: AtomicBool::new(true),
            size: Mutex::new(None),
            device: Mutex::new(device),
            failed: Mutex::new(None),
            capture: Mutex::new(None),
            sink,
            opening: Mutex::new(()),
        });
        let on_frame: OnFrame = {
            let shared = shared.clone();
            let mut picture: Option<(u32, u32, PreviewFrame)> = None;
            Box::new(move |frame: SourceFrame<'_>| {
                if picture.is_none() {
                    // The size and rate a published camera's own tile gets.
                    let size = frame.size();
                    *lock(&shared.size) = Some(size);
                    let target = fit_capture(size.0, size.1, ShareResolution::P720);
                    picture = Some((target.0, target.1, PreviewFrame::new()));
                }
                let Some((width, height, preview)) = picture.as_mut() else {
                    return;
                };
                // Most frames come sooner than the preview's rate: drop them before converting.
                if !preview.due() {
                    return;
                }
                let Some(buffer) = to_i420(&frame, (*width, *height)) else {
                    return;
                };
                if preview.send(shared.sink.as_ref(), CAMERA_TEST_TRACK_SID, &buffer) {
                    shared.frames.fetch_add(1, Ordering::Relaxed);
                }
            })
        };
        let on_ended: OnEnded = {
            let shared = shared.clone();
            Box::new(move |why: String| shared.ended(why))
        };
        // Registered before the (slow) open, so a call asking for the camera meanwhile stops this
        // test and waits for the open to finish, instead of opening the device alongside it.
        let opening = lock(&shared.opening);
        self.track_camera_test(&shared)?;
        let capture = source.start(on_frame, on_ended)?;
        *lock(&shared.capture) = Some(capture);
        if !shared.running.load(Ordering::SeqCst) {
            // The call took the camera while it opened: close it again at once.
            let capture = lock(&shared.capture).take();
            drop(capture);
            drop(opening);
            return Err(CAMERA_IN_USE.into());
        }
        drop(opening);
        Ok(CameraTest { shared })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::FakeVideoSources;
    use crate::{EngineOptions, LiveKitEngine, VideoFrameRef, VideoSink};
    use semaphore_core::platform::MediaEngine as _;
    use std::time::{Duration, Instant};

    /// What reached the window: each frame's sid and size, and the tracks that ended.
    #[derive(Default)]
    struct Sink {
        frames: Mutex<Vec<(String, u32, u32)>>,
        ended: Mutex<Vec<String>>,
    }

    impl VideoSink for Sink {
        fn on_frame(&self, track_sid: &str, frame: &VideoFrameRef<'_>) {
            lock(&self.frames).push((track_sid.to_owned(), frame.width, frame.height));
        }

        fn on_track_ended(&self, track_sid: &str) {
            lock(&self.ended).push(track_sid.to_owned());
        }
    }

    fn engine(sources: Arc<FakeVideoSources>, sink: Arc<Sink>) -> LiveKitEngine {
        let engine = LiveKitEngine::new(EngineOptions {
            video_sources: sources,
            ..EngineOptions::default()
        });
        engine.set_video_sink(sink);
        engine
    }

    /// Polls `check` until it holds, for at most 5 s.
    fn eventually(what: &str, mut check: impl FnMut() -> bool) {
        let started = Instant::now();
        while !check() {
            assert!(started.elapsed() < Duration::from_secs(5), "{what}");
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    #[test]
    fn the_fake_camera_reaches_the_preview_and_dropping_it_lets_the_device_go() {
        let sources = Arc::new(FakeVideoSources::default());
        let sink = Arc::new(Sink::default());
        let engine = engine(sources.clone(), sink.clone());
        let test = engine.start_camera_test().unwrap();
        eventually("the first preview frame", || test.frames() > 0);
        assert_eq!(test.size(), Some((1280, 720)));
        let frames = lock(&sink.frames);
        let (sid, width, height) = frames.last().expect("a frame");
        assert_eq!(sid, CAMERA_TEST_TRACK_SID);
        // The preview is at most 640 wide, 16:9 like the camera.
        assert_eq!((*width, *height), (640, 360));
        drop(frames);
        assert_eq!(sources.camera_requests(), vec![None]);
        let camera = sources.last_camera().expect("a capture");
        assert!(!camera.stopped());
        drop(test);
        eventually("the camera closes", || camera.stopped());
        eventually("the surface goes", || {
            lock(&sink.ended).last().map(String::as_str) == Some(CAMERA_TEST_TRACK_SID)
        });
    }

    #[test]
    fn a_new_test_opens_the_new_camera_and_releases_the_old_one() {
        let sources = Arc::new(FakeVideoSources::default());
        let sink = Arc::new(Sink::default());
        let engine = engine(sources.clone(), sink);
        let first = engine.start_camera_test().unwrap();
        eventually("the first test runs", || first.frames() > 0);
        let old = sources.last_camera().expect("the first capture");
        engine.select_camera(Some("cam-second".into()));
        let second = engine.start_camera_test().unwrap();
        eventually("the second test runs", || second.frames() > 0);
        assert_eq!(second.device().as_deref(), Some("cam-second"));
        assert_eq!(
            sources.camera_requests(),
            vec![None, Some("cam-second".into())]
        );
        eventually("the first capture closed", || old.stopped());
        assert!(!first.is_running(), "the older test stopped");
        drop((first, second));
    }

    #[test]
    fn a_call_sending_the_camera_stops_the_test() {
        let sources = Arc::new(FakeVideoSources::default());
        let sink = Arc::new(Sink::default());
        let engine = engine(sources.clone(), sink);
        let test = engine.start_camera_test().unwrap();
        eventually("the test runs", || test.frames() > 0);
        let camera = sources.last_camera().expect("a capture");
        // Nothing listens there: the join fails, but asking for the camera at all stops the test
        // first, which is what keeps the two off one device.
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let _ = runtime.block_on(engine.set_camera(true));
        eventually("the test's camera closes", || camera.stopped());
        assert!(!test.is_running());
        assert!(test.failed().is_none(), "stopped, not failed");
    }

    /// A call asking for the camera while a test's camera is still opening: the test is stopped
    /// before it runs, its camera is closed as soon as it opened, and the call's request waits for
    /// that (it never opens the device alongside the test).
    #[test]
    fn a_call_asking_for_the_camera_while_a_test_opens_it_waits_and_the_test_gives_it_up() {
        let sources = Arc::new(FakeVideoSources::default());
        let (entered_tx, entered) = std::sync::mpsc::channel();
        let (release, release_rx) = std::sync::mpsc::channel::<()>();
        *sources.hold_next_camera.lock().unwrap() = Some(crate::testing::StartHold {
            entered: entered_tx,
            release: release_rx,
        });
        let engine = Arc::new(engine(sources.clone(), Arc::new(Sink::default())));
        let tester = {
            let engine = engine.clone();
            std::thread::spawn(move || engine.start_camera_test().map(|test| test.is_running()))
        };
        entered
            .recv_timeout(Duration::from_secs(5))
            .expect("the test opens its camera");
        let (done_tx, done) = std::sync::mpsc::channel();
        let caller = {
            let engine = engine.clone();
            std::thread::spawn(move || {
                let runtime = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .unwrap();
                // No call to send it in: it fails after the hand-over, which is what matters.
                let result = runtime.block_on(engine.set_camera(true));
                let _ = done_tx.send(());
                result
            })
        };
        // The call's request is waiting on the test's open, not past it.
        assert!(
            done.recv_timeout(Duration::from_millis(300)).is_err(),
            "set_camera went on while the test's camera was opening"
        );
        drop(release);
        assert_eq!(
            tester.join().unwrap().err().as_deref(),
            Some(CAMERA_IN_USE),
            "the test gave the camera up"
        );
        let camera = sources.last_camera().expect("the test's capture");
        assert!(camera.stopped(), "closed before the call went on");
        let _ = caller.join().unwrap();
        assert_eq!(
            sources.camera_requests(),
            vec![None],
            "only the test opened it"
        );
    }

    /// A call's camera on its way (waiting its turn here): a test asked for now is refused, and
    /// opens nothing; once the request is over (it fails: no call), a test may run again.
    #[test]
    fn a_test_is_refused_while_the_calls_camera_is_starting() {
        let sources = Arc::new(FakeVideoSources::default());
        let engine = Arc::new(engine(sources.clone(), Arc::new(Sink::default())));
        let turn = engine.hold_local_ops();
        let caller = {
            let engine = engine.clone();
            std::thread::spawn(move || {
                let runtime = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .unwrap();
                runtime.block_on(engine.set_camera(true))
            })
        };
        eventually("the call's camera request is pending", || {
            engine.camera_start_pending()
        });
        assert_eq!(
            engine.start_camera_test().err().as_deref(),
            Some(CAMERA_IN_USE)
        );
        assert!(sources.camera_requests().is_empty(), "nothing opened");
        drop(turn);
        let _ = caller.join().unwrap();
        assert!(!engine.camera_start_pending());
        let test = engine.start_camera_test().expect("free again");
        eventually("the test runs", || test.frames() > 0);
    }

    #[test]
    fn a_missing_camera_says_why_and_no_test_runs() {
        let sources = Arc::new(FakeVideoSources::default());
        *sources.fail_next_camera.lock().unwrap() = Some("the camera is in use".into());
        let engine = engine(sources, Arc::new(Sink::default()));
        assert_eq!(
            engine.start_camera_test().err().as_deref(),
            Some("the camera is in use")
        );
    }

    #[test]
    fn no_window_surface_is_refused() {
        let engine = LiveKitEngine::new(EngineOptions {
            video_sources: Arc::new(FakeVideoSources::default()),
            ..EngineOptions::default()
        });
        assert!(engine.start_camera_test().is_err());
    }
}
