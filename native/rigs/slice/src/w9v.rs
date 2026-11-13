//! W9V's conditions, `wait core w9v …` / `expect core w9v …`, for the voice pre-join and seen-by (WP). Hub file from the
//! UI freeze: the words parse here and `Rig::w9v_holds` answers them; WP adds its variants.
//! The generic element checks are W5's (`wait core w5 enabled|disabled|reason|label <id> ..`).

use anyhow::{Result, bail};

/// W9V's conditions. None until WP adds them.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum W9V {}

/// The words after `w9v`.
pub(crate) fn parse(words: &[&str]) -> Result<W9V> {
    bail!("unknown w9v condition: {}", words.join(" "))
}

impl super::Rig {
    pub(crate) fn w9v_holds(&mut self, condition: &W9V) -> Result<bool> {
        match *condition {}
    }
}
