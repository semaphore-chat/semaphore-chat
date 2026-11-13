//! The shell's side panel, as the pane fills it: the pins and search panels, and the thread pane
//! over whichever of them was open. Closing the thread puts that one back.

use super::{ConversationPane, PaneEvent, Which};
use gpui_kit::*;
use semaphore_core::model::{Conversation, ListOp, LoadState, MessageRow, SearchScope, ViewKey};
use semaphore_core::{Core, CoreEvent};
use semaphore_ui::composer::{Composer, ComposerConfig, ComposerMode};
use semaphore_ui::kit::on_core_event;
use semaphore_ui::messages::{ListStatus, MessageList};
use semaphore_ui::panel::{
    PinsPanel, PinsPanelEvent, SearchPanel, SearchPanelEvent, SearchResults, SearchScopeChoice,
};
use semaphore_ui::thread::{ThreadPane, ThreadPaneEvent};

/// How often, and how many times, a search that waits for its first page looks again: core
/// fetches the page, and answers only when it has it. Two seconds of looking is plenty for one
/// page; a page that fails says so and stops the waiting.
const SEARCH_WAIT: std::time::Duration = std::time::Duration::from_millis(20);
const SEARCH_WAIT_TRIES: u32 = 100;

/// The panel under the thread pane, or on its own.
pub(crate) enum Side {
    Pins {
        panel: Entity<PinsPanel>,
        _subscription: Subscription,
    },
    Search {
        panel: Entity<SearchPanel>,
        /// What the panel last asked: the scope and query "More results" reads its next page of.
        asked: Option<(SearchScope, String)>,
        _subscription: Subscription,
    },
}

impl Side {
    fn view(&self) -> AnyView {
        match self {
            Side::Pins { panel, .. } => panel.clone().into(),
            Side::Search { panel, .. } => panel.clone().into(),
        }
    }
}

/// An open thread: the pane and the three views inside it.
pub(crate) struct ThreadView {
    pub parent_id: String,
    /// `Conversation::Thread` for the parent.
    pub conversation: Conversation,
    /// The channel it was opened from: going elsewhere closes it.
    pub in_conversation: Conversation,
    pub pane: Entity<ThreadPane>,
    pub parent_list: Entity<MessageList>,
    pub replies: Entity<MessageList>,
    pub composer: Entity<Composer>,
    /// The replies as core sent them, in list order.
    pub rows: Vec<MessageRow>,
    /// The parent's row, as the channel's list last had it.
    pub parent_row: Vec<MessageRow>,
    /// A reply to tint once it arrives (a jump to a thread reply).
    pub flash: Option<String>,
    _subscriptions: Vec<Subscription>,
}

/// Applies core's ops to a mirror of a list's rows.
pub(crate) fn apply_ops(rows: &mut Vec<MessageRow>, ops: &[ListOp]) {
    for op in ops {
        match op {
            ListOp::Reset { rows: new } => rows.clone_from(new),
            ListOp::Insert { index, rows: new } => {
                let at = (*index as usize).min(rows.len());
                rows.splice(at..at, new.iter().cloned());
            }
            ListOp::Remove { index, count } => {
                let start = (*index as usize).min(rows.len());
                let end = (start + *count as usize).min(rows.len());
                rows.drain(start..end);
            }
            ListOp::Replace { index, rows: new } => {
                for (offset, row) in new.iter().enumerate() {
                    if let Some(slot) = rows.get_mut(*index as usize + offset) {
                        slot.clone_from(row);
                    }
                }
            }
        }
    }
}

/// Pushes core's page for `scope`/`query` into the panel: the hits, whether another page is
/// there, and whether one is on its way.
fn feed_search(
    panel: &mut SearchPanel,
    core: &Core,
    scope: &SearchScope,
    query: &str,
    cx: &mut Context<SearchPanel>,
) {
    let choice = match scope {
        SearchScope::Community { .. } => SearchScopeChoice::Community,
        SearchScope::Channel { .. } | SearchScope::DirectMessage { .. } => SearchScopeChoice::Here,
    };
    let view = core.search_results(scope.clone(), query.to_owned());
    let results = match &view.state {
        LoadState::Loading => SearchResults::Loading,
        LoadState::Ready => SearchResults::Ready {
            hits: view.hits.clone(),
            at_limit: view.more,
        },
        LoadState::Failed { error } => SearchResults::Failed {
            message: error.message.clone(),
        },
    };
    panel.set_more(view.more, view.loading_more, cx);
    panel.set_results(choice, view.query.clone(), results, cx);
}

impl ConversationPane {
    // ---- What the rig reads. ----

    /// `none`, `pins`, `search` or `thread`: what the side panel shows.
    pub fn side_panel_kind(&self) -> &'static str {
        match (&self.thread, &self.side) {
            (Some(_), _) => "thread",
            (None, Some(Side::Pins { .. })) => "pins",
            (None, Some(Side::Search { .. })) => "search",
            (None, None) => "none",
        }
    }

    /// The open thread's replies, as core sent them.
    pub fn thread_rows(&self) -> &[MessageRow] {
        self.rows_of(Which::Thread)
    }

    pub fn thread_parent(&self) -> Option<&str> {
        self.thread.as_ref().map(|thread| thread.parent_id.as_str())
    }

    pub fn thread_composer(&self) -> Option<&Entity<Composer>> {
        self.thread.as_ref().map(|thread| &thread.composer)
    }

    pub fn thread_list(&self) -> Option<&Entity<MessageList>> {
        self.thread.as_ref().map(|thread| &thread.replies)
    }

    /// The pins panel's or the search panel's hits, for the rig: the search panel's view.
    pub fn search_panel(&self) -> Option<&Entity<SearchPanel>> {
        match &self.side {
            Some(Side::Search { panel, .. }) => Some(panel),
            _ => None,
        }
    }

    // ---- The side panel. ----

    /// Tells the app what the side panel shows now.
    pub(crate) fn sync_side(&mut self, cx: &mut Context<Self>) {
        let view = match (&self.thread, &self.side) {
            (Some(thread), _) => Some(thread.pane.clone().into()),
            (None, Some(side)) => Some(side.view()),
            (None, None) => None,
        };
        cx.emit(PaneEvent::SidePanel(view));
        cx.notify();
    }

    /// The scrim, or a panel's own close: everything in the side panel goes.
    pub fn close_side(&mut self, cx: &mut Context<Self>) {
        self.thread = None;
        self.side = None;
        self.sync_side(cx);
    }

    /// The header's pin button: the pins panel, or closed again if it's what shows.
    pub fn toggle_pins(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.side_panel_kind() == "pins" {
            self.close_side(cx);
            return;
        }
        if self.channel_id().is_none() {
            return;
        }
        let media: std::rc::Rc<dyn semaphore_ui::messages::MediaSource> = self.media.clone();
        let panel = cx.new(|cx| {
            let mut panel = PinsPanel::new(media, cx);
            panel.set_clock(self.panel_clock, cx);
            panel
        });
        let subscription = cx.subscribe_in(&panel, window, Self::on_pins_event);
        self.thread = None;
        self.side = Some(Side::Pins {
            panel,
            _subscription: subscription,
        });
        self.refresh_pins(cx);
        self.sync_side(cx);
    }

    /// The header's search button: the search panel with the caret in its field.
    pub fn toggle_search(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.side_panel_kind() == "search" {
            self.close_side(cx);
            return;
        }
        let community_scope = self.community_id.is_some();
        let panel = cx.new(|cx| {
            let mut panel = SearchPanel::new(community_scope, window, cx);
            panel.set_clock(self.panel_clock, cx);
            panel
        });
        panel.update(cx, |panel, cx| panel.focus_field(window, cx));
        // Core pages a search's results itself: the panel is fed from the cache whenever the page
        // it asked for changes, and "More results" asks core for the next one. The listener is on
        // the panel, so it goes with the panel when the side panel closes.
        let core = self.core.clone();
        on_core_event(
            panel.downgrade(),
            move |panel, event, cx| {
                if let CoreEvent::ViewChanged {
                    view: ViewKey::Search { scope, query },
                } = event
                {
                    feed_search(panel, &core, scope, query, cx);
                }
            },
            cx,
        );
        let subscription = cx.subscribe_in(&panel, window, Self::on_search_event);
        self.thread = None;
        self.side = Some(Side::Search {
            panel,
            asked: None,
            _subscription: subscription,
        });
        self.sync_side(cx);
    }

    /// The channel's pins: into the panel if it's open, and the header's count.
    pub(crate) fn refresh_pins(&mut self, cx: &mut Context<Self>) {
        let Some(channel_id) = self.channel_id() else {
            return;
        };
        let pins = self.core.pinned_messages(channel_id);
        if pins.state == semaphore_core::model::LoadState::Ready {
            let count = pins.rows.len() as u32;
            if self.pinned_count != Some(count) {
                self.pinned_count = Some(count);
                cx.emit(PaneEvent::PinnedCount(count));
            }
        }
        if let Some(Side::Pins { panel, .. }) = &self.side {
            let can_unpin = self.moderation.unpin;
            panel.update(cx, |panel, cx| panel.set_pins(pins, can_unpin, cx));
        }
    }

    fn on_pins_event(
        &mut self,
        _: &Entity<PinsPanel>,
        event: &PinsPanelEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        match event.clone() {
            PinsPanelEvent::Jump {
                message_id,
                parent_message_id,
            } => {
                if let Some(conversation) = self.conversation.clone() {
                    let community_id = self.community_id.clone();
                    self.jump(
                        conversation,
                        community_id,
                        message_id,
                        parent_message_id,
                        window,
                        cx,
                    );
                }
            }
            PinsPanelEvent::Unpin { message_id } => {
                let core = self.core.clone();
                self.command("unpinning the message", window, cx, async move {
                    core.unpin_message(message_id, None).await
                });
            }
            PinsPanelEvent::Retry => {
                self.core.retry_failed();
                self.refresh_pins(cx);
            }
            PinsPanelEvent::Close => self.close_side(cx),
        }
    }

    fn on_search_event(
        &mut self,
        _panel: &Entity<SearchPanel>,
        event: &SearchPanelEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        match event.clone() {
            // The next page: core appends it to the page it keeps, and says so on its own view.
            SearchPanelEvent::More => {
                let Some(Side::Search {
                    asked: Some((scope, query)),
                    ..
                }) = &self.side
                else {
                    return;
                };
                let (core, scope, query) = (self.core.clone(), scope.clone(), query.clone());
                self.exec.run(
                    window,
                    cx,
                    async move { core.load_more_search(scope, query).await },
                    |_, result, _, _| {
                        if let Err(error) = result {
                            log::warn!("loading more results: {error}");
                        }
                    },
                );
            }
            SearchPanelEvent::Search { scope, query } => {
                let Some(searched) = self.search_scope(scope) else {
                    return;
                };
                let Some(Side::Search { panel, asked, .. }) = &mut self.side else {
                    return;
                };
                let core = self.core.clone();
                let panel = panel.clone();
                *asked = Some((searched.clone(), query.clone()));
                // The first page is core's: it fetches it and keeps it, for "More results" to read
                // the next one. Core doesn't say when a first page lands, so this waits for it and
                // shows it then (the spinner shows meanwhile).
                panel.update(cx, |panel, cx| {
                    feed_search(panel, &core, &searched, &query, cx)
                });
                let waiting = (core.clone(), searched.clone(), query.clone());
                let (shown, shown_query) = (searched, query);
                self.exec.run(
                    window,
                    cx,
                    async move {
                        let (core, scope, query) = waiting;
                        for _ in 0..SEARCH_WAIT_TRIES {
                            let view = core.search_results(scope.clone(), query.clone());
                            if view.state != LoadState::Loading {
                                break;
                            }
                            tokio::time::sleep(SEARCH_WAIT).await;
                        }
                    },
                    move |_, (), _, cx| {
                        panel.update(cx, |panel, cx| {
                            feed_search(panel, &core, &shown, &shown_query, cx)
                        });
                    },
                );
            }
            SearchPanelEvent::Jump(hit) => {
                let Some(message_id) = hit.row.id.clone() else {
                    return;
                };
                let community_id = self.community_id.clone();
                self.jump(
                    hit.conversation.clone(),
                    community_id,
                    message_id,
                    hit.parent_message_id.clone(),
                    window,
                    cx,
                );
            }
            SearchPanelEvent::Close => self.close_side(cx),
        }
    }

    /// Where a search looks, from the panel's scope: the community when "All channels" is chosen
    /// and there is one, else the conversation on screen.
    fn search_scope(&self, scope: SearchScopeChoice) -> Option<SearchScope> {
        match (scope, &self.community_id, &self.conversation) {
            (SearchScopeChoice::Community, Some(community_id), _) => Some(SearchScope::Community {
                id: community_id.clone(),
            }),
            (_, _, Some(Conversation::Channel { id })) => {
                Some(SearchScope::Channel { id: id.clone() })
            }
            (_, _, Some(Conversation::DirectMessage { id })) => {
                Some(SearchScope::DirectMessage { id: id.clone() })
            }
            _ => None,
        }
    }

    // ---- The thread pane. ----

    /// "Reply in thread", or a thread's link under its message: the pane over the side panel.
    pub(crate) fn open_thread(
        &mut self,
        parent_id: String,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(conversation) = self.conversation.clone() else {
            return;
        };
        self.open_thread_in(parent_id, conversation, window, cx);
    }

    /// Opens the thread of `parent_id`, a message in `in_conversation`.
    pub(crate) fn open_thread_in(
        &mut self,
        parent_id: String,
        in_conversation: Conversation,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self
            .thread
            .as_ref()
            .is_some_and(|thread| thread.parent_id == parent_id)
        {
            return;
        }
        if self
            .editing
            .as_ref()
            .is_some_and(|editing| editing.which != Which::Main)
        {
            self.finish_edit(window, cx);
        }
        let conversation = Conversation::Thread {
            parent_message_id: parent_id.clone(),
        };
        let parent_row: Vec<MessageRow> = self
            .rows
            .iter()
            .find(|row| row.id.as_deref() == Some(parent_id.as_str()))
            .cloned()
            .into_iter()
            .collect();
        let parent_list = self.new_list(parent_row.clone(), ListStatus::Ready, cx);
        let replies = self.new_list(Vec::new(), ListStatus::Loading, cx);
        let config = ComposerConfig {
            conversation: conversation.clone(),
            source: self.mentions.clone(),
            drafts: self.drafts.clone(),
            placeholder: "Reply in thread...".into(),
            max_file_bytes: None,
            mode: ComposerMode::Thread,
        };
        let composer = cx.new(|cx| {
            let mut composer = Composer::new(config, window, cx);
            composer.follow_theme(cx);
            composer.set_gifs_enabled(self.media_gifs_enabled(), cx);
            composer
        });
        let info = self.core.thread_info(parent_id.clone());
        let clock = self.panel_clock;
        let pane = {
            let (parent, list, input): (AnyView, AnyView, AnyView) = (
                parent_list.clone().into(),
                replies.clone().into(),
                composer.clone().into(),
            );
            cx.new(|cx| {
                let mut pane = ThreadPane::new(parent, list, input, cx);
                pane.set_clock(clock, cx);
                pane.set_info(info, cx);
                pane
            })
        };
        let subscriptions = vec![
            cx.subscribe_in(&parent_list, window, |this, _, event, window, cx| {
                this.on_list_event(Which::Parent, event, window, cx)
            }),
            cx.subscribe_in(&replies, window, |this, _, event, window, cx| {
                this.on_list_event(Which::Thread, event, window, cx)
            }),
            cx.subscribe_in(&composer, window, Self::on_composer_event),
            cx.subscribe_in(&pane, window, Self::on_thread_event),
        ];
        self.thread = Some(ThreadView {
            parent_id,
            conversation: conversation.clone(),
            in_conversation,
            pane,
            parent_list,
            replies,
            composer,
            rows: Vec::new(),
            parent_row,
            flash: None,
            _subscriptions: subscriptions,
        });
        self.apply_permissions(cx);
        self.sync_side(cx);
        let core = self.core.clone();
        let opening = conversation.clone();
        self.exec.run(
            window,
            cx,
            async move { core.open_conversation(opening).await },
            move |this, result, _, cx| {
                let Some(thread) = &this.thread else {
                    return;
                };
                if thread.conversation != conversation {
                    return;
                }
                thread
                    .replies
                    .update(cx, |list, cx| list.set_status(ListStatus::Ready, cx));
                if let Err(error) = result {
                    this.report("opening the thread", &error, cx);
                }
            },
        );
    }

    /// Closing the thread: the side panel shows what it showed before.
    pub fn close_thread(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self
            .editing
            .as_ref()
            .is_some_and(|editing| editing.which != Which::Main)
        {
            self.finish_edit(window, cx);
        }
        if self.thread.take().is_some() {
            self.sync_side(cx);
            // The caret goes back to the conversation's own composer, where the user was.
            if let Some(composer) = &self.composer {
                composer.update(cx, |composer, cx| composer.focus(window, cx));
            }
        }
    }

    fn on_thread_event(
        &mut self,
        _: &Entity<ThreadPane>,
        event: &ThreadPaneEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(parent_id) = self.thread.as_ref().map(|thread| thread.parent_id.clone()) else {
            return;
        };
        match event {
            ThreadPaneEvent::SetSubscribed(subscribed) => {
                let core = self.core.clone();
                let subscribed = *subscribed;
                self.command(
                    "changing the thread's notifications",
                    window,
                    cx,
                    async move { core.set_thread_subscribed(parent_id, subscribed).await },
                );
            }
            ThreadPaneEvent::Retry => {
                self.core.retry_failed();
                self.refresh_thread_info(&parent_id, cx);
            }
            ThreadPaneEvent::Close => self.close_thread(window, cx),
        }
    }

    pub(crate) fn refresh_thread_info(&mut self, parent_id: &str, cx: &mut Context<Self>) {
        let Some(thread) = &self.thread else {
            return;
        };
        if thread.parent_id != parent_id {
            return;
        }
        let info = self.core.thread_info(parent_id.to_owned());
        thread.pane.update(cx, |pane, cx| pane.set_info(info, cx));
    }

    /// Core's ops for the open thread's replies.
    pub(crate) fn thread_rows_changed(&mut self, ops: &[ListOp], cx: &mut Context<Self>) {
        let Some(thread) = &mut self.thread else {
            return;
        };
        thread.replies.update(cx, |list, cx| {
            for op in ops.iter().cloned() {
                list.apply(op, cx);
            }
            list.set_status(ListStatus::Ready, cx);
        });
        apply_ops(&mut thread.rows, ops);
        let count = thread.rows.len();
        thread
            .pane
            .update(cx, |pane, cx| pane.set_reply_rows(count, cx));
    }

    /// The channel's rows changed: the thread's parent row follows its copy there.
    pub(crate) fn parent_changed(&mut self, cx: &mut Context<Self>) {
        let Some(thread) = &self.thread else {
            return;
        };
        let Some(row) = self
            .rows
            .iter()
            .find(|row| row.id.as_deref() == Some(thread.parent_id.as_str()))
        else {
            return;
        };
        if thread.parent_row.first() == Some(row) {
            return;
        }
        let row = row.clone();
        let list = thread.parent_list.clone();
        list.update(cx, |list, cx| {
            list.apply(
                ListOp::Reset {
                    rows: vec![row.clone()],
                },
                cx,
            )
        });
        if let Some(thread) = &mut self.thread {
            thread.parent_row = vec![row];
        }
    }
}
