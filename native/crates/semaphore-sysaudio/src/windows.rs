//! WASAPI process loopback: everything rendered on the machine except by our process tree.
//!
//! `ActivateAudioInterfaceAsync` on `VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK` with
//! `PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE` and our own PID: the call audio is played
//! by cpal's WASAPI output inside this process, so it is left out by the OS, not by us. This is
//! what Chromium's `loopbackWithoutChrome` does for the Electron client.
//!
//! Needs Windows 10 2004 (build 19041) or later; the documented minimum is build 20348. On
//! anything older activation fails, `start` returns the error, and the app shares without audio.
//!
//! First run on Windows 11 (2026-11-10) crashed in activation; see `activate`. Not yet passed.

use crate::{CHANNELS as SYSTEM_AUDIO_CHANNELS, RATE as SYSTEM_AUDIO_RATE};
use crate::{
    Capturing, OnAudio as SystemAudioCallback, OnError as ErrorCallback,
    Support as SystemAudioSupport,
};
use std::thread::JoinHandle;
use std::time::Duration;
use windows::Win32::Foundation::{HANDLE, WAIT_OBJECT_0};
use windows::Win32::Media::Audio::{
    AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,
    AUDCLNT_STREAMFLAGS_EVENTCALLBACK, AUDCLNT_STREAMFLAGS_LOOPBACK,
    AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY, AUDIOCLIENT_ACTIVATION_PARAMS,
    AUDIOCLIENT_ACTIVATION_PARAMS_0, AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
    AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS, ActivateAudioInterfaceAsync,
    IActivateAudioInterfaceAsyncOperation, IActivateAudioInterfaceCompletionHandler,
    IActivateAudioInterfaceCompletionHandler_Impl, IAudioCaptureClient, IAudioClient,
    PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE,
    PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE, VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
    WAVEFORMATEX,
};
use windows::Win32::System::Com::StructuredStorage::{
    PROPVARIANT, PROPVARIANT_0, PROPVARIANT_0_0, PROPVARIANT_0_0_0,
};
use windows::Win32::System::Com::{BLOB, COINIT_MULTITHREADED, CoInitializeEx, CoUninitialize};
use windows::Win32::System::Threading::{
    CreateEventW, GetCurrentProcessId, SetEvent, WaitForMultipleObjects, WaitForSingleObject,
};
use windows::Win32::System::Variant::VT_BLOB;
use windows::core::{Interface, implement};

const WAVE_FORMAT_IEEE_FLOAT: u16 = 3;
const ACTIVATE_TIMEOUT_MS: u32 = 5_000;
/// 20 ms, in 100 ns units.
const BUFFER_DURATION: i64 = 200_000;

#[derive(Debug, Clone, Default)]
pub struct ProcessLoopbackCapture {
    only_own: bool,
}

impl ProcessLoopbackCapture {
    /// T11's negative control only: captures our own process tree and nothing else, so the call
    /// audio must be heard. Proves the detector works on Windows. Never use it in the app.
    pub fn negative_control() -> Self {
        Self { only_own: true }
    }
}

impl ProcessLoopbackCapture {
    /// Whether activation works is only known by trying, so this says yes on Windows and `start`
    /// reports anything else (old builds, no render device).
    pub fn support(&self) -> SystemAudioSupport {
        SystemAudioSupport::Supported
    }

    /// Starts capturing everything except our own process. Dropping the result stops it.
    pub fn start_capture(
        &self,
        on_audio: SystemAudioCallback,
        on_error: ErrorCallback,
    ) -> Result<Capturing, String> {
        let only_own = self.only_own;
        let stop = Event::new()?;
        let stop_for_thread = stop.raw();
        let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<(), String>>();
        let thread = std::thread::Builder::new()
            .name("semaphore-sysaudio".into())
            .spawn(move || {
                let result = unsafe {
                    capture_thread(only_own, stop_for_thread, on_audio, &on_error, &ready_tx)
                };
                if let Err(error) = result {
                    // Before ready, the caller gets it; after, the error callback does.
                    if ready_tx.send(Err(error.clone())).is_err() {
                        on_error(error);
                    }
                }
            })
            .map_err(|error| error.to_string())?;
        let running = Running {
            stop,
            thread: Some(thread),
        };
        match ready_rx.recv_timeout(Duration::from_millis(
            u64::from(ACTIVATE_TIMEOUT_MS) + 1_000,
        )) {
            Ok(Ok(())) => Ok(Capturing::new(running)),
            Ok(Err(error)) => Err(error),
            Err(_) => Err("process loopback did not start within 6 s".into()),
        }
    }
}

/// An auto-reset event, closed on drop. Kept as an integer so it can cross threads.
struct Event(isize);

impl Event {
    fn new() -> Result<Self, String> {
        let handle =
            unsafe { CreateEventW(None, false, false, None) }.map_err(|e| e.to_string())?;
        Ok(Self(handle.0 as isize))
    }

    fn raw(&self) -> isize {
        self.0
    }
}

impl Drop for Event {
    fn drop(&mut self) {
        let _ = unsafe { windows::Win32::Foundation::CloseHandle(HANDLE(self.0 as *mut _)) };
    }
}

struct Running {
    stop: Event,
    thread: Option<JoinHandle<()>>,
}

impl Drop for Running {
    fn drop(&mut self) {
        let _ = unsafe { SetEvent(HANDLE(self.stop.raw() as *mut _)) };
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

#[implement(IActivateAudioInterfaceCompletionHandler)]
struct Completion {
    done: isize,
}

impl IActivateAudioInterfaceCompletionHandler_Impl for Completion_Impl {
    fn ActivateCompleted(
        &self,
        _operation: windows::core::Ref<'_, IActivateAudioInterfaceAsyncOperation>,
    ) -> windows::core::Result<()> {
        unsafe { SetEvent(HANDLE(self.done as *mut _)) }
    }
}

fn win(error: windows::core::Error) -> String {
    format!("WASAPI: {error}")
}

unsafe fn activate(only_own: bool) -> Result<IAudioClient, String> {
    let mut params = AUDIOCLIENT_ACTIVATION_PARAMS {
        ActivationType: AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
        Anonymous: AUDIOCLIENT_ACTIVATION_PARAMS_0 {
            ProcessLoopbackParams: AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
                TargetProcessId: unsafe { GetCurrentProcessId() },
                ProcessLoopbackMode: if only_own {
                    PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE
                } else {
                    PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE
                },
            },
        },
    };
    // Never dropped: PROPVARIANT's Drop is PropVariantClear, which would CoTaskMemFree the blob,
    // and the blob is `params` on our stack (heap corruption 0xC0000374, seen on Windows 11).
    let variant = std::mem::ManuallyDrop::new(PROPVARIANT {
        Anonymous: PROPVARIANT_0 {
            Anonymous: std::mem::ManuallyDrop::new(PROPVARIANT_0_0 {
                vt: VT_BLOB,
                wReserved1: 0,
                wReserved2: 0,
                wReserved3: 0,
                Anonymous: PROPVARIANT_0_0_0 {
                    blob: BLOB {
                        cbSize: std::mem::size_of::<AUDIOCLIENT_ACTIVATION_PARAMS>() as u32,
                        pBlobData: (&raw mut params).cast(),
                    },
                },
            }),
        },
    });
    let done = Event::new()?;
    let handler: IActivateAudioInterfaceCompletionHandler = Completion { done: done.raw() }.into();
    let operation = unsafe {
        ActivateAudioInterfaceAsync(
            VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
            &IAudioClient::IID,
            Some(&raw const *variant),
            &handler,
        )
    }
    .map_err(win)?;
    if unsafe { WaitForSingleObject(HANDLE(done.raw() as *mut _), ACTIVATE_TIMEOUT_MS) }
        != WAIT_OBJECT_0
    {
        return Err("process loopback activation timed out".into());
    }
    let mut result = windows::core::HRESULT(0);
    let mut unknown = None;
    unsafe { operation.GetActivateResult(&mut result, &mut unknown) }.map_err(win)?;
    result.ok().map_err(win)?;
    unknown
        .ok_or_else(|| "process loopback gave no interface".to_owned())?
        .cast::<IAudioClient>()
        .map_err(win)
}

unsafe fn capture_thread(
    only_own: bool,
    stop: isize,
    mut on_audio: SystemAudioCallback,
    on_error: &ErrorCallback,
    ready: &std::sync::mpsc::Sender<Result<(), String>>,
) -> Result<(), String> {
    unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }
        .ok()
        .map_err(win)?;
    struct Com;
    impl Drop for Com {
        fn drop(&mut self) {
            unsafe { CoUninitialize() };
        }
    }
    let _com = Com;

    let client = unsafe { activate(only_own) }?;
    // Process loopback has no mix format to ask for (GetMixFormat isn't implemented): we name
    // ours and AUTOCONVERTPCM makes the engine convert to it.
    let channels = SYSTEM_AUDIO_CHANNELS as u16;
    let format = WAVEFORMATEX {
        wFormatTag: WAVE_FORMAT_IEEE_FLOAT,
        nChannels: channels,
        nSamplesPerSec: SYSTEM_AUDIO_RATE,
        nAvgBytesPerSec: SYSTEM_AUDIO_RATE * u32::from(channels) * 4,
        nBlockAlign: channels * 4,
        wBitsPerSample: 32,
        cbSize: 0,
    };
    unsafe {
        client.Initialize(
            AUDCLNT_SHAREMODE_SHARED,
            AUDCLNT_STREAMFLAGS_LOOPBACK
                | AUDCLNT_STREAMFLAGS_EVENTCALLBACK
                | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM
                | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
            BUFFER_DURATION,
            0,
            &format,
            None,
        )
    }
    .map_err(win)?;
    let data = Event::new()?;
    unsafe { client.SetEventHandle(HANDLE(data.raw() as *mut _)) }.map_err(win)?;
    let capture: IAudioCaptureClient = unsafe { client.GetService() }.map_err(win)?;
    unsafe { client.Start() }.map_err(win)?;
    let _ = ready.send(Ok(()));

    let handles = [HANDLE(data.raw() as *mut _), HANDLE(stop as *mut _)];
    let mut scratch: Vec<f32> = Vec::with_capacity(8192);
    loop {
        let woke = unsafe { WaitForMultipleObjects(&handles, false, 200) };
        if woke.0 == WAIT_OBJECT_0.0 + 1 {
            break;
        }
        loop {
            let frames = match unsafe { capture.GetNextPacketSize() } {
                Ok(0) => break,
                Ok(frames) => frames,
                Err(error) => {
                    on_error(win(error));
                    let _ = unsafe { client.Stop() };
                    return Ok(());
                }
            };
            let mut buffer = std::ptr::null_mut();
            let mut got = frames;
            let mut flags = 0u32;
            if let Err(error) =
                unsafe { capture.GetBuffer(&mut buffer, &mut got, &mut flags, None, None) }
            {
                on_error(win(error));
                let _ = unsafe { client.Stop() };
                return Ok(());
            }
            let samples = got as usize * SYSTEM_AUDIO_CHANNELS;
            scratch.clear();
            if flags & (AUDCLNT_BUFFERFLAGS_SILENT.0 as u32) != 0 || buffer.is_null() {
                scratch.resize(samples, 0.0);
            } else {
                scratch.extend_from_slice(unsafe {
                    std::slice::from_raw_parts(buffer.cast::<f32>(), samples)
                });
            }
            let _ = unsafe { capture.ReleaseBuffer(got) };
            if !scratch.is_empty() {
                on_audio(&scratch);
            }
        }
    }
    let _ = unsafe { client.Stop() };
    Ok(())
}
