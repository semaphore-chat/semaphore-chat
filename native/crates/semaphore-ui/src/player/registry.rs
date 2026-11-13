//! The players of a window's message lists: how a row gets one, and what outlives the row.
//!
//! - **Who owns a player.** The list a row is in ([`ListPlayers`], in its shared state), keyed by
//!   the message and the file. A row is drawn by a function, not an entity, so the entity lives
//!   there and survives re-rendering and virtualising. It goes when its message leaves the list
//!   (deleted, removed by a moderator, a reset) or the list goes (a channel switch): dropping it
//!   stops playback and frees the surface.
//! - **[`Players`]** is the window's: the opener (the engine in the app, a fake in tests), the
//!   window's [`VideoFrames`], and a weak handle to every player made, so a sign-out can stop them
//!   all. One playing at a time is the engine's rule (`semaphore_core::player::Exclusive`): starting
//!   one pauses the other, whose view hears it as a state.

use super::model::Phase;
use super::{AudioPlayer, PlayerOpener, PlayerSurface, VideoPlayer};
use crate::voice::VideoFrames;
use gpui_kit::*;
use semaphore_core::model::{AttachmentKind, AttachmentView, MessageRow};
use semaphore_core::player::{
    AttachmentSource, MediaPlayer, PlaybackSource, PlayerEvents, playable,
};
use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::rc::Rc;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

/// An idle player not drawn for this many of its list's frames may go, once the list holds more
/// than [`KEEP_IDLE`]. A playing or paused one stays while its message is in the list.
const IDLE_FRAMES: u64 = 120;
const KEEP_IDLE: usize = 32;

/// One attachment's player view.
#[derive(Clone)]
pub enum AttachmentPlayer {
    Audio(Entity<AudioPlayer>),
    Video(Entity<VideoPlayer>),
}

impl AttachmentPlayer {
    pub fn phase(&self, cx: &App) -> Phase {
        match self {
            Self::Audio(view) => view.read(cx).phase().clone(),
            Self::Video(view) => view.read(cx).phase().clone(),
        }
    }

    pub fn file_id<'a>(&self, cx: &'a App) -> &'a str {
        match self {
            Self::Audio(view) => &view.read(cx).source().file_id,
            Self::Video(view) => &view.read(cx).source().file_id,
        }
    }

    pub fn filename<'a>(&self, cx: &'a App) -> &'a str {
        match self {
            Self::Audio(view) => &view.read(cx).source().filename,
            Self::Video(view) => &view.read(cx).source().filename,
        }
    }

    /// A frame of this player's video is on its surface.
    pub fn has_frame(&self, cx: &App) -> bool {
        match self {
            Self::Audio(_) => false,
            Self::Video(view) => view.read(cx).has_frame(),
        }
    }

    /// Play or pause, as the main button does.
    pub fn toggle(&self, cx: &mut App) {
        match self {
            Self::Audio(view) => view.update(cx, |view, cx| view.toggle(cx)),
            Self::Video(view) => view.update(cx, |view, cx| view.toggle(cx)),
        }
    }

    pub fn close(&self, cx: &mut App) {
        match self {
            Self::Audio(view) => view.update(cx, |view, cx| view.close(cx)),
            Self::Video(view) => view.update(cx, |view, cx| view.close(cx)),
        }
    }

    pub fn into_any_element(self) -> AnyElement {
        match self {
            Self::Audio(view) => view.into_any_element(),
            Self::Video(view) => view.into_any_element(),
        }
    }

    fn downgrade(&self) -> WeakPlayer {
        match self {
            Self::Audio(view) => WeakPlayer::Audio(view.downgrade()),
            Self::Video(view) => WeakPlayer::Video(view.downgrade()),
        }
    }
}

enum WeakPlayer {
    Audio(WeakEntity<AudioPlayer>),
    Video(WeakEntity<VideoPlayer>),
}

impl WeakPlayer {
    fn upgrade(&self) -> Option<AttachmentPlayer> {
        match self {
            Self::Audio(view) => view.upgrade().map(AttachmentPlayer::Audio),
            Self::Video(view) => view.upgrade().map(AttachmentPlayer::Video),
        }
    }
}

/// A video attachment's poster (its server thumbnail), or `None` for the plain dark box.
pub type PosterResolver = Rc<dyn Fn(&AttachmentView) -> Option<ImageSource>>;

/// The owner's opener, counting the players it opened that are still alive.
struct Counting {
    opener: Rc<dyn PlayerOpener>,
    live: Arc<AtomicUsize>,
    previews: Arc<AtomicUsize>,
}

/// A player that leaves its counts when dropped.
struct Counted {
    player: Box<dyn MediaPlayer>,
    counts: Vec<Arc<AtomicUsize>>,
}

impl PlayerOpener for Counting {
    fn open(
        &self,
        source: PlaybackSource,
        events: PlayerEvents,
        surface: Option<PlayerSurface>,
    ) -> Box<dyn MediaPlayer> {
        let mut counts = vec![self.live.clone()];
        if matches!(source, PlaybackSource::ReplayBuffer { .. }) {
            counts.push(self.previews.clone());
        }
        let player = self.opener.open(source, events, surface);
        for count in &counts {
            count.fetch_add(1, Ordering::SeqCst);
        }
        Box::new(Counted { player, counts })
    }

    fn set_output_device(&self, device: Option<String>) {
        self.opener.set_output_device(device);
    }
}

impl MediaPlayer for Counted {
    fn play(&self) {
        self.player.play();
    }

    fn pause(&self) {
        self.player.pause();
    }

    fn seek(&self, to: std::time::Duration) {
        self.player.seek(to);
    }

    fn set_volume(&self, volume: f32) {
        self.player.set_volume(volume);
    }

    fn set_muted(&self, muted: bool) {
        self.player.set_muted(muted);
    }
}

impl Drop for Counted {
    fn drop(&mut self) {
        for count in &self.counts {
            count.fetch_sub(1, Ordering::SeqCst);
        }
    }
}

struct Inner {
    opener: Rc<dyn PlayerOpener>,
    live: Arc<AtomicUsize>,
    previews: Arc<AtomicUsize>,
    frames: Arc<VideoFrames>,
    made: RefCell<Vec<WeakPlayer>>,
    posters: RefCell<Option<PosterResolver>>,
}

/// The window's players: give it to every message list through `ListOptions::players`. Without
/// one, audio and video attachments stay file rows (the app built without its player).
#[derive(Clone)]
pub struct Players {
    inner: Rc<Inner>,
}

impl Players {
    pub fn new(opener: Rc<dyn PlayerOpener>, frames: Arc<VideoFrames>) -> Self {
        let live = Arc::new(AtomicUsize::new(0));
        let previews = Arc::new(AtomicUsize::new(0));
        let opener = Rc::new(Counting {
            opener,
            live: live.clone(),
            previews: previews.clone(),
        });
        Self {
            inner: Rc::new(Inner {
                opener,
                live,
                previews,
                frames,
                made: RefCell::default(),
                posters: RefCell::default(),
            }),
        }
    }

    /// Where video players made from now on get their poster: the app's thumbnails.
    pub fn set_posters(&self, resolver: PosterResolver) {
        *self.inner.posters.borrow_mut() = Some(resolver);
    }

    /// The output the voice settings chose (`None`: the system default), for players opened
    /// after this.
    pub fn set_output_device(&self, device: Option<String>) {
        self.inner.opener.set_output_device(device);
    }

    /// Whether this attachment plays inline: audio or video in a format this client plays.
    pub fn plays(attachment: &AttachmentView) -> bool {
        matches!(
            attachment.kind,
            AttachmentKind::Audio | AttachmentKind::Video
        ) && playable(&attachment.mime_type, &attachment.filename)
    }

    /// A new player for the attachment (not yet opened: that is the first play).
    pub fn create(&self, attachment: &AttachmentView, cx: &mut App) -> AttachmentPlayer {
        let source = AttachmentSource {
            file_id: attachment.file_id.clone(),
            filename: attachment.filename.clone(),
            mime_type: attachment.mime_type.clone(),
            size: attachment.size_bytes,
            has_thumbnail: attachment.has_thumbnail,
        };
        let opener = self.inner.opener.clone();
        let player = match attachment.kind {
            AttachmentKind::Video => {
                let frames = self.inner.frames.clone();
                let dimensions = (attachment.width, attachment.height);
                let poster = self
                    .inner
                    .posters
                    .borrow()
                    .as_ref()
                    .and_then(|resolve| resolve(attachment));
                AttachmentPlayer::Video(cx.new(|cx| {
                    let mut player = VideoPlayer::new(source, dimensions, opener, frames, cx);
                    if poster.is_some() {
                        player.set_poster(poster, cx);
                    }
                    player
                }))
            }
            _ => AttachmentPlayer::Audio(cx.new(|cx| AudioPlayer::new(source, opener, cx))),
        };
        let mut made = self.inner.made.borrow_mut();
        made.retain(|weak| weak.upgrade().is_some());
        made.push(player.downgrade());
        player
    }

    /// Every player still alive, in any list.
    pub fn all(&self) -> Vec<AttachmentPlayer> {
        self.inner
            .made
            .borrow()
            .iter()
            .filter_map(WeakPlayer::upgrade)
            .collect()
    }

    /// Players that hold an open file (loading, playing, paused...): what a rig counts.
    pub fn open_count(&self, cx: &App) -> usize {
        self.all()
            .iter()
            .filter(|player| player.phase(cx) != Phase::Idle)
            .count()
    }

    /// Engine players opened through this and not yet dropped, the trim preview's included.
    pub fn live(&self) -> usize {
        self.inner.live.load(Ordering::SeqCst)
    }

    /// Of [`Self::live`], those playing the replay buffer (the trim preview's).
    pub fn live_previews(&self) -> usize {
        self.inner.previews.load(Ordering::SeqCst)
    }

    /// The opener players are made with (the trim preview opens through it too).
    pub(crate) fn opener(&self) -> Rc<dyn PlayerOpener> {
        self.inner.opener.clone()
    }

    /// The window's frames, where video players draw.
    pub(crate) fn frames(&self) -> Arc<VideoFrames> {
        self.inner.frames.clone()
    }

    /// Stops and closes every player: a sign-out. Nothing of the session's files stays open.
    pub fn stop_all(&self, cx: &mut App) {
        for player in self.all() {
            player.close(cx);
        }
    }
}

/// Which player: the message (its id, or its seq while it has none) and the file.
type Key = (String, String);

fn message_key(row: &MessageRow) -> String {
    row.id.clone().unwrap_or_else(|| format!("seq:{}", row.seq))
}

struct Slot {
    player: AttachmentPlayer,
    drawn: u64,
    _events: Subscription,
}

/// One list's players. See the module docs.
#[derive(Default)]
pub struct ListPlayers {
    slots: RefCell<HashMap<Key, Slot>>,
    frame: std::cell::Cell<u64>,
}

impl ListPlayers {
    /// A new frame of the list is being drawn.
    pub fn next_frame(&self) {
        self.frame.set(self.frame.get() + 1);
    }

    pub fn len(&self) -> usize {
        self.slots.borrow().len()
    }

    pub fn is_empty(&self) -> bool {
        self.slots.borrow().is_empty()
    }

    /// The row's player for this attachment, made on its first draw. `subscribe` hears what the
    /// player asks of its owner.
    pub fn get_or_create(
        &self,
        players: &Players,
        row: &MessageRow,
        attachment: &AttachmentView,
        subscribe: impl FnOnce(&AttachmentPlayer, &mut App) -> Subscription,
        cx: &mut App,
    ) -> AttachmentPlayer {
        let key = (message_key(row), attachment.file_id.clone());
        let frame = self.frame.get();
        if let Some(slot) = self.slots.borrow_mut().get_mut(&key) {
            slot.drawn = frame;
            return slot.player.clone();
        }
        let player = players.create(attachment, cx);
        let events = subscribe(&player, cx);
        self.prune(cx);
        self.slots.borrow_mut().insert(
            key,
            Slot {
                player: player.clone(),
                drawn: frame,
                _events: events,
            },
        );
        player
    }

    /// Drops idle players not drawn lately, once there are many.
    fn prune(&self, cx: &App) {
        let mut slots = self.slots.borrow_mut();
        if slots.len() < KEEP_IDLE {
            return;
        }
        let frame = self.frame.get();
        slots.retain(|_, slot| {
            frame.saturating_sub(slot.drawn) < IDLE_FRAMES
                || !matches!(slot.player.phase(cx), Phase::Idle | Phase::Failed(_))
        });
    }

    /// Keeps only the players whose message is still in the list and not removed, with the file
    /// still on it. Run after the rows change.
    pub fn retain_rows<'a>(&self, rows: impl Iterator<Item = &'a MessageRow>) {
        if self.slots.borrow().is_empty() {
            return;
        }
        let mut present: HashSet<Key> = HashSet::new();
        for row in rows.filter(|row| !row.removed) {
            for attachment in &row.attachments {
                present.insert((message_key(row), attachment.file_id.clone()));
            }
        }
        let gone: Vec<Slot> = {
            let mut slots = self.slots.borrow_mut();
            let keys: Vec<Key> = slots
                .keys()
                .filter(|key| !present.contains(*key))
                .cloned()
                .collect();
            keys.iter().filter_map(|key| slots.remove(key)).collect()
        };
        // Dropped outside the borrow: a player's drop may reach back into the list.
        drop(gone);
    }

    pub fn players(&self) -> Vec<AttachmentPlayer> {
        self.slots
            .borrow()
            .values()
            .map(|slot| slot.player.clone())
            .collect()
    }
}
