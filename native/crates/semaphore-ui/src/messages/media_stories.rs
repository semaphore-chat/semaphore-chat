//! UM's stories: GIF messages, link-preview pictures with "Load images from other sites" on and
//! off, and "Seen by" under the own latest message. Every picture is drawn in memory here; nothing
//! is fetched. The tests reuse the rows and the media source, so without the `stories` feature only
//! those are used.
#![cfg_attr(not(feature = "stories"), allow(dead_code, unused_imports))]

use super::fixture::{self, Body, FixtureMedia, NOW_MS};
use super::format::TimeFormat;
use super::media::{MediaRef, MediaSource};
use super::view::{ListData, ListOptions, ListStatus, MessageList, init};
#[cfg(feature = "stories")]
use crate::stories::Story;
use gpui_kit::*;
use image::{Delay, Frame, RgbaImage};
use semaphore_core::model::{
    AttachmentView, GifEmbed, LinkPreviewView, LoadState, MessageRow, SeenByView, UserView,
};
use std::collections::HashMap;
use std::rc::Rc;
use std::sync::Arc;

const MINUTE: i64 = 60_000;
pub(crate) const GIF_CAT: &str = "https://media.giphy.com/media/cat/giphy.gif";
pub(crate) const GIF_WIDE: &str = "https://media.giphy.com/media/wide/giphy.gif";
pub(crate) const GIF_TALL: &str = "https://media.giphy.com/media/tall/giphy.gif";
/// No picture for it: a failed load.
pub(crate) const GIF_BROKEN: &str = "https://media.tenor.com/broken/tenor.gif";
const COVER: &str = "https://blog.example.com/cover.png";
const LONG_HOST: &str =
    "images.a-very-long-subdomain-of-a-content-delivery-network.static-assets.example.org";

/// An animated picture: a diagonal band that moves a little each frame, BGRA as GPUI wants it.
pub(crate) fn animated(width: u32, height: u32, frames: u32, tint: [u8; 3]) -> Arc<RenderImage> {
    let frames: Vec<Frame> = (0..frames)
        .map(|frame| {
            let shift = frame as f32 / frames as f32;
            let buffer = RgbaImage::from_fn(width, height, |x, y| {
                let (fx, fy) = (x as f32 / width as f32, y as f32 / height as f32);
                let band = ((fx + fy) * 0.5 + shift).fract();
                let light = if band < 0.5 { 0.55 + band } else { 1.55 - band };
                image::Rgba([
                    (tint[2] as f32 * light).min(255.) as u8,
                    (tint[1] as f32 * light).min(255.) as u8,
                    (tint[0] as f32 * light).min(255.) as u8,
                    255,
                ])
            });
            Frame::from_parts(buffer, 0, 0, Delay::from_numer_denom_ms(100, 1))
        })
        .collect();
    Arc::new(RenderImage::new(frames))
}

/// The fixture's files and emoji, plus GIFs and link-preview pictures by URL.
pub(crate) struct StoryMedia {
    fixture: FixtureMedia,
    gifs: HashMap<&'static str, Arc<RenderImage>>,
    link_images: HashMap<&'static str, Arc<RenderImage>>,
}

impl StoryMedia {
    pub fn new() -> Self {
        let mut gifs = HashMap::new();
        gifs.insert(GIF_CAT, animated(480, 270, 6, [244, 114, 182]));
        gifs.insert(GIF_WIDE, animated(1200, 160, 6, [56, 189, 248]));
        gifs.insert(GIF_TALL, animated(160, 1000, 6, [163, 230, 53]));
        let mut link_images = HashMap::new();
        link_images.insert(COVER, animated(640, 320, 1, [251, 191, 36]));
        Self {
            fixture: FixtureMedia::new(),
            gifs,
            link_images,
        }
    }
}

impl MediaSource for StoryMedia {
    fn attachment(&self, attachment: &AttachmentView) -> MediaRef {
        self.fixture.attachment(attachment)
    }
    fn emoji(&self, emoji_id: &str) -> MediaRef {
        self.fixture.emoji(emoji_id)
    }
    fn avatar(&self, file_id: &str) -> MediaRef {
        self.fixture.avatar(file_id)
    }
    fn link_image(&self, url: &str) -> MediaRef {
        self.link_images
            .get(url)
            .map_or(MediaRef::Missing, |image| MediaRef::Ready(image.clone()))
    }
    fn gif(&self, url: &str) -> MediaRef {
        self.gifs
            .get(url)
            .map_or(MediaRef::Missing, |image| MediaRef::Ready(image.clone()))
    }
}

fn sam() -> UserView {
    fixture::user("u-sam", "sam", Some("Sam Rivera"))
}

fn ava() -> UserView {
    fixture::user("u-ava", "ava", Some("Ava Chen"))
}

pub(crate) fn host_of(url: &str) -> String {
    url.split("//")
        .nth(1)
        .and_then(|rest| rest.split('/').next())
        .unwrap_or_default()
        .to_owned()
}

/// A message whose whole text is one GIF URL, as core marks it.
pub(crate) fn gif_message(seq: i64, author: UserView, minutes_ago: i64, url: &str) -> MessageRow {
    let mut row = fixture::message(
        seq,
        author,
        NOW_MS - minutes_ago * MINUTE,
        Body::default().link(url, url),
    );
    row.gif = Some(GifEmbed {
        url: url.into(),
        host: host_of(url),
    });
    row.link_previews = vec![LinkPreviewView {
        url: url.into(),
        title: Some("GIF".into()),
        ..LinkPreviewView::default()
    }];
    row
}

pub(crate) fn text_message(seq: i64, author: UserView, minutes_ago: i64, text: &str) -> MessageRow {
    fixture::message(
        seq,
        author,
        NOW_MS - minutes_ago * MINUTE,
        Body::default().text(text),
    )
}

pub(crate) fn mine(mut row: MessageRow) -> MessageRow {
    row.mine = true;
    row
}

fn preview_message(seq: i64, minutes_ago: i64, host: &str, image: &str) -> MessageRow {
    let url = "https://blog.example.com/posts/native-client";
    let mut row = fixture::message(
        seq,
        ava(),
        NOW_MS - minutes_ago * MINUTE,
        Body::default().text("Worth a read: ").link(url, url),
    );
    row.link_previews = vec![LinkPreviewView {
        url: url.into(),
        title: Some("Building a native chat client in Rust".into()),
        description: Some(
            "What it took to draw a message list at 120 fps, and what we left to the web.".into(),
        ),
        image_url: Some(image.into()),
        image_host: Some(host.into()),
        site_name: Some("Example Blog".into()),
        ..LinkPreviewView::default()
    }];
    row
}

pub(crate) fn readers(count: usize) -> Vec<UserView> {
    const NAMES: [&str; 20] = [
        "Sam Rivera",
        "Ava Chen",
        "Ben",
        "Cleo",
        "Dmitri Volkov",
        "Elena",
        "Farah Haddad",
        "Gus",
        "Hana Sato",
        "Ian",
        "Jo",
        "Kai Nakamura",
        "Lena",
        "Marco",
        "Nia",
        "Omar",
        "Priya",
        "Quinn",
        "Rosa",
        "Theo",
    ];
    (0..count)
        .map(|index| {
            let name = NAMES[index % NAMES.len()];
            fixture::user(
                &format!("u-reader-{index}"),
                &name.to_lowercase().replace(' ', "."),
                Some(name),
            )
        })
        .collect()
}

pub(crate) fn seen(readers: Vec<UserView>, count: u32) -> SeenByView {
    let more = count - readers.len() as u32;
    SeenByView {
        state: LoadState::Ready,
        readers,
        count,
        more,
    }
}

#[cfg(feature = "stories")]
struct MediaList {
    rows: Vec<MessageRow>,
    third_party: bool,
    seen: Option<SeenByView>,
}

#[cfg(feature = "stories")]
impl MediaList {
    fn new(rows: Vec<MessageRow>) -> Self {
        Self {
            rows,
            third_party: false,
            seen: None,
        }
    }

    fn allowed(mut self) -> Self {
        self.third_party = true;
        self
    }

    fn seen(mut self, seen: SeenByView) -> Self {
        self.seen = Some(seen);
        self
    }

    fn view(self, cx: &mut App) -> AnyView {
        init(cx);
        cx.new(|cx| {
            let mut list = MessageList::new(
                ListData {
                    me_id: fixture::me().id,
                    rows: self.rows,
                    replies: HashMap::new(),
                    status: ListStatus::Ready,
                },
                Rc::new(StoryMedia::new()),
                ListOptions {
                    time: TimeFormat::fixed(NOW_MS),
                    follow_theme: true,
                    scrollbar: false,
                    ..ListOptions::default()
                },
                cx,
            );
            list.set_third_party_media(self.third_party, cx);
            list.set_seen_by(self.seen, cx);
            list
        })
        .into()
    }
}

fn gif_rows(url: &str) -> Vec<MessageRow> {
    vec![
        text_message(1, ava(), 6, "Friday deploy went out clean."),
        gif_message(2, sam(), 5, url),
        text_message(3, ava(), 4, "Ha, exactly."),
    ]
}

/// A 1:1 DM: Sam and me, my message last.
fn dm_rows() -> Vec<MessageRow> {
    vec![
        text_message(1, sam(), 9, "Are you around for the release check later?"),
        mine(text_message(
            2,
            fixture::me(),
            8,
            "Yes, after lunch. I'll ping you.",
        )),
    ]
}

/// A group DM or a channel: several people, my message last.
fn group_rows() -> Vec<MessageRow> {
    vec![
        text_message(1, sam(), 12, "Who is taking the upgrade test?"),
        text_message(2, ava(), 11, "I can, if someone seeds the data."),
        mine(text_message(
            3,
            fixture::me(),
            10,
            "I'll seed it tonight and post the snapshot here.",
        )),
    ]
}

fn mixed_rows() -> Vec<MessageRow> {
    vec![
        text_message(
            1,
            ava(),
            30,
            "Morning! Notes from yesterday are in the doc.",
        ),
        preview_message(2, 28, "blog.example.com", COVER),
        gif_message(3, sam(), 20, GIF_CAT),
        mine(text_message(
            4,
            fixture::me(),
            15,
            "Nice. I read it on the train.",
        )),
        text_message(5, sam(), 12, "The wide one is my favourite."),
        gif_message(6, sam(), 11, GIF_WIDE),
        mine(text_message(
            7,
            fixture::me(),
            9,
            "Shipping the GIF cards today; reviews welcome.",
        )),
    ]
}

#[cfg(feature = "stories")]
pub fn stories() -> Vec<Story> {
    vec![
        Story::new("um-gif-allowed", |_, _, cx| {
            MediaList::new(gif_rows(GIF_CAT)).allowed().view(cx)
        }),
        Story::new("um-gif-blocked", |_, _, cx| {
            MediaList::new(gif_rows(GIF_CAT)).view(cx)
        }),
        Story::new("um-gif-blocked-long-host", |_, _, cx| {
            let url = format!("https://{LONG_HOST}/media/giphy.gif");
            MediaList::new(gif_rows(&url)).view(cx)
        }),
        Story::new("um-gif-failed", |_, _, cx| {
            MediaList::new(gif_rows(GIF_BROKEN)).allowed().view(cx)
        }),
        Story::new("um-gif-wide", |_, _, cx| {
            MediaList::new(gif_rows(GIF_WIDE)).allowed().view(cx)
        }),
        Story::new("um-gif-tall", |_, _, cx| {
            MediaList::new(gif_rows(GIF_TALL)).allowed().view(cx)
        }),
        Story::new("um-preview-image-blocked", |_, _, cx| {
            MediaList::new(vec![preview_message(1, 3, "blog.example.com", COVER)]).view(cx)
        }),
        Story::new("um-preview-image-allowed", |_, _, cx| {
            MediaList::new(vec![preview_message(1, 3, "blog.example.com", COVER)])
                .allowed()
                .view(cx)
        }),
        Story::new("um-preview-long-host", |_, _, cx| {
            let image = format!("https://{LONG_HOST}/cover.png");
            MediaList::new(vec![preview_message(1, 3, LONG_HOST, &image)]).view(cx)
        }),
        Story::new("um-seen-dm-one", |_, _, cx| {
            MediaList::new(dm_rows())
                .seen(seen(vec![sam()], 1))
                .view(cx)
        }),
        Story::new("um-seen-group-two", |_, _, cx| {
            MediaList::new(group_rows())
                .seen(seen(vec![sam(), ava()], 2))
                .view(cx)
        }),
        Story::new("um-seen-group-many", |_, _, cx| {
            MediaList::new(group_rows())
                .seen(seen(readers(15), 23))
                .view(cx)
        }),
        Story::new("um-seen-nobody", |_, _, cx| {
            MediaList::new(group_rows())
                .seen(seen(Vec::new(), 0))
                .view(cx)
        }),
        Story::new("um-seen-loading", |_, _, cx| {
            MediaList::new(dm_rows())
                .seen(SeenByView::default())
                .view(cx)
        }),
        Story::new("um-seen-not-latest", |_, _, cx| {
            let mut rows = dm_rows();
            rows.push(text_message(3, sam(), 7, "Great, thanks."));
            rows.push(mine(text_message(
                4,
                fixture::me(),
                6,
                "One more thing: bring the checklist.",
            )));
            MediaList::new(rows).seen(seen(vec![sam()], 1)).view(cx)
        }),
        Story::new("um-mixed", |_, _, cx| {
            MediaList::new(mixed_rows())
                .allowed()
                .seen(seen(readers(3), 3))
                .view(cx)
        }),
        Story::new("um-mixed-blocked", |_, _, cx| {
            MediaList::new(mixed_rows())
                .seen(seen(readers(3), 3))
                .view(cx)
        }),
    ]
}
