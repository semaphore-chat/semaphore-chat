//! The replay buffer, capturing clips, and the clip library. Unit W4-core.
//!
//! The buffer starts by itself once our screen share in a channel call is published with its track
//! sids (`LocalMediaView::screen_tracks`; with its audio track's too when the share has audio), and
//! stops with the share or the call, as on the web (chosen for the owner, 2026-11-11).
//! `VoiceView::replay` shows it; `replayBufferStopped` and `replayBufferFailed` end it, and it isn't
//! started again for the same share; `egressSegmentsReady` reads the session again. The start
//! itself is in `State::w4_replay` (`calls.rs`).

use crate::cache::keys;
use crate::client::{Core, State};
use crate::commands::calls::ReplayOp;
use crate::model::{
    CaptureRequest, CapturedClip, Clip, ClipDestination, ClipsView, ErrorView, PreviewSegment,
    ReplayMinutes, ReplaySessionView, ReplayState, SegmentFailure, ViewKey, VoiceRoom,
};
use crate::platform::CoreError;
use crate::resync::unavailable;
use semaphore_wire::enums::{
    CaptureReplayDestination, ReplayDurationMinutes, ShareClipDestination,
};
use semaphore_wire::types as wire;

fn ended_state(error: Option<String>) -> ReplayState {
    match error {
        Some(message) => ReplayState::Failed { message },
        None => ReplayState::Off,
    }
}

fn clip_view(dto: &wire::ClipResponseDto) -> Clip {
    Clip {
        id: dto.id.clone(),
        file_id: dto.file_id.clone(),
        channel_id: dto.channel_id.clone(),
        duration_seconds: dto.duration_seconds.clamp(0, i64::from(u32::MAX)) as u32,
        is_public: dto.is_public,
        captured_at_ms: dto.captured_at.timestamp_millis(),
        download_url: dto.download_url.clone(),
        size_bytes: dto.size_bytes.max(0) as u64,
        filename: dto.filename.clone(),
        // `ClipResponseDto` names no type and no thumbnail: every clip the server makes is MP4.
        mime_type: "video/mp4".into(),
        has_thumbnail: false,
    }
}

fn uuid(id: &str, what: &str) -> Result<uuid::Uuid, CoreError> {
    id.parse().map_err(|_| CoreError::Failed {
        message: format!("{what} isn't a valid id"),
    })
}

fn wire_minutes(minutes: ReplayMinutes) -> ReplayDurationMinutes {
    match minutes {
        ReplayMinutes::One => ReplayDurationMinutes::M1,
        ReplayMinutes::Two => ReplayDurationMinutes::M2,
        ReplayMinutes::Five => ReplayDurationMinutes::M5,
        ReplayMinutes::Ten => ReplayDurationMinutes::M10,
    }
}

/// The segments of an HLS playlist, in order, with their `#EXTINF` lengths. Each URI's file name
/// is all the server's segment route needs, so a relative or absolute URI alike becomes
/// `{base}/api/livekit/replay/preview/segment/{file}`.
/// Whether a segment fetch that failed with this status is worth trying again.
fn segment_transient(status: u16, retryable: bool) -> bool {
    retryable || status == 0 || status == 429 || status >= 500
}

pub(crate) fn parse_playlist(text: &str, base: &str) -> Vec<PreviewSegment> {
    let mut segments = Vec::new();
    let mut duration_ms = None;
    for line in text.lines().map(str::trim) {
        if let Some(info) = line.strip_prefix("#EXTINF:") {
            let seconds = info.split(',').next().unwrap_or("").trim();
            duration_ms = seconds
                .parse::<f64>()
                .ok()
                .map(|seconds| (seconds * 1000.0).round().max(0.0) as u32);
        } else if !line.is_empty() && !line.starts_with('#') {
            let path = line.split(['?', '#']).next().unwrap_or(line);
            let file = path.rsplit('/').next().unwrap_or(path);
            segments.push(PreviewSegment {
                url: format!("{base}/api/livekit/replay/preview/segment/{file}"),
                duration_ms: duration_ms.take().unwrap_or(0),
            });
        }
    }
    segments
}

impl State {
    /// `replayBufferStopped` (no `error`) or `replayBufferFailed`: the server has no buffer now.
    /// While ours is starting its session isn't known yet, so the ended one is kept for the start
    /// to compare with its own.
    pub(crate) fn w4_replay_ended(&mut self, session_id: &str, error: Option<String>) {
        self.invalidate(&keys::op(keys::REPLAY_SESSION));
        match &self.voice.replay {
            ReplayState::Recording { session_id: ours } if ours == session_id => {
                self.w4.replay_live = false;
                self.voice.replay = ended_state(error);
                self.view_changed(ViewKey::Voice);
            }
            ReplayState::Starting => {
                self.w4.replay_ended.push((session_id.to_owned(), error));
            }
            _ => {}
        }
    }

    fn clip_changed(&mut self, clip_id: &str, change: impl Fn(&mut Vec<wire::ClipResponseDto>)) {
        for key in self
            .cache
            .keys_with_op(keys::CLIPS)
            .into_iter()
            .chain(self.cache.keys_with_op(keys::USER_CLIPS))
        {
            let Some(clips) = self.cache.clips_mut(&key) else {
                continue;
            };
            if !clips.iter().any(|clip| clip.id == clip_id) {
                continue;
            }
            change(clips);
            self.note_direct_update(&key);
            match key.op() {
                keys::CLIPS => self.view_changed(ViewKey::Clips),
                _ => self.view_changed(ViewKey::UserClips {
                    user_id: key.segments.get(1).cloned().unwrap_or_default(),
                }),
            }
        }
    }

    fn clips_view(&self, key: &crate::cache::QueryKey, mine: bool) -> ClipsView {
        ClipsView {
            state: self.load_of(key),
            clips: self
                .cache
                .clips(key)
                .map(|clips| clips.iter().map(clip_view).collect())
                .unwrap_or_default(),
            busy: if mine {
                self.w4.clips_busy.clone()
            } else {
                Vec::new()
            },
            error: if mine {
                self.w4.clips_error.clone()
            } else {
                None
            },
        }
    }
}

impl Core {
    /// The effect `State::w4_replay` queues: tell the server to buffer this call's share.
    pub(crate) async fn start_replay(&self, call: u64) {
        let services = self.services().cloned();
        let request = self.read(|state| {
            let Some(VoiceRoom::Channel { channel_id, .. }) = &state.voice.room else {
                return None;
            };
            let tracks = state.media.as_ref()?.local.screen_tracks.clone()?;
            (state.call == call && state.w4.replay_live)
                .then(|| (channel_id.clone(), tracks, state.me_id().to_owned()))
        });
        let (Some(services), Some((channel_id, tracks, me))) = (services, request) else {
            self.write(|state, _| state.w4_replay_op_done());
            return;
        };
        let result = match uuid(&channel_id, "the channel") {
            Ok(channel) => services
                .backend
                .livekit_controller_start_replay_buffer(wire::StartReplayBufferDto {
                    channel_id: channel,
                    room_name: Some(channel_id.clone()),
                    video_track_id: tracks.video_sid.clone(),
                    audio_track_id: tracks.audio_sid.clone(),
                    participant_identity: Some(me),
                })
                .await
                .map_err(|error| self.backend_failed(error)),
            Err(error) => Err(error),
        };
        self.write(|state, _| {
            state.w4_replay_op_done();
            let current = state.call == call
                && state.w4.replay_live
                && state.w4.replay_done_for.as_deref() == Some(tracks.video_sid.as_str());
            let ended = std::mem::take(&mut state.w4.replay_ended);
            match result {
                // The share or the call ended while this ran: stop what it started.
                Ok(_) if !current => state.w4_replay_op(ReplayOp::Stop),
                Ok(started) => {
                    let ended_already = ended
                        .into_iter()
                        .find(|(session, _)| *session == started.session_id);
                    state.voice.replay = match ended_already {
                        // It ended as it began: nothing to stop, and no restart for this share.
                        Some((_, error)) => {
                            state.w4.replay_live = false;
                            ended_state(error)
                        }
                        None => ReplayState::Recording {
                            session_id: started.session_id,
                        },
                    };
                    state.view_changed(ViewKey::Voice);
                }
                Err(_) if !current => {}
                Err(error) => {
                    log::warn!("starting the replay buffer failed: {error}");
                    state.w4.replay_live = false;
                    state.voice.replay = ReplayState::Failed {
                        message: error.to_string(),
                    };
                    state.view_changed(ViewKey::Voice);
                }
            }
        });
    }

    pub(crate) async fn stop_replay(&self) {
        if let Some(services) = self.services()
            && let Err(error) = services
                .backend
                .livekit_controller_stop_replay_buffer()
                .await
        {
            log::warn!("stopping the replay buffer failed: {error}");
        }
        self.write(|state, _| state.w4_replay_op_done());
    }

    /// The host calls this at `VoiceView::replay_audio_wait_until_ms`: past it, the buffer starts
    /// with the share's video alone. Harmless early or twice.
    pub fn expire_replay_audio_wait(&self) {
        self.write(|state, now| {
            if let Some((video, until)) = state.w4.replay_audio_wait.clone()
                && now >= until
            {
                state.w4.replay_audio_waived = Some(video);
            }
        });
    }

    /// What the buffer holds now, for the trim timeline (`ViewKey::ReplaySession`).
    pub fn replay_session(&self) -> ReplaySessionView {
        self.write(|state, _| {
            let key = keys::op(keys::REPLAY_SESSION);
            state.ensure_query(key.clone());
            let load = state.load_of(&key);
            let Some(info) = state.cache.replay_session(&key) else {
                return ReplaySessionView {
                    state: load,
                    ..ReplaySessionView::default()
                };
            };
            ReplaySessionView {
                state: load,
                active: info.has_active_session,
                total_segments: info
                    .total_segments
                    .unwrap_or(0)
                    .clamp(0, i64::from(u32::MAX)) as u32,
                total_seconds: info
                    .total_duration_seconds
                    .unwrap_or(0)
                    .clamp(0, i64::from(u32::MAX)) as u32,
                start_ms: info.buffer_start_time.map(|at| at.timestamp_millis()),
                end_ms: info.buffer_end_time.map(|at| at.timestamp_millis()),
            }
        })
    }

    /// The buffer's preview: its HLS segments in order, with URLs on this server that need the
    /// session's `Authorization`.
    pub async fn replay_preview(&self) -> Result<Vec<PreviewSegment>, CoreError> {
        let services = self
            .services()
            .ok_or_else(|| unavailable("the replay preview"))?;
        let base = self
            .read(|state| state.reading.server_url.clone())
            .ok_or_else(|| unavailable("the replay preview while signed out"))?;
        let playlist = services
            .backend
            .livekit_controller_get_preview_playlist()
            .await
            .map_err(|error| self.backend_failed(error))?;
        Ok(parse_playlist(&playlist, base.trim_end_matches('/')))
    }

    /// One preview segment's bytes (MPEG-TS), fetched with this session's token, for a player
    /// that can't add `Authorization` itself.
    pub async fn replay_segment(&self, segment: PreviewSegment) -> Result<Vec<u8>, CoreError> {
        self.fetch_replay_segment(segment)
            .await
            .map_err(|failure| failure.error)
    }

    /// [`Core::replay_segment`], saying whether a failure is worth retrying: no response, a 5xx
    /// or a 429 is; a refusal (4xx), a URL that isn't a segment or no session isn't. For the
    /// desktop player's segment reader.
    pub async fn fetch_replay_segment(
        &self,
        segment: PreviewSegment,
    ) -> Result<Vec<u8>, SegmentFailure> {
        let lasting = |error| SegmentFailure {
            transient: false,
            error,
        };
        let services = self
            .services()
            .ok_or_else(|| lasting(unavailable("the replay preview")))?;
        let file = segment
            .url
            .rsplit('/')
            .next()
            .filter(|file| !file.is_empty())
            .ok_or_else(|| {
                lasting(CoreError::Failed {
                    message: "not a replay segment".into(),
                })
            })?;
        services
            .backend
            .livekit_controller_get_preview_segment(file.to_owned())
            .await
            .map_err(|error| SegmentFailure {
                transient: segment_transient(error.status, error.retryable),
                error: self.backend_failed(error),
            })
    }

    /// The last `minutes` of the buffer as MP4 bytes, saved nowhere on the server ("Download only",
    /// `GET replay/stream`). The host writes them where the user chose, as it does an attachment's
    /// bytes from `Core::file`.
    pub async fn download_replay(&self, minutes: ReplayMinutes) -> Result<Vec<u8>, CoreError> {
        let services = self
            .services()
            .ok_or_else(|| unavailable("downloading a replay"))?;
        services
            .backend
            .livekit_controller_stream_replay(wire_minutes(minutes))
            .await
            .map_err(|error| self.backend_failed(error))
    }

    /// Saves the last `minutes` (trimmed when asked) as a clip, to the library or posted to a
    /// channel or DM. A trim must end after it starts, within the window.
    pub async fn capture_replay(&self, request: CaptureRequest) -> Result<CapturedClip, CoreError> {
        let services = self
            .services()
            .ok_or_else(|| unavailable("capturing a replay"))?;
        // A trim counts from the buffer's start, which holds about 20 minutes: it's checked
        // against the buffer's length when that's been read, not against `minutes`.
        let buffered = self.read(|state| {
            state
                .cache
                .replay_session(&keys::op(keys::REPLAY_SESSION))
                .filter(|info| info.has_active_session)
                .and_then(|info| info.total_duration_seconds)
                .filter(|seconds| *seconds > 0)
        });
        if let Some(trim) = request.trim
            && (trim.end_seconds <= trim.start_seconds
                || buffered.is_some_and(|seconds| i64::from(trim.end_seconds) > seconds))
        {
            return Err(CoreError::Failed {
                message: "The trim has to end after it starts, within the replay".into(),
            });
        }
        let (destination, channel, dm) = match &request.destination {
            ClipDestination::Library => (CaptureReplayDestination::Library, None, None),
            ClipDestination::Channel { channel_id } => (
                CaptureReplayDestination::Channel,
                Some(uuid(channel_id, "the channel")?),
                None,
            ),
            ClipDestination::Dm { dm_group_id } => (
                CaptureReplayDestination::Dm,
                None,
                Some(uuid(dm_group_id, "the DM")?),
            ),
        };
        let body = wire::CaptureReplayDto {
            destination,
            // With a range the server ignores the preset, and checks the range only without one
            // (by truthiness, #669: a start of 0 counts as absent there, but the range is still
            // taken, since the server tests `!== undefined`, and the end is never 0).
            duration_minutes: request
                .trim
                .is_none()
                .then(|| wire_minutes(request.minutes)),
            start_seconds: request.trim.map(|trim| u64::from(trim.start_seconds)),
            end_seconds: request
                .trim
                .and_then(|trim| std::num::NonZeroU64::new(u64::from(trim.end_seconds))),
            target_channel_id: channel,
            target_direct_message_group_id: dm,
        };
        let clip = services
            .backend
            .livekit_controller_capture_replay(body)
            .await
            .map_err(|error| self.backend_failed(error))?;
        self.write(|state, _| {
            state.invalidate(&keys::op(keys::CLIPS));
        });
        Ok(CapturedClip {
            clip_id: clip.clip_id,
            file_id: clip.file_id,
            duration_seconds: clip.duration_seconds.clamp(0, i64::from(u32::MAX)) as u32,
            size_bytes: clip.size_bytes.max(0) as u64,
            download_url: clip.download_url,
            message_id: clip.message_id,
        })
    }

    /// My clip library (`ViewKey::Clips`).
    pub fn clips(&self) -> ClipsView {
        self.write(|state, _| {
            let key = keys::op(keys::CLIPS);
            state.ensure_query(key.clone());
            state.clips_view(&key, true)
        })
    }

    /// Another user's public clips (`ViewKey::UserClips`).
    pub fn user_clips(&self, user_id: String) -> ClipsView {
        self.write(|state, _| {
            let key = keys::scoped(keys::USER_CLIPS, &user_id);
            state.ensure_query(key.clone());
            state.clips_view(&key, false)
        })
    }

    /// Runs one change to a clip, showing it busy meanwhile and the failure after.
    async fn clip_change<T>(
        &self,
        clip_id: &str,
        call: impl std::future::Future<Output = Result<T, crate::backend::BackendError>>,
    ) -> Result<T, CoreError> {
        self.write(|state, _| {
            state.w4.clips_busy.push(clip_id.to_owned());
            state.w4.clips_error = None;
            state.view_changed(ViewKey::Clips);
        });
        let result = call.await.map_err(|error| self.backend_failed(error));
        self.write(|state, _| {
            state.w4.clips_busy.retain(|busy| busy != clip_id);
            if let Err(error) = &result {
                state.w4.clips_error = Some(ErrorView {
                    code: "FAILED".into(),
                    message: error.to_string(),
                    retryable: true,
                    retry_after_ms: None,
                });
            }
            state.view_changed(ViewKey::Clips);
        });
        result
    }

    pub async fn set_clip_public(&self, clip_id: String, public: bool) -> Result<(), CoreError> {
        let services = self
            .services()
            .ok_or_else(|| unavailable("updating a clip"))?;
        let updated = self
            .clip_change(
                &clip_id,
                services.backend.livekit_controller_update_clip(
                    clip_id.clone(),
                    wire::UpdateClipDto {
                        is_public: Some(public),
                    },
                ),
            )
            .await?;
        self.write(|state, _| {
            state.clip_changed(&clip_id, |clips| {
                for clip in clips.iter_mut().filter(|clip| clip.id == updated.id) {
                    *clip = updated.clone();
                }
            });
        });
        Ok(())
    }

    pub async fn delete_clip(&self, clip_id: String) -> Result<(), CoreError> {
        let services = self
            .services()
            .ok_or_else(|| unavailable("deleting a clip"))?;
        self.clip_change(
            &clip_id,
            services
                .backend
                .livekit_controller_delete_clip(clip_id.clone()),
        )
        .await?;
        self.write(|state, _| {
            state.clip_changed(&clip_id, |clips| clips.retain(|clip| clip.id != clip_id));
        });
        Ok(())
    }

    /// Posts a clip to a channel or DM. `ClipDestination::Library` is refused.
    pub async fn share_clip(
        &self,
        clip_id: String,
        destination: ClipDestination,
    ) -> Result<(), CoreError> {
        let services = self
            .services()
            .ok_or_else(|| unavailable("sharing a clip"))?;
        let body = match &destination {
            ClipDestination::Library => {
                return Err(CoreError::Failed {
                    message: "A clip is shared to a channel or a DM".into(),
                });
            }
            ClipDestination::Channel { channel_id } => wire::ShareClipDto {
                destination: ShareClipDestination::Channel,
                target_channel_id: Some(uuid(channel_id, "the channel")?),
                target_direct_message_group_id: None,
            },
            ClipDestination::Dm { dm_group_id } => wire::ShareClipDto {
                destination: ShareClipDestination::Dm,
                target_channel_id: None,
                target_direct_message_group_id: Some(uuid(dm_group_id, "the DM")?),
            },
        };
        self.clip_change(
            &clip_id,
            services
                .backend
                .livekit_controller_share_clip(clip_id.clone(), body),
        )
        .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_playlist, segment_transient};

    #[test]
    fn only_no_answer_5xx_and_429_are_worth_another_try() {
        for (status, retryable, want) in [
            (0, false, true),
            (429, false, true),
            (500, false, true),
            (503, false, true),
            (400, false, false),
            (401, false, false),
            (404, false, false),
            (404, true, true),
        ] {
            assert_eq!(segment_transient(status, retryable), want, "{status}");
        }
    }

    #[test]
    fn a_playlist_without_lengths_or_with_queries_still_lists_its_segments() {
        let segments = parse_playlist(
            "#EXTM3U\nseg_1.ts?x=1\n\n#EXTINF:2,\nseg_2.ts\n",
            "http://s",
        );
        assert_eq!(segments.len(), 2);
        assert_eq!(
            segments[0].url,
            "http://s/api/livekit/replay/preview/segment/seg_1.ts"
        );
        assert_eq!(segments[0].duration_ms, 0);
        assert_eq!(segments[1].duration_ms, 2000);
    }
}
