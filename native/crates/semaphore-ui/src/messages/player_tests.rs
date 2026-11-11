//! Inline players in the list: which attachments get one, and what outlives a row's element.

use super::fixture::NOW_MS;
use super::format::TimeFormat;
use super::synth::{self, SynthMedia};
use super::view::{ListData, ListOptions, ListStatus, MessageList, MessageListEvent, init};
use crate::player::fake::{FakeOpener, Script};
use crate::player::{AttachmentPlayer, Phase, PlayerViewEvent, Players};
use crate::voice::VideoFrames;
use gpui_kit::test::TestWindowExt as _;
use gpui_kit::*;
use semaphore_core::model::{AttachmentKind, AttachmentView, ListOp, MessageRow};
use std::cell::RefCell;
use std::rc::Rc;
// `gpui_kit::*` exports the `test` attribute, and the macro's own `#[test]` would resolve to it.
use std::prelude::v1::test;

fn draw(cx: &mut VisualTestContext) {
    cx.run_until_parked();
    cx.update(|window, cx| window.draw(cx).clear(cx));
    cx.run_until_parked();
}

fn attachment(file_id: &str, filename: &str, mime: &str, kind: AttachmentKind) -> AttachmentView {
    AttachmentView {
        file_id: file_id.into(),
        filename: filename.into(),
        mime_type: mime.into(),
        size_bytes: 4096,
        kind,
        has_thumbnail: false,
        width: Some(640),
        height: Some(360),
    }
}

fn audio() -> AttachmentView {
    attachment("f-audio", "song.ogg", "audio/ogg", AttachmentKind::Audio)
}

fn video() -> AttachmentView {
    attachment("f-video", "clip.webm", "video/webm", AttachmentKind::Video)
}

/// `count` text rows from 1, then a row with an audio file, one with a video, one with an AVI
/// and one with a PDF.
fn rows(count: usize) -> Vec<MessageRow> {
    let mut rows = synth::rows(1, count);
    let extra = [
        audio(),
        video(),
        attachment("f-avi", "old.avi", "video/x-msvideo", AttachmentKind::Video),
        attachment(
            "f-pdf",
            "doc.pdf",
            "application/pdf",
            AttachmentKind::Document,
        ),
    ];
    for (offset, attachment) in extra.into_iter().enumerate() {
        let seq = count as i64 + 1 + offset as i64;
        let mut row = synth::row(seq);
        row.id = Some(format!("m-{seq}"));
        row.display = format!("attached {seq}");
        row.segs.clear();
        row.attachments = vec![attachment];
        row.revision += 1;
        rows.push(row);
    }
    rows
}

struct Opened<'a> {
    view: Entity<MessageList>,
    players: Option<Players>,
    fake: FakeOpener,
    cx: &'a mut VisualTestContext,
}

fn open(cx: &mut TestAppContext, rows: Vec<MessageRow>, with_players: bool) -> Opened<'_> {
    cx.update(|cx| {
        gpui_kit::init(cx);
        crate::theme::init(cx);
        init(cx);
    });
    let (opener, fake) = FakeOpener::rc(Script::audio());
    let made: Rc<RefCell<Option<Players>>> = Rc::default();
    let slot = made.clone();
    let (view, cx) = cx.add_window_view(move |window, cx| {
        let players = with_players.then(|| Players::new(opener, VideoFrames::for_window(window)));
        *slot.borrow_mut() = players.clone();
        MessageList::new(
            ListData {
                me_id: "me".into(),
                rows,
                replies: Default::default(),
                status: ListStatus::Ready,
            },
            Rc::new(SynthMedia::new(None)),
            ListOptions {
                time: TimeFormat::fixed(NOW_MS),
                scrollbar: false,
                players,
                ..ListOptions::default()
            },
            cx,
        )
    });
    draw(cx);
    let players = made.borrow().clone();
    Opened {
        view,
        players,
        fake,
        cx,
    }
}

fn player_shown(seq: i64, cx: &mut VisualTestContext) -> bool {
    let id = ElementId::NamedInteger("attachment-player".into(), (seq as u64) << 8);
    cx.update(|window, _| window.try_find(id).is_some())
}

fn by_file(
    view: &Entity<MessageList>,
    file_id: &str,
    cx: &mut VisualTestContext,
) -> AttachmentPlayer {
    cx.update(|_, cx| {
        view.read(cx)
            .players()
            .into_iter()
            .find(|player| player.file_id(cx) == file_id)
            .expect("a player for the file")
    })
}

fn phase_of(player: &AttachmentPlayer, cx: &mut VisualTestContext) -> Phase {
    cx.update(|_, cx| player.phase(cx))
}

fn toggle(player: &AttachmentPlayer, cx: &mut VisualTestContext) {
    cx.update(|_, cx| player.toggle(cx));
    draw(cx);
}

#[gpui_kit::test]
fn audio_and_video_in_playable_formats_get_players_and_the_rest_stay_files(
    cx: &mut TestAppContext,
) {
    let opened = open(cx, rows(2), true);
    let cx = opened.cx;
    assert!(player_shown(3, cx), "the audio row");
    assert!(player_shown(4, cx), "the video row");
    assert!(!player_shown(5, cx), "an AVI keeps the plain row");
    assert!(!player_shown(6, cx), "a PDF is a file");
    let players = cx.update(|_, cx| opened.view.read(cx).players().len());
    assert_eq!(players, 2);
    assert_eq!(opened.fake.calls(), [], "nothing opens before a play");
}

#[gpui_kit::test]
fn without_the_player_every_attachment_stays_as_it_was(cx: &mut TestAppContext) {
    let opened = open(cx, rows(2), false);
    let cx = opened.cx;
    assert!(!player_shown(3, cx));
    assert!(!player_shown(4, cx));
    assert!(opened.players.is_none());
}

#[gpui_kit::test]
fn a_player_keeps_playing_while_its_row_scrolls_away_and_back(cx: &mut TestAppContext) {
    let opened = open(cx, rows(1), true);
    let (view, cx) = (opened.view, opened.cx);
    let audio = by_file(&view, "f-audio", cx);
    toggle(&audio, cx);
    assert_eq!(phase_of(&audio, cx), Phase::Playing);
    // Two hundred rows land below: the audio row leaves the viewport.
    let more: Vec<MessageRow> = synth::rows(1000, 200);
    view.update(cx, |list, cx| {
        list.apply(
            ListOp::Insert {
                index: list.row_count() as u32,
                rows: more,
            },
            cx,
        );
        list.scroll_to_latest();
    });
    for _ in 0..3 {
        draw(cx);
    }
    assert!(!player_shown(2, cx), "scrolled away");
    view.update(cx, |list, _| list.scroll_to_seq(2, 0.));
    draw(cx);
    assert!(player_shown(2, cx), "back");
    let again = by_file(&view, "f-audio", cx);
    let same = matches!((&audio, &again), (AttachmentPlayer::Audio(a), AttachmentPlayer::Audio(b)) if a == b);
    assert!(same, "the same player");
    assert_eq!(phase_of(&again, cx), Phase::Playing);
    assert_eq!(opened.fake.alive(), 1, "opened once");
}

#[gpui_kit::test]
fn starting_another_player_pauses_the_first(cx: &mut TestAppContext) {
    let opened = open(cx, rows(1), true);
    let (view, cx) = (opened.view, opened.cx);
    let audio = by_file(&view, "f-audio", cx);
    let video = by_file(&view, "f-video", cx);
    toggle(&audio, cx);
    assert_eq!(phase_of(&audio, cx), Phase::Playing);
    toggle(&video, cx);
    assert_eq!(phase_of(&video, cx), Phase::Playing);
    assert_eq!(phase_of(&audio, cx), Phase::Paused, "one at a time");
}

#[gpui_kit::test]
fn deleting_or_removing_the_message_stops_its_player(cx: &mut TestAppContext) {
    let opened = open(cx, rows(1), true);
    let (view, cx) = (opened.view, opened.cx);
    toggle(&by_file(&view, "f-audio", cx), cx);
    toggle(&by_file(&view, "f-video", cx), cx);
    assert_eq!(opened.fake.alive(), 2);
    // The audio message (seq 2, index 1) is deleted.
    view.update(cx, |list, cx| {
        list.apply(ListOp::Remove { index: 1, count: 1 }, cx)
    });
    draw(cx);
    assert_eq!(opened.fake.alive(), 1, "its player was dropped");
    // A moderator removes the video message (now index 1).
    let mut removed = cx.update(|_, cx| {
        view.read(cx)
            .shared
            .rows
            .borrow()
            .get(1)
            .unwrap()
            .as_ref()
            .clone()
    });
    removed.removed = true;
    removed.revision += 1;
    view.update(cx, |list, cx| {
        list.apply(
            ListOp::Replace {
                index: 1,
                rows: vec![removed],
            },
            cx,
        )
    });
    draw(cx);
    assert_eq!(opened.fake.alive(), 0);
    let left = cx.update(|_, cx| view.read(cx).players().len());
    assert_eq!(left, 0);
}

#[gpui_kit::test]
fn signing_out_closes_every_player(cx: &mut TestAppContext) {
    let opened = open(cx, rows(1), true);
    let (view, cx) = (opened.view, opened.cx);
    let audio = by_file(&view, "f-audio", cx);
    toggle(&audio, cx);
    let players = opened.players.clone().unwrap();
    assert_eq!(cx.update(|_, cx| players.open_count(cx)), 1);
    cx.update(|_, cx| players.stop_all(cx));
    draw(cx);
    assert_eq!(opened.fake.alive(), 0);
    assert_eq!(phase_of(&audio, cx), Phase::Idle);
    assert_eq!(cx.update(|_, cx| players.open_count(cx)), 0);
}

#[gpui_kit::test]
fn what_a_player_asks_goes_out_as_the_lists_events(cx: &mut TestAppContext) {
    let opened = open(cx, rows(1), true);
    let (view, cx) = (opened.view, opened.cx);
    let events = Rc::new(RefCell::new(Vec::new()));
    let sink = events.clone();
    cx.update(|_, cx| {
        cx.subscribe(&view, move |_, event: &MessageListEvent, _| {
            sink.borrow_mut().push(event.clone());
        })
        .detach();
    });
    let AttachmentPlayer::Video(video) = by_file(&view, "f-video", cx) else {
        panic!("a video player");
    };
    video.update(cx, |_, cx| {
        cx.emit(PlayerViewEvent::OpenExternally {
            file_id: "f-video".into(),
        });
        cx.emit(PlayerViewEvent::Download {
            file_id: "f-video".into(),
        });
        cx.emit(PlayerViewEvent::Expanded(true));
    });
    cx.run_until_parked();
    let events = events.borrow();
    assert!(matches!(
        events.as_slice(),
        [
            MessageListEvent::OpenExternally { file_id: a },
            MessageListEvent::OpenAttachment { file_id: b },
        ] if a == "f-video" && b == "f-video"
    ));
}
