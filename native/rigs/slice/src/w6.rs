//! W6's conditions, `wait core w6 …` / `expect core w6 …`, for the admin area (WA). Hub file from the
//! UI freeze: the words parse here and `Rig::w6_holds` answers them; WA adds its variants.
//! The generic element checks are W5's (`wait core w5 enabled|disabled|reason|label <id> ..`).

use anyhow::{Result, bail};

/// W6's conditions. None until WA adds them.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum W6 {}

/// The words after `w6`.
pub(crate) fn parse(words: &[&str]) -> Result<W6> {
    bail!("unknown w6 condition: {}", words.join(" "))
}

impl super::Rig {
    pub(crate) fn w6_holds(&mut self, condition: &W6) -> Result<bool> {
        match *condition {}
    }
}
