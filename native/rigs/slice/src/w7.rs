//! W7's conditions, `wait core w7 …` / `expect core w7 …`, for GIFs and third-party pictures (WM). Hub file from the
//! UI freeze: the words parse here and `Rig::w7_holds` answers them; WM adds its variants.
//! The generic element checks are W5's (`wait core w5 enabled|disabled|reason|label <id> ..`).

use anyhow::{Result, bail};

/// W7's conditions. None until WM adds them.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum W7 {}

/// The words after `w7`.
pub(crate) fn parse(words: &[&str]) -> Result<W7> {
    bail!("unknown w7 condition: {}", words.join(" "))
}

impl super::Rig {
    pub(crate) fn w7_holds(&mut self, condition: &W7) -> Result<bool> {
        match *condition {}
    }
}
