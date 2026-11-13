//! W9's conditions, `wait core w9 …` / `expect core w9 …`, for the U9 routes and flows (WU): the
//! connect screen's notice, what core says the register form asks for, the notifications page's
//! unread count, a DM group's header actions, the shortcut sheet and the search panel's next page.
//! The generic element checks are W5's (`wait core w5 enabled|disabled|reason|label <id> ..`).
//!
//! ```text
//! wait core w9 setup-notice shown            # the connect card's "Open in browser"
//! wait core w9 register invite               # closed|invite|open: Core::register_requirements
//! wait core w9 unread-notifications 0        # the notification list's unread count
//! wait core w9 group-actions shown           # the open DM header's overflow menu
//! wait core w9 sheet open                    # open|closed: the keyboard shortcut sheet
//! wait core w9 search-more shown             # shown|gone: the search panel's "More results"
//! wait core w9 unread cc-general 1           # the channel's unread count, as the sidebar has it
//! ```

use anyhow::{Result, bail};
use gpui_kit::test::TestWindowExt as _;
use gpui_kit::*;
use semaphore_core::model::RegistrationMode;

/// W9's conditions.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum W9 {
    /// `setup-notice shown|gone`: the connect screen's "set this server up in a browser" card.
    SetupNotice(bool),
    /// `register closed|invite|open`: what core says the register form asks for, which the
    /// sign-in card shows.
    Register(RegistrationMode),
    /// `unread-notifications N`: what `Core::notifications` counts as unread.
    UnreadNotifications(u32),
    /// `group-actions shown|gone`: the open DM header offers "Add people" and "Leave group".
    GroupActions(bool),
    /// `dm-members N`: how many people the open DM holds besides this user.
    DmMembers(usize),
    /// `sheet open|closed`: the keyboard shortcut sheet.
    Sheet(bool),
    /// `search-more shown|gone`: the search panel's "More results" button.
    SearchMore(bool),
    /// `unread CHANNEL_ID N`: the channel's unread count as the sidebar has it: at least N, and
    /// exactly none when N is 0.
    Unread(String, u32),
}

/// The words after `w9`.
pub(crate) fn parse(words: &[&str]) -> Result<W9> {
    Ok(match words {
        ["setup-notice", shown @ ("shown" | "gone")] => W9::SetupNotice(*shown == "shown"),
        ["register", mode @ ("closed" | "invite" | "open")] => W9::Register(match *mode {
            "closed" => RegistrationMode::Closed,
            "open" => RegistrationMode::Open,
            _ => RegistrationMode::InviteOnly,
        }),
        ["unread-notifications", count] => W9::UnreadNotifications(
            count
                .parse()
                .map_err(|_| anyhow::anyhow!("not a number: {count}"))?,
        ),
        ["group-actions", shown @ ("shown" | "gone")] => W9::GroupActions(*shown == "shown"),
        ["dm-members", count] => W9::DmMembers(
            count
                .parse()
                .map_err(|_| anyhow::anyhow!("not a number: {count}"))?,
        ),
        ["sheet", state @ ("open" | "closed")] => W9::Sheet(*state == "open"),
        ["search-more", shown @ ("shown" | "gone")] => W9::SearchMore(*shown == "shown"),
        ["unread", id, count] => W9::Unread(
            (*id).to_owned(),
            count
                .parse()
                .map_err(|_| anyhow::anyhow!("not a number: {count}"))?,
        ),
        _ => bail!("unknown w9 condition: {}", words.join(" ")),
    })
}

impl super::Rig {
    pub(crate) fn w9_holds(&mut self, condition: &W9) -> Result<bool> {
        match condition {
            W9::SetupNotice(shown) => return self.w9_element("auth-setup-open", *shown),
            W9::GroupActions(shown) => return self.w9_element("dm-header-more", *shown),
            W9::Sheet(open) => return self.w9_element("shortcuts-close", *open),
            W9::SearchMore(shown) => return self.w9_element("search-more", *shown),
            W9::Register(_) | W9::UnreadNotifications(_) | W9::DmMembers(_) | W9::Unread(_, _) => {}
        }
        let app = self.app()?.clone();
        Ok(self.driver.cx.update(|cx| {
            let root = app.read(cx);
            let Some(core) = root.core() else {
                return false;
            };
            let route = root.shell().map(|shell| shell.read(cx).nav().current());
            let open_dm = route.as_ref().and_then(|route| match route {
                semaphore_ui::nav::Route::DirectMessage { dm_group_id } => {
                    Some(dm_group_id.clone())
                }
                _ => None,
            });
            let open_channel = route.as_ref().and_then(|route| match route {
                semaphore_ui::nav::Route::Channel {
                    community_id,
                    channel_id,
                } => Some((community_id.clone(), channel_id.clone())),
                _ => None,
            });
            match condition {
                W9::Register(wanted) => core.register_requirements().mode == *wanted,
                W9::UnreadNotifications(count) => core.notifications().unread_count == *count,
                W9::DmMembers(wanted) => open_dm
                    .is_some_and(|id| core.dm(id).is_some_and(|row| row.members.len() == *wanted)),
                W9::Unread(id, wanted) => {
                    // The sidebar's row for the channel on screen holds the count.
                    let unread = open_channel
                        .filter(|(_, channel_id)| channel_id == id)
                        .and_then(|(community_id, _)| {
                            core.channels(community_id)
                                .into_iter()
                                .find(|channel| channel.id == *id)
                        })
                        .map_or(0, |channel| channel.unread_count);
                    if *wanted == 0 {
                        unread == 0
                    } else {
                        unread >= *wanted
                    }
                }
                W9::SetupNotice(_) | W9::GroupActions(_) | W9::Sheet(_) | W9::SearchMore(_) => {
                    unreachable!("answered above")
                }
            }
        }))
    }

    /// Whether an element with this id is drawn now.
    fn w9_element(&mut self, id: &str, drawn: bool) -> Result<bool> {
        let id = ElementId::Name(id.to_owned().into());
        let found = self.driver.query(|window| window.try_find(id).is_some())?;
        Ok(found == drawn)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn every_form_parses_and_nothing_else_does() {
        let good: [(&[&str], W9); 10] = [
            (&["setup-notice", "shown"], W9::SetupNotice(true)),
            (&["setup-notice", "gone"], W9::SetupNotice(false)),
            (
                &["register", "closed"],
                W9::Register(RegistrationMode::Closed),
            ),
            (
                &["register", "invite"],
                W9::Register(RegistrationMode::InviteOnly),
            ),
            (&["register", "open"], W9::Register(RegistrationMode::Open)),
            (&["unread-notifications", "3"], W9::UnreadNotifications(3)),
            (&["group-actions", "gone"], W9::GroupActions(false)),
            (&["dm-members", "4"], W9::DmMembers(4)),
            (&["search-more", "shown"], W9::SearchMore(true)),
            (
                &["unread", "cc-general", "1"],
                W9::Unread("cc-general".into(), 1),
            ),
        ];
        for (words, want) in good {
            assert_eq!(parse(words).unwrap(), want, "{words:?}");
        }
        assert_eq!(parse(&["sheet", "open"]).unwrap(), W9::Sheet(true));
        assert_eq!(parse(&["sheet", "closed"]).unwrap(), W9::Sheet(false));
        let bad: [&[&str]; 9] = [
            &[],
            &["setup-notice"],
            &["setup-notice", "maybe"],
            &["register", "sometimes"],
            &["unread-notifications", "many"],
            &["dm-members", "some"],
            &["sheet", "ajar"],
            &["search-more", "shown", "extra"],
            &["unread", "cc-general", "many"],
        ];
        for words in bad {
            assert!(parse(words).is_err(), "{words:?}");
        }
    }
}
