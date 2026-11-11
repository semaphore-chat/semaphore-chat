//! W1-ui-panels: the thread pane, from `ThreadPanel.tsx`. A header (title, reply count, the
//! subscribe toggle, close), the parent message, the replies and the thread composer. The owner
//! builds the three inner views: the parent and the replies are each a `MessageList` (the parent's
//! holds one row), the composer a `Composer` in thread mode. It goes in `Shell::set_side_panel`.
//!
//! P0 stub: the types and signatures are fixed; the second agent fills in the view.

use gpui_kit::*;
use semaphore_core::model::ThreadInfo;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ThreadPaneEvent {
    /// The subscribe toggle: `Core::set_thread_subscribed`.
    SetSubscribed(bool),
    /// The parent failed to load (`ThreadInfo::state` failed) and the user asked again.
    Retry,
    Close,
}

pub struct ThreadPane {
    #[allow(dead_code)]
    parent: AnyView,
    #[allow(dead_code)]
    replies: AnyView,
    #[allow(dead_code)]
    composer: AnyView,
    #[allow(dead_code)]
    info: ThreadInfo,
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
        }
    }

    /// `Core::thread_info`, read again on `ViewChanged { Thread }`.
    pub fn set_info(&mut self, info: ThreadInfo, cx: &mut Context<Self>) {
        self.info = info;
        cx.notify();
    }
}

impl EventEmitter<ThreadPaneEvent> for ThreadPane {}

impl Render for ThreadPane {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div().id("thread-pane").size_full()
    }
}

#[cfg(feature = "stories")]
pub fn stories() -> Vec<crate::stories::Story> {
    Vec::new()
}
