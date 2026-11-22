//! Composer, SuggestionList and the queued AttachmentTile, one story per state the web kit's
//! stories show (`frontend/src/stories/kit/KitComposer.stories.tsx`, `KitAttachmentTile`'s
//! `Queued`), in the same words.

use super::stories::{Body, Palette, colour, labelled, picture, view};
use super::{
    AttachmentKind, AttachmentTile, BannerKind, Composer, ComposerBanner, ComposerCap,
    ComposerMode, ComposerNotice, Suggestion, SuggestionList,
};
use crate::kit::{IconButton, IconButtonVariant, Island, Padding, Pill};
use crate::stories::Story;
use gpui_kit::component::input::TextareaState;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_design::lounge::{SPACE_LG, SPACE_SM};
use semaphore_design::{Icon as I, LoungeIcon};

/// A field the story keeps across frames under `key`, starting with `initial`.
pub(super) fn field(
    key: impl Into<ElementId>,
    initial: &'static str,
    window: &mut Window,
    cx: &mut App,
) -> Entity<TextareaState> {
    window.use_keyed_state(key, cx, move |window, cx| {
        let mut state = TextareaState::new(window, cx);
        state.set_value(initial, window, cx);
        state
    })
}

/// A composer with its own draft, so a story can be typed into: Send clears it.
pub(super) fn live(
    id: &'static str,
    label: &'static str,
    initial: &'static str,
    window: &mut Window,
    cx: &mut App,
) -> Composer {
    let state = field((id, 0usize), initial, window, cx);
    let clear = state.clone();
    Composer::new(id, label, state).on_submit(move |window, cx| {
        clear.update(cx, |field, cx| field.set_value("", window, cx));
    })
}

fn emoji(id: &'static str) -> IconButton {
    IconButton::new(id, I::EmojiEmotionsOutlined, "Emoji")
        .lounge_icon(LoungeIcon::Smile)
        .variant(IconButtonVariant::Soft)
        .on_click(|_, _, _| {})
}

/// The conversation's composer: attach and emoji, as the web's `Live`.
fn full(id: &'static str, initial: &'static str, window: &mut Window, cx: &mut App) -> Composer {
    live(id, "Message #general", initial, window, cx)
        .on_attach(|_, _| {})
        .emoji([emoji(id)])
}

/// A chat column the width of the web's `ChatColumn`, with the composer at its foot.
fn column(id: &'static str, children: Vec<AnyElement>) -> AnyElement {
    div()
        .w(px(640.))
        .max_w_full()
        .child(
            Island::new(id)
                .padding(Padding::None)
                .child(div().pt(px(SPACE_LG)).flex().flex_col().children(children)),
        )
        .into_any_element()
}

const MANY_LINES: &str = "line 1 of a long draft\nline 2 of a long draft\nline 3 of a long draft\n\
line 4 of a long draft\nline 5 of a long draft\nline 6 of a long draft\nline 7 of a long draft\n\
line 8 of a long draft\nline 9 of a long draft\nline 10 of a long draft\nline 11 of a long draft\n\
line 12 of a long draft\nline 13 of a long draft\nline 14 of a long draft";

fn queued(id: &'static str, name: &'static str, detail: &'static str) -> AttachmentTile {
    AttachmentTile::new(id, AttachmentKind::File, name)
        .detail(detail)
        .on_remove(|_, _| {})
}

fn states_body(window: &mut Window, cx: &mut App) -> AnyElement {
    let reply = || {
        ComposerBanner::new(
            BannerKind::Reply,
            "Replying to aiko",
            "Cancel reply",
            |_, _| {},
        )
        .detail("you still have my headset btw")
    };
    let editing = || {
        ComposerBanner::new(
            BannerKind::Editing,
            "Editing message",
            "Cancel editing",
            |_, _| {},
        )
        .detail("Escape to cancel, Enter to save")
    };
    let states: Vec<(&'static str, Composer)> = vec![
        (
            "Empty: Send reads as unavailable",
            full("empty", "", window, cx),
        ),
        ("Typing", full("typing", "same time tomorrow?", window, cx)),
        (
            "Multi-line at the cap (desktop: 10 rows, then it scrolls)",
            full("desktop-cap", MANY_LINES, window, cx),
        ),
        (
            "Phone cap (4 rows)",
            full("phone-cap", MANY_LINES, window, cx).cap(ComposerCap::Phone),
        ),
        (
            "Keyboard cap (2 rows, the on-screen keyboard is up)",
            full("keyboard-cap", MANY_LINES, window, cx).cap(ComposerCap::Keyboard),
        ),
        (
            "Reply banner",
            full("reply", "on it", window, cx).banner(reply()),
        ),
        (
            "Editing banner, save mode: \"Save changes\" with a check",
            full("editing", "yeah i'll bring it friday", window, cx)
                .mode(ComposerMode::Save)
                .banner(editing()),
        ),
        (
            "Save mode with nothing changed yet: unavailable",
            full("save-empty", "", window, cx).mode(ComposerMode::Save),
        ),
        (
            "Inline edit (inside a message row): no Save button, the hint \"escape to cancel • enter to save\" instead",
            live("inline", "Message #general", "edited in place", window, cx)
                .inline()
                .mode(ComposerMode::Save)
                .on_cancel(|_, _| {}),
        ),
        (
            "Inline edit on touch (Enter is a new line): the hint is \"Cancel • Save\"",
            live(
                "inline-touch",
                "Message #general",
                "edited in place",
                window,
                cx,
            )
            .inline()
            .mode(ComposerMode::Save)
            .submit_on_enter(false)
            .on_cancel(|_, _| {}),
        ),
        (
            "Files dragged over the conversation: the drop look",
            full("drop", "half typed", window, cx).drop_target("Drop files to attach them"),
        ),
        (
            "Attachments tray",
            full("tray", "", window, cx).can_send(true).attachments([
                Pill::new("deep-dive-clip.png").icon(LoungeIcon::Image),
                Pill::new("notes.txt").icon(LoungeIcon::Paperclip),
            ]),
        ),
        (
            "Attachments tray with kit tiles (Remove on each, a picture thumbnail)",
            full("tiles", "the files", window, cx).attachments([
                queued("tray-notes", "notes.txt", "2.1 KB"),
                queued("tray-long", "a-rather-long-name-for-a-file.pdf", "4 MB"),
            ]),
        ),
        (
            "Sending: Send is busy, the field stays editable",
            full("sending", "on its way", window, cx).sending(true),
        ),
        (
            "Attach unavailable (no permission to attach): a press says why",
            full("no-attach", "", window, cx).attach_unavailable(true),
        ),
        (
            "Notice: no permission",
            full("notice-lock", "", window, cx).notice(
                ComposerNotice::new("You can't send messages in #announcements")
                    .icon(LoungeIcon::Lock),
            ),
        ),
        (
            "Notice: timed out",
            full("notice-timeout", "", window, cx).notice(
                ComposerNotice::new("You're timed out for 4 more minutes").icon(LoungeIcon::Shield),
            ),
        ),
        (
            "Notice: read only",
            full("notice-read", "", window, cx)
                .notice(ComposerNotice::new("This channel is read only").icon(LoungeIcon::Eye)),
        ),
    ];
    div()
        .flex()
        .flex_col()
        .gap(px(SPACE_LG))
        .children(
            states
                .into_iter()
                .enumerate()
                .map(|(index, (label, composer))| {
                    labelled(
                        label,
                        vec![column(
                            [
                                "c0", "c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8", "c9", "c10",
                                "c11", "c12", "c13", "c14", "c15", "c16", "c17",
                            ][index],
                            vec![composer.into_any_element()],
                        )],
                        cx,
                    )
                }),
        )
        .into_any_element()
}

fn suggestions() -> Vec<Suggestion> {
    vec![
        Suggestion::new("here", "here")
            .detail("Notify online members in this channel")
            .icon(LoungeIcon::Megaphone),
        Suggestion::new("channel", "channel")
            .detail("Notify all members in this channel")
            .icon(LoungeIcon::Megaphone),
        Suggestion::new("mods", "mods")
            .detail("4 members")
            .icon(LoungeIcon::Users),
        Suggestion::new("aiko", "aiko")
            .detail("Aiko Tanaka")
            .avatar(None, Some(colour(0xff8fb8))),
        Suggestion::new("long", "a-member-with-a-very-long-username-indeed")
            .detail("And an even longer display name that gives way")
            .avatar(None, Some(colour(0x5fd49a))),
    ]
}

/// The mention list open over the conversation, the second option highlighted.
fn mentions_body(window: &mut Window, cx: &mut App) -> AnyElement {
    let composer = full("mentions", "hey @a", window, cx).suggestions(
        SuggestionList::new(
            "story-mentions",
            "Mention suggestions",
            suggestions(),
            Some(1),
        )
        .on_pick(|_, _, _| {}),
    );
    column(
        "mention-column",
        vec![
            div().h(px(360.)).into_any_element(),
            composer.into_any_element(),
        ],
    )
}

/// Loading the members: a spinner row.
fn mentions_loading_body(window: &mut Window, cx: &mut App) -> AnyElement {
    let composer = full("mentions-loading", "@", window, cx).suggestions(
        SuggestionList::new("story-mentions", "Mention suggestions", Vec::new(), None)
            .loading(true)
            .on_pick(|_, _, _| {}),
    );
    column(
        "mention-column",
        vec![
            div().h(px(120.)).into_any_element(),
            composer.into_any_element(),
        ],
    )
}

fn at_cap(cap: ComposerCap, window: &mut Window, cx: &mut App) -> AnyElement {
    column(
        "cap-column",
        vec![
            full("at-cap", MANY_LINES, window, cx)
                .cap(cap)
                .into_any_element(),
        ],
    )
}

fn at_desktop_cap(window: &mut Window, cx: &mut App) -> AnyElement {
    at_cap(ComposerCap::Desktop, window, cx)
}

fn at_phone_cap(window: &mut Window, cx: &mut App) -> AnyElement {
    at_cap(ComposerCap::Phone, window, cx)
}

fn at_keyboard_cap(window: &mut Window, cx: &mut App) -> AnyElement {
    at_cap(ComposerCap::Keyboard, window, cx)
}

/// Queued in the composer's tray: not pressable, a thumbnail for a picture, Remove, a long name.
fn queued_body(_: &mut Window, _: &mut App) -> AnyElement {
    div()
        .w(px(390.))
        .max_w_full()
        .child(
            Island::new("queued").padding(Padding::None).child(
                div()
                    .p(px(SPACE_LG))
                    .flex()
                    .flex_col()
                    .gap(px(SPACE_SM))
                    .child(queued("q-notes", "notes.txt", "2.1 KB"))
                    .child(
                        queued("q-sunset", "sunset.png", "1.2 MB")
                            .src(picture(1600, 900, 0xffa366)),
                    )
                    .child(queued(
                        "q-long",
                        "a-very-long-file-name-that-has-to-give-way-at-phone-width.pdf",
                        "4 MB",
                    )),
            ),
        )
        .into_any_element()
}

pub fn stories() -> Vec<Story> {
    macro_rules! story {
        ($name:literal, $palette:expr, $body:expr) => {
            Story::new($name, |_, _, cx| view($palette, $body as Body, cx))
        };
    }
    use Palette::{Dark, Light, Tinted};
    vec![
        story!("kit-composer-states", Dark, states_body),
        story!("kit-composer-states-light", Light, states_body),
        story!("kit-composer-states-tinted", Tinted, states_body),
        story!("kit-composer-mention-list", Dark, mentions_body),
        story!("kit-composer-mention-list-light", Light, mentions_body),
        story!("kit-composer-mention-list-tinted", Tinted, mentions_body),
        story!(
            "kit-composer-mention-list-loading",
            Dark,
            mentions_loading_body
        ),
        story!("kit-composer-at-cap", Dark, at_desktop_cap),
        story!("kit-composer-at-phone-cap", Dark, at_phone_cap),
        story!("kit-composer-at-keyboard-cap", Dark, at_keyboard_cap),
        story!("kit-attachment-tile-queued", Dark, queued_body),
        story!("kit-attachment-tile-queued-light", Light, queued_body),
    ]
}
