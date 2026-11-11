//! Inline attachment players (docs/player.md), behind the `player` feature.
//!
//! - **On:** `semaphore_player::DesktopPlayers` over the session's backend (`http_opener`: range
//!   reads with the bearer token, a shared 32 MiB block cache), sound through the app's `AudioIo`
//!   (the rig's virtual device in rigs), video into the window's `VideoFrames`. Every list gets the
//!   same `Players`, so the engine's one-playing rule spans channels, threads and DMs.
//! - **Off:** [`players`] is `None` and audio and video attachments stay file rows. The engine
//!   crate isn't in the build at all.
//! - **Output device:** `Players::set_output_device` reaches `DesktopPlayers::set_output_device`
//!   (players opened after it play there).
//! - **Soundboard:** [`sound_decoder`] is the engine's `SoundDecoder` for what it doesn't decode
//!   built in (MP3, AAC, Vorbis): [`PlayerSoundDecoder`] with the feature, `None` without.

use crate::runtime::Activity;
use crate::services::Services;
use semaphore_media_livekit::soundboard::SoundDecoder;
use semaphore_ui::player::Players;
use semaphore_ui::voice::VideoFrames;
use std::sync::Arc;

/// The window's players, or `None` when the app is built without them.
#[cfg(feature = "player")]
pub fn players(
    services: &Services,
    activity: Arc<Activity>,
    frames: Arc<VideoFrames>,
) -> Option<Players> {
    use semaphore_core::player::{PlaybackSource, PlayerEvents};
    use semaphore_player::range::{BlockCache, http_opener};
    use semaphore_ui::player::{PlayerOpener, PlayerSurface};
    use std::rc::Rc;

    /// The engine's video sink over the view's surface.
    struct Sink(PlayerSurface);

    impl semaphore_player::VideoSink for Sink {
        fn upload(&self, f: &semaphore_player::Nv12Frame<'_>) {
            self.0.upload(&gpui_kit::Nv12Frame {
                width: f.width,
                height: f.height,
                y: f.y,
                y_stride: f.y_stride,
                uv: f.uv,
                uv_stride: f.uv_stride,
            });
        }

        fn remove(&self) {
            self.0.remove()
        }
    }

    struct Engine {
        players: semaphore_player::DesktopPlayers,
        activity: Arc<Activity>,
    }

    impl PlayerOpener for Engine {
        fn open(
            &self,
            source: PlaybackSource,
            events: PlayerEvents,
            surface: Option<PlayerSurface>,
        ) -> Box<dyn semaphore_core::player::MediaPlayer> {
            // What a player says is activity too: a rig waiting on it wakes at once.
            let activity = self.activity.clone();
            let events: PlayerEvents = Arc::new(move |event| {
                events(event);
                activity.bump();
            });
            let sink = surface
                .map(|surface| Arc::new(Sink(surface)) as Arc<dyn semaphore_player::VideoSink>);
            Box::new(self.players.open_with_sink(source, events, sink))
        }

        fn set_output_device(&self, device: Option<String>) {
            self.players.set_output_device(device);
        }
    }

    let cache = Arc::new(BlockCache::default());
    let opener = http_opener(
        services.backend.clone(),
        cache,
        services.exec.handle().clone(),
    );
    let players = semaphore_player::DesktopPlayers::new(services.audio.clone(), opener);
    let engine: Rc<dyn PlayerOpener> = Rc::new(Engine { players, activity });
    Some(Players::new(engine, frames))
}

/// The window's players, or `None` when the app is built without them.
#[cfg(not(feature = "player"))]
pub fn players(_: &Services, _: Arc<Activity>, _: Arc<VideoFrames>) -> Option<Players> {
    None
}

/// The longest soundboard sound decoded: the engine's own limit (`soundboard::MAX_SECONDS`, 30 s),
/// so a longer one is refused before it's all decoded. The engine checks what this returns too.
#[cfg(feature = "player")]
pub const MAX_SOUND: std::time::Duration = std::time::Duration::from_secs(30);

/// Soundboard sounds through the player's FFmpeg: the first audio stream, mono at 48 kHz.
#[cfg(feature = "player")]
pub struct PlayerSoundDecoder;

#[cfg(feature = "player")]
impl SoundDecoder for PlayerSoundDecoder {
    fn decode(&self, bytes: &[u8]) -> Result<semaphore_media_livekit::soundboard::Pcm, String> {
        let samples = semaphore_player::decode_audio(bytes.to_vec(), MAX_SOUND)
            .map_err(|error| format!("This sound can't be played: {error}"))?;
        Ok(semaphore_media_livekit::soundboard::Pcm {
            sample_rate: semaphore_player::DECODED_RATE,
            channels: 1,
            samples,
        })
    }
}

/// `EngineOptions::sound_decoder`: the player's decoder, or `None` in a build without it.
#[cfg(feature = "player")]
pub fn sound_decoder() -> Option<Arc<dyn SoundDecoder>> {
    Some(Arc::new(PlayerSoundDecoder))
}

/// `EngineOptions::sound_decoder`: the player's decoder, or `None` in a build without it.
#[cfg(not(feature = "player"))]
pub fn sound_decoder() -> Option<Arc<dyn SoundDecoder>> {
    None
}

#[cfg(all(test, feature = "player"))]
mod tests {
    use super::*;

    fn airhorn() -> Vec<u8> {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../semaphore-fake-server/fixtures/sound-airhorn.mp3"
        );
        std::fs::read(path).expect("the fake server's airhorn")
    }

    #[test]
    fn the_airhorn_decodes_to_mono_48k() {
        let decoder = sound_decoder().expect("the player feature's decoder");
        let pcm = decoder.decode(&airhorn()).expect("decoded");
        assert_eq!((pcm.sample_rate, pcm.channels), (48_000, 1));
        let seconds = pcm.samples.len() as f64 / 48_000.;
        assert!((0.9..1.2).contains(&seconds), "{seconds} s");
        // The fixture is lavfi's sine, at 1/8 of full scale.
        assert!(pcm.samples.iter().any(|sample| sample.abs() > 0.08));
    }

    #[test]
    fn what_isnt_a_sound_is_refused_with_a_sentence() {
        let error = PlayerSoundDecoder
            .decode(b"<html>not a sound</html>")
            .expect_err("refused");
        assert!(error.starts_with("This sound can't be played"), "{error}");
    }
}
