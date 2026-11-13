//! W1-ui-panels: the thread pane, from `ThreadPanel.tsx`. A header (title, reply count, the
//! subscribe toggle, close), the parent message, the replies and the thread composer. The owner
//! builds the three inner views: the parent and the replies are each a `MessageList` (the parent's
//! holds one row), the composer a `Composer` in thread mode. It goes in `Shell::set_side_panel`.
//!
//! A list fills whatever height it is given and can't size itself to one row, so the parent gets a
//! fixed slot (`PARENT_SLOT`, changed with `set_parent_height`) and scrolls inside it when longer.
//! The web's phone layout scrolls the parent with the replies; two separate lists can't, so a
//! phone keeps the slot, a little shorter, with a back arrow in place of the close button.
//!
//! While core reads the thread (`ThreadInfo::state` loading) the parent and replies show
//! skeletons; when it failed, an error with "Try again" (`Retry`). A ready thread with no replies
//! shows the web's "No replies yet" in place of the replies list. The count comes from the server,
//! so a first reply still on its way has a count of 0: the owner says how many rows the replies list
//! holds (`set_reply_rows`), and any row there shows the list instead.

#[cfg(feature = "stories")]
mod stories;
#[cfg(test)]
mod tests;

use crate::kit::{Skeleton, Variant, spacing, text};
use crate::panel::PanelClock;
use crate::panel::common::{
    design_icon, empty_block, error_block, icon_button, is_phone, relative_time,
};
use crate::theme::SemTheme;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{LoadState, ThreadInfo};
use semaphore_design::Icon as DesignIcon;

/// The parent's slot on a desktop: an avatar row and three lines of text.
pub const PARENT_SLOT: f32 = 132.;
/// The slot on a phone, where the replies need the room.
const PARENT_SLOT_PHONE: f32 = 112.;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ThreadPaneEvent {
    /// The subscribe toggle: `Core::set_thread_subscribed`.
    SetSubscribed(bool),
    /// The parent failed to load (`ThreadInfo::state` failed) and the user asked again.
    Retry,
    Close,
}

pub struct ThreadPane {
    parent: AnyView,
    replies: AnyView,
    composer: AnyView,
    info: ThreadInfo,
    /// The rows in the replies list, pending ones included.
    reply_rows: usize,
    parent_height: Option<f32>,
    clock: PanelClock,
}

impl ThreadPane {
    pub fn new(
        parent: AnyView,
        replies: AnyView,
        composer: AnyView,
        _cx: &mut Context<Self>,
    ) -> Self {
        Self {
            parent,
            replies,
            composer,
            info: ThreadInfo::default(),
            reply_rows: 0,
            parent_height: None,
            clock: PanelClock::default(),
        }
    }

    /// `Core::thread_info`, read again on `ViewChanged { Thread }`.
    pub fn set_info(&mut self, info: ThreadInfo, cx: &mut Context<Self>) {
        self.info = info;
        cx.notify();
    }

    /// How many rows the replies list holds, sent or pending. With none and a count of 0 the pane
    /// says "No replies yet".
    pub fn set_reply_rows(&mut self, rows: usize, cx: &mut Context<Self>) {
        if self.reply_rows != rows {
            self.reply_rows = rows;
            cx.notify();
        }
    }

    /// The parent's slot, in pixels, in place of `PARENT_SLOT` (and the phone's shorter one).
    pub fn set_parent_height(&mut self, height: Option<f32>, cx: &mut Context<Self>) {
        self.parent_height = height;
        cx.notify();
    }

    /// What "last reply 5 minutes ago" is measured from. The real clock unless a story fixes it.
    pub fn set_clock(&mut self, clock: PanelClock, cx: &mut Context<Self>) {
        self.clock = clock;
        cx.notify();
    }

    fn summary(&self) -> Option<String> {
        summary(&self.info, self.clock.now_ms())
    }

    /// Escape that nothing inside the pane took first: the replies list clears its own menu,
    /// staged delete or selection, and the composer its dropdown, edit or reply, all before this.
    /// With nothing of theirs to do, the key closes the thread, as its close button does.
    fn on_key_down(&mut self, event: &KeyDownEvent, _: &mut Window, cx: &mut Context<Self>) {
        if event.keystroke.key == "escape" {
            cx.emit(ThreadPaneEvent::Close);
            cx.stop_propagation();
        }
    }

    fn header(&self, touch: bool, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let sem = cx.sem();
        let subscribed = self.info.subscribed;
        let (primary, secondary, paper, divider, accent) = (
            sem.text_primary,
            sem.text_secondary,
            sem.paper,
            sem.divider,
            sem.primary,
        );
        let ready = self.info.state == LoadState::Ready;
        let label = if subscribed {
            "Turn off notifications"
        } else {
            "Get notified about replies"
        };
        let bell = ready.then(|| {
            icon_button(
                "thread-subscribe",
                if subscribed {
                    DesignIcon::Notifications
                } else {
                    DesignIcon::NotificationsOff
                },
                label,
                touch,
                if subscribed { accent } else { secondary },
                cx,
            )
            .selected(subscribed)
            .on_click(cx.listener(move |_, _, _, cx| {
                cx.emit(ThreadPaneEvent::SetSubscribed(!subscribed));
            }))
        });
        let close = icon_button(
            "thread-close",
            if touch {
                DesignIcon::ArrowBack
            } else {
                DesignIcon::Close
            },
            if touch { "Back" } else { "Close thread" },
            touch,
            secondary,
            cx,
        )
        .on_click(cx.listener(|_, _, _, cx| cx.emit(ThreadPaneEvent::Close)));
        let title = div()
            .flex()
            .flex_col()
            .min_w_0()
            .flex_1()
            .child(
                text(Variant::H6, "Thread")
                    .text_color(primary)
                    .when(touch, |title| title.font_weight(FontWeight(600.))),
            )
            .children(self.summary().map(|summary| {
                text(Variant::Caption, summary)
                    .text_color(secondary)
                    .truncate()
            }));
        let row = div()
            .id("thread-header")
            .flex_shrink_0()
            .flex()
            .items_center()
            .gap(spacing(1.))
            .min_h(px(if touch { 56. } else { 64. }))
            .border_b_1()
            .border_color(divider)
            .bg(paper);
        if touch {
            // The phone's app bar: back, the title, then the bell.
            row.px(px(4.)).child(close).child(title).children(bell)
        } else {
            row.px(spacing(2.))
                .py(spacing(1.))
                .child(design_icon(DesignIcon::ChatBubbleOutline, 24., accent))
                .child(title)
                .child(
                    div()
                        .flex()
                        .flex_shrink_0()
                        .items_center()
                        .gap(px(4.))
                        .children(bell)
                        .child(close),
                )
        }
    }

    fn parent_slot(&self, touch: bool, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let sem = cx.sem();
        let height = self.parent_height.unwrap_or(if touch {
            PARENT_SLOT_PHONE
        } else {
            PARENT_SLOT
        });
        let tint = sem.primary.opacity(0.04);
        let content = match self.info.state {
            LoadState::Loading => div()
                .id("thread-parent-loading")
                .test_support()
                .role(Role::ProgressIndicator)
                .aria_label("Loading the original message")
                .px(spacing(2.))
                .flex()
                .flex_col()
                .gap(px(8.))
                .child(Skeleton::rect("thread-parent-name", relative(0.4), 14.))
                .child(Skeleton::rect("thread-parent-line", relative(0.9), 14.))
                .child(Skeleton::rect("thread-parent-line-2", relative(0.7), 14.))
                .into_any_element(),
            _ => div()
                .h(px(height))
                .overflow_hidden()
                .child(self.parent.clone())
                .into_any_element(),
        };
        div()
            .id("thread-original-message")
            .test_support()
            .role(Role::Group)
            .aria_label("Original message")
            .flex_shrink_0()
            .pt(spacing(1.5))
            .bg(tint)
            .border_b_1()
            .border_color(sem.divider)
            .child(
                text(Variant::Caption, "Original message")
                    .px(spacing(2.))
                    .mb(px(4.))
                    .text_color(sem.text_secondary),
            )
            .child(content)
    }

    fn body(&self, touch: bool, cx: &mut Context<Self>) -> AnyElement {
        match &self.info.state {
            LoadState::Failed { error } => {
                // Core reads a deleted parent as `NOT_FOUND`: nothing to try again.
                let missing = error.code == "NOT_FOUND";
                if missing {
                    empty_block(
                        DesignIcon::ErrorOutline,
                        "This thread is no longer available.",
                        "The original message was deleted.",
                        cx,
                    )
                    .id("thread-missing")
                    .test_support()
                    .role(Role::Status)
                    .into_any_element()
                } else {
                    error_block(
                        "thread-retry",
                        "Couldn't load this thread",
                        "Check your connection and try again.",
                        cx.listener(|_, _, _, cx| cx.emit(ThreadPaneEvent::Retry)),
                        cx,
                    )
                    .into_any_element()
                }
            }
            LoadState::Loading => div()
                .id("thread-replies-loading")
                .test_support()
                .role(Role::ProgressIndicator)
                .aria_label("Loading replies")
                .p(spacing(2.))
                .flex()
                .flex_col()
                .gap(spacing(2.))
                .children((0..3usize).map(|index| {
                    Skeleton::rect(("thread-reply-loading", index), relative(1.), 60.)
                }))
                .into_any_element(),
            LoadState::Ready if self.info.reply_count == 0 && self.reply_rows == 0 => div()
                .id("thread-no-replies")
                .test_support()
                .size_full()
                .flex()
                .flex_col()
                .justify_center()
                .child(empty_block(
                    DesignIcon::ChatBubbleOutline,
                    "No replies yet",
                    "Be the first to reply to this message",
                    cx,
                ))
                .into_any_element(),
            LoadState::Ready => div()
                .size_full()
                .when(!touch, |list| list.pt(spacing(0.5)))
                .child(self.replies.clone())
                .into_any_element(),
        }
    }
}

/// The header's second line: the reply count, and when the last one came.
fn summary(info: &ThreadInfo, now_ms: i64) -> Option<String> {
    if info.state != LoadState::Ready {
        return None;
    }
    let count = match info.reply_count {
        0 => return None,
        1 => "1 reply".to_owned(),
        n => format!("{n} replies"),
    };
    Some(match info.last_reply_at_ms {
        Some(at) => format!("{count} · last {}", relative_time(now_ms, at)),
        None => count,
    })
}

impl EventEmitter<ThreadPaneEvent> for ThreadPane {}

impl Render for ThreadPane {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let touch = is_phone(window);
        let sem = cx.sem();
        let (canvas, paper) = (sem.background_default, sem.paper);
        let missing_parent = matches!(self.info.state, LoadState::Failed { .. });
        let header = self.header(touch, cx);
        let parent = (!missing_parent).then(|| self.parent_slot(touch, cx));
        let body = self.body(touch, cx);
        let ready = self.info.state == LoadState::Ready;
        div()
            .id("thread-pane")
            .test_support()
            .role(Role::Complementary)
            .aria_label("Thread")
            .size_full()
            .flex()
            .flex_col()
            .overflow_hidden()
            .bg(canvas)
            .on_key_down(cx.listener(Self::on_key_down))
            .child(header)
            .children(parent)
            .child(div().id("thread-scroll").flex_1().min_h_0().child(body))
            .when(ready, |pane| {
                pane.child(
                    div()
                        .id("thread-composer")
                        .test_support()
                        .flex_shrink_0()
                        .when(touch, |slot| slot.bg(paper))
                        .child(self.composer.clone()),
                )
            })
    }
}

#[cfg(feature = "stories")]
pub fn stories() -> Vec<crate::stories::Story> {
    stories::stories()
}
