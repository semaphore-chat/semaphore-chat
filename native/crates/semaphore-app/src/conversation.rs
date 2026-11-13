//! The middle column for a text conversation: core's rows in the message list, and the composer.
//!
//! Core sends rows as `ListOp`s for the conversation on screen. The pane hands them to the list, keeps
//! a mirror for what the list doesn't expose (the reply quotes it draws, the newest id for read
//! marks, and the rig's checks), and answers what the list and composer ask by calling core.
//!
//! W1's message features live in two children: `actions` (edit in place, delete, pins, reactions
//! and the emoji picker, links and jumps, the error notice) and `side` (the pins and search panels
//! and the thread pane, in the shell's side panel). The pane asks the app for what it can't do
//! itself with a [`PaneEvent`]: show a side panel, go to another channel, the header's pin count.

mod actions;
mod media;
mod seen;
mod side;

use crate::files::AppMedia;
use crate::runtime::Exec;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{AttachmentView, DraftFile};
use semaphore_core::model::{
    ChannelModeration, ChannelPermissions, ChannelRow, Conversation, ListOp, MentionCandidate,
    MessageRow, SessionState, ViewKey,
};
use semaphore_core::{Core, CoreEvent};
use semaphore_ui::composer::{Availability, Composer, ComposerConfig, DraftStore, MentionSource};
use semaphore_ui::kit::on_core_event;
use semaphore_ui::messages::{
    ListData, ListOptions, ListPermissions, ListStatus, MessageList, ReplyPreview, TimeFormat,
};
use semaphore_ui::panel::PanelClock;
use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// What the app does with a clicked attachment: the image viewer, or Save as; or, for a file the
/// inline player can't play, the OS's default app.
pub type OpenAttachment = Rc<dyn Fn(AttachmentView, OpenHow, &mut Window, &mut App)>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OpenHow {
    View,
    Externally,
}

/// The server this session is on, for telling its message links from the rest.
pub type ServerUrl = Rc<dyn Fn() -> Option<String>>;

/// What the pane asks of the app.
#[derive(Clone)]
pub enum PaneEvent {
    /// Show this in the shell's side panel, or close it.
    SidePanel(Option<AnyView>),
    /// Go to a channel: a jump or a link to a message elsewhere. Core has already opened it there.
    Navigate {
        community_id: String,
        channel_id: String,
    },
    /// Go to a DM: a jump or a link to a message in one. Core has already opened it there.
    OpenDm { dm_id: String },
    /// The header's pin badge.
    PinnedCount(u32),
    /// An author or a mention was clicked: their profile.
    OpenProfile { user_id: String },
    /// A list's "Load" card: turn the third-party media switch on (`AppRoot::media_set_third_party`).
    EnableThirdPartyMedia,
}

/// Which of the pane's lists something happened in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Which {
    /// The conversation's own list.
    Main,
    /// The thread pane's replies.
    Thread,
    /// The thread pane's one-row list: the message the thread answers.
    Parent,
}

/// The web sends `typingStart` at most this often while keys keep coming.
const TYPING_EVERY: Duration = Duration::from_secs(3);

/// `Core::mention_candidates` for the community on screen. The composer asks with the query alone
/// and keeps the candidates whose trigger matches, so this asks for both kinds.
struct CoreMentions {
    core: Arc<Core>,
    community_id: RefCell<Option<String>>,
}

impl MentionSource for CoreMentions {
    fn candidates(&self, query: &str) -> Vec<MentionCandidate> {
        let Some(community_id) = self.community_id.borrow().clone() else {
            return Vec::new();
        };
        let mut candidates = self
            .core
            .mention_candidates(community_id.clone(), query.to_owned());
        candidates.extend(
            self.core
                .mention_candidates(community_id, format!("#{query}")),
        );
        candidates
    }
}

pub struct ConversationPane {
    core: Arc<Core>,
    exec: Exec,
    time: TimeFormat,
    /// Core's clock, which a timeout's end is told in (`with_clock`); the system's without one.
    clock: Option<Arc<dyn semaphore_core::platform::Clock>>,
    scrollbar: bool,
    window: AnyWindowHandle,
    conversation: Option<Conversation>,
    community_id: Option<String>,
    channel: Option<ChannelRow>,
    /// The DM's composer placeholder ("Message @Ava"), once its row is known.
    dm_placeholder: Option<String>,
    list: Option<Entity<MessageList>>,
    composer: Option<Entity<Composer>>,
    drafts: Entity<DraftStore>,
    mentions: Rc<CoreMentions>,
    /// The rows as core sent them, in list order.
    rows: Vec<MessageRow>,
    replies: HashMap<i64, ReplyPreview>,
    last_typing: Option<Instant>,
    marked_read: Option<String>,
    focused: bool,
    media: Rc<AppMedia>,
    /// Inline audio and video players for every list, or `None` (the app built without them).
    players: Option<semaphore_ui::player::Players>,
    /// The app opens an attachment: the image viewer, or Save as.
    open_attachment: OpenAttachment,
    list_subscription: Option<Subscription>,
    server_url: ServerUrl,
    /// What "5 minutes ago" in the panels is measured from: the rows' clock.
    panel_clock: PanelClock,
    /// What this user may do to others' messages in the channel on screen.
    moderation: ChannelModeration,
    pinned_count: Option<u32>,
    pub(crate) thread: Option<side::ThreadView>,
    pub(crate) side: Option<side::Side>,
    pub(crate) editing: Option<actions::Editing>,
    pub(crate) picker: Option<actions::OpenPicker>,
    /// WM: the open GIF picker, and whether the server offers GIFs (the root says).
    pub(crate) gif: Option<media::GifHost>,
    pub(crate) gifs_enabled: bool,
    /// The reaction whose tooltip shows: its list, message and emoji.
    hovered_reaction: Option<(Which, String, String)>,
    /// The last thing the server refused, in its words, until dismissed.
    notice: Option<String>,
    /// A message to scroll to and tint once its rows arrive: its conversation and id.
    flash: Option<(Conversation, String)>,
    /// Takes the tint away again.
    flash_timer: Option<Task<()>>,
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<PaneEvent> for ConversationPane {}

impl ConversationPane {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        core: Arc<Core>,
        exec: Exec,
        time: TimeFormat,
        scrollbar: bool,
        media: Rc<AppMedia>,
        players: Option<semaphore_ui::player::Players>,
        open_attachment: OpenAttachment,
        server_url: ServerUrl,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        on_core_event(cx.entity().downgrade(), Self::on_core, cx);
        let panel_clock = time.now;
        Self {
            mentions: Rc::new(CoreMentions {
                core: core.clone(),
                community_id: RefCell::new(None),
            }),
            core,
            exec,
            time,
            clock: None,
            scrollbar,
            window: window.window_handle(),
            conversation: None,
            community_id: None,
            channel: None,
            dm_placeholder: None,
            list: None,
            composer: None,
            drafts: cx.new(|_| DraftStore::default()),
            rows: Vec::new(),
            replies: HashMap::new(),
            last_typing: None,
            marked_read: None,
            focused: window.is_window_active(),
            media,
            players,
            open_attachment,
            list_subscription: None,
            server_url,
            panel_clock,
            moderation: ChannelModeration::default(),
            pinned_count: None,
            thread: None,
            side: None,
            editing: None,
            picker: None,
            gif: None,
            gifs_enabled: false,
            hovered_reaction: None,
            notice: None,
            flash: None,
            flash_timer: None,
            _subscriptions: Vec::new(),
        }
    }

    pub fn conversation(&self) -> Option<&Conversation> {
        self.conversation.as_ref()
    }

    /// The rows on screen, as core sent them.
    pub fn rows(&self) -> &[MessageRow] {
        &self.rows
    }

    pub fn list(&self) -> Option<&Entity<MessageList>> {
        self.list.as_ref()
    }

    pub fn composer(&self) -> Option<&Entity<Composer>> {
        self.composer.as_ref()
    }

    /// Keyboard focus to the composer, for a conversation the shell just landed on or re-selected.
    pub fn focus_composer(&self, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(composer) = &self.composer {
            composer.update(cx, |composer, cx| composer.focus(window, cx));
        }
    }

    pub fn set_focused(&mut self, focused: bool, cx: &mut Context<Self>) {
        self.focused = focused;
        if focused {
            self.mark_read(cx);
        }
    }

    /// Shows `conversation`, or keeps showing it with this channel row's permissions.
    pub fn show(
        &mut self,
        conversation: Conversation,
        community_id: Option<String>,
        channel: Option<ChannelRow>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let changed = self.conversation.as_ref() != Some(&conversation);
        let permissions_changed = self.channel.as_ref().map(|row| &row.permissions)
            != channel.as_ref().map(|row| &row.permissions)
            || self.channel.as_ref().map(|row| row.slowmode_seconds)
                != channel.as_ref().map(|row| row.slowmode_seconds);
        self.channel = channel;
        *self.mentions.community_id.borrow_mut() = community_id.clone();
        *self.media.community.borrow_mut() = community_id.clone();
        self.community_id = community_id;
        if changed {
            self.open(conversation, window, cx);
        } else if permissions_changed {
            self.apply_availability(window, cx);
            self.apply_permissions(cx);
        }
        // The composer outlives the conversation: it takes this one's name ("Message #random").
        let placeholder = self.placeholder();
        if let Some(composer) = &self.composer {
            composer.update(cx, |composer, cx| {
                composer.set_placeholder(placeholder, window, cx)
            });
        }
    }

    /// The channel on screen, if a channel is.
    pub(crate) fn channel_id(&self) -> Option<String> {
        match &self.conversation {
            Some(Conversation::Channel { id }) => Some(id.clone()),
            _ => None,
        }
    }

    /// What the rows offer: posting and reacting from the channel's capabilities (open while they
    /// load, as the composer is: the server enforces them), the rest from its moderation roles.
    pub(crate) fn list_permissions(&self, which: Which) -> ListPermissions {
        let permissions = self
            .channel
            .as_ref()
            .and_then(|row| row.permissions.as_ref());
        let (post, react, thread_reply) = permissions.map_or((true, true, true), |p| {
            (
                p.post
                    && p.timed_out_until_ms
                        .is_none_or(|until| until <= self.now_ms()),
                p.react,
                p.thread_reply,
            )
        });
        let main = which == Which::Main;
        ListPermissions {
            reply: main && post,
            react,
            threads: main && thread_reply,
            pin: self.moderation.pin,
            unpin: self.moderation.unpin,
            remove_any: self.moderation.remove_any,
        }
    }

    /// Hands every list what it may offer now.
    pub(crate) fn apply_permissions(&mut self, cx: &mut Context<Self>) {
        for which in [Which::Main, Which::Thread, Which::Parent] {
            let permissions = self.list_permissions(which);
            if let Some(list) = self.list_of(which) {
                list.update(cx, |list, cx| list.set_permissions(permissions, cx));
            }
        }
    }

    pub(crate) fn list_of(&self, which: Which) -> Option<Entity<MessageList>> {
        match which {
            Which::Main => self.list.clone(),
            Which::Thread => self.thread.as_ref().map(|thread| thread.replies.clone()),
            Which::Parent => self
                .thread
                .as_ref()
                .map(|thread| thread.parent_list.clone()),
        }
    }

    /// The rows a list shows, as core sent them.
    pub(crate) fn rows_of(&self, which: Which) -> &[MessageRow] {
        match (which, &self.thread) {
            (Which::Main, _) => &self.rows,
            (Which::Thread, Some(thread)) => &thread.rows,
            (Which::Parent, Some(thread)) => thread.parent_row.as_slice(),
            _ => &[],
        }
    }

    /// The conversation a list's paging and holds go to. The parent's list has none of its own.
    fn conversation_of(&self, which: Which) -> Option<Conversation> {
        match which {
            Which::Main => self.conversation.clone(),
            Which::Thread => self
                .thread
                .as_ref()
                .map(|thread| thread.conversation.clone()),
            Which::Parent => None,
        }
    }

    /// A message list over core's rows, as the conversation's own is made.
    pub(crate) fn new_list(
        &self,
        rows: Vec<MessageRow>,
        status: ListStatus,
        cx: &mut Context<Self>,
    ) -> Entity<MessageList> {
        let me_id = match self.core.session() {
            SessionState::SignedIn { me } => me.id,
            _ => String::new(),
        };
        let (time, scrollbar) = (self.time, self.scrollbar);
        let media: Rc<dyn semaphore_ui::messages::MediaSource> = self.media.clone();
        // The third-party media switch, as the preview fetcher has it (`media.rs`).
        let third_party = self.media.previews.allowed();
        cx.new(|cx| {
            let mut list = MessageList::new(
                ListData {
                    me_id,
                    rows,
                    replies: HashMap::new(),
                    status,
                },
                media,
                ListOptions {
                    time,
                    scrollbar,
                    follow_theme: true,
                    players: self.players.clone(),
                    ..ListOptions::default()
                },
                cx,
            );
            list.set_third_party_media(third_party, cx);
            list
        })
    }

    /// The divider from core's snapshot of where reading stopped when the conversation opened.
    fn refresh_unread(&mut self, cx: &mut Context<Self>) {
        let Some(conversation) = self.conversation.clone() else {
            return;
        };
        let marker = self.core.unread_marker(conversation);
        if let Some(list) = &self.list {
            list.update(cx, |list, cx| list.set_unread_marker(marker.as_ref(), cx));
        }
    }

    /// Reads the moderation roles for the channel on screen, and what they allow.
    fn refresh_moderation(&mut self, cx: &mut Context<Self>) {
        self.moderation = match self.channel_id() {
            Some(channel_id) => self.core.channel_moderation(channel_id).allowed,
            None => ChannelModeration::default(),
        };
        self.apply_permissions(cx);
        self.refresh_pins(cx);
    }

    fn open(&mut self, conversation: Conversation, window: &mut Window, cx: &mut Context<Self>) {
        self.conversation = Some(conversation.clone());
        self.rows.clear();
        self.replies.clear();
        self.marked_read = None;
        self.editing = None;
        self.picker = None;
        self.hovered_reaction = None;
        self.pinned_count = None;
        // A thread belongs to the channel it was opened in, unless a jump opened it for this one.
        if self
            .thread
            .as_ref()
            .is_some_and(|thread| thread.in_conversation != conversation)
        {
            self.thread = None;
            self.sync_side(cx);
        }
        let list = self.new_list(Vec::new(), ListStatus::Loading, cx);
        let list_events = cx.subscribe_in(&list, window, |this, _, event, window, cx| {
            this.on_list_event(Which::Main, event, window, cx)
        });
        self.list = Some(list);

        self.list_subscription = Some(list_events);
        match &self.composer {
            Some(composer) => {
                composer.update(cx, |composer, cx| {
                    composer.set_conversation(conversation.clone(), window, cx)
                });
            }
            None => {
                let config = ComposerConfig {
                    conversation: conversation.clone(),
                    source: self.mentions.clone(),
                    drafts: self.drafts.clone(),
                    placeholder: self.placeholder(),
                    max_file_bytes: None,
                    mode: semaphore_ui::composer::ComposerMode::Send,
                };
                let composer = cx.new(|cx| {
                    let mut composer = Composer::new(config, window, cx);
                    composer.follow_theme(cx);
                    composer.set_gifs_enabled(self.media_gifs_enabled(), cx);
                    composer
                });
                self._subscriptions.push(cx.subscribe_in(
                    &composer,
                    window,
                    Self::on_composer_event,
                ));
                self.composer = Some(composer);
            }
        }
        self.apply_availability(window, cx);
        self.refresh_moderation(cx);
        self.refresh_unread(cx);

        let core = self.core.clone();
        let opening = conversation.clone();
        self.exec.run(
            window,
            cx,
            async move { core.open_conversation(opening).await },
            move |this, result, _, cx| {
                if this.conversation.as_ref() != Some(&conversation) {
                    return;
                }
                if let Err(error) = result {
                    log::warn!("opening {conversation:?} failed: {error}");
                }
                if let Some(list) = &this.list {
                    list.update(cx, |list, cx| list.set_status(ListStatus::Ready, cx));
                }
                this.flash_if_loaded(cx);
            },
        );
        cx.notify();
    }

    fn placeholder(&self) -> SharedString {
        match (&self.channel, &self.conversation, &self.dm_placeholder) {
            (Some(channel), _, _) => format!("Message #{}", channel.name).into(),
            (None, Some(Conversation::DirectMessage { .. }), Some(name)) => name.clone().into(),
            _ => "Type a message...".into(),
        }
    }

    /// The DM on screen's placeholder, from its row (`None` while the row loads).
    pub fn set_dm_placeholder(
        &mut self,
        placeholder: Option<String>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.dm_placeholder == placeholder {
            return;
        }
        self.dm_placeholder = placeholder;
        let placeholder = self.placeholder();
        if let Some(composer) = &self.composer {
            composer.update(cx, |composer, cx| {
                composer.set_placeholder(placeholder, window, cx)
            });
        }
    }

    /// `useComposerAvailability`: what this user may do here, failing open while permissions load.
    /// W5: whether the composer is locked by a timeout, for the rig.
    pub fn timed_out(&self, cx: &App) -> bool {
        matches!(self.availability(cx), Availability::TimedOut { .. })
    }

    /// W5: tells the timeout lock by core's clock, as the server's times are (a rig holds it).
    pub fn with_clock(mut self, clock: Arc<dyn semaphore_core::platform::Clock>) -> Self {
        self.clock = Some(clock);
        self
    }

    fn now_ms(&self) -> i64 {
        self.clock
            .as_ref()
            .map_or_else(now_ms, |clock| clock.now_ms() as i64)
    }

    fn availability(&self, cx: &App) -> Availability {
        let channel_name = self.channel.as_ref().map(|row| row.name.clone());
        let Some(permissions) = self
            .channel
            .as_ref()
            .and_then(|row| row.permissions.as_ref())
        else {
            // Fail open while permissions load, as the web does: the server enforces them.
            return Availability::Open {
                can_attach: true,
                channel_name,
            };
        };
        availability_for(
            permissions,
            channel_name,
            self.now_ms(),
            cx.background_executor().now(),
        )
    }

    fn apply_availability(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let availability = self.availability(cx);
        let slowmode = self.channel.as_ref().map(|row| row.slowmode_seconds);
        if let Some(composer) = &self.composer {
            composer.update(cx, |composer, cx| {
                composer.set_availability(availability, window, cx);
                composer.set_slowmode(slowmode, cx);
            });
        }
    }

    fn on_core(&mut self, event: &CoreEvent, cx: &mut Context<Self>) {
        let Some(conversation) = self.conversation.clone() else {
            return;
        };
        match event {
            CoreEvent::MessagesChanged {
                conversation: changed,
                ops,
            } if *changed == conversation => {
                if let Some(list) = &self.list {
                    let ops = ops.clone();
                    list.update(cx, |list, cx| {
                        for op in ops {
                            list.apply(op, cx);
                        }
                    });
                }
                if self.apply_to_mirror(ops)
                    && let Some(list) = &self.list
                {
                    let replies = self.replies.clone();
                    list.update(cx, |list, cx| list.set_replies(replies, cx));
                }
                let detached = !self.core.at_live_edge(conversation);
                if let Some(list) = &self.list {
                    list.update(cx, |list, cx| {
                        list.set_detached(detached, cx);
                        list.set_status(ListStatus::Ready, cx);
                    });
                }
                // The divider's row may have just arrived.
                if self
                    .list
                    .as_ref()
                    .is_some_and(|list| list.read(cx).unread_divider().is_none())
                {
                    self.refresh_unread(cx);
                }
                self.parent_changed(cx);
                self.flash_if_loaded(cx);
                self.mark_read(cx);
            }
            CoreEvent::MessagesChanged {
                conversation: changed,
                ops,
            } if self
                .thread
                .as_ref()
                .is_some_and(|thread| thread.conversation == *changed) =>
            {
                self.thread_rows_changed(ops, cx);
                self.flash_if_loaded(cx);
            }
            CoreEvent::ViewChanged {
                view: ViewKey::UnreadMarker { conversation: of },
            } if *of == conversation => self.refresh_unread(cx),
            CoreEvent::ViewChanged {
                view: ViewKey::ChannelModeration { channel_id },
            } if self.channel_id().as_ref() == Some(channel_id) => self.refresh_moderation(cx),
            CoreEvent::ViewChanged {
                view: ViewKey::Pins { channel_id },
            } if self.channel_id().as_ref() == Some(channel_id) => self.refresh_pins(cx),
            CoreEvent::ViewChanged {
                view: ViewKey::Thread { parent_message_id },
            } => self.refresh_thread_info(parent_message_id, cx),
            CoreEvent::ViewChanged {
                view: ViewKey::ReactionUsers { message_id, emoji },
            } => self.refresh_reaction_users(message_id, emoji, cx),
            // Mention candidates arrive after the query that asked: show them. Custom emoji ride
            // the same view, so the list draws them now too.
            CoreEvent::ViewChanged {
                view: ViewKey::Mentionables { .. } | ViewKey::Members { .. },
            } => {
                self.refresh_composer(cx);
                self.refresh_picker_emoji(cx);
                for which in [Which::Main, Which::Thread, Which::Parent] {
                    if let Some(list) = self.list_of(which) {
                        list.update(cx, |_, cx| cx.notify());
                    }
                }
            }
            _ => {}
        }
    }

    /// Re-reads the composer's suggestions and availability, in a frame of its own.
    fn refresh_composer(&mut self, cx: &mut Context<Self>) {
        let (Some(composer), window) = (self.composer.clone(), self.window) else {
            return;
        };
        let availability = self.availability(cx);
        cx.defer(move |cx| {
            window
                .update(cx, |_, window, cx| {
                    composer.update(cx, |composer, cx| {
                        composer.set_availability(availability, window, cx)
                    });
                })
                .ok();
        });
    }

    /// Applies ops to the mirror. True if the reply quotes changed.
    fn apply_to_mirror(&mut self, ops: &[ListOp]) -> bool {
        let mut replies_changed = false;
        let note = |rows: &[MessageRow], replies: &mut HashMap<i64, ReplyPreview>| -> bool {
            let mut noted = false;
            for row in rows {
                if let Some(reply) = &row.reply_to {
                    let author = reply
                        .author
                        .display_name
                        .clone()
                        .filter(|name| !name.is_empty())
                        .unwrap_or_else(|| reply.author.username.clone());
                    replies.insert(
                        row.seq,
                        ReplyPreview {
                            author,
                            text: reply.text.clone(),
                            deleted: reply.deleted,
                        },
                    );
                    noted = true;
                }
            }
            noted
        };
        for op in ops {
            match op {
                ListOp::Reset { rows } => {
                    self.replies.clear();
                    note(rows, &mut self.replies);
                    replies_changed = true;
                    self.rows.clone_from(rows);
                }
                ListOp::Insert { index, rows } => {
                    replies_changed |= note(rows, &mut self.replies);
                    let at = (*index as usize).min(self.rows.len());
                    self.rows.splice(at..at, rows.iter().cloned());
                }
                ListOp::Remove { index, count } => {
                    let start = (*index as usize).min(self.rows.len());
                    let end = (start + *count as usize).min(self.rows.len());
                    self.rows.drain(start..end);
                }
                ListOp::Replace { index, rows } => {
                    replies_changed |= note(rows, &mut self.replies);
                    for (offset, row) in rows.iter().enumerate() {
                        if let Some(slot) = self.rows.get_mut(*index as usize + offset) {
                            slot.clone_from(row);
                        }
                    }
                }
            }
        }
        replies_changed
    }

    /// Marks the newest message read while the window has focus and the list is at the live edge,
    /// as the web does for what's on screen.
    fn mark_read(&mut self, _: &mut Context<Self>) {
        let Some(conversation) = self.conversation.clone() else {
            return;
        };
        if !self.focused || !self.core.at_live_edge(conversation.clone()) {
            return;
        }
        let Some(newest) = self.rows.iter().rev().find_map(|row| row.id.clone()) else {
            return;
        };
        if self.marked_read.as_ref() == Some(&newest) {
            return;
        }
        self.marked_read = Some(newest.clone());
        let core = self.core.clone();
        self.exec.fire(async move {
            if let Err(error) = core.mark_read(conversation, newest).await {
                log::debug!("marking read: {error}");
            }
        });
    }

    fn typing_line(&self) -> Option<String> {
        let conversation = self.conversation.clone()?;
        let names: Vec<String> = self
            .core
            .typing_users(conversation)
            .into_iter()
            .map(|user| {
                user.display_name
                    .filter(|name| !name.is_empty())
                    .unwrap_or(user.username)
            })
            .collect();
        match names.as_slice() {
            [] => None,
            [one] => Some(format!("{one} is typing...")),
            [one, two] => Some(format!("{one} and {two} are typing...")),
            _ => Some("Several people are typing...".into()),
        }
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis() as i64)
}

/// `useComposerAvailability` over a channel's permissions. `now` is the app clock the composer
/// counts a timeout down on.
pub fn availability_for(
    permissions: &ChannelPermissions,
    channel_name: Option<String>,
    now_ms: i64,
    now: Instant,
) -> Availability {
    if let Some(until_ms) = permissions.timed_out_until_ms
        && until_ms > now_ms
    {
        return Availability::TimedOut {
            until: Some(now + Duration::from_millis((until_ms - now_ms) as u64)),
            reason: None,
        };
    }
    if !permissions.post {
        if permissions.posting_role_names.is_empty() {
            return Availability::NoPermission { channel_name };
        }
        return Availability::ReadOnly {
            channel_name,
            posting_roles: permissions.posting_role_names.clone(),
        };
    }
    Availability::Open {
        can_attach: permissions.attach,
        channel_name,
    }
}

/// A composer file, as it can cross to a blocking thread.
enum FileSource {
    Path(String, std::path::PathBuf),
    Bytes(String, Vec<u8>),
}

/// The composer's files as core takes them: bytes, a name and a MIME type. Fails the send, with
/// the composer's draft put back, if one can't be read.
fn read_files(files: &[FileSource]) -> Result<Vec<DraftFile>, semaphore_core::CoreError> {
    files
        .iter()
        .map(|file| {
            let (name, bytes) = match file {
                FileSource::Path(name, path) => (
                    name,
                    std::fs::read(path).map_err(|error| semaphore_core::CoreError::Failed {
                        message: format!("couldn't read {name}: {error}"),
                    })?,
                ),
                FileSource::Bytes(name, bytes) => (name, bytes.clone()),
            };
            Ok(DraftFile {
                name: name.clone(),
                mime_type: mime_for(name),
                bytes,
            })
        })
        .collect()
}

/// A MIME type from a file name's extension: the common ones, and octet-stream for the rest.
pub fn mime_for(name: &str) -> String {
    let extension = name
        .rsplit_once('.')
        .map(|(_, extension)| extension.to_ascii_lowercase())
        .unwrap_or_default();
    match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "pdf" => "application/pdf",
        "txt" | "log" | "md" => "text/plain",
        "json" => "application/json",
        "zip" => "application/zip",
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "mkv" => "video/x-matroska",
        "ogv" => "video/ogg",
        "avi" => "video/x-msvideo",
        "mp3" => "audio/mpeg",
        "m4a" => "audio/mp4",
        "aac" => "audio/aac",
        "ogg" | "oga" => "audio/ogg",
        "opus" => "audio/opus",
        "flac" => "audio/flac",
        "wav" => "audio/wav",
        _ => "application/octet-stream",
    }
    .to_owned()
}

impl Render for ConversationPane {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let palette = cx
            .try_global::<semaphore_ui::theme::Sem>()
            .map(|sem| semaphore_ui::messages::palette::Palette::for_theme(sem.choice))
            .unwrap_or_else(semaphore_ui::messages::palette::Palette::dark);
        let typing = self.typing_line();
        let notice = self.notice_element(cx);
        let picker = self.picker_element(cx);
        div()
            .id("conversation")
            .size_full()
            .flex()
            .flex_col()
            .min_h_0()
            .child(
                div()
                    .flex_1()
                    .min_h_0()
                    .when_some(self.list.clone(), |this, list| this.child(list)),
            )
            .child(
                div()
                    .h(px(20.))
                    .px(px(16.))
                    .flex_shrink_0()
                    .text_size(px(12.))
                    .text_color(palette.text_secondary)
                    .when_some(typing, |this, typing| this.child(typing)),
            )
            .children(notice)
            .when_some(self.composer.clone(), |this, composer| {
                this.child(div().flex_shrink_0().child(composer))
            })
            .children(picker)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::prelude::rust_2024::test;

    fn permissions() -> ChannelPermissions {
        ChannelPermissions {
            post: true,
            ..ChannelPermissions::default()
        }
    }

    #[test]
    fn availability_follows_the_permissions() {
        let now = Instant::now();
        assert!(matches!(
            availability_for(&permissions(), None, 1_000, now),
            Availability::Open {
                can_attach: false,
                ..
            }
        ));
        let attach = ChannelPermissions {
            attach: true,
            ..permissions()
        };
        assert!(matches!(
            availability_for(&attach, None, 1_000, now),
            Availability::Open {
                can_attach: true,
                ..
            }
        ));
        assert_eq!(mime_for("Photo.JPG"), "image/jpeg");
        assert_eq!(mime_for("notes"), "application/octet-stream");
        let read_only = ChannelPermissions {
            post: false,
            posting_role_names: vec!["Mods".into()],
            ..ChannelPermissions::default()
        };
        assert!(matches!(
            availability_for(&read_only, None, 1_000, now),
            Availability::ReadOnly { posting_roles, .. } if posting_roles == ["Mods"]
        ));
        let none = ChannelPermissions::default();
        assert!(matches!(
            availability_for(&none, None, 1_000, now),
            Availability::NoPermission { .. }
        ));
        let timed_out = ChannelPermissions {
            timed_out_until_ms: Some(61_000),
            ..permissions()
        };
        let Availability::TimedOut {
            until: Some(until), ..
        } = availability_for(&timed_out, None, 1_000, now)
        else {
            panic!("expected a timeout");
        };
        assert_eq!(until - now, Duration::from_secs(60));
        // A timeout in the past is over.
        let over = ChannelPermissions {
            timed_out_until_ms: Some(500),
            ..permissions()
        };
        assert!(matches!(
            availability_for(&over, None, 1_000, now),
            Availability::Open { .. }
        ));
    }
}
