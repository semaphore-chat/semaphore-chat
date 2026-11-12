//! W5's conditions, `wait core w5 …` / `expect core w5 …`, read from core's views and the window:
//!
//! ```text
//! wait core w5 channel "w5-ops" at 2        # the shown community's channel list, 0-based
//! wait core w5 role "Member" has CREATE_INVITE
//! wait core w5 member $ID(u-priya) role "Moderator"
//! wait core w5 enabled invites-create       # an element's disabled state, by its id
//! wait core w5 disabled invites-create
//! wait core w5 reason invites-create "You need"   # the element's label contains this
//! wait core w5 label moderate-ban "Ban"     # the element's label is exactly this
//! wait core w5 composer locked              # locked|open: the timeout lock on the composer
//! wait core w5 invites 1                    # invites|emoji|sounds N: rows in that view
//! wait core w5 webhook-url shown            # shown|gone: the created webhook's one-time URL
//! wait core w5 removed-notice banned        # banned|kicked|deleted|none
//! ```
//!
//! W5-app skeleton: the words parse; agent B makes `Rig::w5_holds` answer them.

use anyhow::{Result, anyhow, bail};
use gpui_kit::test::TestWindowExt as _;
use gpui_kit::*;

/// W5's conditions.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum W5 {
    /// `channel <name> at <n>`: the channel called `name` is at `n` in the shown community's list.
    Channel { name: String, position: usize },
    /// `role <name> has <ACTION>`: the community's role holds that wire action.
    RoleHas { role: String, action: String },
    /// `member <user-id> role <name>`: the member holds that role.
    MemberRole { user_id: String, role: String },
    /// `enabled|disabled <id>`: the element is there and on or off.
    Enabled { id: String, enabled: bool },
    /// `reason <id> <text>`: the element's label (a locked note's reason, a menu item's
    /// "…, unavailable: why") contains `text`.
    Reason { id: String, text: String },
    /// `label <id> <text>`: the element's label is exactly `text` (an action that is on).
    Label { id: String, text: String },
    /// `composer locked|open`.
    ComposerLocked(bool),
    /// `invites|emoji|sounds N`.
    Count(Counted, usize),
    /// `webhook-url shown|gone`.
    WebhookUrl(bool),
    /// `removed-notice banned|kicked|deleted|none`.
    RemovedNotice(Option<String>),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Counted {
    Invites,
    Emoji,
    Sounds,
}

fn number(word: &str) -> Result<usize> {
    word.parse().map_err(|_| anyhow!("not a number: {word}"))
}

/// The words after `w5`.
pub(crate) fn parse(words: &[&str]) -> Result<W5> {
    Ok(match words {
        ["channel", name, "at", position] => W5::Channel {
            name: (*name).into(),
            position: number(position)?,
        },
        ["role", role, "has", action] => W5::RoleHas {
            role: (*role).into(),
            action: (*action).into(),
        },
        ["member", user_id, "role", role] => W5::MemberRole {
            user_id: (*user_id).into(),
            role: (*role).into(),
        },
        [state @ ("enabled" | "disabled"), id] => W5::Enabled {
            id: (*id).into(),
            enabled: *state == "enabled",
        },
        ["reason", id, text] => W5::Reason {
            id: (*id).into(),
            text: (*text).into(),
        },
        ["label", id, text] => W5::Label {
            id: (*id).into(),
            text: (*text).into(),
        },
        ["composer", state @ ("locked" | "open")] => W5::ComposerLocked(*state == "locked"),
        [what @ ("invites" | "emoji" | "sounds"), count] => W5::Count(
            match *what {
                "invites" => Counted::Invites,
                "emoji" => Counted::Emoji,
                _ => Counted::Sounds,
            },
            number(count)?,
        ),
        ["webhook-url", state @ ("shown" | "gone")] => W5::WebhookUrl(*state == "shown"),
        ["removed-notice", "none"] => W5::RemovedNotice(None),
        ["removed-notice", cause @ ("banned" | "kicked" | "deleted")] => {
            W5::RemovedNotice(Some((*cause).into()))
        }
        _ => bail!("not a w5 condition: {}", words.join(" ")),
    })
}

impl super::Rig {
    /// W5's conditions.
    pub(crate) fn w5_holds(&mut self, condition: &W5) -> Result<bool> {
        match condition {
            W5::Enabled { id, enabled } => {
                let id = ElementId::Name(id.clone().into());
                let found = self.driver.query(|window| {
                    window
                        .try_find(id)
                        .map(|element| !element.disabled().unwrap_or(false))
                })?;
                return Ok(found == Some(*enabled));
            }
            W5::Reason { id, text } | W5::Label { id, text } => {
                let exact = matches!(condition, W5::Label { .. });
                let id = ElementId::Name(id.clone().into());
                let label = self.driver.query(|window| {
                    window
                        .try_find(id)
                        .and_then(|element| element.label().map(|label| label.to_string()))
                })?;
                return Ok(label.is_some_and(|label| {
                    if exact {
                        label == *text
                    } else {
                        label.contains(text.as_str())
                    }
                }));
            }
            W5::WebhookUrl(shown) => {
                // The created webhook's dialog, which shows its URL this once.
                let id = ElementId::Name("webhook-created-done".into());
                let found = self.driver.query(|window| window.try_find(id).is_some())?;
                return Ok(found == *shown);
            }
            _ => {}
        }
        let app = self.app()?.clone();
        Ok(self.driver.cx.update(|cx| {
            let root = app.read(cx);
            let Some(core) = root.core() else {
                return false;
            };
            let community = root.shell().and_then(|shell| {
                shell
                    .read(cx)
                    .nav()
                    .current()
                    .community_id()
                    .map(str::to_owned)
            });
            match condition {
                W5::Channel { name, position } => {
                    let Some(community) = community else {
                        return false;
                    };
                    let channels = core.channels(community);
                    let Some(kind) = channels.iter().find(|c| c.name == *name).map(|c| c.kind)
                    else {
                        return false;
                    };
                    let mut same: Vec<_> = channels.iter().filter(|c| c.kind == kind).collect();
                    same.sort_by_key(|c| c.position);
                    same.iter().position(|c| c.name == *name) == Some(*position)
                }
                W5::RoleHas { role, action } => community.is_some_and(|community| {
                    core.roles(community)
                        .roles
                        .iter()
                        .any(|row| row.name == *role && row.actions.iter().any(|a| a == action))
                }),
                W5::MemberRole { user_id, role } => community.is_some_and(|community| {
                    let roles = core.roles(community.clone()).roles;
                    let held = core.member_roles(community, user_id.clone()).held;
                    roles
                        .iter()
                        .any(|row| row.name == *role && held.contains(&row.id))
                }),
                W5::ComposerLocked(locked) => root
                    .pane()
                    .is_some_and(|pane| pane.read(cx).timed_out(cx) == *locked),
                W5::Count(what, count) => community.is_some_and(|community| {
                    let shown = match what {
                        Counted::Invites => core.community_invites(community).invites.len(),
                        Counted::Emoji => core.custom_emoji(community).emojis.len(),
                        Counted::Sounds => core.soundboard(community).sounds.len(),
                    };
                    shown == *count
                }),
                W5::RemovedNotice(cause) => {
                    root.removed_notice(cx).map(|(_, shown)| shown.to_owned()) == *cause
                }
                W5::Enabled { .. } | W5::Reason { .. } | W5::Label { .. } | W5::WebhookUrl(_) => {
                    unreachable!("answered above")
                }
            }
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn every_form_parses_and_nothing_else_does() {
        let good: [(&[&str], W5); 14] = [
            (
                &["label", "moderate-ban", "Ban"],
                W5::Label {
                    id: "moderate-ban".into(),
                    text: "Ban".into(),
                },
            ),
            (
                &["channel", "w5-ops", "at", "2"],
                W5::Channel {
                    name: "w5-ops".into(),
                    position: 2,
                },
            ),
            (
                &["role", "Member", "has", "CREATE_INVITE"],
                W5::RoleHas {
                    role: "Member".into(),
                    action: "CREATE_INVITE".into(),
                },
            ),
            (
                &["member", "u1", "role", "Moderator"],
                W5::MemberRole {
                    user_id: "u1".into(),
                    role: "Moderator".into(),
                },
            ),
            (
                &["enabled", "x"],
                W5::Enabled {
                    id: "x".into(),
                    enabled: true,
                },
            ),
            (
                &["disabled", "x"],
                W5::Enabled {
                    id: "x".into(),
                    enabled: false,
                },
            ),
            (
                &["reason", "x", "You need"],
                W5::Reason {
                    id: "x".into(),
                    text: "You need".into(),
                },
            ),
            (&["composer", "locked"], W5::ComposerLocked(true)),
            (&["composer", "open"], W5::ComposerLocked(false)),
            (&["invites", "0"], W5::Count(Counted::Invites, 0)),
            (&["emoji", "3"], W5::Count(Counted::Emoji, 3)),
            (&["sounds", "1"], W5::Count(Counted::Sounds, 1)),
            (&["webhook-url", "gone"], W5::WebhookUrl(false)),
            (
                &["removed-notice", "banned"],
                W5::RemovedNotice(Some("banned".into())),
            ),
        ];
        for (words, want) in good {
            assert_eq!(parse(words).unwrap(), want, "{words:?}");
        }
        assert_eq!(
            parse(&["removed-notice", "none"]).unwrap(),
            W5::RemovedNotice(None)
        );
        let bad: [&[&str]; 9] = [
            &[],
            &["channel", "x", "at", "-1"],
            &["channel", "x", "2"],
            &["composer", "shut"],
            &["invites", "many"],
            &["webhook-url", "shown", "extra"],
            &["removed-notice", "left"],
            &["enabled"],
            &["role", "Member", "CREATE_INVITE"],
        ];
        for words in bad {
            assert!(parse(words).is_err(), "{words:?}");
        }
    }
}
