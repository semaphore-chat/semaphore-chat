//! The composer's stories, drawn by `rig-shot`. The composer sits at the bottom of its window, as it
//! does under the message list, so the dropdown has the room it has in the app.

use super::model::{Availability, DraftStore, MentionSource, PendingAttachment, ReplyTarget};
use super::palette::Palette;
use super::view::{Composer, ComposerConfig};
use crate::stories::{Story, StoryEnv};
use gpui_kit::component::{ActiveTheme as _, Theme, ThemeMode};
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{Conversation, MentionCandidate, MentionKind};
use std::rc::Rc;
use std::sync::Arc;
use std::time::Duration;

/// Candidates shaped as `useMentionAutocomplete` ranks them: special, then aliases, then users.
struct Fixture;

fn candidate(kind: MentionKind, id: &str, label: &str, insert: &str) -> MentionCandidate {
    MentionCandidate {
        kind,
        id: id.into(),
        label: label.into(),
        insert_text: insert.into(),
        avatar_file_id: None,
    }
}

impl MentionSource for Fixture {
    fn candidates(&self, query: &str) -> Vec<MentionCandidate> {
        let query = query.to_lowercase();
        [
            candidate(
                MentionKind::Special,
                "here",
                "Notify online members in this channel",
                "@here",
            ),
            candidate(
                MentionKind::Special,
                "channel",
                "Notify all members in this channel",
                "@channel",
            ),
            candidate(MentionKind::Alias, "a1", "3 members", "@night-crew"),
            candidate(MentionKind::User, "u1", "Ava Chen", "@ava_chen67"),
            candidate(MentionKind::User, "u2", "Ava Ibrahim", "@ava_ibrahim17"),
            candidate(MentionKind::User, "u3", "Priya Nilsson", "@priya"),
            candidate(MentionKind::Channel, "c1", "general", "#general"),
            candidate(
                MentionKind::Channel,
                "c2",
                "announcements",
                "#announcements",
            ),
        ]
        .into_iter()
        .filter(|c| {
            c.insert_text.to_lowercase().contains(&query) || c.label.to_lowercase().contains(&query)
        })
        .collect()
    }
}

struct Host {
    composer: Entity<Composer>,
}

impl Render for Host {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div()
            .size_full()
            .bg(Palette::dark().background)
            .flex()
            .flex_col()
            .justify_end()
            .child(self.composer.clone())
    }
}

/// The kit's colours for what `Textarea` paints itself. U8's theme takes this over.
fn use_web_input_colours(cx: &mut App) {
    Theme::change(ThemeMode::Dark, None, cx);
    let p = Palette::dark();
    let theme = Theme::global_mut(cx);
    theme.colors.muted_foreground = p.text_secondary;
    theme.colors.caret = p.text;
    theme.colors.selection = Hsla {
        a: 0.3,
        ..p.primary
    };
    let _ = cx.theme();
}

fn host(
    window: &mut Window,
    cx: &mut App,
    setup: impl FnOnce(&mut Composer, &mut Window, &mut Context<Composer>),
) -> AnyView {
    use_web_input_colours(cx);
    let drafts = cx.new(|_| DraftStore::default());
    let composer = cx.new(|cx| {
        let mut composer = Composer::new(
            ComposerConfig {
                conversation: Conversation::Channel { id: "c1".into() },
                source: Rc::new(Fixture),
                drafts,
                placeholder: "Type a message...".into(),
                max_file_bytes: None,
            },
            window,
            cx,
        );
        setup(&mut composer, window, cx);
        composer
    });
    cx.new(|_| Host { composer }).into()
}

const LONG: &str = "This draft runs on for a while, the way a long explanation does, so the field has to \
wrap it and keep growing.\nIt has a second paragraph too.\nAnd a third.\nFourth line.\nFifth line.\nSixth \
line.\nSeventh line.\nEighth line.\nNinth line.\nTenth line, by which point the field has hit its cap and \
scrolls, leaving the caret in view.\nEleventh.\nTwelfth.\nThirteenth.\nFourteenth.\nFifteenth.\nSixteenth, \
the last one.";

fn thumbnail() -> ImageSource {
    let width = 128;
    let mut pixels = Vec::with_capacity(width * width * 4);
    for y in 0..width {
        for x in 0..width {
            pixels.extend([(x * 2) as u8, 110, (y * 2) as u8, 255]);
        }
    }
    let buffer = image::RgbaImage::from_raw(width as u32, width as u32, pixels).expect("sized");
    let frame = image::Frame::new(buffer);
    ImageSource::Render(Arc::new(RenderImage::new(vec![frame])))
}

fn reply() -> ReplyTarget {
    ReplyTarget {
        message_id: "m1".into(),
        author_name: "Priya Nilsson".into(),
        snippet: "the original message being replied to".into(),
    }
}

fn with_files(composer: &mut Composer, window: &mut Window, cx: &mut Context<Composer>) {
    let file = |name: &str| PendingAttachment {
        name: name.to_owned().into(),
        size_bytes: Some(1024),
        source: super::model::AttachmentSource::Path(name.into()),
        preview: None,
    };
    let photo = PendingAttachment {
        preview: Some(thumbnail()),
        ..file("photo.png")
    };
    composer.add_attachments(
        vec![
            photo,
            file("quarterly-report-final-v3-really-final-this-time.pdf"),
            file("notes.txt"),
        ],
        window,
        cx,
    );
}

fn channel(name: &str) -> Option<String> {
    Some(name.to_owned())
}

pub fn stories() -> Vec<Story> {
    fn build(
        window: &mut Window,
        cx: &mut App,
        setup: impl FnOnce(&mut Composer, &mut Window, &mut Context<Composer>),
    ) -> AnyView {
        host(window, cx, setup)
    }
    vec![
        Story::new("composer-empty", |_: &StoryEnv, window, cx| {
            build(window, cx, |_, _, _| {})
        }),
        Story::new("composer-long-text", |_, window, cx| {
            build(window, cx, |c, window, cx| {
                c.insert_at_caret(LONG, window, cx)
            })
        }),
        Story::new("composer-mention-open", |_, window, cx| {
            build(window, cx, |c, window, cx| {
                c.insert_at_caret("hey @a", window, cx)
            })
        }),
        Story::new("composer-mention-channels", |_, window, cx| {
            build(window, cx, |c, window, cx| {
                c.insert_at_caret("see #", window, cx)
            })
        }),
        Story::new("composer-reply", |_, window, cx| {
            build(window, cx, |c, window, cx| {
                c.set_reply(Some(reply()), window, cx)
            })
        }),
        Story::new("composer-attachments", |_, window, cx| {
            build(window, cx, with_files)
        }),
        Story::new("composer-reply-files-draft", |_, window, cx| {
            build(window, cx, |c, window, cx| {
                c.set_reply(Some(reply()), window, cx);
                with_files(c, window, cx);
                c.insert_at_caret("a draft with everything at once", window, cx);
            })
        }),
        Story::new("composer-slowmode", |_, window, cx| {
            build(window, cx, |c, window, cx| {
                c.insert_at_caret("waiting my turn", window, cx);
                c.start_slowmode_wait(Duration::from_secs(42), window, cx);
            })
        }),
        Story::new("composer-denied", |_, window, cx| {
            build(window, cx, |c, window, cx| {
                c.set_availability(
                    Availability::NoPermission {
                        channel_name: channel("general"),
                    },
                    window,
                    cx,
                )
            })
        }),
        Story::new("composer-read-only", |_, window, cx| {
            build(window, cx, |c, window, cx| {
                c.set_availability(
                    Availability::ReadOnly {
                        channel_name: channel("announcements"),
                        posting_roles: vec!["Moderator".into(), "Admin".into()],
                    },
                    window,
                    cx,
                )
            })
        }),
        Story::new("composer-timed-out", |_, window, cx| {
            build(window, cx, |c, window, cx| {
                let until = cx.background_executor().now() + Duration::from_secs(12 * 60);
                c.set_availability(
                    Availability::TimedOut {
                        until: Some(until),
                        reason: Some("Spamming the channel".into()),
                    },
                    window,
                    cx,
                )
            })
        }),
        Story::new("composer-narrow", |_, window, cx| {
            build(window, cx, |c, window, cx| {
                c.insert_at_caret("hey @a", window, cx)
            })
        }),
        Story::new("composer-narrow-actions", |_, window, cx| {
            build(window, cx, |c, _, cx| c.open_actions_for_story(cx))
        }),
        Story::new("composer-ime-preedit", |_, window, cx| {
            build(window, cx, |c, window, cx| {
                c.compose_for_story("日本語", window, cx)
            })
        }),
    ]
}
