//! A community's soundboard: the list and playing a sound into the call. Unit W4-core.
//!
//! Only in a channel call: the sounds are the call's community's. The bytes come from the sound's
//! file, read once a session, and go to `MediaEngine::play_soundboard`, which decodes them and
//! sends them on its own `soundboard` track. The server can refuse that track for a user whose
//! publish grant lists sources (#659), and doesn't gate or limit playing (#660).

use crate::cache::keys;
use crate::client::Core;
use crate::model::{ErrorView, SoundboardSound, SoundboardView, ViewKey, VoiceRoom, VoiceStatus};
use crate::platform::CoreError;
use crate::resync::unavailable;

/// Soundboard files kept at once (each at most 1 MiB).
const KEPT_SOUNDS: usize = 32;

impl Core {
    /// The community's sounds (`ViewKey::Soundboard`), fetched when missing.
    pub fn soundboard(&self, community_id: String) -> SoundboardView {
        self.write(|state, _| {
            let key = keys::scoped(keys::SOUNDBOARD, &community_id);
            state.ensure_query(key.clone());
            let sounds = state
                .cache
                .soundboard(&key)
                .map(|sounds| {
                    sounds
                        .iter()
                        .map(|sound| SoundboardSound {
                            id: sound.id.clone(),
                            name: sound.name.clone(),
                            emoji: sound.emoji.clone().filter(|emoji| !emoji.is_empty()),
                            file_id: sound.file_id.clone(),
                        })
                        .collect()
                })
                .unwrap_or_default();
            let ours = |(community, _): &&(String, _)| *community == community_id;
            SoundboardView {
                state: state.load_of(&key),
                sounds,
                playing: state
                    .w4
                    .sound_playing
                    .as_ref()
                    .filter(ours)
                    .map(|(_, sound)| sound.clone()),
                error: state
                    .w4
                    .sound_error
                    .as_ref()
                    .filter(|(community, _)| *community == community_id)
                    .map(|(_, error)| error.clone()),
                community_id,
            }
        })
    }

    /// Plays one of the call's community's sounds to everyone in the call. Refused outside a
    /// channel call. `playing` shows it until it has started.
    pub async fn play_sound(&self, sound_id: String) -> Result<(), CoreError> {
        let services = self
            .services()
            .ok_or_else(|| unavailable("the soundboard"))?
            .clone();
        let media = services
            .media
            .clone()
            .ok_or_else(|| unavailable("the soundboard"))?;
        let (community_id, file_id, bytes, epoch) = self.write(|state, _| {
            let Some(VoiceRoom::Channel {
                community_id: Some(community_id),
                ..
            }) = state.voice.room.clone()
            else {
                return Err(unavailable("the soundboard outside a channel call"));
            };
            if !matches!(
                state.voice.status,
                VoiceStatus::Connected | VoiceStatus::Reconnecting
            ) {
                return Err(unavailable("the soundboard before the call is up"));
            }
            let file_id = state
                .cache
                .soundboard(&keys::scoped(keys::SOUNDBOARD, &community_id))
                .and_then(|sounds| sounds.iter().find(|sound| sound.id == sound_id))
                .map(|sound| sound.file_id.clone())
                .ok_or_else(|| CoreError::Failed {
                    message: "That sound isn't on this community's soundboard".into(),
                })?;
            state.w4.sound_playing = Some((community_id.clone(), sound_id.clone()));
            state.w4.sound_error = None;
            state.view_changed(ViewKey::Soundboard {
                community_id: community_id.clone(),
            });
            let bytes = state.w4.sound_bytes.get(&file_id).cloned();
            Ok((community_id, file_id, bytes, state.session_epoch))
        })?;
        let result = async {
            let bytes = match bytes {
                Some(bytes) => bytes,
                None => {
                    let bytes = services
                        .backend
                        .file_controller_get_file(file_id.clone())
                        .await
                        .map_err(|error| self.backend_failed(error))?;
                    // The session it was read for may have ended meanwhile: then it's dropped.
                    self.write(|state, _| {
                        if state.session_epoch != epoch {
                            return Err(unavailable("the soundboard after the session ended"));
                        }
                        if state.w4.sound_bytes.len() >= KEPT_SOUNDS {
                            state.w4.sound_bytes.clear();
                        }
                        state.w4.sound_bytes.insert(file_id.clone(), bytes.clone());
                        Ok(())
                    })?;
                    bytes
                }
            };
            media.play_soundboard(sound_id.clone(), bytes).await
        }
        .await;
        self.write(|state, _| {
            if state.session_epoch != epoch {
                return;
            }
            if state
                .w4
                .sound_playing
                .as_ref()
                .is_some_and(|(_, playing)| *playing == sound_id)
            {
                state.w4.sound_playing = None;
            }
            if let Err(error) = &result {
                state.w4.sound_error = Some((
                    community_id.clone(),
                    ErrorView {
                        code: "FAILED".into(),
                        message: error.to_string(),
                        retryable: true,
                        retry_after_ms: None,
                    },
                ));
            }
            state.view_changed(ViewKey::Soundboard { community_id });
        });
        result
    }

    /// Stops the sound playing, if any.
    pub fn stop_sound(&self) {
        if let Some(media) = self.services().and_then(|services| services.media.as_ref()) {
            media.stop_soundboard();
        }
        self.write(|state, _| {
            if let Some((community_id, _)) = state.w4.sound_playing.take() {
                state.view_changed(ViewKey::Soundboard { community_id });
            }
        });
    }
}
