//! W7's conditions and steps, for GIFs and third-party pictures (WM):
//!
//! ```text
//! wait core w7 picker open                 # open|closed: the composer's GIF picker
//! wait core w7 picker notice               # it shows the "Allow" notice (the setting is off)
//! wait core w7 picker results >= 20        # results it was given
//! wait core w7 picker query "fixture 1"    # the query its results are for
//! wait core w7 third-party on              # on|off: core's setting and the settings store's
//! wait core w7 gif shown                   # shown|blocked: the newest GIF message's picture or its Load card
//! wait core w7 sent-gif "gif-3.gif"        # the newest row is a GIF message whose URL contains this
//! expect core w7 new-requests Fixture_image == 0   # since `w7 mark`; also `>= N`
//! w7 mark                                  # remember the request counts now
//! w7 click-gif-load                        # press the newest GIF message's Load
//! ```
//!
//! The generic element checks are W5's (`wait core w5 enabled|disabled|reason|label <id> ..`).

use anyhow::{Result, anyhow, bail};
use gpui_kit::test::TestWindowExt as _;
use gpui_kit::*;
use std::cell::RefCell;
use std::collections::HashMap;

/// W7's conditions.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum W7 {
    PickerOpen(bool),
    PickerNotice,
    PickerResults(usize),
    PickerQuery(String),
    ThirdParty(bool),
    /// `gif shown|blocked`.
    Gif(bool),
    SentGif(String),
    NewRequests {
        name: String,
        at_least: bool,
        count: usize,
    },
}

/// W7's steps.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum W7Step {
    Mark,
    ClickGifLoad,
}

thread_local! {
    /// The fake server's request counts at the last `w7 mark`, by operation.
    static MARKS: RefCell<HashMap<String, usize>> = RefCell::new(HashMap::new());
}

fn number(word: &str) -> Result<usize> {
    word.parse().map_err(|_| anyhow!("not a number: {word}"))
}

fn on_off(word: &str) -> Result<bool> {
    match word {
        "on" => Ok(true),
        "off" => Ok(false),
        _ => bail!("on or off, not {word}"),
    }
}

/// The words after `w7`.
pub(crate) fn parse(words: &[&str]) -> Result<W7> {
    Ok(match words {
        ["picker", "open"] => W7::PickerOpen(true),
        ["picker", "closed"] => W7::PickerOpen(false),
        ["picker", "notice"] => W7::PickerNotice,
        ["picker", "results", ">=", count] => W7::PickerResults(number(count)?),
        ["picker", "query", query] => W7::PickerQuery((*query).into()),
        ["third-party", state] => W7::ThirdParty(on_off(state)?),
        ["gif", "shown"] => W7::Gif(true),
        ["gif", "blocked"] => W7::Gif(false),
        ["sent-gif", needle] => W7::SentGif((*needle).into()),
        ["new-requests", name, op @ (">=" | "=="), count] => W7::NewRequests {
            name: (*name).into(),
            at_least: *op == ">=",
            count: number(count)?,
        },
        _ => bail!("unknown w7 condition: {}", words.join(" ")),
    })
}

/// The words of a `w7 ..` step.
pub(crate) fn parse_step(words: &[&str]) -> Result<W7Step> {
    Ok(match words {
        ["mark"] => W7Step::Mark,
        ["click-gif-load"] => W7Step::ClickGifLoad,
        _ => bail!("unknown w7 step: {}", words.join(" ")),
    })
}

impl super::Rig {
    /// The newest GIF message's seq.
    fn newest_gif_seq(&mut self) -> Result<Option<String>> {
        let (rows, _, _) = self.rows()?;
        Ok(rows
            .iter()
            .rev()
            .find(|row| row.gif.is_some())
            .map(|row| row.seq.to_string()))
    }

    fn present(&mut self, id: String) -> Result<bool> {
        let id = ElementId::Name(id.into());
        self.driver.query(|window| window.try_find(id).is_some())
    }

    pub(crate) fn w7_holds(&mut self, condition: &W7) -> Result<bool> {
        match condition {
            W7::Gif(shown) => {
                let Some(seq) = self.newest_gif_seq()? else {
                    return Ok(false);
                };
                let id = if *shown {
                    format!("message-gif-{seq}")
                } else {
                    format!("message-gif-blocked-{seq}")
                };
                return self.present(id);
            }
            W7::SentGif(needle) => {
                let (rows, _, _) = self.rows()?;
                return Ok(rows.last().is_some_and(|row| {
                    row.gif
                        .as_ref()
                        .is_some_and(|gif| gif.url.contains(needle.as_str()))
                }));
            }
            W7::NewRequests {
                name,
                at_least,
                count,
            } => {
                let now = self.requests(name)?;
                let marked = MARKS.with(|marks| marks.borrow().get(name).copied().unwrap_or(0));
                let new = now.saturating_sub(marked);
                return Ok(if *at_least {
                    new >= *count
                } else {
                    new == *count
                });
            }
            _ => {}
        }
        let app = self.app()?.clone();
        Ok(self.driver.cx.update(|cx| {
            let root = app.read(cx);
            if let W7::ThirdParty(on) = condition {
                return root
                    .core()
                    .is_some_and(|core| core.third_party_media() == *on);
            }
            let view = root
                .pane()
                .and_then(|pane| pane.read(cx).gif_picker_view().cloned());
            match condition {
                W7::PickerOpen(open) => view.is_some() == *open,
                W7::PickerNotice => view.is_some_and(|view| view.needs_permission),
                W7::PickerResults(count) => {
                    view.is_some_and(|view| !view.needs_permission && view.results.len() >= *count)
                }
                W7::PickerQuery(query) => view.is_some_and(|view| view.query == *query),
                _ => false,
            }
        }))
    }

    pub(crate) fn w7_run(&mut self, step: &W7Step) -> Result<()> {
        match step {
            W7Step::Mark => {
                let answer = super::http(&self.server, "POST", "/__control/requests", "")?;
                let mut counts = HashMap::<String, usize>::new();
                for record in answer["requests"].as_array().into_iter().flatten() {
                    for key in ["operation", "event"] {
                        if let Some(name) = record[key].as_str() {
                            *counts.entry(name.to_owned()).or_default() += 1;
                        }
                    }
                }
                MARKS.with(|marks| *marks.borrow_mut() = counts);
                Ok(())
            }
            W7Step::ClickGifLoad => {
                self.driver.settle()?;
                let seq = self
                    .newest_gif_seq()?
                    .ok_or_else(|| anyhow!("no GIF message on screen"))?;
                let id = ElementId::Name(format!("message-gif-load-{seq}").into());
                self.driver.update(|window, cx| window.click(id, cx))
            }
        }
    }
}
