//! Interaction tests: real keys, clicks and focus through `gpui_kit::test`, on the kit's real field.

use super::model::{
    Availability, ComposerEvent, ComposerMode, DraftStore, MentionSource, PendingAttachment,
    ReplyTarget,
};
use super::view::{Composer, ComposerConfig};
use gpui_kit::component::input::TextareaState;
use gpui_kit::test::{TestInput, TestQueryExt, TestWindowExt};
use gpui_kit::{
    AnyWindowHandle, App, AppContext, Bounds, ClipboardEntry, ClipboardItem, Context, ElementId,
    ElementInputHandler, Entity, Image, ImageFormat, IntoElement, ParentElement, Point, Render,
    Role, Size, Styled, TestAppContext, Window, WindowBounds, WindowOptions, div, px, size,
};
use semaphore_core::model::{Conversation, MentionCandidate, MentionKind, MessageDraft};
use std::cell::RefCell;
use std::rc::Rc;
use std::time::Duration;

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
        [
            candidate(MentionKind::Special, "here", "Notify online", "@here"),
            candidate(MentionKind::Alias, "a1", "3 members", "@night-crew"),
            candidate(MentionKind::User, "u1", "Ava Chen", "@ava"),
            candidate(MentionKind::User, "u2", "Ben Okafor", "@ben"),
            candidate(MentionKind::Channel, "c1", "general", "#general"),
        ]
        .into_iter()
        .filter(|c| c.insert_text.contains(query))
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
            .flex()
            .flex_col()
            .justify_end()
            .child(self.composer.clone())
    }
}

#[derive(Default)]
struct Log {
    sends: Vec<(Conversation, MessageDraft, usize)>,
    typing: usize,
    emoji: usize,
    files: usize,
    edit_last: usize,
    timeout_ended: usize,
    edits: Vec<(String, MessageDraft, Option<Vec<String>>)>,
    cancels: Vec<String>,
}

struct Rig {
    window: AnyWindowHandle,
    composer: Entity<Composer>,
    drafts: Entity<DraftStore>,
    log: Rc<RefCell<Log>>,
}

fn channel(id: &str) -> Conversation {
    Conversation::Channel { id: id.into() }
}

fn rig(cx: &mut TestAppContext) -> Rig {
    rig_sized(cx, size(px(900.), px(800.)))
}

fn rig_sized(cx: &mut TestAppContext, window_size: Size<gpui_kit::Pixels>) -> Rig {
    cx.update(gpui_kit::init);
    let drafts = cx.update(|cx| cx.new(|_| DraftStore::default()));
    open(cx, window_size, drafts)
}

fn open(
    cx: &mut TestAppContext,
    window_size: Size<gpui_kit::Pixels>,
    drafts: Entity<DraftStore>,
) -> Rig {
    open_mode(cx, window_size, drafts, ComposerMode::Send)
}

fn rig_mode(cx: &mut TestAppContext, mode: ComposerMode) -> Rig {
    cx.update(gpui_kit::init);
    let drafts = cx.update(|cx| cx.new(|_| DraftStore::default()));
    open_mode(cx, size(px(900.), px(800.)), drafts, mode)
}

fn open_mode(
    cx: &mut TestAppContext,
    window_size: Size<gpui_kit::Pixels>,
    drafts: Entity<DraftStore>,
    mode: ComposerMode,
) -> Rig {
    let log = Rc::new(RefCell::new(Log::default()));
    let (window, composer) = cx.update(|cx| {
        let store = drafts.clone();
        let log = log.clone();
        let mut made = None;
        let handle = gpui_kit::open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(Bounds {
                    origin: Point::default(),
                    size: window_size,
                })),
                ..Default::default()
            },
            cx,
            |window, cx| {
                let composer = cx.new(|cx| {
                    Composer::new(
                        ComposerConfig {
                            conversation: channel("a"),
                            source: Rc::new(Fixture),
                            drafts: store,
                            placeholder: "Type a message...".into(),
                            max_file_bytes: None,
                            mode,
                        },
                        window,
                        cx,
                    )
                });
                let log = log.clone();
                cx.subscribe(&composer, move |_, event: &ComposerEvent, _| {
                    let mut log = log.borrow_mut();
                    match event {
                        ComposerEvent::Send {
                            conversation,
                            draft,
                            attachments,
                        } => {
                            log.sends
                                .push((conversation.clone(), draft.clone(), attachments.len()))
                        }
                        ComposerEvent::Typing => log.typing += 1,
                        ComposerEvent::OpenEmojiPicker => log.emoji += 1,
                        ComposerEvent::OpenFilePicker => log.files += 1,
                        ComposerEvent::EditLastMessage => log.edit_last += 1,
                        ComposerEvent::TimeoutEnded => log.timeout_ended += 1,
                        ComposerEvent::SaveEdit {
                            message_id,
                            draft,
                            keep_attachment_ids,
                        } => log.edits.push((
                            message_id.clone(),
                            draft.clone(),
                            keep_attachment_ids.clone(),
                        )),
                        ComposerEvent::CancelEdit { message_id } => {
                            log.cancels.push(message_id.clone())
                        }
                    }
                })
                .detach();
                made = Some(composer.clone());
                cx.new(|_| Host { composer })
            },
        )
        .expect("window");
        (handle.0, made.expect("built"))
    });
    Rig {
        window,
        composer,
        drafts,
        log,
    }
}

impl Rig {
    /// Runs `f` with a frame drawn first, and settles deferred effects after.
    fn with<R>(
        &self,
        cx: &mut TestAppContext,
        f: impl FnOnce(&Entity<Composer>, &mut Window, &mut App) -> R,
    ) -> R {
        let out = cx
            .update_window(self.window, |_, window, cx| {
                window.render_frame(cx);
                let out = f(&self.composer, window, cx);
                window.render_frame(cx);
                out
            })
            .expect("window");
        cx.run_until_parked();
        out
    }

    fn typed(&self, cx: &mut TestAppContext, text: &str) {
        self.with(cx, |_, window, cx| window.input(text, cx));
    }

    fn press(&self, cx: &mut TestAppContext, key: &str) {
        self.with(cx, |_, window, cx| window.press(key, cx));
    }

    fn click(&self, cx: &mut TestAppContext, id: impl Into<ElementId>) {
        let id = id.into();
        self.with(cx, |_, window, cx| window.click(id, cx));
    }

    fn value(&self, cx: &mut TestAppContext) -> String {
        cx.update(|cx| self.composer.read(cx).value(cx).to_string())
    }

    fn field(&self, cx: &mut TestAppContext) -> Entity<TextareaState> {
        cx.update(|cx| self.composer.read(cx).field_state())
    }

    fn field_id(&self, cx: &mut TestAppContext) -> ElementId {
        let field = self.field(cx);
        ("input", field.entity_id()).into()
    }

    fn menu_open(&self, cx: &mut TestAppContext) -> bool {
        self.with(cx, |_, window, _| window.try_find("mention-menu").is_some())
    }

    fn options(&self, cx: &mut TestAppContext) -> Vec<(String, bool)> {
        self.with(cx, |_, window, _| {
            window
                .find_all_by_role(Role::ListBoxOption)
                .iter()
                .map(|option| {
                    (
                        option.label().unwrap_or_default().to_owned(),
                        option.selected().unwrap_or(false),
                    )
                })
                .collect()
        })
    }

    fn selected_option(&self, cx: &mut TestAppContext) -> Option<String> {
        self.options(cx)
            .into_iter()
            .find(|(_, s)| *s)
            .map(|(l, _)| l)
    }

    fn sends(&self) -> usize {
        self.log.borrow().sends.len()
    }

    fn last_draft(&self) -> MessageDraft {
        self.log.borrow().sends.last().expect("a send").1.clone()
    }

    fn settle(&self, cx: &mut TestAppContext, result: Result<(), String>) {
        self.with(cx, |composer, window, cx| {
            composer.update(cx, |composer, cx| composer.send_settled(result, window, cx));
        });
    }

    fn availability(&self, cx: &mut TestAppContext, availability: Availability) {
        self.with(cx, |composer, window, cx| {
            composer.update(cx, |composer, cx| {
                composer.set_availability(availability, window, cx)
            });
        });
    }

    /// Drives the text-input protocol an input method uses, on the field itself.
    fn ime<R>(&self, cx: &mut TestAppContext, f: impl FnOnce(&mut TestInput, &mut App) -> R) -> R {
        let field = self.field(cx);
        let id = self.field_id(cx);
        self.with(cx, |_, window, cx| {
            let bounds = window.find(id).bounds();
            let mut input = TestInput::new(ElementInputHandler::new(bounds, field), window);
            f(&mut input, cx)
        })
    }
}

fn file(name: &str) -> PendingAttachment {
    PendingAttachment::from_path(std::path::Path::new(name))
}

#[gpui_kit::test]
fn enter_sends_and_shift_enter_makes_a_new_line(cx: &mut TestAppContext) {
    let rig = rig(cx);
    rig.typed(cx, "first");
    rig.press(cx, "shift-enter");
    rig.typed(cx, "second");
    assert_eq!(rig.value(cx), "first\nsecond");
    assert_eq!(rig.sends(), 0);

    rig.press(cx, "enter");
    assert_eq!(rig.sends(), 1);
    assert_eq!(rig.last_draft().text, "first\nsecond");
    assert_eq!(rig.log.borrow().sends[0].0, channel("a"));
    assert_eq!(rig.value(cx), "", "the field clears at once");
    assert!(rig.log.borrow().typing > 0);
}

#[gpui_kit::test]
fn only_whitespace_does_not_send_and_outer_whitespace_is_trimmed(cx: &mut TestAppContext) {
    let rig = rig(cx);
    rig.press(cx, "enter");
    rig.typed(cx, "   ");
    rig.press(cx, "enter");
    assert_eq!(rig.sends(), 0);
    rig.typed(cx, "hi ");
    rig.press(cx, "enter");
    assert_eq!(rig.last_draft().text, "hi");
}

#[gpui_kit::test]
fn the_send_button_sends_and_gives_focus_back(cx: &mut TestAppContext) {
    let rig = rig(cx);
    let send = |rig: &Rig, cx: &mut TestAppContext| {
        rig.with(cx, |_, window, _| window.find_by_label("send").disabled())
    };
    assert_eq!(send(&rig, cx), Some(true), "disabled while empty");
    rig.typed(cx, "hi");
    assert_ne!(send(&rig, cx), Some(true));
    rig.click(cx, "composer-send");
    assert_eq!(rig.sends(), 1);
    assert_eq!(
        send(&rig, cx),
        Some(true),
        "disabled again while it is on its way"
    );
    let id = rig.field_id(cx);
    assert_eq!(
        rig.with(cx, |_, window, _| window.find(id).focused()),
        Some(true)
    );
}

#[gpui_kit::test]
fn one_send_at_a_time_and_a_failure_puts_the_message_back(cx: &mut TestAppContext) {
    let rig = rig(cx);
    rig.typed(cx, "first");
    rig.press(cx, "enter");
    rig.typed(cx, "second");
    rig.press(cx, "enter");
    assert_eq!(rig.sends(), 1, "the second waits for the first to settle");
    assert_eq!(rig.value(cx), "second");

    rig.settle(cx, Ok(()));
    rig.press(cx, "enter");
    assert_eq!(rig.sends(), 2);
    assert_eq!(rig.value(cx), "");

    rig.settle(cx, Err(String::new()));
    assert_eq!(rig.value(cx), "second", "failed, so it comes back");
    let error = rig.with(cx, |_, window, _| {
        window
            .find_by_label("Failed to send message. Please try again.")
            .role()
    });
    assert_eq!(error, Some(Role::Alert));
}

#[gpui_kit::test]
fn a_failure_does_not_overwrite_what_was_typed_since(cx: &mut TestAppContext) {
    let rig = rig(cx);
    rig.typed(cx, "first");
    rig.press(cx, "enter");
    rig.typed(cx, "newer");
    rig.settle(cx, Err("nope".into()));
    assert_eq!(rig.value(cx), "newer");
}

#[gpui_kit::test]
fn the_field_grows_with_its_text_up_to_the_cap(cx: &mut TestAppContext) {
    // A 400 px window caps the draft at 40%: 160 px, or six 23 px lines.
    let rig = rig_sized(cx, size(px(900.), px(400.)));
    let id = rig.field_id(cx);
    let height = |rig: &Rig, cx: &mut TestAppContext| {
        let id = id.clone();
        rig.with(cx, |_, window, _| window.find(id).bounds().size.height)
    };
    let one = height(&rig, cx);
    assert_eq!(one, px(23.));
    rig.typed(cx, "a");
    rig.press(cx, "shift-enter");
    rig.typed(cx, "b");
    assert_eq!(height(&rig, cx), px(46.));
    for _ in 0..20 {
        rig.press(cx, "shift-enter");
    }
    assert_eq!(height(&rig, cx), px(23. * 6.));
}

#[gpui_kit::test]
fn the_field_is_40_px_high_and_lines_up_with_the_buttons(cx: &mut TestAppContext) {
    let rig = rig(cx);
    let (field, send) = rig.with(cx, |_, window, _| {
        (
            window.find("composer-field").bounds(),
            window.find("composer-send").bounds(),
        )
    });
    assert_eq!(field.size.height, px(40.));
    assert_eq!(send.size, size(px(40.), px(40.)));
    assert_eq!(field.bottom(), send.bottom());
}

#[gpui_kit::test]
fn the_notice_takes_the_composers_height_so_the_chat_does_not_jump(cx: &mut TestAppContext) {
    let rig = rig(cx);
    // The paper's top: the field's, less its 16 px padding and 1 px border.
    let field = rig.with(cx, |_, window, _| {
        window.find("composer-field").bounds().top()
    });
    rig.availability(cx, Availability::NoPermission { channel_name: None });
    let notice = rig.with(cx, |_, window, _| {
        window.find("composer-unavailable").bounds().top()
    });
    assert_eq!(field - px(17.), notice);
}

#[gpui_kit::test]
fn each_conversation_keeps_its_draft(cx: &mut TestAppContext) {
    let rig = rig(cx);
    let switch = |rig: &Rig, cx: &mut TestAppContext, id: &str| {
        let conversation = channel(id);
        rig.with(cx, |composer, window, cx| {
            composer.update(cx, |composer, cx| {
                composer.set_conversation(conversation, window, cx)
            });
        });
    };
    rig.typed(cx, "for a");
    rig.with(cx, |composer, window, cx| {
        composer.update(cx, |composer, cx| {
            composer.add_attachments(vec![file("a.txt")], window, cx)
        });
    });
    switch(&rig, cx, "b");
    assert_eq!(rig.value(cx), "");
    assert!(rig.with(cx, |_, window, _| {
        window.try_find_by_label("remove a.txt").is_none()
    }));
    rig.typed(cx, "for b");
    switch(&rig, cx, "a");
    assert_eq!(rig.value(cx), "for a");
    assert!(rig.with(cx, |_, window, _| {
        window.try_find_by_label("remove a.txt").is_some()
    }));
    // The caret comes back too.
    assert_eq!(rig.field(cx).read_with(cx, |f, _| f.cursor()), 5);
    switch(&rig, cx, "b");
    assert_eq!(rig.value(cx), "for b");
}

#[gpui_kit::test]
fn switching_does_not_count_as_typing_or_reopen_a_finished_send(cx: &mut TestAppContext) {
    let rig = rig(cx);
    rig.typed(cx, "x");
    let typed = rig.log.borrow().typing;
    rig.with(cx, |composer, window, cx| {
        composer.update(cx, |composer, cx| {
            composer.set_conversation(channel("b"), window, cx)
        });
    });
    assert_eq!(rig.log.borrow().typing, typed);
}

#[gpui_kit::test]
fn a_draft_outlives_the_composer(cx: &mut TestAppContext) {
    let first = rig(cx);
    first.typed(cx, "still here");
    let drafts = first.drafts.clone();
    let second = open(cx, size(px(900.), px(800.)), drafts);
    assert_eq!(second.value(cx), "still here");
    second.press(cx, "enter");
    assert!(cx.update(|cx| second.drafts.read(cx).get(&channel("a")).is_none()));
}

#[gpui_kit::test]
fn the_dropdown_lists_users_aliases_and_special_mentions_for_at(cx: &mut TestAppContext) {
    let rig = rig(cx);
    assert!(!rig.menu_open(cx));
    rig.typed(cx, "hi @");
    let labels: Vec<_> = rig
        .options(cx)
        .into_iter()
        .map(|(label, _)| label)
        .collect();
    assert_eq!(labels, ["@here", "@night-crew", "@ava", "@ben"]);
    rig.typed(cx, "av");
    let labels: Vec<_> = rig
        .options(cx)
        .into_iter()
        .map(|(label, _)| label)
        .collect();
    assert_eq!(labels, ["@ava"]);
    rig.typed(cx, "x");
    assert!(!rig.menu_open(cx), "nothing matches, so it closes");
}

#[gpui_kit::test]
fn hash_lists_channels(cx: &mut TestAppContext) {
    let rig = rig(cx);
    rig.typed(cx, "see #");
    assert_eq!(rig.selected_option(cx).as_deref(), Some("#general"));
    rig.press(cx, "tab");
    assert_eq!(rig.value(cx), "see #general ");
    rig.press(cx, "enter");
    let mention = rig.last_draft().mentions[0].clone();
    assert_eq!(
        (mention.start, mention.end, mention.kind),
        (4, 12, MentionKind::Channel)
    );
}

#[gpui_kit::test]
fn arrow_keys_move_and_wrap_while_the_field_stays_put(cx: &mut TestAppContext) {
    let rig = rig(cx);
    rig.typed(cx, "@");
    assert_eq!(rig.selected_option(cx).as_deref(), Some("@here"));
    rig.press(cx, "down");
    assert_eq!(rig.selected_option(cx).as_deref(), Some("@night-crew"));
    rig.press(cx, "up");
    rig.press(cx, "up");
    assert_eq!(
        rig.selected_option(cx).as_deref(),
        Some("@ben"),
        "wraps to the end"
    );
    rig.press(cx, "down");
    assert_eq!(
        rig.selected_option(cx).as_deref(),
        Some("@here"),
        "wraps to the start"
    );
    assert_eq!(rig.value(cx), "@");
    let id = rig.field_id(cx);
    assert_eq!(
        rig.with(cx, |_, window, _| window.find(id).focused()),
        Some(true)
    );
}

#[gpui_kit::test]
fn enter_and_tab_pick_rather_than_send(cx: &mut TestAppContext) {
    let rig = rig(cx);
    rig.typed(cx, "hello @a");
    rig.press(cx, "down");
    rig.press(cx, "enter");
    assert_eq!(rig.sends(), 0);
    assert_eq!(rig.value(cx), "hello @ava ");
    assert!(!rig.menu_open(cx));
    assert_eq!(rig.field(cx).read_with(cx, |f, _| f.cursor()), 11);

    rig.typed(cx, "and @b");
    rig.press(cx, "tab");
    assert_eq!(rig.value(cx), "hello @ava and @ben ");

    rig.press(cx, "enter");
    let draft = rig.last_draft();
    assert_eq!(draft.text, "hello @ava and @ben");
    let got: Vec<_> = draft
        .mentions
        .iter()
        .map(|m| (m.start, m.end, m.id.as_str()))
        .collect();
    assert_eq!(got, [(6, 10, "u1"), (15, 19, "u2")]);
}

#[gpui_kit::test]
fn undo_takes_a_picked_mention_back(cx: &mut TestAppContext) {
    let rig = rig(cx);
    rig.typed(cx, "@b");
    rig.press(cx, "enter");
    assert_eq!(rig.value(cx), "@ben ");
    rig.press(cx, "ctrl-z");
    assert_eq!(rig.value(cx), "@b");
}

#[gpui_kit::test]
fn a_click_on_a_row_picks_it_and_the_field_keeps_focus(cx: &mut TestAppContext) {
    let rig = rig(cx);
    rig.typed(cx, "@");
    rig.click(cx, ("mention-option", 1usize));
    assert_eq!(rig.value(cx), "@night-crew ");
    let id = rig.field_id(cx);
    assert_eq!(
        rig.with(cx, |_, window, _| window.find(id).focused()),
        Some(true)
    );
}

#[gpui_kit::test]
fn the_highlight_scrolls_into_view(cx: &mut TestAppContext) {
    // 40% of this window fits about three rows of the four.
    let rig = rig_sized(cx, size(px(900.), px(700.)));
    rig.typed(cx, "@");
    let last_visible = |rig: &Rig, cx: &mut TestAppContext| {
        rig.with(cx, |_, window, _| {
            let list = window.find("mention-listbox").bounds();
            let row = window.find(("mention-option", 3usize)).bounds();
            row.bottom() <= list.bottom() && row.top() >= list.top()
        })
    };
    assert!(
        !last_visible(&rig, cx),
        "the fixture has to overflow for this to test anything"
    );
    rig.press(cx, "up");
    assert_eq!(rig.selected_option(cx).as_deref(), Some("@ben"));
    assert!(last_visible(&rig, cx));
}

#[gpui_kit::test]
fn escape_closes_it_until_the_text_changes(cx: &mut TestAppContext) {
    let rig = rig(cx);
    rig.typed(cx, "@a");
    assert!(rig.menu_open(cx));
    rig.press(cx, "escape");
    assert!(!rig.menu_open(cx));
    assert_eq!(rig.value(cx), "@a");
    rig.typed(cx, "v");
    assert!(rig.menu_open(cx));
}

#[gpui_kit::test]
fn moving_the_caret_out_of_the_mention_closes_it(cx: &mut TestAppContext) {
    let rig = rig(cx);
    rig.typed(cx, "x @a");
    assert!(rig.menu_open(cx));
    rig.press(cx, "home");
    assert!(!rig.menu_open(cx));
    rig.press(cx, "end");
    assert!(rig.menu_open(cx));
}

#[gpui_kit::test]
fn the_dropdown_sits_above_the_caret_and_follows_it(cx: &mut TestAppContext) {
    let rig = rig(cx);
    rig.typed(cx, "@");
    let at = |rig: &Rig, cx: &mut TestAppContext| {
        rig.with(cx, |_, window, _| window.find("mention-menu").bounds())
    };
    let first = at(&rig, cx);
    let caret = rig
        .field(cx)
        .read_with(cx, |f, _| f.cursor_layout().expect("laid out").0);
    assert!(first.bottom() <= caret.top(), "{first:?} above {caret:?}");
    assert!(first.left() <= caret.left() && caret.left() <= first.right());

    rig.press(cx, "escape");
    rig.typed(cx, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa @");
    let moved = at(&rig, cx);
    assert!(
        moved.left() > first.left(),
        "{moved:?} moved right of {first:?}"
    );

    rig.press(cx, "escape");
    rig.press(cx, "shift-enter");
    rig.typed(cx, "@");
    let lower = at(&rig, cx);
    assert!(lower.left() < moved.left(), "back to the new line's start");
}

#[gpui_kit::test]
fn on_a_narrow_window_it_takes_the_width_and_the_slim_layout_shows(cx: &mut TestAppContext) {
    let rig = rig_sized(cx, size(px(360.), px(700.)));
    assert!(rig.with(cx, |_, window, _| {
        window.try_find("composer-emoji").is_none()
    }));
    assert!(
        rig.with(cx, |_, window, _| window
            .try_find("composer-send")
            .is_none()),
        "no send until there's content"
    );
    rig.typed(cx, "@");
    let menu = rig.with(cx, |_, window, _| window.find("mention-menu").bounds());
    assert_eq!(menu.size.width, px(344.));
    assert_eq!(menu.left(), px(8.));
    let row = rig.with(cx, |_, window, _| {
        window.find(("mention-option", 0usize)).bounds()
    });
    assert_eq!(row.size.height, px(44.), "one line per row, as on a phone");
    assert!(rig.with(cx, |_, window, _| {
        window.try_find("composer-send").is_some()
    }));

    rig.click(cx, "composer-actions");
    rig.click(cx, "composer-emoji");
    assert_eq!(rig.log.borrow().emoji, 1);
    assert!(rig.with(cx, |_, window, _| {
        window.try_find("composer-actions-sheet").is_none()
    }));
}

#[gpui_kit::test]
fn ctrl_b_and_i_wrap_and_unwrap_the_selection(cx: &mut TestAppContext) {
    let rig = rig(cx);
    rig.typed(cx, "hello");
    rig.press(cx, "ctrl-a");
    rig.press(cx, "ctrl-b");
    assert_eq!(rig.value(cx), "**hello**");
    assert_eq!(rig.field(cx).read_with(cx, |f, _| f.selected_range()), 2..7);
    rig.press(cx, "ctrl-b");
    assert_eq!(rig.value(cx), "hello");
    rig.press(cx, "ctrl-i");
    assert_eq!(rig.value(cx), "_hello_");
    rig.press(cx, "ctrl-z");
    assert_eq!(rig.value(cx), "hello", "formatting is undoable");
}

#[gpui_kit::test]
fn ctrl_b_with_no_selection_puts_the_caret_between_the_markers(cx: &mut TestAppContext) {
    let rig = rig(cx);
    rig.typed(cx, "x ");
    rig.press(cx, "ctrl-b");
    rig.typed(cx, "y");
    assert_eq!(rig.value(cx), "x **y**");
}

#[gpui_kit::test]
fn the_emoji_button_asks_the_owner_and_the_answer_lands_at_the_caret(cx: &mut TestAppContext) {
    let rig = rig(cx);
    rig.typed(cx, "ab");
    rig.press(cx, "left");
    rig.click(cx, "composer-emoji");
    assert_eq!(rig.log.borrow().emoji, 1);
    let expanded = rig.with(cx, |_, window, _| {
        window.find_by_label("add emoji").expanded()
    });
    assert_eq!(expanded, Some(true));
    rig.with(cx, |composer, window, cx| {
        composer.update(cx, |composer, cx| {
            composer.set_emoji_picker_open(false, cx);
            composer.insert_at_caret("🙂", window, cx);
        });
    });
    assert_eq!(rig.value(cx), "a🙂b");
    let id = rig.field_id(cx);
    assert_eq!(
        rig.with(cx, |_, window, _| window.find(id).focused()),
        Some(true)
    );
}

#[gpui_kit::test]
fn attachments_list_remove_and_go_with_the_message(cx: &mut TestAppContext) {
    let rig = rig(cx);
    rig.click(cx, "composer-attach");
    assert_eq!(rig.log.borrow().files, 1);
    rig.with(cx, |composer, window, cx| {
        composer.update(cx, |composer, cx| {
            composer.add_attachments(vec![file("a.txt"), file("b.txt")], window, cx)
        });
    });
    let list = rig.with(cx, |_, window, _| {
        window.find_by_label("Attachments").role()
    });
    assert_eq!(list, Some(Role::List));
    let remove: ElementId = ElementId::NamedInteger("remove-attachment".into(), 0);
    rig.click(cx, remove);
    assert!(rig.with(cx, |_, window, _| {
        window.try_find_by_label("remove a.txt").is_none()
    }));
    assert!(rig.with(cx, |_, window, _| {
        window.try_find_by_label("remove b.txt").is_some()
    }));

    // Files alone are enough to send.
    rig.press(cx, "enter");
    assert_eq!(rig.log.borrow().sends[0].2, 1);
    assert!(rig.with(cx, |_, window, _| {
        window.try_find_by_label("Attachments").is_none()
    }));
}

#[gpui_kit::test]
fn attachment_limits_match_the_web(cx: &mut TestAppContext) {
    let rig = rig(cx);
    let add = |rig: &Rig, cx: &mut TestAppContext, files: Vec<PendingAttachment>| {
        rig.with(cx, |composer, window, cx| {
            composer.update(cx, |c, cx| c.add_attachments(files, window, cx))
        });
    };
    add(
        &rig,
        cx,
        (0..11).map(|i| file(&format!("{i}.txt"))).collect(),
    );
    assert!(rig.with(cx, |_, window, _| {
        window
            .try_find_by_label("Maximum 10 files per message")
            .is_some()
    }));
    assert!(
        rig.with(cx, |_, window, _| window
            .try_find_by_label("Attachments")
            .is_none()),
        "all or none"
    );

    let big = PendingAttachment {
        size_bytes: Some(11 * 1024 * 1024),
        ..file("big.bin")
    };
    add(&rig, cx, vec![big]);
    let copy = "File \"big.bin\" exceeds the 10 MB size limit";
    assert!(rig.with(cx, |_, window, _| window.try_find_by_label(copy).is_some()));
}

#[gpui_kit::test]
fn attaching_can_be_turned_off(cx: &mut TestAppContext) {
    let rig = rig(cx);
    rig.availability(
        cx,
        Availability::Open {
            can_attach: false,
            channel_name: Some("general".into()),
        },
    );
    let disabled = rig.with(cx, |_, window, _| {
        window.find_by_label("attach file").disabled()
    });
    assert_eq!(disabled, Some(true));
    rig.with(cx, |composer, window, cx| {
        composer.update(cx, |composer, cx| {
            composer.add_attachments(vec![file("a.txt")], window, cx)
        });
    });
    let copy = "Attaching files is turned off in #general";
    assert!(rig.with(cx, |_, window, _| window.try_find_by_label(copy).is_some()));
    assert!(rig.with(cx, |_, window, _| {
        window.try_find_by_label("remove a.txt").is_none()
    }));
}

#[gpui_kit::test]
fn pasting_text_inserts_it(cx: &mut TestAppContext) {
    let rig = rig(cx);
    cx.update(|cx| cx.write_to_clipboard(ClipboardItem::new_string("line one\nline two".into())));
    rig.press(cx, "ctrl-v");
    assert_eq!(rig.value(cx), "line one\nline two", "keeps its newlines");
}

#[gpui_kit::test]
fn pasting_an_image_adds_it_and_inserts_nothing(cx: &mut TestAppContext) {
    let rig = rig(cx);
    rig.typed(cx, "look");
    let image = Image::from_bytes(ImageFormat::Png, vec![1, 2, 3]);
    cx.update(|cx| {
        cx.write_to_clipboard(ClipboardItem {
            entries: vec![ClipboardEntry::Image(image)],
        })
    });
    rig.press(cx, "ctrl-v");
    assert_eq!(rig.value(cx), "look");
    assert!(rig.with(cx, |_, window, _| {
        window.try_find_by_label("remove image.png").is_some()
    }));
}

#[gpui_kit::test]
fn a_reply_shows_goes_with_the_message_and_escape_cancels_it(cx: &mut TestAppContext) {
    let rig = rig(cx);
    let set_reply = |rig: &Rig, cx: &mut TestAppContext| {
        rig.with(cx, |composer, window, cx| {
            composer.update(cx, |composer, cx| {
                composer.set_reply(
                    Some(ReplyTarget {
                        message_id: "m1".into(),
                        author_name: "Priya".into(),
                        snippet: "two\nlines".into(),
                    }),
                    window,
                    cx,
                )
            });
        });
    };
    set_reply(&rig, cx);
    assert!(rig.with(cx, |_, window, _| {
        window.try_find_by_label("Replying to Priya").is_some()
    }));

    rig.press(cx, "escape");
    assert!(rig.with(cx, |_, window, _| {
        window.try_find_by_label("Replying to Priya").is_none()
    }));

    set_reply(&rig, cx);
    rig.click(cx, "cancel-reply");
    assert!(rig.with(cx, |_, window, _| {
        window.try_find_by_label("Replying to Priya").is_none()
    }));

    set_reply(&rig, cx);
    rig.typed(cx, "answer");
    rig.press(cx, "enter");
    assert_eq!(rig.last_draft().reply_to_message_id.as_deref(), Some("m1"));
    assert!(rig.with(cx, |_, window, _| {
        window.try_find_by_label("Replying to Priya").is_none()
    }));
}

#[gpui_kit::test]
fn escape_closes_the_dropdown_before_it_cancels_a_reply(cx: &mut TestAppContext) {
    let rig = rig(cx);
    rig.with(cx, |composer, window, cx| {
        composer.update(cx, |composer, cx| {
            composer.set_reply(
                Some(ReplyTarget {
                    message_id: "m1".into(),
                    author_name: "Priya".into(),
                    snippet: "s".into(),
                }),
                window,
                cx,
            )
        });
    });
    rig.typed(cx, "@");
    rig.press(cx, "escape");
    assert!(!rig.menu_open(cx));
    assert!(rig.with(cx, |_, window, _| {
        window.try_find_by_label("Replying to Priya").is_some()
    }));
}

#[gpui_kit::test]
fn up_in_an_empty_composer_asks_to_edit_the_last_message(cx: &mut TestAppContext) {
    let rig = rig(cx);
    rig.press(cx, "up");
    assert_eq!(rig.log.borrow().edit_last, 1);
    rig.typed(cx, "x");
    rig.press(cx, "up");
    assert_eq!(rig.log.borrow().edit_last, 1);
}

#[gpui_kit::test]
fn slow_mode_holds_the_send_but_not_the_typing(cx: &mut TestAppContext) {
    let rig = rig(cx);
    rig.with(cx, |composer, _, cx| {
        composer.update(cx, |c, cx| c.set_slowmode(Some(30), cx))
    });
    rig.typed(cx, "one");
    rig.press(cx, "enter");
    rig.settle(cx, Ok(()));
    assert_eq!(rig.sends(), 1);

    let status = |rig: &Rig, cx: &mut TestAppContext| {
        rig.with(cx, |_, window, _| {
            window
                .try_find("composer-slowmode")
                .map(|status| status.label().unwrap_or_default().to_owned())
        })
    };
    assert_eq!(
        status(&rig, cx).as_deref(),
        Some("Slow mode: you can send again in 30 s")
    );

    rig.typed(cx, "two");
    assert_eq!(rig.value(cx), "two");
    rig.press(cx, "enter");
    assert_eq!(rig.sends(), 1, "held");
    assert_eq!(rig.value(cx), "two", "and not lost");
    assert_eq!(
        rig.with(cx, |_, window, _| window.find_by_label("send").disabled()),
        Some(true)
    );

    cx.executor().advance_clock(Duration::from_secs(12));
    cx.run_until_parked();
    assert_eq!(
        status(&rig, cx).as_deref(),
        Some("Slow mode: you can send again in 18 s")
    );

    cx.executor().advance_clock(Duration::from_secs(19));
    cx.run_until_parked();
    assert_eq!(status(&rig, cx), None);
    rig.press(cx, "enter");
    assert_eq!(rig.sends(), 2);
}

#[gpui_kit::test]
fn a_denied_user_gets_a_notice_and_no_field(cx: &mut TestAppContext) {
    let rig = rig(cx);
    rig.typed(cx, "kept");
    let id = rig.field_id(cx);
    let cases = [
        (
            Availability::NoPermission {
                channel_name: Some("general".into()),
            },
            "You can't send messages in #general",
        ),
        (
            Availability::NoPermission { channel_name: None },
            "You can't send messages in this channel",
        ),
        (
            Availability::ReadOnly {
                channel_name: Some("news".into()),
                posting_roles: vec!["Moderator".into(), "Admin".into()],
            },
            "#news is read-only. Only Moderator and Admin can post.",
        ),
        (
            Availability::ReadOnly {
                channel_name: None,
                posting_roles: vec![],
            },
            "This channel is read-only.",
        ),
        (
            Availability::Banned { reason: None },
            "You're banned from this community",
        ),
        (
            Availability::TimedOut {
                until: None,
                reason: Some("spam".into()),
            },
            "You're timed out in this community. Reason: spam",
        ),
    ];
    for (availability, copy) in cases {
        rig.availability(cx, availability);
        let (role, label, field) = rig.with(cx, |_, window, _| {
            let notice = window.find("composer-unavailable");
            (
                notice.role(),
                notice.label().map(str::to_owned),
                window.try_find(id.clone()),
            )
        });
        assert_eq!(role, Some(Role::Status));
        assert_eq!(label.as_deref(), Some(copy));
        assert!(field.is_none(), "{copy}");
    }
    rig.press(cx, "enter");
    assert_eq!(rig.sends(), 0);

    rig.availability(cx, Availability::default());
    assert_eq!(rig.value(cx), "kept", "the draft waits");
    assert_eq!(
        rig.with(cx, |_, window, _| window.find(id).focused()),
        Some(true)
    );
}

#[gpui_kit::test]
fn a_timeout_counts_down_and_opens_by_itself(cx: &mut TestAppContext) {
    let rig = rig(cx);
    let until = cx.update(|cx| cx.background_executor().now()) + Duration::from_secs(90);
    rig.availability(
        cx,
        Availability::TimedOut {
            until: Some(until),
            reason: None,
        },
    );
    let label = |rig: &Rig, cx: &mut TestAppContext| {
        rig.with(cx, |_, window, _| {
            window
                .try_find("composer-unavailable")
                .map(|n| n.label().unwrap_or_default().to_owned())
        })
    };
    assert_eq!(label(&rig, cx).as_deref(), Some("Timed out, 2 min left"));
    cx.executor().advance_clock(Duration::from_secs(50));
    cx.run_until_parked();
    assert_eq!(label(&rig, cx).as_deref(), Some("Timed out, 40 s left"));
    cx.executor().advance_clock(Duration::from_secs(41));
    cx.run_until_parked();
    assert_eq!(label(&rig, cx), None);
    assert_eq!(rig.log.borrow().timeout_ended, 1);
    rig.typed(cx, "back");
    rig.press(cx, "enter");
    assert_eq!(rig.sends(), 1);
}

#[gpui_kit::test]
fn composition_shows_a_preedit_and_commits(cx: &mut TestAppContext) {
    let rig = rig(cx);
    rig.typed(cx, "abc");

    let marked = rig.ime(cx, |input, cx| {
        input.compose_text(None, "にほん", Some(3..3), cx);
        input.marked_text_range(cx)
    });
    assert_eq!(marked, Some(3..6), "UTF-16 range of the preedit");
    assert_eq!(rig.value(cx), "abcにほん", "the preedit shows in the field");

    let marked = rig.ime(cx, |input, cx| {
        input.compose_text(None, "日本", Some(2..2), cx);
        input.marked_text_range(cx)
    });
    assert_eq!(marked, Some(3..5));
    assert_eq!(
        rig.value(cx),
        "abc日本",
        "the next preedit replaces the last"
    );

    let marked = rig.ime(cx, |input, cx| {
        input.commit_text("日本語", cx);
        input.marked_text_range(cx)
    });
    assert_eq!(marked, None);
    assert_eq!(rig.value(cx), "abc日本語");

    rig.press(cx, "enter");
    assert_eq!(rig.last_draft().text, "abc日本語");
}

#[gpui_kit::test]
fn cancelling_a_composition_leaves_the_text_as_it_was(cx: &mut TestAppContext) {
    let rig = rig(cx);
    rig.typed(cx, "abc");
    rig.ime(cx, |input, cx| {
        input.compose_text(None, "に", Some(1..1), cx);
        input.compose_text(None, "", None, cx);
    });
    assert_eq!(rig.value(cx), "abc");
    rig.press(cx, "enter");
    assert_eq!(rig.last_draft().text, "abc");
}

#[gpui_kit::test]
fn candidates_are_placed_at_the_caret(cx: &mut TestAppContext) {
    let rig = rig(cx);
    rig.typed(cx, "hello ");
    let field = rig.field(cx);
    let id = rig.field_id(cx);
    let (caret, candidate_at) = rig.with(cx, |_, window, cx| {
        let bounds = window.find(id).bounds();
        let mut handler = ElementInputHandler::new(bounds, field.clone());
        use gpui_kit::InputHandler as _;
        handler.replace_and_mark_text_in_range(None, "に", Some(1..1), window, cx);
        window.render_frame(cx);
        let caret = field.read(cx).cursor_layout().expect("laid out").0;
        (
            caret,
            handler
                .bounds_for_range(6..7, window, cx)
                .expect("IME bounds"),
        )
    });
    assert!(
        candidate_at.left() < caret.right() + px(1.),
        "{candidate_at:?} at {caret:?}"
    );
    assert!(
        (candidate_at.top() - caret.top()).abs() < px(8.),
        "{candidate_at:?} at {caret:?}"
    );
}

#[gpui_kit::test]
fn enter_during_composition_does_not_send(cx: &mut TestAppContext) {
    let rig = rig(cx);
    rig.typed(cx, "abc");
    rig.ime(cx, |input, cx| {
        input.compose_text(None, "に", Some(1..1), cx)
    });
    rig.press(cx, "enter");
    assert_eq!(
        rig.sends(),
        0,
        "an IME that lets Enter through is confirming"
    );
    assert_eq!(rig.value(cx), "abcに");
}

#[gpui_kit::test]
fn a_latin_preedit_does_not_open_the_dropdown(cx: &mut TestAppContext) {
    let rig = rig(cx);
    rig.typed(cx, "@");
    assert!(rig.menu_open(cx));
    // Pinyin: an input method composing latin letters, which would otherwise match `\w`.
    rig.ime(cx, |input, cx| {
        input.compose_text(None, "ben", Some(3..3), cx)
    });
    assert!(!rig.menu_open(cx), "open only over committed text");
    rig.ime(cx, |input, cx| input.commit_text("ben", cx));
    assert!(rig.menu_open(cx));
    assert_eq!(rig.selected_option(cx).as_deref(), Some("@ben"));
}

#[gpui_kit::test]
fn the_field_is_named_and_reports_its_value(cx: &mut TestAppContext) {
    let rig = rig(cx);
    rig.typed(cx, "hi");
    let id = rig.field_id(cx);
    let (role, label, value, placeholder, focused) = rig.with(cx, |_, window, _| {
        let field = window.find(id);
        (
            field.role(),
            field.label().map(str::to_owned),
            field.value().map(str::to_owned),
            field.placeholder().map(str::to_owned),
            field.focused(),
        )
    });
    assert_eq!(role, Some(Role::MultilineTextInput));
    assert_eq!(label.as_deref(), Some("Message"));
    assert_eq!(value.as_deref(), Some("hi"));
    assert_eq!(placeholder.as_deref(), Some("Type a message..."));
    assert_eq!(focused, Some(true));
}

#[gpui_kit::test]
fn every_control_is_named_with_the_webs_label(cx: &mut TestAppContext) {
    let rig = rig(cx);
    for label in ["add emoji", "attach file", "send"] {
        let role = rig.with(cx, |_, window, _| window.find_by_label(label).role());
        assert_eq!(role, Some(Role::Button), "{label}");
    }
    rig.typed(cx, "@");
    let listbox = rig.with(cx, |_, window, _| {
        window.find_by_label("Mention suggestions").role()
    });
    assert_eq!(listbox, Some(Role::ListBox));
    assert_eq!(rig.options(cx).len(), 4);
}

// Offsets: the field, `rules` and `DraftMention` all count bytes, and the input protocol counts
// UTF-16 units, so these use text where the three differ: CJK is 3 bytes and 1 unit, an emoji 4 and 2.

#[gpui_kit::test]
fn a_mention_after_non_ascii_text_lands_and_its_range_slices_cleanly(cx: &mut TestAppContext) {
    let rig = rig(cx);
    rig.typed(cx, "日本🙂 @b");
    assert_eq!(rig.selected_option(cx).as_deref(), Some("@ben"));
    rig.press(cx, "enter");
    assert_eq!(rig.value(cx), "日本🙂 @ben ");
    let caret = rig.field(cx).read_with(cx, |f, _| f.cursor());
    assert_eq!(caret, "日本🙂 @ben ".len());

    rig.typed(cx, "語");
    rig.press(cx, "enter");
    let draft = rig.last_draft();
    assert_eq!(draft.text, "日本🙂 @ben 語");
    let mention = &draft.mentions[0];
    assert_eq!(
        &draft.text[mention.start as usize..mention.end as usize],
        "@ben"
    );
}

#[gpui_kit::test]
fn a_mention_with_non_ascii_text_on_both_sides_replaces_only_the_query(cx: &mut TestAppContext) {
    let rig = rig(cx);
    rig.typed(cx, "日本 @b");
    rig.typed(cx, " 語🙂");
    for _ in 0..3 {
        rig.press(cx, "left");
    }
    assert!(rig.menu_open(cx), "the caret is back at the end of @b");
    rig.press(cx, "tab");
    assert_eq!(rig.value(cx), "日本 @ben  語🙂");
    assert_eq!(
        rig.field(cx).read_with(cx, |f, _| f.cursor()),
        "日本 @ben ".len()
    );
}

#[gpui_kit::test]
fn formatting_keeps_a_non_ascii_selection_whole(cx: &mut TestAppContext) {
    let rig = rig(cx);
    rig.typed(cx, "日本🙂");
    rig.press(cx, "ctrl-a");
    rig.press(cx, "ctrl-b");
    assert_eq!(rig.value(cx), "**日本🙂**");
    let selection = rig.field(cx).read_with(cx, |f, _| f.selected_range());
    assert_eq!(selection, 2..2 + "日本🙂".len());
    assert_eq!(
        rig.field(cx)
            .read_with(cx, |f, _| f.selected_value().to_string()),
        "日本🙂"
    );
    rig.press(cx, "ctrl-b");
    assert_eq!(rig.value(cx), "日本🙂");
}

#[gpui_kit::test]
fn a_draft_restores_its_caret_inside_non_ascii_text(cx: &mut TestAppContext) {
    let rig = rig(cx);
    rig.typed(cx, "日本🙂語");
    rig.press(cx, "left");
    let switch = |rig: &Rig, cx: &mut TestAppContext, id: &str| {
        let conversation = channel(id);
        rig.with(cx, |composer, window, cx| {
            composer.update(cx, |composer, cx| {
                composer.set_conversation(conversation, window, cx)
            });
        });
    };
    switch(&rig, cx, "b");
    switch(&rig, cx, "a");
    assert_eq!(
        rig.field(cx).read_with(cx, |f, _| f.cursor()),
        "日本🙂".len()
    );
    rig.typed(cx, "x");
    assert_eq!(rig.value(cx), "日本🙂x語");
}

#[gpui_kit::test]
fn composition_after_an_emoji_counts_utf16_and_the_field_counts_bytes(cx: &mut TestAppContext) {
    let rig = rig(cx);
    rig.typed(cx, "日🙂");
    let marked = rig.ime(cx, |input, cx| {
        input.compose_text(None, "に", Some(1..1), cx);
        input.marked_text_range(cx)
    });
    // 日 is one unit and 🙂 two, so the preedit starts at 3 in UTF-16, and at 7 in bytes.
    assert_eq!(marked, Some(3..4));
    rig.ime(cx, |input, cx| input.commit_text("語", cx));
    assert_eq!(rig.value(cx), "日🙂語");
    assert_eq!(
        rig.field(cx).read_with(cx, |f, _| f.cursor()),
        "日🙂語".len()
    );

    // A mention straight after committed composition still opens: `@` starts its own token.
    rig.typed(cx, " @b");
    assert!(rig.menu_open(cx));
    rig.press(cx, "enter");
    assert_eq!(rig.value(cx), "日🙂語 @ben ");
}

#[gpui_kit::test]
fn a_leading_space_is_trimmed_before_ranges_are_taken(cx: &mut TestAppContext) {
    let rig = rig(cx);
    rig.typed(cx, "  日本 @ben");
    rig.press(cx, "escape");
    rig.press(cx, "enter");
    let draft = rig.last_draft();
    assert_eq!(draft.text, "日本 @ben");
    let mention = &draft.mentions[0];
    assert_eq!(
        &draft.text[mention.start as usize..mention.end as usize],
        "@ben"
    );
}

// ---- Edit and thread modes (W1). ----

fn edit_mode() -> ComposerMode {
    ComposerMode::Edit {
        message_id: "m-1".into(),
    }
}

fn attachment(id: &str, name: &str) -> semaphore_core::model::AttachmentView {
    semaphore_core::model::AttachmentView {
        file_id: id.into(),
        filename: name.into(),
        mime_type: "application/octet-stream".into(),
        size_bytes: 1,
        kind: semaphore_core::model::AttachmentKind::Other,
        has_thumbnail: false,
        width: None,
        height: None,
    }
}

fn start_edit(
    rig: &Rig,
    cx: &mut TestAppContext,
    draft: MessageDraft,
    files: Vec<semaphore_core::model::AttachmentView>,
) {
    rig.with(cx, |composer, window, cx| {
        composer.update(cx, |composer, cx| {
            composer.set_edit_content(draft, files, window, cx)
        })
    });
}

#[gpui_kit::test]
fn edit_mode_saves_on_enter_keeping_mentions(cx: &mut TestAppContext) {
    let rig = rig_mode(cx, edit_mode());
    let draft = MessageDraft {
        text: "hi @ava".into(),
        mentions: vec![semaphore_core::model::DraftMention {
            start: 3,
            end: 7,
            kind: MentionKind::User,
            id: "u1".into(),
        }],
        ..MessageDraft::default()
    };
    start_edit(&rig, cx, draft, Vec::new());
    assert_eq!(rig.value(cx), "hi @ava");
    rig.typed(cx, " again");
    rig.press(cx, "enter");
    let log = rig.log.borrow();
    assert!(log.sends.is_empty(), "an edit never sends a new message");
    let (id, draft, keep) = &log.edits[0];
    assert_eq!(id, "m-1");
    assert_eq!(draft.text, "hi @ava again");
    assert_eq!(draft.mentions.len(), 1);
    assert_eq!(draft.mentions[0].id, "u1");
    assert_eq!(
        *keep, None,
        "untouched attachments stay as the server has them"
    );
}

#[gpui_kit::test]
fn edit_mode_escape_cancels_and_keeps_no_draft(cx: &mut TestAppContext) {
    let rig = rig_mode(cx, edit_mode());
    start_edit(
        &rig,
        cx,
        MessageDraft {
            text: "old".into(),
            ..MessageDraft::default()
        },
        Vec::new(),
    );
    rig.typed(cx, " new");
    rig.press(cx, "escape");
    assert_eq!(rig.log.borrow().cancels, vec!["m-1".to_owned()]);
    assert!(rig.log.borrow().edits.is_empty());
    let saved = cx.update(|cx| rig.drafts.read(cx).get(&channel("a")).is_some());
    assert!(!saved, "the edit's text isn't the conversation's draft");
}

#[gpui_kit::test]
fn edit_mode_removing_an_attachment_lists_the_rest(cx: &mut TestAppContext) {
    let rig = rig_mode(cx, edit_mode());
    start_edit(
        &rig,
        cx,
        MessageDraft {
            text: "files".into(),
            ..MessageDraft::default()
        },
        vec![attachment("f1", "a.png"), attachment("f2", "b.pdf")],
    );
    rig.click(
        cx,
        ElementId::NamedInteger("edit-remove-attachment".into(), 0),
    );
    rig.click(cx, "edit-save");
    let log = rig.log.borrow();
    assert_eq!(log.edits[0].2, Some(vec!["f2".to_owned()]));
}

#[gpui_kit::test]
fn edit_mode_wont_save_an_empty_message(cx: &mut TestAppContext) {
    let rig = rig_mode(cx, edit_mode());
    start_edit(
        &rig,
        cx,
        MessageDraft {
            text: "x".into(),
            ..MessageDraft::default()
        },
        Vec::new(),
    );
    rig.press(cx, "backspace");
    rig.press(cx, "enter");
    assert!(rig.log.borrow().edits.is_empty());
}

#[gpui_kit::test]
fn thread_mode_has_no_attach_or_edit_last(cx: &mut TestAppContext) {
    let rig = rig_mode(cx, ComposerMode::Thread);
    let has_attach = rig.with(cx, |_, window, _| {
        window.try_find("composer-attach").is_some()
    });
    assert!(!has_attach);
    rig.press(cx, "up");
    assert_eq!(rig.log.borrow().edit_last, 0);
    rig.typed(cx, "a reply");
    rig.press(cx, "enter");
    assert_eq!(rig.log.borrow().sends.len(), 1);
}
