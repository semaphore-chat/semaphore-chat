//! W9V's conditions, `wait core w9v …` / `expect core w9v …`, for the voice pre-join and seen-by (WP). Hub file from the
//! UI freeze: the words parse here and `Rig::w9v_holds` answers them; WP adds its variants.
//! The generic element checks are W5's (`wait core w5 enabled|disabled|reason|label <id> ..`).
//!
//! ```text
//! wait core w9v prejoin users 2            # the pre-join's grid has exactly this many people
//! wait core w9v prejoin user "pri"         # someone with this name is in it
//! wait core w9v prejoin gone               # no pre-join on screen
//! wait core w9v join-failed shown          # shown|gone: the failed join's notice
//! wait core w9v seen "hello" "Seen by pri" # "Seen by" is under the newest row containing
//!                                          # "hello", the list's target, and reads exactly so
//! wait core w9v seen none                  # no "Seen by" line anywhere in the main list
//! ```

use anyhow::{Result, anyhow, bail};
use gpui_kit::test::TestWindowExt as _;
use gpui_kit::*;

/// Far more people than a rig's channel holds: where counting stops.
const MAX_PEOPLE: usize = 64;

/// W9V's conditions.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum W9V {
    /// `prejoin users N`.
    PreJoinUsers(usize),
    /// `prejoin user <name>`.
    PreJoinUser(String),
    /// `prejoin gone`.
    PreJoinGone,
    /// `join-failed shown|gone`.
    JoinFailed(bool),
    /// `seen <row text> <line>`.
    Seen { row: String, line: String },
    /// `seen none`.
    SeenNone,
}

/// The words after `w9v`.
pub(crate) fn parse(words: &[&str]) -> Result<W9V> {
    Ok(match words {
        ["prejoin", "users", count] => W9V::PreJoinUsers(
            count
                .parse()
                .map_err(|_| anyhow!("not a number: {count}"))?,
        ),
        ["prejoin", "user", name] => W9V::PreJoinUser((*name).into()),
        ["prejoin", "gone"] => W9V::PreJoinGone,
        ["join-failed", state @ ("shown" | "gone")] => W9V::JoinFailed(*state == "shown"),
        ["seen", "none"] => W9V::SeenNone,
        ["seen", row, line] => W9V::Seen {
            row: (*row).into(),
            line: (*line).into(),
        },
        _ => bail!("unknown w9v condition: {}", words.join(" ")),
    })
}

fn element(id: &'static str) -> ElementId {
    ElementId::Name(id.into())
}

fn user_tile(index: usize) -> ElementId {
    ElementId::Name(format!("voice-prejoin-user-{index}").into())
}

impl super::Rig {
    pub(crate) fn w9v_holds(&mut self, condition: &W9V) -> Result<bool> {
        match condition {
            W9V::PreJoinUsers(count) => {
                let count = *count;
                self.driver.query(move |window| {
                    window.try_find(element("voice-prejoin")).is_some()
                        && (count == 0 || window.try_find(user_tile(count - 1)).is_some())
                        && window.try_find(user_tile(count)).is_none()
                })
            }
            W9V::PreJoinUser(name) => {
                let name = name.clone();
                self.driver.query(move |window| {
                    (0..MAX_PEOPLE).any(|index| {
                        window.try_find(user_tile(index)).is_some_and(|element| {
                            element
                                .label()
                                .is_some_and(|label| *label == *name.as_str())
                        })
                    })
                })
            }
            W9V::PreJoinGone => self
                .driver
                .query(|window| window.try_find(element("voice-prejoin")).is_none()),
            W9V::JoinFailed(shown) => {
                let app = self.app()?.clone();
                let notice = self
                    .driver
                    .cx
                    .update(|cx| app.read(cx).prejoin_notice().is_some());
                Ok(notice == *shown)
            }
            W9V::SeenNone => self
                .driver
                .query(|window| window.try_find(element("message-seen-by")).is_none()),
            W9V::Seen { row, line } => {
                let (rows, _, _) = self.rows()?;
                let Some(newest) = rows
                    .iter()
                    .rev()
                    .find(|candidate| candidate.display.contains(row.as_str()))
                    .and_then(|row| row.id.clone())
                else {
                    return Ok(false);
                };
                let app = self.app()?.clone();
                let target = self.driver.cx.update(|cx| {
                    app.read(cx)
                        .pane()
                        .and_then(|pane| pane.read(cx).list().cloned())
                        .and_then(|list| list.read(cx).seen_by_target())
                });
                if target.as_deref() != Some(newest.as_str()) {
                    return Ok(false);
                }
                let line = line.clone();
                self.driver.query(move |window| {
                    window
                        .try_find(element("message-seen-by"))
                        .is_some_and(|element| {
                            element
                                .label()
                                .is_some_and(|label| *label == *line.as_str())
                        })
                })
            }
        }
    }
}
