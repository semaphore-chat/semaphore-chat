//! The window's own rules, below `Core`: what each updater leaves in the rows, the ops a UI is
//! sent, and malformed or out-of-order input. `tests/client.rs` covers the same code end to end.
//!
//! Ids are `m000`, `m001`, ...: the server's order is their number.

use super::*;
use serde_json::json;

fn id(n: u32) -> String {
    format!("m{n:03}")
}

fn dto(n: u32) -> MessageDto {
    named(&id(n), &id(n))
}

fn named(id: &str, text: &str) -> MessageDto {
    serde_json::from_value(json!({
        "id": id,
        "channelId": "c",
        "authorId": "u",
        "spans": [{ "type": "PLAINTEXT", "text": text }],
        "attachments": [],
        "reactions": [],
        "pinned": false,
        "replyCount": 0,
        "sentAt": "2026-09-22T18:00:00.000Z",
    }))
    .unwrap()
}

/// A page as the server sends one: newest first.
fn page(newest_first: &[u32]) -> Vec<MessageDto> {
    newest_first.iter().copied().map(dto).collect()
}

/// A loaded window at the live edge holding `oldest..=newest`.
fn window(oldest: u32, newest: u32) -> Window {
    let mut window = Window::unloaded();
    window.apply_live_page(
        page(&(oldest..=newest).rev().collect::<Vec<_>>()),
        Some(id(oldest)),
    );
    window
}

fn ids(window: &Window) -> Vec<String> {
    window
        .rows()
        .map(|row| row.message.dto.id.clone())
        .collect()
}

fn texts(window: &Window) -> Vec<String> {
    window
        .rows()
        .map(|row| match row.message.dto.spans.first() {
            Some(span) => span.text.clone().unwrap_or_default(),
            None => String::new(),
        })
        .collect()
}

/// What must hold after anything: seqs strictly rising, every row indexed once under its seq.
fn assert_consistent(window: &Window) {
    let seqs: Vec<i64> = window.rows().map(|row| row.seq).collect();
    assert!(
        seqs.windows(2).all(|pair| pair[0] < pair[1]),
        "seqs out of order: {seqs:?}"
    );
    assert_eq!(
        window.by_id.len(),
        window.rows.len(),
        "index and rows disagree: {:?}",
        ids(window)
    );
    for row in window.rows() {
        assert_eq!(
            window.by_id.get(&row.message.dto.id),
            Some(&row.seq),
            "{} is not indexed under its seq",
            row.message.dto.id
        );
    }
}

/// Settled rows in the server's order.
fn assert_in_server_order(window: &Window) {
    let settled: Vec<String> = window
        .rows()
        .filter(|row| !row.message.is_placeholder())
        .map(|row| row.message.dto.id.clone())
        .collect();
    let mut sorted = settled.clone();
    sorted.sort();
    assert_eq!(settled, sorted);
}

fn project_row(row: &Row) -> MessageRow {
    project(row, "me", &mut |_| None, &HashMap::new())
}

/// The list a UI holds, kept up to date only through the ops it is sent.
#[derive(Default)]
struct Ui(Vec<MessageRow>);

impl Ui {
    fn sync(&mut self, window: &mut Window) {
        for op in window.take_ops(project_row) {
            match op {
                ListOp::Reset { rows } => self.0 = rows,
                ListOp::Insert { index, rows } => {
                    let at = index as usize;
                    assert!(at <= self.0.len(), "insert past the end");
                    self.0.splice(at..at, rows);
                }
                ListOp::Remove { index, count } => {
                    let (at, count) = (index as usize, count as usize);
                    assert!(count > 0, "an empty remove");
                    assert!(at + count <= self.0.len(), "remove past the end");
                    self.0.drain(at..at + count);
                }
                ListOp::Replace { index, rows } => {
                    let at = index as usize;
                    assert!(!rows.is_empty(), "an empty replace");
                    assert!(at + rows.len() <= self.0.len(), "replace past the end");
                    for (offset, row) in rows.into_iter().enumerate() {
                        self.0[at + offset] = row;
                    }
                }
            }
        }
        let shown: Vec<(i64, u64, Option<String>)> = self
            .0
            .iter()
            .map(|row| (row.seq, row.revision, row.id.clone()))
            .collect();
        let wanted: Vec<(i64, u64, Option<String>)> = window
            .rows()
            .map(project_row)
            .map(|row| (row.seq, row.revision, row.id))
            .collect();
        assert_eq!(shown, wanted, "the UI's list drifted from the window");
    }
}

// --- Paging ---

#[test]
fn older_pages_go_on_top_and_newer_pages_reattach_a_detached_window() {
    let mut window = Window::unloaded();
    window.apply_around_page(page(&[12, 11, 10]), Some(id(10)), true);
    assert!(window.is_detached_from_live_edge());
    assert_eq!(window.newer_cursor(), Some(id(12)));

    window.apply_older_page(page(&[9, 8]), Some(id(8)));
    assert_eq!(window.older_cursor(), Some(Some(id(8))));
    assert!(window.apply_newer_page(page(&[14, 13]), true));
    assert!(window.is_detached_from_live_edge());
    assert!(window.apply_newer_page(page(&[15]), false));

    assert!(!window.is_detached_from_live_edge());
    assert_eq!(window.newer_cursor(), None);
    assert_eq!(ids(&window), (8..=15).map(id).collect::<Vec<_>>());
    assert_consistent(&window);
}

#[test]
fn a_last_older_page_marks_the_start_and_there_is_nothing_more_to_ask_for() {
    let mut window = window(5, 9);
    window.apply_older_page(page(&[4, 3]), None);
    assert_eq!(window.older_cursor(), None);
    // An empty last page too.
    let mut window = self::window(5, 9);
    window.apply_older_page(Vec::new(), None);
    assert_eq!(window.older_cursor(), None);
    assert_eq!(ids(&window), (5..=9).map(id).collect::<Vec<_>>());
}

#[test]
fn an_unloaded_window_takes_nothing_and_asks_for_nothing() {
    let mut window = Window::unloaded();
    assert!(!window.prepend(StoredMessage::from_server(dto(1))));
    assert!(!window.reconcile_echo(dto(1)));
    assert!(!window.update(dto(1), None));
    assert!(!window.delete(&id(1)));
    assert_eq!(window.older_cursor(), None);
    assert_eq!(window.newer_cursor(), None);
    assert!(window.is_empty());
}

#[test]
fn overlapping_pages_update_the_rows_they_share_instead_of_repeating_them() {
    let mut window = window(5, 9);
    let mut edited = dto(5);
    edited.spans[0].text = Some("edited".into());
    window.apply_older_page(vec![edited, dto(4)], Some(id(4)));
    assert_eq!(ids(&window), (4..=9).map(id).collect::<Vec<_>>());
    assert_eq!(texts(&window)[1], "edited");

    let mut window = Window::unloaded();
    window.apply_around_page(page(&[7, 6, 5]), Some(id(5)), true);
    assert!(window.apply_newer_page(page(&[9, 8, 7]), false));
    assert_eq!(ids(&window), (5..=9).map(id).collect::<Vec<_>>());
    assert_consistent(&window);
}

#[test]
fn a_detached_window_takes_no_live_rows() {
    let mut window = Window::unloaded();
    window.apply_around_page(page(&[3, 2, 1]), Some(id(1)), true);
    assert!(!window.prepend(StoredMessage::from_server(dto(50))));
    assert!(!window.reconcile_echo(dto(50)));
    assert_eq!(ids(&window), (1..=3).map(id).collect::<Vec<_>>());
}

// --- Events ---

#[test]
fn an_event_for_a_row_that_is_not_loaded_changes_nothing() {
    let mut window = window(1, 3);
    assert!(!window.update(dto(9), None));
    assert!(!window.delete(&id(9)));
    assert!(!window.edit(&id(9), |dto| dto.pinned = true));
    assert!(!window.replace_optimistic("pending-x", StoredMessage::from_server(dto(9))));
    assert!(!window.remove_optimistic("pending-x"));
    assert!(!window.mark_failed(
        "pending-x",
        ErrorView {
            code: "X".into(),
            message: "x".into(),
            retryable: true,
            retry_after_ms: None
        }
    ));
    assert_eq!(ids(&window), (1..=3).map(id).collect::<Vec<_>>());
}

#[test]
fn a_repeated_new_message_merges_into_its_row() {
    let mut window = window(1, 3);
    let seq = window.rows().last().unwrap().seq;
    let mut again = dto(3);
    again.spans[0].text = Some("again".into());
    assert!(window.reconcile_echo(again));
    assert_eq!(ids(&window), (1..=3).map(id).collect::<Vec<_>>());
    assert_eq!(window.rows().last().unwrap().seq, seq);
    assert_eq!(texts(&window)[2], "again");
}

#[test]
fn an_update_before_its_message_is_dropped_and_the_message_still_arrives() {
    let mut window = window(1, 3);
    assert!(!window.update(named(&id(4), "edited"), None));
    assert!(window.reconcile_echo(named(&id(4), "first")));
    assert_eq!(texts(&window).last().unwrap(), "first");
}

#[test]
fn an_event_during_a_fetch_is_applied_again_over_its_answer() {
    let mut window = window(1, 3);
    window.begin_fetch();
    window.reconcile_echo(dto(4));
    window.note_upsert(&id(4), Some(dto(4)));
    window.note_delete(&id(2));
    window.delete(&id(2));
    // The answer predates both.
    window.apply_live_page(page(&[3, 2, 1]), None);
    window.end_fetch();
    assert_eq!(ids(&window), [id(1), id(3), id(4)]);
    assert_consistent(&window);
}

#[test]
fn overlapping_fetches_both_see_what_happened_during_either() {
    let mut window = window(1, 3);
    window.begin_fetch();
    window.begin_fetch();
    window.reconcile_echo(dto(4));
    window.note_upsert(&id(4), None);
    window.apply_live_page(page(&[3, 2, 1]), None);
    window.end_fetch();
    assert_eq!(ids(&window).last(), Some(&id(4)));
    window.apply_live_page(page(&[3, 2, 1]), None);
    window.end_fetch();
    assert_eq!(ids(&window).last(), Some(&id(4)));
    // Done: nothing is replayed any more.
    window.apply_live_page(page(&[3, 2, 1]), None);
    window.end_fetch();
    assert_eq!(ids(&window).last(), Some(&id(3)));
    assert_eq!(window.fetching, 0);
}

// --- Resync ---

#[test]
fn a_resync_merges_missed_rows_and_drops_rows_the_server_no_longer_has() {
    let mut window = window(1, 5);
    let seqs: HashMap<String, i64> = window
        .rows()
        .map(|row| (row.message.dto.id.clone(), row.seq))
        .collect();
    // 3 was deleted, 6 and 7 arrived.
    assert_eq!(
        window.apply_resync(page(&[7, 6, 5, 4, 2, 1]), true),
        ResyncOutcome::Merged
    );
    assert_eq!(ids(&window), [1, 2, 4, 5, 6, 7].map(id));
    for row in window.rows() {
        if let Some(seq) = seqs.get(&row.message.dto.id) {
            assert_eq!(row.seq, *seq, "{} moved", row.message.dto.id);
        }
    }
    assert_consistent(&window);
}

#[test]
fn a_resync_that_does_not_reach_the_oldest_row_keeps_what_it_did_not_cover() {
    let mut window = window(1, 6);
    assert_eq!(
        window.apply_resync(page(&[8, 7, 6, 4]), false),
        ResyncOutcome::Merged
    );
    // 5 is gone (between 4 and 6, inside what the server sent); 1-3 weren't covered.
    assert_eq!(ids(&window), [1, 2, 3, 4, 6, 7, 8].map(id));
    assert_in_server_order(&window);
}

#[test]
fn missed_rows_older_than_every_known_one_go_first() {
    // The server's page reached past the oldest loaded row: rows older than it come first.
    let mut window = window(5, 7);
    assert_eq!(
        window.apply_resync(page(&[8, 7, 6, 5, 4, 3]), true),
        ResyncOutcome::Merged
    );
    assert_eq!(ids(&window), (3..=8).map(id).collect::<Vec<_>>());
    assert_consistent(&window);
}

#[test]
fn missed_rows_older_than_the_first_known_one_go_after_older_rows_not_covered() {
    // Audit bug 7's case: a capped resync (`reaches_oldest` false) whose oldest rows are missed
    // ones. They are newer than every loaded row the server didn't cover, so they go after them.
    // A window is contiguous, so such rows can only be older than the oldest loaded one, where
    // the first-slot placement is right: this proves that, rather than a bug.
    let mut window = window(1, 4);
    assert_eq!(
        window.apply_resync(page(&[6, 5, 4, 0]), false),
        ResyncOutcome::Merged
    );
    assert_in_server_order(&window);
    assert_consistent(&window);
}

#[test]
fn a_resync_that_shares_no_row_asks_for_a_reset() {
    let mut window = window(1, 3);
    let before = ids(&window);
    assert_eq!(
        window.apply_resync(page(&[9, 8, 7]), false),
        ResyncOutcome::NeedsReset
    );
    assert_eq!(ids(&window), before, "nothing changed on the way");
    assert_eq!(
        window.apply_resync(Vec::new(), true),
        ResyncOutcome::NeedsReset
    );
}

#[test]
fn a_gap_with_no_seqs_left_between_two_rows_asks_for_a_reset() {
    let mut window = window(0, 1);
    let mut inserted: Vec<u32> = Vec::new();
    let mut outcome = ResyncOutcome::Merged;
    // Each round slots one row just after the oldest, halving the room there.
    for round in 0..64 {
        let fresh = 1000 - round;
        // Newest first: 1, the rows slotted so far (newest to oldest), the fresh one, then 0. The
        // fresh row goes between 0 and the last one slotted. Positions, not numbers, order these.
        let mut server = vec![1];
        server.extend(inserted.iter().rev().copied());
        server.push(fresh);
        server.push(0);
        outcome = window.apply_resync(server.iter().map(|n| dto(*n)).collect(), true);
        if outcome == ResyncOutcome::NeedsReset {
            break;
        }
        inserted.insert(0, fresh);
        assert_consistent(&window);
    }
    assert_eq!(outcome, ResyncOutcome::NeedsReset);
    assert!(inserted.len() >= 19, "only {} fitted", inserted.len());
}

// --- What a UI is sent ---

#[test]
fn ops_take_a_ui_from_what_it_has_to_what_is_there() {
    let mut window = window(1, 5);
    let mut ui = Ui::default();
    window.show();
    ui.sync(&mut window);
    assert_eq!(ui.0.len(), 5);

    // A removal, an insert at both ends, and two edits in one batch.
    window.delete(&id(3));
    window.apply_older_page(page(&[0]), Some(id(0)));
    window.reconcile_echo(dto(6));
    window.edit(&id(1), |dto| dto.pinned = true);
    window.edit(&id(5), |dto| dto.pinned = true);
    ui.sync(&mut window);

    // Nothing changed: nothing is sent.
    assert!(window.take_ops(project_row).is_empty());
}

#[test]
fn a_row_added_and_removed_in_one_batch_is_no_op() {
    let mut window = window(1, 3);
    let mut ui = Ui::default();
    window.show();
    ui.sync(&mut window);
    window.reconcile_echo(dto(4));
    window.delete(&id(4));
    assert!(window.take_ops(project_row).is_empty());
}

#[test]
fn a_hidden_window_sends_nothing_and_shows_again_from_a_reset() {
    let mut window = window(1, 3);
    assert!(window.take_ops(project_row).is_empty(), "never shown");
    window.show();
    let mut ui = Ui::default();
    ui.sync(&mut window);
    window.hide();
    window.reconcile_echo(dto(4));
    assert!(window.take_ops(project_row).is_empty());
    window.show();
    let ops = window.take_ops(project_row);
    assert!(matches!(ops.as_slice(), [ListOp::Reset { rows }] if rows.len() == 4));
}

#[test]
fn replacing_the_rows_while_shown_resets_the_ui() {
    let mut window = window(1, 3);
    window.show();
    let mut ui = Ui::default();
    ui.sync(&mut window);
    window.apply_live_page(page(&[9, 8]), Some(id(8)));
    let ops = window.take_ops(project_row);
    assert!(matches!(ops.as_slice(), [ListOp::Reset { rows }] if rows.len() == 2));
}

// --- bug:seq-reuse ---

#[test]
fn a_row_slotted_where_one_was_just_deleted_reaches_the_ui() {
    // The resync deletes 2 and slots 9 between 1 and 3: 9 gets the seq 2 had. The UI must still
    // be told, or it keeps showing the deleted row.
    let mut window = window(1, 3);
    window.show();
    let mut ui = Ui::default();
    ui.sync(&mut window);

    assert_eq!(
        window.apply_resync(vec![dto(3), named("m009", "missed"), dto(1)], true),
        ResyncOutcome::Merged
    );

    ui.sync(&mut window);
    assert_eq!(ui.0[1].display, "missed");
}

// --- Properties ---

use proptest::prelude::*;
use proptest::test_runner::{Config, RngSeed};

/// A step a window can take, with ids drawn from a small pool so they collide.
#[derive(Debug, Clone)]
enum Step {
    /// A live page of these ids (sorted newest first before use).
    Live(Vec<u32>),
    /// A page of ids older than the oldest loaded, at most `.0` of them.
    Older(u8),
    /// A new message, newer than everything.
    New,
    /// A repeat of a message's echo.
    Echo(u32),
    Edit(u32),
    Delete(u32),
    /// The server's rows after a gap: a subset of the pool, possibly with a new one on top.
    Resync(Vec<u32>, bool, bool),
    Hold(bool),
    Show,
    Hide,
}

fn step() -> impl Strategy<Value = Step> {
    let ids =
        || prop::collection::btree_set(0u32..60, 0..12).prop_map(|set| set.into_iter().collect());
    prop_oneof![
        1 => ids().prop_map(Step::Live),
        2 => (0u8..5).prop_map(Step::Older),
        3 => Just(Step::New),
        1 => (0u32..80).prop_map(Step::Echo),
        2 => (0u32..80).prop_map(Step::Edit),
        2 => (0u32..80).prop_map(Step::Delete),
        1 => (ids(), any::<bool>(), any::<bool>()).prop_map(|(ids, new, reach)| Step::Resync(ids, new, reach)),
        1 => any::<bool>().prop_map(Step::Hold),
        1 => Just(Step::Show),
        1 => Just(Step::Hide),
    ]
}

struct Model {
    window: Window,
    ui: Ui,
    shown: bool,
    /// The next new message's number: above every id in the pool.
    next: u32,
}

impl Model {
    fn new() -> Self {
        Self {
            window: window(30, 39),
            ui: Ui::default(),
            shown: false,
            next: 100,
        }
    }

    fn apply(&mut self, step: Step) {
        match step {
            Step::Live(mut ids) => {
                ids.sort_unstable_by(|a, b| b.cmp(a));
                let token = ids.last().map(|oldest| id(*oldest));
                self.window.apply_live_page(page(&ids), token);
            }
            Step::Older(count) => {
                let oldest = self
                    .window
                    .rows()
                    .find_map(|row| row.message.dto.id[1..].parse::<u32>().ok())
                    .unwrap_or(0);
                let older: Vec<u32> = (oldest.saturating_sub(u32::from(count))..oldest)
                    .rev()
                    .collect();
                if self.window.older_cursor().is_some() && !older.is_empty() {
                    let token = older.last().map(|n| id(*n));
                    self.window.apply_older_page(page(&older), token);
                }
            }
            Step::New => {
                self.window.reconcile_echo(dto(self.next));
                self.window.evict_oldest();
                self.next += 1;
            }
            Step::Echo(n) => {
                if self.window.holds_id(&id(n)) {
                    self.window.reconcile_echo(dto(n));
                }
            }
            Step::Edit(n) => {
                self.window.update(named(&id(n), "edited"), None);
            }
            Step::Delete(n) => {
                self.window.delete(&id(n));
            }
            Step::Resync(mut ids, new, reaches) => {
                if new {
                    ids.push(self.next);
                    self.next += 1;
                }
                ids.sort_unstable_by(|a, b| b.cmp(a));
                // Any subset of the pool: loaded rows, rows never loaded, maybe one newer than all.
                // What doesn't connect is reset, as core does.
                if self.window.apply_resync(page(&ids), reaches) == ResyncOutcome::NeedsReset {
                    self.window
                        .apply_live_page(page(&ids), ids.last().map(|n| id(*n)));
                }
            }
            Step::Hold(on) => self.window.hold(on.then_some((i64::MIN, i64::MAX))),
            Step::Show => {
                self.window.show();
                self.shown = true;
            }
            Step::Hide => {
                self.window.hide();
                self.shown = false;
            }
        }
    }

    fn check(&mut self) {
        assert_consistent(&self.window);
        if self.shown {
            self.ui.sync(&mut self.window);
        } else {
            assert!(self.window.take_ops(project_row).is_empty());
            self.ui = Ui::default();
        }
    }
}

fn config() -> Config {
    Config {
        cases: 256,
        rng_seed: RngSeed::Fixed(0x5704_e001),
        ..Config::default()
    }
}

proptest! {
    #![proptest_config(config())]

    /// After any steps, the window is consistent, and a UI fed only the ops it was sent holds
    /// exactly the window's rows.
    #[test]
    fn any_steps_keep_the_window_consistent_and_the_ui_in_step(
        steps in prop::collection::vec(step(), 1..40),
    ) {
        let mut model = Model::new();
        for step in steps {
            model.apply(step);
            model.check();
        }
    }
}
// --- end bug:seq-reuse ---

// --- bug:duplicates ---

#[test]
fn a_page_that_repeats_a_row_holds_it_once() {
    let mut window = Window::unloaded();
    window.apply_live_page(page(&[3, 2, 2, 1, 3]), Some(id(1)));
    assert_eq!(ids(&window), [1, 2, 3].map(id));
    assert_consistent(&window);
    // Deleting it leaves nothing behind.
    window.delete(&id(2));
    assert_eq!(ids(&window), [1, 3].map(id));
    assert_consistent(&window);

    let mut window = self::window(5, 7);
    window.apply_older_page(page(&[4, 4, 3]), Some(id(3)));
    assert_eq!(ids(&window), (3..=7).map(id).collect::<Vec<_>>());
    assert_consistent(&window);

    let mut window = Window::unloaded();
    window.apply_around_page(page(&[7, 6, 5]), Some(id(5)), true);
    assert!(window.apply_newer_page(page(&[9, 9, 8]), false));
    assert_eq!(ids(&window), (5..=9).map(id).collect::<Vec<_>>());
    assert_consistent(&window);

    let mut window = self::window(1, 3);
    assert_eq!(
        window.apply_resync(page(&[5, 4, 4, 3, 2, 1]), true),
        ResyncOutcome::Merged
    );
    assert_eq!(ids(&window), (1..=5).map(id).collect::<Vec<_>>());
    assert_consistent(&window);
}

// --- end bug:duplicates ---
