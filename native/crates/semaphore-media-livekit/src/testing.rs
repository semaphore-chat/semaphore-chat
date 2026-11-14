//! Tone generation and detection, shared by the real-server tests and the rig. A person is "heard"
//! when their own frequency dominates what actually came out of the mixer, not when the connection
//! says so.

use crate::audio::SAMPLE_RATE;
use std::sync::{Arc, Mutex};

/// A mic that plays a sine.
pub struct ToneMic {
    step: f64,
    phase: f64,
    amplitude: f64,
}

impl ToneMic {
    pub fn new(hz: f64, amplitude: f64) -> Self {
        Self {
            step: 2.0 * std::f64::consts::PI * hz / f64::from(SAMPLE_RATE),
            phase: 0.0,
            amplitude,
        }
    }

    pub fn fill(&mut self, out: &mut [i16]) {
        for sample in out {
            *sample = (self.phase.sin() * self.amplitude * f64::from(i16::MAX)) as i16;
            self.phase += self.step;
        }
        self.phase %= 2.0 * std::f64::consts::PI;
    }
}

/// Energy at `hz` as a share of the window's total, from the Goertzel recurrence.
pub fn tone_share(samples: &[f64], hz: f64) -> f64 {
    let energy: f64 = samples.iter().map(|sample| sample * sample).sum();
    if energy == 0.0 {
        return 0.0;
    }
    let omega = 2.0 * std::f64::consts::PI * hz / f64::from(SAMPLE_RATE);
    let coefficient = 2.0 * omega.cos();
    let (mut previous, mut before) = (0.0, 0.0);
    for sample in samples {
        let current = sample + coefficient * previous - before;
        before = previous;
        previous = current;
    }
    let power = previous * previous + before * before - coefficient * previous * before;
    // A pure sine's bin power is total_energy * N / 2.
    power / (energy * samples.len() as f64 / 2.0)
}

/// The RMS amplitude of the part of the signal at `hz`.
pub fn tone_rms(samples: &[f64], hz: f64) -> f64 {
    let energy: f64 = samples.iter().map(|sample| sample * sample).sum();
    (tone_share(samples, hz) * energy / samples.len() as f64).sqrt()
}

/// Keeps the last `window` samples a speaker played, for measuring from another thread.
#[derive(Clone)]
pub struct SpeakerTap {
    samples: Arc<Mutex<Vec<f64>>>,
    window: usize,
}

impl SpeakerTap {
    pub fn new(window: usize) -> Self {
        Self {
            samples: Arc::default(),
            window,
        }
    }

    pub fn push(&self, frame: &[i16]) {
        let mut samples = self.samples.lock().unwrap_or_else(|p| p.into_inner());
        samples.extend(frame.iter().map(|sample| f64::from(*sample)));
        let excess = samples.len().saturating_sub(self.window);
        samples.drain(..excess);
    }

    /// The window's RMS at `hz`, or 0 if it isn't full yet.
    pub fn rms_at(&self, hz: f64) -> f64 {
        let samples = self.samples.lock().unwrap_or_else(|p| p.into_inner());
        if samples.len() < self.window {
            return 0.0;
        }
        tone_rms(&samples, hz)
    }

    pub fn share_at(&self, hz: f64) -> f64 {
        let samples = self.samples.lock().unwrap_or_else(|p| p.into_inner());
        tone_share(&samples, hz)
    }
}

/// What a test sees of one fake capture, and how it ends it.
#[derive(Default)]
pub struct FakeVideoControl {
    frames: std::sync::atomic::AtomicU64,
    stopped: std::sync::atomic::AtomicBool,
    end: Mutex<Option<std::sync::mpsc::Sender<String>>>,
}

impl FakeVideoControl {
    /// Frames handed to the engine so far.
    pub fn frames(&self) -> u64 {
        self.frames.load(std::sync::atomic::Ordering::Relaxed)
    }

    /// The engine dropped the capture.
    pub fn stopped(&self) -> bool {
        self.stopped.load(std::sync::atomic::Ordering::Relaxed)
    }

    /// Ends the capture on its own, as a closed window or the system's "stop sharing" does.
    pub fn end(&self, why: &str) {
        if let Some(end) = lock(&self.end).take() {
            let _ = end.send(why.to_owned());
        }
    }
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|p| p.into_inner())
}

/// Known frames at a fixed size and rate: BGRA for a screen, I420 for a camera, as the real
/// sources give them. The luma steps every frame, so a viewer can tell the picture is live.
pub struct FakeVideoSource {
    width: u32,
    height: u32,
    fps: u32,
    i420: bool,
    control: Arc<FakeVideoControl>,
    hold: Option<StartHold>,
}

/// Holds a fake source's `start` (a slow camera opening) until the test lets it go: `start` sends
/// on `entered`, then waits for `release` to send or be dropped.
pub struct StartHold {
    pub entered: std::sync::mpsc::Sender<()>,
    pub release: std::sync::mpsc::Receiver<()>,
}

impl FakeVideoSource {
    pub fn screen(width: u32, height: u32, fps: u32) -> (Self, Arc<FakeVideoControl>) {
        Self::new(width, height, fps, false)
    }

    pub fn camera(width: u32, height: u32, fps: u32) -> (Self, Arc<FakeVideoControl>) {
        Self::new(width, height, fps, true)
    }

    fn new(width: u32, height: u32, fps: u32, i420: bool) -> (Self, Arc<FakeVideoControl>) {
        let control = Arc::new(FakeVideoControl::default());
        (
            Self {
                width,
                height,
                fps: fps.max(1),
                i420,
                control: control.clone(),
                hold: None,
            },
            control,
        )
    }
}

struct FakeRunning {
    stop: Option<std::sync::mpsc::Sender<String>>,
    thread: Option<std::thread::JoinHandle<()>>,
    control: Arc<FakeVideoControl>,
}

impl Drop for FakeRunning {
    fn drop(&mut self) {
        drop(self.stop.take());
        lock(&self.control.end).take();
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
        self.control
            .stopped
            .store(true, std::sync::atomic::Ordering::Relaxed);
    }
}

impl crate::video::local::VideoCaptureSource for FakeVideoSource {
    fn start(
        self: Box<Self>,
        mut on_frame: crate::video::local::OnFrame,
        on_ended: crate::video::local::OnEnded,
    ) -> Result<crate::video::local::Capturing, String> {
        use crate::video::local::SourceFrame;
        use std::sync::mpsc::RecvTimeoutError;
        if let Some(hold) = &self.hold {
            let _ = hold.entered.send(());
            let _ = hold.release.recv();
        }
        // One channel for both a stop (the sender dropped) and an end (a reason sent).
        let (tx, rx) = std::sync::mpsc::channel::<String>();
        *lock(&self.control.end) = Some(tx.clone());
        let control = self.control.clone();
        let (width, height, i420) = (self.width, self.height, self.i420);
        let period = std::time::Duration::from_secs_f64(1.0 / self.fps as f64);
        let thread = std::thread::Builder::new()
            .name("fake-video".into())
            .spawn(move || {
                let mut frame = 0u32;
                let (chroma_w, chroma_h) = (width.div_ceil(2), height.div_ceil(2));
                let mut y = vec![0u8; (width * height) as usize];
                let uv = vec![128u8; (chroma_w * chroma_h) as usize];
                let mut bgra = vec![0u8; (width * height * 4) as usize];
                loop {
                    let level = 16 + (frame * 8 % 200) as u8;
                    if i420 {
                        y.fill(level);
                        on_frame(SourceFrame::I420 {
                            width,
                            height,
                            y: &y,
                            stride_y: width,
                            u: &uv,
                            stride_u: chroma_w,
                            v: &uv,
                            stride_v: chroma_w,
                        });
                    } else {
                        for pixel in bgra.as_chunks_mut::<4>().0 {
                            pixel.copy_from_slice(&[level, level, level, 255]);
                        }
                        on_frame(SourceFrame::Bgra {
                            width,
                            height,
                            stride: width * 4,
                            data: &bgra,
                        });
                    }
                    frame += 1;
                    control
                        .frames
                        .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                    // Waits for the next frame's time, or a stop or an end.
                    match rx.recv_timeout(period) {
                        Err(RecvTimeoutError::Timeout) => {}
                        Ok(why) => {
                            on_ended(why);
                            return;
                        }
                        Err(RecvTimeoutError::Disconnected) => return,
                    }
                }
            })
            .map_err(|error| error.to_string())?;
        drop(tx);
        Ok(crate::video::local::Capturing::new(FakeRunning {
            stop: lock(&self.control.end).clone(),
            thread: Some(thread),
            control: self.control.clone(),
        }))
    }
}

/// Fake cameras and screens for the engine: each start makes a new [`FakeVideoSource`] whose
/// control is kept here, and a start can be made to fail.
pub struct FakeVideoSources {
    pub camera_size: (u32, u32),
    pub screen_size: (u32, u32),
    pub fail_next_camera: Mutex<Option<String>>,
    pub fail_next_screen: Mutex<Option<String>>,
    pub cameras: Mutex<Vec<Arc<FakeVideoControl>>>,
    pub screens: Mutex<Vec<Arc<FakeVideoControl>>>,
    pub screen_requests: Mutex<Vec<semaphore_core::model::ScreenShareRequest>>,
    /// The device each camera start asked for, in order (`None` = the first camera).
    camera_requests: Mutex<Vec<Option<String>>>,
    /// The next camera's `start` waits on this.
    pub hold_next_camera: Mutex<Option<StartHold>>,
}

impl Default for FakeVideoSources {
    fn default() -> Self {
        Self {
            camera_size: (1280, 720),
            screen_size: (1920, 1080),
            fail_next_camera: Mutex::default(),
            fail_next_screen: Mutex::default(),
            cameras: Mutex::default(),
            screens: Mutex::default(),
            screen_requests: Mutex::default(),
            camera_requests: Mutex::default(),
            hold_next_camera: Mutex::default(),
        }
    }
}

impl FakeVideoSources {
    pub fn last_camera(&self) -> Option<Arc<FakeVideoControl>> {
        lock(&self.cameras).last().cloned()
    }

    pub fn last_screen(&self) -> Option<Arc<FakeVideoControl>> {
        lock(&self.screens).last().cloned()
    }

    /// The device each camera start asked for, in order.
    pub fn camera_requests(&self) -> Vec<Option<String>> {
        lock(&self.camera_requests).clone()
    }
}

impl crate::video::local::VideoSources for FakeVideoSources {
    fn camera(
        &self,
        device: Option<&str>,
    ) -> Result<Box<dyn crate::video::local::VideoCaptureSource>, String> {
        lock(&self.camera_requests).push(device.map(str::to_owned));
        if let Some(why) = lock(&self.fail_next_camera).take() {
            return Err(why);
        }
        let (width, height) = self.camera_size;
        let (mut source, control) = FakeVideoSource::camera(width, height, 30);
        source.hold = lock(&self.hold_next_camera).take();
        lock(&self.cameras).push(control);
        Ok(Box::new(source))
    }

    /// Two cameras for the settings page's list and the end-to-end run; either start gives the
    /// same picture.
    fn cameras(&self) -> Vec<(String, String)> {
        vec![
            ("rig-camera".into(), "Rig camera".into()),
            ("rig-camera-2".into(), "Rig camera 2".into()),
        ]
    }

    fn screen(
        &self,
        request: &semaphore_core::model::ScreenShareRequest,
    ) -> Result<Box<dyn crate::video::local::VideoCaptureSource>, String> {
        lock(&self.screen_requests).push(request.clone());
        if let Some(why) = lock(&self.fail_next_screen).take() {
            return Err(why);
        }
        let (width, height) = self.screen_size;
        let (source, control) = FakeVideoSource::screen(width, height, request.fps);
        lock(&self.screens).push(control);
        Ok(Box::new(source))
    }
}

/// System audio for a screen share in tests: silence, or a failure, without PipeWire or WASAPI.
#[derive(Default)]
pub struct FakeSystemAudio {
    pub fail_with: Mutex<Option<String>>,
    pub starts: std::sync::atomic::AtomicU32,
}

impl crate::audio::system::SystemAudioCapture for FakeSystemAudio {
    fn support(&self) -> crate::audio::system::SystemAudioSupport {
        crate::audio::system::SystemAudioSupport::Supported
    }

    fn start(
        &self,
        _scope: crate::audio::system::CaptureScope,
        _on_audio: crate::audio::system::SystemAudioCallback,
        _on_error: crate::audio::ErrorCallback,
    ) -> Result<crate::audio::AudioStream, String> {
        self.starts
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        match lock(&self.fail_with).clone() {
            Some(why) => Err(why),
            None => Ok(crate::audio::AudioStream::new(())),
        }
    }
}
