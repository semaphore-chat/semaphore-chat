//! Inline attachment players (docs/player.md), behind the `player` feature.
//!
//! - **On:** `semaphore_player::DesktopPlayers` over the session's backend (`http_opener`: range
//!   reads with the bearer token, a shared 32 MiB block cache), sound through the app's `AudioIo`
//!   (the rig's virtual device in rigs), video into the window's `VideoFrames`. Every list gets the
//!   same `Players`, so the engine's one-playing rule spans channels, threads and DMs.
//! - **Off:** [`players`] is `None` and audio and video attachments stay file rows. The engine
//!   crate isn't in the build at all.

use crate::runtime::Activity;
use crate::services::Services;
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
