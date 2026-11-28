//! The chat pieces' pure rules for the apps: `semaphore_design::chat` and
//! `semaphore_core::links::check_link`, so a mobile client draws a message, its links, the typing
//! line and "Jump to latest" by the same Rust rules as desktop and the web kit, not a third
//! implementation.
//!
//! Pure functions of their arguments: they touch no core and no runtime, so they are free exports
//! rather than `SemaphoreCore` methods, and the `run`/`sync` rule does not apply.

use semaphore_core::model::{SegKind, TextSeg, TextStyle};

/// A web link a message may show and open (`semaphore_core::links::CheckedLink`).
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct CheckedLink {
    /// The only address ever opened: parsed and serialised, punycode host.
    pub href: String,
    /// What is drawn: the parsed address, never decoded, with no bidi controls.
    pub label: String,
}

/// The link a message may open for `href`, or `None` for anything that is not drawn as a link (any
/// scheme but http and https, a user name or password): the web kit's `checkLink`.
#[uniffi::export]
pub fn check_link(href: String) -> Option<CheckedLink> {
    semaphore_core::links::check_link(&href).map(|link| CheckedLink {
        href: link.href,
        label: link.label,
    })
}

/// One run of a message's words, cut out of `MessageRow.display`, ready to draw.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct MessagePiece {
    /// What is drawn. A link's is its checked label (`check_link`), never the text it was written
    /// with.
    pub text: String,
    /// The run's kind as core sent it, except links: a `Link`'s `url` is the checked address to
    /// open, and a link `check_link` refuses is plain `Text` (its address, bidi controls removed),
    /// never pressable.
    pub kind: SegKind,
    pub style: TextStyle,
}

const PLAIN: TextStyle = TextStyle {
    bold: false,
    italic: false,
    strikethrough: false,
    code: false,
};

/// `display` cut into its runs. Core's segment ends are UTF-8 byte offsets into `display`, which
/// a UTF-16 language can't slice by: this does it here. Each run starts where the last ended. An
/// end past the text is clamped to it and one inside a character is moved back to that
/// character's start; text after the last end is one plain run; an empty run is dropped. So any
/// input gives runs that join up to `display`, except a link's label in place of its words.
#[uniffi::export]
pub fn message_pieces(display: String, segs: Vec<TextSeg>) -> Vec<MessagePiece> {
    let mut pieces = Vec::with_capacity(segs.len() + 1);
    let mut from = 0usize;
    for seg in segs {
        let mut end = (seg.end as usize).min(display.len());
        while !display.is_char_boundary(end) {
            end -= 1;
        }
        if end <= from {
            continue;
        }
        let text = &display[from..end];
        from = end;
        pieces.push(piece(text, seg.kind, seg.style));
    }
    if from < display.len() {
        pieces.push(MessagePiece {
            text: display[from..].to_owned(),
            kind: SegKind::Text,
            style: PLAIN,
        });
    }
    pieces
}

fn piece(text: &str, kind: SegKind, style: TextStyle) -> MessagePiece {
    match kind {
        SegKind::Link { url } => match semaphore_core::links::check_link(&url) {
            Some(link) => MessagePiece {
                text: link.label,
                kind: SegKind::Link { url: link.href },
                style,
            },
            None => MessagePiece {
                text: semaphore_design::chat::strip_bidi(&url),
                kind: SegKind::Text,
                style,
            },
        },
        kind => MessagePiece {
            text: text.to_owned(),
            kind,
            style,
        },
    }
}

/// Who is typing, in words: "Ava is typing…", "Ava and Ben are typing…", "Ava and 2 others are
/// typing…"; empty for nobody.
#[uniffi::export]
pub fn typing_text(names: Vec<String>) -> String {
    semaphore_design::chat::typing_text(&names)
}

/// What "Jump to latest" shows and is named (`semaphore_design::chat::JumpText`).
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct JumpText {
    /// "Jump to latest", "3 new", "99+ new".
    pub text: String,
    /// The accessible name: "Jump to latest, 3 new messages".
    pub name: String,
    /// There is a count: the control is drawn in the accent.
    pub counted: bool,
}

/// The jump control's words for `new_count` messages that arrived while the reader was away.
#[uniffi::export]
pub fn jump_text(new_count: u32) -> JumpText {
    let jump = semaphore_design::chat::jump_text(u64::from(new_count));
    JumpText {
        text: jump.text,
        name: jump.name,
        counted: jump.counted,
    }
}

/// The composer's shared numbers (`semaphore_design::chat`): how many lines its field grows to
/// before it scrolls, on a phone and with the on-screen keyboard up, and how many suggestion rows
/// show before the list scrolls.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Record)]
pub struct ComposerCaps {
    pub phone_rows: u32,
    pub keyboard_rows: u32,
    pub suggestions_shown: u32,
}

#[uniffi::export]
pub fn composer_caps() -> ComposerCaps {
    use semaphore_design::chat::{ComposerCap, SUGGESTIONS_SHOWN, cap_rows};
    let rows = |cap| u32::try_from(cap_rows(cap)).unwrap_or(u32::MAX);
    ComposerCaps {
        phone_rows: rows(ComposerCap::Phone),
        keyboard_rows: rows(ComposerCap::Keyboard),
        suggestions_shown: u32::try_from(SUGGESTIONS_SHOWN).unwrap_or(u32::MAX),
    }
}

/// What one message may carry (`semaphore_design::chat`, the web's `constants/messages.ts`): the
/// composer refuses more files, or a bigger one, before anything is sent.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Record)]
pub struct AttachmentLimits {
    pub max_files: u32,
    pub max_file_bytes: u64,
}

#[uniffi::export]
pub fn attachment_limits() -> AttachmentLimits {
    use semaphore_design::chat::{MAX_FILE_BYTES, MAX_FILES_PER_MESSAGE};
    AttachmentLimits {
        max_files: u32::try_from(MAX_FILES_PER_MESSAGE).unwrap_or(u32::MAX),
        max_file_bytes: MAX_FILE_BYTES,
    }
}

/// The box an image attachment is drawn in, in density-independent pixels.
#[derive(Debug, Clone, Copy, PartialEq, uniffi::Record)]
pub struct ImageBox {
    pub width: f32,
    pub height: f32,
}

/// `semaphore_design::chat::image_box` (the web's `imageBox`): the image's own size shrunk to fit
/// 320×240, no side under 48, or 240×160 when the size isn't known.
#[uniffi::export]
pub fn image_box(width: Option<u32>, height: Option<u32>) -> ImageBox {
    let size = semaphore_design::chat::image_box(width.map(f64::from), height.map(f64::from));
    ImageBox {
        width: size.width,
        height: size.height,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn composer_caps_are_the_design_crates() {
        assert_eq!(
            composer_caps(),
            ComposerCaps {
                phone_rows: 4,
                keyboard_rows: 2,
                suggestions_shown: 6,
            }
        );
    }

    #[test]
    fn attachment_limits_are_the_webs() {
        assert_eq!(
            attachment_limits(),
            AttachmentLimits {
                max_files: 10,
                max_file_bytes: 10 * 1024 * 1024,
            }
        );
    }

    #[test]
    fn image_boxes_follow_the_design_crate() {
        let at = |w, h| {
            let b = image_box(w, h);
            (b.width, b.height)
        };
        assert_eq!(at(None, Some(10)), (240., 160.));
        assert_eq!(at(Some(0), Some(10)), (240., 160.));
        assert_eq!(at(Some(100), Some(50)), (100., 50.));
        assert_eq!(at(Some(4000), Some(3000)), (320., 240.));
        assert_eq!(at(Some(4000), Some(10)), (320., 48.));
        assert_eq!(at(Some(10), Some(4000)), (48., 240.));
    }

    fn seg(end: usize, kind: SegKind) -> TextSeg {
        TextSeg {
            end: end as u32,
            kind,
            style: PLAIN,
        }
    }

    fn texts(pieces: &[MessagePiece]) -> Vec<&str> {
        pieces.iter().map(|piece| piece.text.as_str()).collect()
    }

    #[test]
    fn byte_offsets_cut_multibyte_text_into_strings() {
        // "é" is 2 bytes, "😀" 4 (a surrogate pair in UTF-16), "日本" 6.
        let display = "é😀 @ava 日本".to_owned();
        let mention = display.find('@').unwrap();
        let after = mention + "@ava".len();
        let pieces = message_pieces(
            display.clone(),
            vec![
                seg(mention, SegKind::Text),
                seg(
                    after,
                    SegKind::UserMention {
                        user_id: "u1".into(),
                    },
                ),
                seg(display.len(), SegKind::Text),
            ],
        );
        assert_eq!(texts(&pieces), ["é😀 ", "@ava", " 日本"]);
        assert_eq!(
            pieces[1].kind,
            SegKind::UserMention {
                user_id: "u1".into()
            }
        );
        assert_eq!(pieces.concat_text(), display);
    }

    trait Concat {
        fn concat_text(&self) -> String;
    }

    impl Concat for Vec<MessagePiece> {
        fn concat_text(&self) -> String {
            self.iter().map(|piece| piece.text.as_str()).collect()
        }
    }

    #[test]
    fn bad_offsets_never_panic_and_keep_every_character() {
        let display = "a😀b".to_owned();
        // 2 is inside the emoji (bytes 1..5); 99 is past the end; 1 again is behind.
        let pieces = message_pieces(
            display.clone(),
            vec![
                seg(2, SegKind::Text),
                seg(1, SegKind::Text),
                seg(99, SegKind::CodeBlock),
            ],
        );
        assert_eq!(texts(&pieces), ["a", "😀b"]);
        assert_eq!(pieces[1].kind, SegKind::CodeBlock);
        assert_eq!(pieces.concat_text(), display);
    }

    #[test]
    fn text_after_the_last_segment_and_no_segments_are_plain() {
        let pieces = message_pieces("hello world".into(), vec![seg(5, SegKind::Text)]);
        assert_eq!(texts(&pieces), ["hello", " world"]);
        assert_eq!(pieces[1].style, PLAIN);
        assert_eq!(
            texts(&message_pieces("just text".into(), vec![])),
            ["just text"]
        );
        assert!(message_pieces(String::new(), vec![]).is_empty());
    }

    #[test]
    fn a_link_draws_its_checked_label_and_opens_its_checked_address() {
        let display = "see https://аpple.com/a b".to_owned();
        let start = display.find("https").unwrap();
        let end = display.find(' ').map(|_| display.len() - 2).unwrap();
        let pieces = message_pieces(
            display.clone(),
            vec![
                seg(start, SegKind::Text),
                seg(
                    end,
                    SegKind::Link {
                        url: "https://аpple.com/a".into(),
                    },
                ),
            ],
        );
        assert_eq!(pieces[1].text, "https://xn--pple-43d.com/a");
        assert_eq!(
            pieces[1].kind,
            SegKind::Link {
                url: "https://xn--pple-43d.com/a".into()
            }
        );
        assert_eq!(pieces[2].text, " b");
    }

    #[test]
    fn a_refused_link_is_plain_text_without_bidi_controls() {
        for url in [
            "javascript:alert(1)",
            "https://bank.example@evil.example/",
            "ftp://files.example/",
        ] {
            let pieces = message_pieces(
                url.to_owned(),
                vec![seg(url.len(), SegKind::Link { url: url.into() })],
            );
            assert_eq!(pieces.len(), 1);
            assert_eq!(pieces[0].kind, SegKind::Text, "{url}");
            assert_eq!(pieces[0].text, url);
        }
        let tricky = "javascript:\u{202E}gpj.exe".to_owned();
        let pieces = message_pieces(
            tricky.clone(),
            vec![seg(
                tricky.len(),
                SegKind::Link {
                    url: tricky.clone(),
                },
            )],
        );
        assert_eq!(pieces[0].text, "javascript:gpj.exe");
    }

    #[test]
    fn styles_pass_through() {
        let bold = TextStyle {
            bold: true,
            ..PLAIN
        };
        let pieces = message_pieces(
            "hi".into(),
            vec![TextSeg {
                end: 2,
                kind: SegKind::Text,
                style: bold,
            }],
        );
        assert_eq!(pieces[0].style, bold);
    }

    #[test]
    fn check_link_is_core_s() {
        assert_eq!(
            check_link("https://аpple.com".into()),
            Some(CheckedLink {
                href: "https://xn--pple-43d.com/".into(),
                label: "https://xn--pple-43d.com/".into(),
            })
        );
        assert_eq!(check_link("mailto:a@b.c".into()), None);
    }

    #[test]
    fn typing_and_jump_words_are_the_design_crate_s() {
        assert_eq!(typing_text(vec![]), "");
        assert_eq!(typing_text(vec!["Ava".into()]), "Ava is typing…");
        assert_eq!(
            typing_text(vec!["Ava".into(), "Ben".into(), "Cy".into()]),
            "Ava and 2 others are typing…"
        );
        assert_eq!(jump_text(0).text, "Jump to latest");
        assert!(!jump_text(0).counted);
        assert_eq!(jump_text(3).name, "Jump to latest, 3 new messages");
        assert_eq!(jump_text(150).text, "99+ new");
    }
}
