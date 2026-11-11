//! A conversation's loaded window of rows: `seq` assignment, the id index, older-page loading, and
//! eviction, which waits while a span is held by `Core::hold_rows`.
//!
//! The updaters mirror `messageCacheUpdaters.ts` on a flat list instead of pages, and are tested by
//! that file's own test cases, exported to `fixtures/cache/message-cache-updaters.json`. Rows run
//! oldest first, because `ListOp::Insert { index: 0 }` is what older rows arrive as.
//!
//! **`seq`.** Spaced out, because a resync has to slot missed messages between rows that keep
//! theirs: a selection is held by `seq`, and must survive a reconnect.

use crate::model::{
    AttachmentKind, AttachmentView, ErrorView, LinkPreviewView, ListOp, MessageRow, ReactionView,
    ReplyToView, SendState, TextStyle, UserView, WebhookView,
};
use crate::text::{SpanInput, layout_spans};
use semaphore_wire::types::{MessageDto, ReactionDto, SpanDto};
use std::collections::{HashMap, HashSet, VecDeque};

/// A page, as the web client asks for one.
pub const PAGE_SIZE: i64 = 25;
/// Thread replies come in larger pages, oldest first.
pub const THREAD_PAGE_SIZE: i64 = 50;
/// The web client's `MESSAGE_MAX_PAGES`: 40 pages of 25.
pub const MAX_ROWS: usize = 1000;
const SEQ_STEP: i64 = 1 << 20;
/// How many deleted ids a window remembers, so a message that arrives after its delete stays gone.
pub const TOMBSTONES: usize = 128;

/// Where a local row stands. Absent on the web, where it's `sendStatus`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub enum SendStatus {
    #[default]
    Settled,
    Pending,
    Failed(ErrorView),
}

/// A message and what only this client knows about it.
#[derive(Debug, Clone)]
pub struct StoredMessage {
    pub dto: MessageDto,
    /// The local key of a row that began as a send. Kept after it settles. While the row is
    /// unsettled, `dto.id` equals it, which is what `is_placeholder` means.
    pub client_id: Option<String>,
    pub send: SendStatus,
}

impl StoredMessage {
    pub fn from_server(dto: MessageDto) -> Self {
        Self {
            dto,
            client_id: None,
            send: SendStatus::Settled,
        }
    }

    /// Still the optimistic row: the server's id hasn't replaced the local one.
    pub fn is_placeholder(&self) -> bool {
        self.client_id.as_deref() == Some(self.dto.id.as_str())
    }

    fn is_placeholder_for(&self, client_id: &str) -> bool {
        self.client_id.as_deref() == Some(client_id) && self.dto.id == client_id
    }

    fn is_optimistic(&self) -> bool {
        self.send != SendStatus::Settled
    }
}

#[derive(Debug, Clone)]
pub struct Row {
    pub seq: i64,
    pub revision: u64,
    pub message: StoredMessage,
}

/// What an event did while a fetch was running: applied again over the response, which may be older.
#[derive(Debug, Clone)]
enum Touch {
    /// A new message: a row if the response didn't include it.
    Upsert(Box<MessageDto>),
    /// A change to a message. One the response doesn't include is outside the rows: leave it out.
    Update(Box<MessageDto>),
    Delete(String),
}

/// What a resync of the loaded rows found.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResyncOutcome {
    Merged,
    /// The server's rows don't connect to the loaded ones.
    NeedsReset,
}

#[derive(Debug, Default)]
pub struct Window {
    rows: VecDeque<Row>,
    by_id: HashMap<String, i64>,
    loaded: bool,
    detached: bool,
    older_token: Option<String>,
    at_start: bool,
    high: i64,
    low: i64,
    held: Option<(i64, i64)>,
    /// Older rows came in during a hold, so the newest are the ones to drop when it ends.
    grew_older_while_held: bool,
    /// A reset was due while a span was held. It runs when the hold is released.
    pub reset_deferred: bool,
    /// Rows may have missed events. Refetched when on screen, or when next opened.
    pub stale: bool,
    /// Changes when the rows are replaced, so a response to an older request is dropped.
    pub epoch: u64,
    pub loading_older: bool,
    pub loading_newer: bool,
    pub loading_first: bool,
    /// What the UI has, by `(seq, revision)`. `None` until the conversation is opened.
    shown: Option<Vec<(i64, u64)>>,
    send_reset: bool,
    fetching: u32,
    touched: Vec<Touch>,
    pub last_used: u64,
    /// The last revision handed out. Revisions are unique within a window, not per row: a resync
    /// can slot a missed row at the seq of a row it just deleted, and the UI tells rows apart by
    /// `(seq, revision)`, so a fresh row must never repeat a pair the UI holds.
    revisions: u64,
    /// Ids deleted lately, newest last, at most [`TOMBSTONES`]. A delete can overtake its message
    /// (the echo of a send, a reply), and the late message must not bring the row back.
    tombstones: VecDeque<String>,
}

impl Window {
    /// The web's `old`, when it's `undefined`: nothing loaded, so every updater does nothing.
    pub fn unloaded() -> Self {
        Self::default()
    }

    /// A loaded window from rows newest first, as a page holds them. `detached` is the web's
    /// `pageParams[0]` being a cursor.
    pub fn with_rows(newest_first: Vec<StoredMessage>, detached: bool) -> Self {
        let mut window = Self {
            loaded: true,
            detached,
            ..Self::default()
        };
        for message in newest_first.into_iter().rev() {
            window.push_back(message);
        }
        window
    }

    pub fn is_loaded(&self) -> bool {
        self.loaded
    }

    pub fn is_detached_from_live_edge(&self) -> bool {
        self.detached
    }

    pub fn rows(&self) -> impl Iterator<Item = &Row> {
        self.rows.iter()
    }

    pub fn len(&self) -> usize {
        self.rows.len()
    }

    pub fn is_empty(&self) -> bool {
        self.rows.is_empty()
    }

    pub fn find(&self, id: &str) -> Option<&StoredMessage> {
        self.index_of(id).map(|index| &self.rows[index].message)
    }

    /// The oldest row the server knows about.
    pub fn oldest_settled_id(&self) -> Option<&str> {
        self.rows
            .iter()
            .find(|row| !row.message.is_placeholder())
            .map(|row| row.message.dto.id.as_str())
    }

    pub fn has_unsettled_rows(&self) -> bool {
        self.rows.iter().any(|row| row.message.is_optimistic())
    }

    fn index_of(&self, id: &str) -> Option<usize> {
        let seq = *self.by_id.get(id)?;
        self.rows.binary_search_by_key(&seq, |row| row.seq).ok()
    }

    fn next_revision(&mut self) -> u64 {
        self.revisions += 1;
        self.revisions
    }

    fn push_back(&mut self, message: StoredMessage) {
        self.high += SEQ_STEP;
        self.by_id.insert(message.dto.id.clone(), self.high);
        let revision = self.next_revision();
        self.rows.push_back(Row {
            seq: self.high,
            revision,
            message,
        });
    }

    fn push_front(&mut self, message: StoredMessage) {
        self.low -= SEQ_STEP;
        self.by_id.insert(message.dto.id.clone(), self.low);
        let revision = self.next_revision();
        self.rows.push_front(Row {
            seq: self.low,
            revision,
            message,
        });
    }

    fn set_at(&mut self, index: usize, message: StoredMessage) {
        let revision = self.next_revision();
        let row = &mut self.rows[index];
        if row.message.dto.id != message.dto.id {
            self.by_id.remove(&row.message.dto.id);
            self.by_id.insert(message.dto.id.clone(), row.seq);
        }
        row.message = message;
        row.revision = revision;
    }

    fn remove_at(&mut self, index: usize) {
        if let Some(row) = self.rows.remove(index) {
            self.by_id.remove(&row.message.dto.id);
        }
    }

    // --- The updaters, from messageCacheUpdaters.ts. Each returns whether anything changed. ---

    /// `prependMessageToInfinite`.
    pub fn prepend(&mut self, message: StoredMessage) -> bool {
        // Never insert into a detached window: the newest row loaded isn't the newest there is.
        if !self.loaded
            || self.detached
            || self.by_id.contains_key(&message.dto.id)
            || self.is_tombstoned(&message.dto.id)
        {
            return false;
        }
        self.push_back(message);
        true
    }

    /// `updateMessageInInfinite`. A row that was sent keeps its `client_id`.
    pub fn update(&mut self, dto: MessageDto, client_id: Option<String>) -> bool {
        let Some(index) = self.index_of(&dto.id) else {
            return false;
        };
        let client_id = client_id.or_else(|| self.rows[index].message.client_id.clone());
        self.set_at(
            index,
            StoredMessage {
                dto,
                client_id,
                send: SendStatus::Settled,
            },
        );
        true
    }

    /// `deleteMessageFromInfinite`. The id is remembered either way, so the message can't come
    /// back if it arrives after its delete.
    pub fn delete(&mut self, id: &str) -> bool {
        if !self.is_tombstoned(id) {
            if self.tombstones.len() == TOMBSTONES {
                self.tombstones.pop_front();
            }
            self.tombstones.push_back(id.to_owned());
        }
        let Some(index) = self.index_of(id) else {
            return false;
        };
        self.remove_at(index);
        true
    }

    /// `prependOrReconcileOptimistic`: an echo merges into a row with its id, replaces the
    /// optimistic row with its nonce, or else is a new row. Never swaps a row out and back, so no
    /// list can show both.
    pub fn reconcile_echo(&mut self, dto: MessageDto) -> bool {
        if !self.loaded || self.detached || self.is_tombstoned(&dto.id) {
            return false;
        }
        if let Some(index) = self.index_of(&dto.id) {
            let existing = &self.rows[index].message;
            let client_nonce = dto
                .client_nonce
                .clone()
                .or(existing.dto.client_nonce.clone());
            let merged = StoredMessage {
                dto: MessageDto {
                    client_nonce,
                    ..dto
                },
                client_id: existing.client_id.clone(),
                send: existing.send.clone(),
            };
            self.set_at(index, merged);
            return true;
        }
        let optimistic = dto.client_nonce.as_ref().and_then(|nonce| {
            self.rows.iter().position(|row| {
                row.message.is_optimistic()
                    && row.message.dto.author_id == dto.author_id
                    && row.message.dto.client_nonce.as_ref() == Some(nonce)
            })
        });
        match optimistic {
            Some(index) => {
                let client_id = self.rows[index].message.client_id.clone();
                self.set_at(
                    index,
                    StoredMessage {
                        dto,
                        client_id,
                        send: SendStatus::Settled,
                    },
                );
            }
            None => self.push_back(StoredMessage::from_server(dto)),
        }
        true
    }

    fn is_tombstoned(&self, id: &str) -> bool {
        self.tombstones.iter().any(|gone| gone == id)
    }

    /// The row still waiting under `client_id`. A row that settled keeps its `client_id`, so this
    /// is what stops a late ack from touching a real message.
    fn placeholder_index(&self, client_id: &str) -> Option<usize> {
        self.index_of(client_id)
            .filter(|index| self.rows[*index].message.is_placeholder_for(client_id))
    }

    /// `replaceOptimisticMessage`.
    pub fn replace_optimistic(&mut self, client_id: &str, real: StoredMessage) -> bool {
        let Some(index) = self.placeholder_index(client_id) else {
            return false;
        };
        self.set_at(index, real);
        true
    }

    /// `removeOptimisticMessage`.
    pub fn remove_optimistic(&mut self, client_id: &str) -> bool {
        let Some(index) = self.placeholder_index(client_id) else {
            return false;
        };
        self.remove_at(index);
        true
    }

    fn set_send(&mut self, client_id: &str, send: SendStatus) -> bool {
        let Some(index) = self.placeholder_index(client_id) else {
            return false;
        };
        let mut message = self.rows[index].message.clone();
        message.send = send;
        self.set_at(index, message);
        true
    }

    /// `markOptimisticFailed`.
    pub fn mark_failed(&mut self, client_id: &str, error: ErrorView) -> bool {
        self.set_send(client_id, SendStatus::Failed(error))
    }

    /// `markOptimisticPending`.
    pub fn mark_pending(&mut self, client_id: &str) -> bool {
        self.set_send(client_id, SendStatus::Pending)
    }

    // --- Field updates from socket events ---

    /// Changes one row, if it's loaded.
    pub fn edit(&mut self, id: &str, change: impl FnOnce(&mut MessageDto)) -> bool {
        let Some(index) = self.index_of(id) else {
            return false;
        };
        let revision = self.next_revision();
        let row = &mut self.rows[index];
        change(&mut row.message.dto);
        row.revision = revision;
        true
    }

    /// Asks for a row to be sent again, when something it's drawn from changed.
    pub fn touch_author(&mut self, author_id: &str) {
        for row in &mut self.rows {
            let dto = &row.message.dto;
            let reply_author = dto
                .reply_to
                .as_ref()
                .and_then(|reply| reply.author_id.as_deref());
            if dto.author_id.as_deref() == Some(author_id) || reply_author == Some(author_id) {
                self.revisions += 1;
                row.revision = self.revisions;
            }
        }
    }

    // --- Loading ---

    pub fn begin_fetch(&mut self) -> u64 {
        self.fetching += 1;
        self.epoch
    }

    /// Ends a fetch, and applies again what events did while it ran: its response may predate them.
    pub fn end_fetch(&mut self) {
        self.fetching = self.fetching.saturating_sub(1);
        let touches = if self.fetching == 0 {
            std::mem::take(&mut self.touched)
        } else {
            self.touched.clone()
        };
        for touch in touches {
            match touch {
                Touch::Upsert(dto) => {
                    if self.by_id.contains_key(&dto.id) {
                        self.update_keeping_send(*dto);
                    } else {
                        self.reconcile_echo(*dto);
                    }
                }
                Touch::Update(dto) => self.update_keeping_send(*dto),
                Touch::Delete(id) => {
                    self.delete(&id);
                }
            }
        }
    }

    fn update_keeping_send(&mut self, dto: MessageDto) {
        if let Some(index) = self.index_of(&dto.id) {
            let message = &self.rows[index].message;
            let merged = StoredMessage {
                client_id: message.client_id.clone(),
                send: message.send.clone(),
                dto,
            };
            self.set_at(index, merged);
        }
    }

    /// Records an event's result, if a fetch is running.
    pub fn note_upsert(&mut self, id: &str, dto: Option<MessageDto>) {
        if self.fetching == 0 {
            return;
        }
        let dto = dto.or_else(|| self.find(id).map(|message| message.dto.clone()));
        if let Some(dto) = dto {
            self.touched.push(Touch::Upsert(Box::new(dto)));
        }
    }

    /// Records a change to a message that may be outside the rows, if a fetch is running.
    pub fn note_update(&mut self, id: &str, dto: Option<MessageDto>) {
        if self.fetching == 0 {
            return;
        }
        let dto = dto.or_else(|| self.find(id).map(|message| message.dto.clone()));
        if let Some(dto) = dto {
            self.touched.push(Touch::Update(Box::new(dto)));
        }
    }

    pub fn note_delete(&mut self, id: &str) {
        if self.fetching > 0 {
            self.touched.push(Touch::Delete(id.to_owned()));
        }
    }

    /// Replaces everything with the live edge. Rows still being sent stay, after the page.
    pub fn apply_live_page(&mut self, newest_first: Vec<MessageDto>, token: Option<String>) {
        self.replace_rows(newest_first, token, false);
    }

    /// Replaces everything with the rows around a message. `more_newer` is whether the server has
    /// rows past them, which detaches the window.
    pub fn apply_around_page(
        &mut self,
        newest_first: Vec<MessageDto>,
        older_token: Option<String>,
        more_newer: bool,
    ) {
        self.replace_rows(newest_first, older_token, more_newer);
    }

    fn replace_rows(
        &mut self,
        newest_first: Vec<MessageDto>,
        token: Option<String>,
        detached: bool,
    ) {
        let unsettled: Vec<StoredMessage> = self
            .rows
            .drain(..)
            .filter(|row| row.message.is_optimistic())
            .map(|row| row.message)
            .collect();
        self.by_id.clear();
        self.epoch += 1;
        self.loaded = true;
        self.detached = detached;
        self.reset_deferred = false;
        self.stale = false;
        self.at_start = token.is_none();
        self.older_token = token;
        for dto in once_each(newest_first).into_iter().rev() {
            self.push_back(StoredMessage::from_server(dto));
        }
        for message in unsettled {
            if !self.by_id.contains_key(&message.dto.id) {
                self.push_back(message);
            }
        }
        self.send_reset = self.shown.is_some();
    }

    /// Adds a page of older rows, newest first as a page holds them. Past the cap the newest rows
    /// go, which is what detaches a window, as on the web (#404).
    pub fn apply_older_page(&mut self, newest_first: Vec<MessageDto>, token: Option<String>) {
        self.at_start = token.is_none();
        self.older_token = token;
        for dto in newest_first {
            if self.by_id.contains_key(&dto.id) {
                self.update_keeping_send(dto);
            } else {
                self.push_front(StoredMessage::from_server(dto));
            }
        }
        self.grew_older_while_held |= self.held.is_some();
        self.evict_newest();
    }

    /// Where a page toward the live edge starts: the newest row the server knows about. `None` when
    /// the window is at the live edge already, or has nothing to start from.
    pub fn newer_cursor(&self) -> Option<String> {
        if !self.loaded || !self.detached {
            return None;
        }
        self.rows
            .iter()
            .rev()
            .find(|row| !row.message.is_placeholder())
            .map(|row| row.message.dto.id.clone())
    }

    /// Adds a page of newer rows, newest first as a page holds them. With no more after it, the
    /// window has reached the live edge. Past the cap the oldest rows go. Rows still being sent stay
    /// last, in the gap before them: false when that has run out, and only a reset can fix it.
    pub fn apply_newer_page(&mut self, newest_first: Vec<MessageDto>, more: bool) -> bool {
        let mut run = Vec::new();
        for dto in once_each(newest_first).into_iter().rev() {
            if self.by_id.contains_key(&dto.id) {
                self.update_keeping_send(dto);
            } else {
                run.push(dto);
            }
        }
        let first_unsettled = self.rows.iter().position(|row| row.message.is_optimistic());
        let (after, before) = match first_unsettled {
            Some(index) => (
                index.checked_sub(1).map(|index| self.rows[index].seq),
                Some(self.rows[index].seq),
            ),
            None => (self.rows.back().map(|row| row.seq), None),
        };
        if !self.slot_between(after, before, run) {
            return false;
        }
        if !more {
            self.detached = false;
        }
        self.evict_oldest();
        true
    }

    pub fn holds_id(&self, id: &str) -> bool {
        self.by_id.contains_key(id)
    }

    /// Thread replies come oldest first, and the token walks forward, so a thread is read to its
    /// end and has nothing older to load. Pass every reply loaded so far, oldest first.
    pub fn apply_thread(&mut self, oldest_first: Vec<MessageDto>) {
        self.apply_live_page(oldest_first.into_iter().rev().collect(), None);
    }

    /// Takes the rows an older page should follow: `(token, or None at the start)`.
    pub fn older_cursor(&self) -> Option<Option<String>> {
        if self.at_start || !self.loaded {
            return None;
        }
        Some(self.older_token.clone())
    }

    /// Merges what the server says after a gap, keeping each surviving row's `seq`. `server` runs
    /// newest first from the live edge. When `reaches_oldest` it covers every loaded row, so a row
    /// it doesn't have was deleted during the gap.
    pub fn apply_resync(&mut self, server: Vec<MessageDto>, reaches_oldest: bool) -> ResyncOutcome {
        let server = once_each(server);
        let known: HashSet<&str> = server.iter().map(|dto| dto.id.as_str()).collect();
        let connects = self
            .rows
            .iter()
            .any(|row| known.contains(row.message.dto.id.as_str()));
        let has_settled = self.oldest_settled_id().is_some();
        if has_settled && !connects {
            return ResyncOutcome::NeedsReset;
        }

        // Rows the server no longer has, within the span its answer covers.
        let oldest_covered = if reaches_oldest {
            Some(i64::MIN)
        } else {
            server
                .iter()
                .rev()
                .find_map(|dto| self.by_id.get(dto.id.as_str()).copied())
        };
        if let Some(from) = oldest_covered {
            let gone: Vec<String> = self
                .rows
                .iter()
                .filter(|row| {
                    row.seq >= from
                        && !row.message.is_placeholder()
                        && !known.contains(row.message.dto.id.as_str())
                })
                .map(|row| row.message.dto.id.clone())
                .collect();
            for id in gone {
                self.delete(&id);
            }
        }

        // Walk oldest to newest, updating known rows and gathering runs of missed ones.
        let mut run: Vec<MessageDto> = Vec::new();
        let mut before: Option<i64> = None;
        let mut oldest_first = server;
        oldest_first.reverse();
        for dto in oldest_first {
            if let Some(seq) = self.by_id.get(&dto.id).copied() {
                if !self.slot_between(before, Some(seq), std::mem::take(&mut run)) {
                    return ResyncOutcome::NeedsReset;
                }
                before = Some(seq);
                if self.differs(&dto) {
                    self.update_keeping_send(dto);
                }
            } else {
                run.push(dto);
            }
        }
        // What's left is newer than every known row, but goes before rows still being sent.
        let first_unsettled = self
            .rows
            .iter()
            .find(|row| Some(row.seq) > before && row.message.is_placeholder())
            .map(|row| row.seq);
        if !self.slot_between(before, first_unsettled, run) {
            return ResyncOutcome::NeedsReset;
        }
        self.stale = false;
        self.evict_oldest();
        ResyncOutcome::Merged
    }

    fn differs(&self, dto: &MessageDto) -> bool {
        self.find(&dto.id).is_none_or(|message| {
            serde_json::to_value(&message.dto).ok() != serde_json::to_value(dto).ok()
        })
    }

    /// Places rows between two seqs, either of which may be open. False if there's no room.
    fn slot_between(
        &mut self,
        after: Option<i64>,
        before: Option<i64>,
        run: Vec<MessageDto>,
    ) -> bool {
        if run.is_empty() {
            return true;
        }
        let count = run.len() as i64;
        let (start, step) = match (after, before) {
            (_, None) => {
                // Past the end: ordinary new rows.
                for dto in run {
                    self.push_back(StoredMessage::from_server(dto));
                }
                return true;
            }
            (None, Some(before)) => {
                self.low = self.low.min(before) - SEQ_STEP * (count + 1);
                (self.low, SEQ_STEP)
            }
            (Some(after), Some(before)) => {
                let step = (before - after) / (count + 1);
                if step < 1 {
                    return false;
                }
                (after, step)
            }
        };
        let first = start + step;
        let at = self.rows.partition_point(|row| row.seq < first);
        for (offset, dto) in run.into_iter().enumerate() {
            let seq = start + step * (offset as i64 + 1);
            self.by_id.insert(dto.id.clone(), seq);
            let revision = self.next_revision();
            self.rows.insert(
                at + offset,
                Row {
                    seq,
                    revision,
                    message: StoredMessage::from_server(dto),
                },
            );
        }
        true
    }

    // --- Eviction ---

    /// While a selection is held, core keeps every row: the span stays and so does everything
    /// around it. Eviction catches up when the hold is released.
    pub fn hold(&mut self, span: Option<(i64, i64)>) {
        self.held = span;
        if span.is_none() {
            if std::mem::take(&mut self.grew_older_while_held) {
                self.evict_newest();
            } else {
                self.evict_oldest();
            }
        }
    }

    pub fn is_held(&self) -> bool {
        self.held.is_some()
    }

    fn over_cap(&self) -> Option<usize> {
        if self.held.is_some() || self.rows.len() <= MAX_ROWS {
            return None;
        }
        Some(self.rows.len() - MAX_ROWS)
    }

    /// After older rows arrive, drop the newest. The window no longer holds the live edge.
    fn evict_newest(&mut self) {
        let Some(excess) = self.over_cap() else {
            return;
        };
        for _ in 0..excess {
            if let Some(row) = self.rows.pop_back() {
                self.by_id.remove(&row.message.dto.id);
            }
        }
        self.detached = true;
    }

    /// After a live row arrives, drop the oldest. The oldest remaining row becomes the cursor:
    /// the server's token is a message id.
    pub fn evict_oldest(&mut self) {
        let Some(excess) = self.over_cap() else {
            return;
        };
        for _ in 0..excess {
            if let Some(row) = self.rows.pop_front() {
                self.by_id.remove(&row.message.dto.id);
            }
        }
        self.at_start = false;
        self.older_token = self.rows.front().map(|row| row.message.dto.id.clone());
    }

    // --- What the UI sees ---

    /// The UI starts following this window, from a full list of its rows.
    pub fn show(&mut self) {
        self.send_reset = true;
        if self.shown.is_none() {
            self.shown = Some(Vec::new());
        }
    }

    /// Nothing new lands here until a reset: what happens when a gap can't be bridged during a hold.
    pub fn mark_detached(&mut self) {
        self.detached = true;
    }

    pub fn hide(&mut self) {
        self.shown = None;
        self.send_reset = false;
    }

    pub fn is_shown(&self) -> bool {
        self.shown.is_some()
    }

    /// The smallest ops that take the UI from what it has to what's here. However many changes a
    /// batch made, a burst to one row is one `Replace`, and rows added and removed again are nothing.
    pub fn take_ops(&mut self, mut project: impl FnMut(&Row) -> MessageRow) -> Vec<ListOp> {
        let Some(shown) = self.shown.as_mut() else {
            return Vec::new();
        };
        if !self.loaded {
            return Vec::new();
        }
        let current: Vec<(i64, u64)> = self
            .rows
            .iter()
            .map(|row| (row.seq, row.revision))
            .collect();
        if self.send_reset {
            self.send_reset = false;
            *shown = current;
            return vec![ListOp::Reset {
                rows: self.rows.iter().map(&mut project).collect(),
            }];
        }
        if *shown == current {
            return Vec::new();
        }
        let mut ops = Vec::new();
        let (mut old, mut new) = (0, 0);
        while old < shown.len() || new < current.len() {
            if new >= current.len() || (old < shown.len() && shown[old].0 < current[new].0) {
                let start = old;
                while old < shown.len() && (new >= current.len() || shown[old].0 < current[new].0) {
                    old += 1;
                }
                ops.push(ListOp::Remove {
                    index: new as u32,
                    count: (old - start) as u32,
                });
            } else if old >= shown.len() || current[new].0 < shown[old].0 {
                let start = new;
                while new < current.len() && (old >= shown.len() || current[new].0 < shown[old].0) {
                    new += 1;
                }
                ops.push(ListOp::Insert {
                    index: start as u32,
                    rows: self.rows.range(start..new).map(&mut project).collect(),
                });
            } else if shown[old].1 == current[new].1 {
                old += 1;
                new += 1;
            } else {
                let start = new;
                while old < shown.len()
                    && new < current.len()
                    && shown[old].0 == current[new].0
                    && shown[old].1 != current[new].1
                {
                    old += 1;
                    new += 1;
                }
                ops.push(ListOp::Replace {
                    index: start as u32,
                    rows: self.rows.range(start..new).map(&mut project).collect(),
                });
            }
        }
        *shown = current;
        ops
    }
}

/// A page with each message once, where it first appears. A server that repeats a row in a page
/// would otherwise leave a second row the id index doesn't know, which no delete could remove.
fn once_each(rows: Vec<MessageDto>) -> Vec<MessageDto> {
    let mut seen = HashSet::new();
    rows.into_iter()
        .filter(|dto| seen.insert(dto.id.clone()))
        .collect()
}

pub fn span_input(span: &SpanDto) -> SpanInput {
    SpanInput {
        kind: span.type_.as_str().into_owned(),
        text: span.text.clone(),
        user_id: span.user_id.clone(),
        special_kind: span.special_kind.clone(),
        community_id: span.community_id.clone(),
        alias_id: span.alias_id.clone(),
        channel_id: span.channel_id.clone(),
        emoji_id: span.emoji_id.clone(),
        style: TextStyle {
            bold: span.bold.unwrap_or(false),
            italic: span.italic.unwrap_or(false),
            strikethrough: span.strikethrough.unwrap_or(false),
            code: span.code.unwrap_or(false),
        },
    }
}

fn attachment_kind(mime_type: &str) -> AttachmentKind {
    match mime_type.split('/').next().unwrap_or_default() {
        "image" => AttachmentKind::Image,
        "video" => AttachmentKind::Video,
        "audio" => AttachmentKind::Audio,
        "application" | "text" => AttachmentKind::Document,
        _ => AttachmentKind::Other,
    }
}

/// The prefix the web gives a community emoji's reaction: `custom:{emojiId}`.
pub const CUSTOM_REACTION_PREFIX: &str = "custom:";

/// The community emoji a reaction names, if it names one.
pub fn custom_emoji_id(emoji: &str) -> Option<String> {
    emoji
        .strip_prefix(CUSTOM_REACTION_PREFIX)
        .filter(|id| !id.is_empty())
        .map(str::to_owned)
}

fn reaction_view(reaction: &ReactionDto, me_id: &str) -> ReactionView {
    ReactionView {
        emoji: reaction.emoji.clone(),
        count: reaction.user_ids.len() as u32,
        me: reaction.user_ids.iter().any(|id| id == me_id),
        user_ids: reaction.user_ids.clone(),
        custom_emoji_id: custom_emoji_id(&reaction.emoji),
    }
}

/// A row as a UI renders it. A removed message shows what the server sent of it: the server blanks
/// it for readers who may not see removed messages (contract rule 5), and sends it whole to
/// moderators, who keep seeing what they removed.
pub fn project(
    row: &Row,
    me_id: &str,
    author: &mut dyn FnMut(&str) -> Option<UserView>,
    uploads: &std::collections::HashMap<String, Vec<crate::model::UploadView>>,
) -> MessageRow {
    let message = &row.message;
    let dto = &message.dto;
    let removed = dto.deleted_at.is_some();
    let spans: Vec<SpanInput> = dto.spans.iter().map(span_input).collect();
    let (display, segs) = layout_spans(&spans);
    let mut view_of = |id: &Option<String>| {
        id.as_deref()
            .map(|id| {
                author(id).unwrap_or_else(|| UserView {
                    id: id.to_owned(),
                    ..UserView::default()
                })
            })
            .unwrap_or_default()
    };
    let reply_to = dto.reply_to.as_ref().map(|reply| {
        let deleted = reply.deleted_at.is_some();
        ReplyToView {
            message_id: reply.id.clone(),
            author: view_of(&reply.author_id),
            text: if deleted {
                String::new()
            } else {
                reply
                    .spans
                    .iter()
                    .filter_map(|span| span.text.as_deref())
                    .collect()
            },
            deleted,
        }
    });
    let author = view_of(&dto.author_id);
    let removed_by = dto.deleted_by.is_some().then(|| view_of(&dto.deleted_by));
    let pinned_by = dto.pinned_by.is_some().then(|| view_of(&dto.pinned_by));
    let link_previews = dto
        .link_previews
        .iter()
        .flatten()
        .map(|preview| LinkPreviewView {
            url: preview.url.clone(),
            title: preview.title.clone(),
            description: preview.description.clone(),
            image_url: preview.image_url.clone(),
            site_name: preview.site_name.clone(),
            favicon_url: preview.favicon_url.clone(),
            author_name: preview.author_name.clone(),
        })
        .collect();
    let webhook = dto.webhook.as_ref().map(|webhook| WebhookView {
        id: webhook.id.clone(),
        name: webhook.name.clone(),
        avatar_url: webhook.avatar_url.clone(),
    });
    MessageRow {
        seq: row.seq,
        id: (!message.is_placeholder()).then(|| dto.id.clone()),
        client_nonce: dto.client_nonce.clone(),
        author,
        sent_at_ms: dto.sent_at.timestamp_millis(),
        edited: dto.edited_at.is_some(),
        mine: !me_id.is_empty() && dto.author_id.as_deref() == Some(me_id),
        edit_pending: false,
        removed,
        removed_by: removed_by.filter(|_| removed),
        removed_reason: dto.deleted_by_reason.clone().filter(|_| removed),
        display,
        segs,
        attachments: dto
            .attachments
            .iter()
            .map(|file| AttachmentView {
                file_id: file.id.clone(),
                filename: file.filename.clone(),
                mime_type: file.mime_type.clone(),
                size_bytes: file.size.max(0) as u64,
                kind: attachment_kind(&file.mime_type),
                has_thumbnail: file.has_thumbnail,
                width: None,
                height: None,
            })
            .collect(),
        reactions: dto
            .reactions
            .iter()
            .map(|reaction| reaction_view(reaction, me_id))
            .collect(),
        reply_count: dto.reply_count.max(0) as u32,
        last_reply_at_ms: dto.last_reply_at.map(|at| at.timestamp_millis()),
        reply_to,
        link_previews,
        pinned: dto.pinned,
        pinned_by: pinned_by.filter(|_| dto.pinned),
        pinned_at_ms: dto.pinned_at.map(|at| at.timestamp_millis()),
        webhook,
        send_state: match &message.send {
            SendStatus::Settled => SendState::Sent,
            SendStatus::Pending => SendState::Pending,
            SendStatus::Failed(error) => SendState::Failed {
                error: error.clone(),
            },
        },
        pending_attachments: dto
            .pending_attachments
            .map_or(0, |count| count.max(0) as u32),
        uploads: message
            .client_id
            .as_ref()
            .and_then(|client_id| uploads.get(client_id))
            .cloned()
            .unwrap_or_default(),
        revision: row.revision,
    }
}

#[cfg(test)]
#[path = "store_tests.rs"]
mod tests;
