//! Real sound cards through cpal. On Linux that is PulseAudio's protocol when a pulse socket exists
//! (PipeWire provides one), otherwise ALSA; on Windows, WASAPI.

use super::{
    AudioDevice, AudioDevices, AudioIo, AudioStream, ErrorCallback, InputCallback, OutputCallback,
    SAMPLE_RATE,
};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{
    BufferSize, DeviceId, FromSample, SampleFormat, SizedSample, StreamConfig, SupportedBufferSize,
};
use std::sync::{Mutex, mpsc};

/// Enumeration runs on one thread with one `Host`, because the device watcher asks every couple of
/// seconds, and a `Host` on PulseAudio is a client connection the server would see come and go.
pub struct CpalIo {
    requests: Mutex<mpsc::Sender<mpsc::Sender<Result<AudioDevices, String>>>>,
}

impl Default for CpalIo {
    fn default() -> Self {
        let (requests, incoming) = mpsc::channel::<mpsc::Sender<Result<AudioDevices, String>>>();
        std::thread::spawn(move || {
            let mut host = cpal::default_host();
            while let Ok(reply) = incoming.recv() {
                let mut result = list_devices(&host);
                if result.is_err() {
                    // The sound server restarted, as PipeWire does after an update.
                    host = cpal::default_host();
                    result = list_devices(&host);
                }
                let _ = reply.send(result);
            }
        });
        Self {
            requests: Mutex::new(requests),
        }
    }
}

/// A sink's monitor is an input as far as PulseAudio cares, and never what a user means by "mic".
fn is_monitor(id: &str, name: &str) -> bool {
    id.ends_with(".monitor") || name.starts_with("Monitor of ")
}

fn device_id(device: &cpal::Device) -> Option<String> {
    device.id().ok().map(|id| id.to_string())
}

fn device_name(device: &cpal::Device) -> String {
    device
        .description()
        .map(|description| description.name().to_owned())
        .unwrap_or_else(|_| "Unknown device".to_owned())
}

fn pick(host: &cpal::Host, device: Option<&str>, input: bool) -> Result<cpal::Device, String> {
    match device {
        Some(id) => {
            let parsed: DeviceId = id.parse().map_err(|e| format!("device id {id}: {e}"))?;
            host.device_by_id(&parsed)
                .ok_or_else(|| format!("no such device: {id}"))
        }
        None => if input {
            host.default_input_device()
        } else {
            host.default_output_device()
        }
        .ok_or_else(|| "no default audio device".to_owned()),
    }
}

/// Linear interpolation between device rate and 48 kHz. Speech only needs this on the rare device
/// that refuses 48 kHz outright.
struct Resampler {
    step: f64,
    position: f64,
    previous: f64,
}

impl Resampler {
    fn new(from: u32, to: u32) -> Self {
        Self {
            step: f64::from(from) / f64::from(to),
            position: 0.0,
            previous: 0.0,
        }
    }

    fn run(&mut self, input: &[f64], mut emit: impl FnMut(f64)) {
        for sample in input {
            while self.position < 1.0 {
                emit(self.previous + (sample - self.previous) * self.position);
                self.position += self.step;
            }
            self.position -= 1.0;
            self.previous = *sample;
        }
    }
}

/// 20 ms a chunk. PulseAudio's end-to-end target is then 40 ms, a little over what PipeWire's usual
/// quantum needs on a loaded machine.
fn buffer_frames(sample_rate: u32) -> u32 {
    sample_rate / 50
}

fn stream_config(
    default: cpal::SupportedStreamConfig,
    ranges: impl Iterator<Item = cpal::SupportedStreamConfigRange>,
) -> (StreamConfig, SampleFormat) {
    let format = default.sample_format();
    let channels = default.channels();
    let buffers = *default.buffer_size();
    let wants_48k = ranges.into_iter().any(|range| {
        range.channels() == channels
            && range.sample_format() == format
            && range.min_sample_rate() <= SAMPLE_RATE
            && range.max_sample_rate() >= SAMPLE_RATE
    });
    let mut config: StreamConfig = default.into();
    if wants_48k {
        config.sample_rate = SAMPLE_RATE;
    }
    // Left to itself PulseAudio buffers two seconds, which is measured, and fatal to a conversation
    // and to echo cancellation. Where a device has no range to ask within, its default stands.
    if let SupportedBufferSize::Range { min, max } = buffers {
        config.buffer_size = BufferSize::Fixed(buffer_frames(config.sample_rate).clamp(min, max));
    }
    (config, format)
}

fn build_input<T>(
    device: &cpal::Device,
    config: StreamConfig,
    mut on_audio: InputCallback,
    on_error: ErrorCallback,
) -> Result<cpal::Stream, cpal::Error>
where
    T: SizedSample,
    i16: FromSample<T>,
{
    let channels = usize::from(config.channels.max(1));
    let rate = config.sample_rate;
    let mut resampler = Resampler::new(rate, SAMPLE_RATE);
    let mut mono: Vec<i16> = Vec::new();
    let mut raw: Vec<f64> = Vec::new();
    device.build_input_stream::<T, _, _>(
        config,
        move |data: &[T], info: &cpal::InputCallbackInfo| {
            mono.clear();
            raw.clear();
            raw.extend(data.chunks_exact(channels).map(|frame| {
                let sum: i64 = frame.iter().map(|s| i64::from(s.to_sample::<i16>())).sum();
                (sum / channels as i64) as f64
            }));
            if rate == SAMPLE_RATE {
                mono.extend(raw.iter().map(|sample| *sample as i16));
            } else {
                resampler.run(&raw, |sample| mono.push(sample as i16));
            }
            let timestamp = info.timestamp();
            let latency = timestamp
                .callback
                .duration_since(timestamp.capture)
                .as_millis() as u32;
            on_audio(&mono, latency);
        },
        move |error| on_error(error.to_string()),
        None,
    )
}

fn build_output<T>(
    device: &cpal::Device,
    config: StreamConfig,
    mut on_audio: OutputCallback,
    on_error: ErrorCallback,
) -> Result<cpal::Stream, cpal::Error>
where
    T: SizedSample + FromSample<i16>,
{
    let channels = usize::from(config.channels.max(1));
    let rate = config.sample_rate;
    let mut resampler = Resampler::new(SAMPLE_RATE, rate);
    let mut mono: Vec<i16> = Vec::new();
    let mut raw: Vec<f64> = Vec::new();
    let mut resampled: std::collections::VecDeque<i16> = Default::default();
    device.build_output_stream::<T, _, _>(
        config,
        move |data: &mut [T], info: &cpal::OutputCallbackInfo| {
            let frames = data.len() / channels;
            let timestamp = info.timestamp();
            let latency = timestamp
                .playback
                .duration_since(timestamp.callback)
                .as_millis() as u32;
            if rate == SAMPLE_RATE {
                mono.clear();
                mono.resize(frames, 0);
                on_audio(&mut mono, latency);
            } else {
                while resampled.len() < frames {
                    mono.clear();
                    mono.resize(super::FRAME_SAMPLES, 0);
                    on_audio(&mut mono, latency);
                    raw.clear();
                    raw.extend(mono.iter().map(|sample| f64::from(*sample)));
                    resampler.run(&raw, |sample| resampled.push_back(sample as i16));
                }
                mono.clear();
                mono.extend(resampled.drain(..frames));
            }
            for (frame, sample) in data.chunks_exact_mut(channels).zip(mono.iter()) {
                let converted = T::from_sample(*sample);
                frame.fill(converted);
            }
        },
        move |error| on_error(error.to_string()),
        None,
    )
}

/// cpal's stream isn't `Send` on every platform, so each one lives on a thread of its own, and
/// dropping the sender ends that thread and the stream with it.
fn on_stream_thread(
    build: impl FnOnce() -> Result<cpal::Stream, String> + Send + 'static,
) -> Result<AudioStream, String> {
    let (stop_tx, stop_rx) = mpsc::channel::<()>();
    let (ready_tx, ready_rx) = mpsc::channel();
    std::thread::spawn(move || {
        let stream = match build().and_then(|stream| {
            stream.play().map_err(|e| e.to_string())?;
            Ok(stream)
        }) {
            Ok(stream) => {
                let _ = ready_tx.send(Ok(()));
                stream
            }
            Err(error) => {
                let _ = ready_tx.send(Err(error));
                return;
            }
        };
        let _ = stop_rx.recv();
        drop(stream);
    });
    ready_rx
        .recv()
        .map_err(|_| "the audio thread exited".to_owned())??;
    Ok(AudioStream::new(stop_tx))
}

fn list_devices(host: &cpal::Host) -> Result<AudioDevices, String> {
    let default_in = host.default_input_device().as_ref().and_then(device_id);
    let default_out = host.default_output_device().as_ref().and_then(device_id);
    let mut devices = AudioDevices::default();
    for device in host.input_devices().map_err(|e| e.to_string())? {
        let (Some(id), name) = (device_id(&device), device_name(&device)) else {
            continue;
        };
        if !is_monitor(&id, &name) {
            devices.inputs.push(AudioDevice {
                is_default: default_in.as_deref() == Some(id.as_str()),
                id,
                name,
            });
        }
    }
    for device in host.output_devices().map_err(|e| e.to_string())? {
        let (Some(id), name) = (device_id(&device), device_name(&device)) else {
            continue;
        };
        devices.outputs.push(AudioDevice {
            is_default: default_out.as_deref() == Some(id.as_str()),
            id,
            name,
        });
    }
    Ok(devices)
}

impl AudioIo for CpalIo {
    fn devices(&self) -> Result<AudioDevices, String> {
        let (reply, answer) = mpsc::channel();
        self.requests
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .send(reply)
            .map_err(|_| "the device thread exited".to_owned())?;
        answer
            .recv()
            .map_err(|_| "the device thread exited".to_owned())?
    }

    fn open_input(
        &self,
        device: Option<&str>,
        on_audio: InputCallback,
        on_error: ErrorCallback,
    ) -> Result<AudioStream, String> {
        let device = device.map(str::to_owned);
        on_stream_thread(move || {
            let host = cpal::default_host();
            let device = pick(&host, device.as_deref(), true)?;
            let default = device.default_input_config().map_err(|e| e.to_string())?;
            let ranges = device
                .supported_input_configs()
                .map_err(|e| e.to_string())?;
            let (config, format) = stream_config(default, ranges);
            match format {
                SampleFormat::F32 => build_input::<f32>(&device, config, on_audio, on_error),
                SampleFormat::I16 => build_input::<i16>(&device, config, on_audio, on_error),
                SampleFormat::I32 => build_input::<i32>(&device, config, on_audio, on_error),
                other => return Err(format!("unsupported sample format {other:?}")),
            }
            .map_err(|e| e.to_string())
        })
    }

    fn open_output(
        &self,
        device: Option<&str>,
        on_audio: OutputCallback,
        on_error: ErrorCallback,
    ) -> Result<AudioStream, String> {
        let device = device.map(str::to_owned);
        on_stream_thread(move || {
            let host = cpal::default_host();
            let device = pick(&host, device.as_deref(), false)?;
            let default = device.default_output_config().map_err(|e| e.to_string())?;
            let ranges = device
                .supported_output_configs()
                .map_err(|e| e.to_string())?;
            let (config, format) = stream_config(default, ranges);
            match format {
                SampleFormat::F32 => build_output::<f32>(&device, config, on_audio, on_error),
                SampleFormat::I16 => build_output::<i16>(&device, config, on_audio, on_error),
                SampleFormat::I32 => build_output::<i32>(&device, config, on_audio, on_error),
                other => return Err(format!("unsupported sample format {other:?}")),
            }
            .map_err(|e| e.to_string())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resampling_keeps_the_rate_ratio() {
        let mut up = Resampler::new(44_100, 48_000);
        let mut count = 0;
        up.run(&vec![0.0; 44_100], |_| count += 1);
        assert!((47_990..=48_010).contains(&count), "got {count}");
    }

    #[test]
    fn monitors_are_not_mics() {
        assert!(is_monitor("pulseaudio:foo.monitor", "x"));
        assert!(is_monitor("pulseaudio:foo", "Monitor of Foo"));
        assert!(!is_monitor("pulseaudio:mic", "USB Microphone"));
    }
}
