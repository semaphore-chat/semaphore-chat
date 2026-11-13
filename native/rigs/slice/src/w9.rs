//! W9's conditions, `wait core w9 …` / `expect core w9 …`, for the U9 routes and flows (WU). Hub file from the
//! UI freeze: the words parse here and `Rig::w9_holds` answers them; WU adds its variants.
//! The generic element checks are W5's (`wait core w5 enabled|disabled|reason|label <id> ..`).

use anyhow::{Result, bail};

/// W9's conditions. None until WU adds them.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum W9 {}

/// The words after `w9`.
pub(crate) fn parse(words: &[&str]) -> Result<W9> {
    bail!("unknown w9 condition: {}", words.join(" "))
}

impl super::Rig {
    pub(crate) fn w9_holds(&mut self, condition: &W9) -> Result<bool> {
        match *condition {}
    }
}
