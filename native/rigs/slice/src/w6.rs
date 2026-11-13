//! W6's conditions, `wait core w6 …` / `expect core w6 …`, for the admin area (WA). Hub file from the
//! UI freeze: the words parse here and `Rig::w6_holds` answers them; WA adds its variants.
//! The generic element checks are W5's (`wait core w5 enabled|disabled|reason|label <id> ..`).
//!
//! ```text
//! wait core w6 page users                       # the route is Route::Admin on that page
//! wait core w6 attention disk error             # that attention item, with that severity
//! wait core w6 instance name "Lumen Chat"       # the instance settings' name
//! wait core w6 instance registration closed     # open|invite-only|closed
//! wait core w6 user $ID(u-priya) banned         # listed|gone|banned|active|owner, in the shown list
//! wait core w6 user $ID(u-priya) role "Instance Admin"
//! wait core w6 community $ID(c-trail) gone      # in the shown list and the rail, or in neither
//! wait core w6 role "Helpers" exists            # exists|gone, or has <ACTION>
//! wait core w6 storage filter 90                # the usage filter the page is on
//! wait core w6 storage quota $ID(u-priya) 10    # a user's quota, in whole GiB, from the stats
//! wait core w6 invites 1                        # instance invites listed
//! ```

use anyhow::{Result, anyhow, bail};
use semaphore_core::model::{AdminPage, AttentionId, AttentionSeverity, RegistrationMode};
use semaphore_ui::nav::Route;

/// W6's conditions.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum W6 {
    /// `page dashboard|users|communities|invites|roles|storage|settings`.
    Page(AdminPage),
    /// `attention disk|over-quota|storage-unavailable|livekit error|warning`.
    Attention {
        id: AttentionId,
        severity: AttentionSeverity,
    },
    /// `instance name <name>`.
    InstanceName(String),
    /// `instance registration open|invite-only|closed`.
    InstanceRegistration(RegistrationMode),
    /// `user <id> listed|gone|banned|active|owner|not-owner|role <name>`.
    User { user_id: String, what: UserWhat },
    /// `community <id> listed|gone`: in the shown communities list and the rail.
    Community { community_id: String, listed: bool },
    /// `role <name> exists|gone|has <ACTION>`.
    Role { name: String, what: RoleWhat },
    /// `storage filter <percent>`.
    StorageFilter(u32),
    /// `storage quota <user-id> <gib>`.
    StorageQuota { user_id: String, gib: u64 },
    /// `invites <count>`: the instance invites listed.
    Invites(usize),
}

/// What `user <id> …` asks about the user's row in the list on screen.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum UserWhat {
    Listed(bool),
    Banned(bool),
    /// Holds the instance owner role (the row's Owner chip).
    Owner(bool),
    /// Holds an instance role with this name.
    Role(String),
}

/// What `role <name> …` asks about the instance roles.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum RoleWhat {
    Exists(bool),
    /// Holds this wire action.
    Has(String),
}

fn number(word: &str) -> Result<u64> {
    word.parse().map_err(|_| anyhow!("not a number: {word}"))
}

fn page(word: &str) -> Result<AdminPage> {
    Ok(match word {
        "dashboard" => AdminPage::Dashboard,
        "users" => AdminPage::Users,
        "communities" => AdminPage::Communities,
        "invites" => AdminPage::Invites,
        "roles" => AdminPage::Roles,
        "storage" => AdminPage::Storage,
        "settings" => AdminPage::Settings,
        _ => bail!("not an admin page: {word}"),
    })
}

fn attention_id(word: &str) -> Result<AttentionId> {
    Ok(match word {
        "disk" => AttentionId::Disk,
        "over-quota" => AttentionId::OverQuota,
        "storage-unavailable" => AttentionId::StorageUnavailable,
        "livekit" => AttentionId::Livekit,
        _ => bail!("not an attention item: {word}"),
    })
}

fn severity(word: &str) -> Result<AttentionSeverity> {
    Ok(match word {
        "error" => AttentionSeverity::Error,
        "warning" => AttentionSeverity::Warning,
        _ => bail!("not an attention severity: {word}"),
    })
}

fn registration(word: &str) -> Result<RegistrationMode> {
    Ok(match word {
        "open" => RegistrationMode::Open,
        "invite-only" => RegistrationMode::InviteOnly,
        "closed" => RegistrationMode::Closed,
        _ => bail!("not a registration mode: {word}"),
    })
}

/// The words after `w6`.
pub(crate) fn parse(words: &[&str]) -> Result<W6> {
    Ok(match words {
        ["page", name] => W6::Page(page(name)?),
        ["attention", id, level] => W6::Attention {
            id: attention_id(id)?,
            severity: severity(level)?,
        },
        ["instance", "name", name] => W6::InstanceName((*name).into()),
        ["instance", "registration", mode] => W6::InstanceRegistration(registration(mode)?),
        ["user", id, "listed"] => W6::User {
            user_id: (*id).into(),
            what: UserWhat::Listed(true),
        },
        ["user", id, "gone"] => W6::User {
            user_id: (*id).into(),
            what: UserWhat::Listed(false),
        },
        ["user", id, "banned"] => W6::User {
            user_id: (*id).into(),
            what: UserWhat::Banned(true),
        },
        ["user", id, "active"] => W6::User {
            user_id: (*id).into(),
            what: UserWhat::Banned(false),
        },
        ["user", id, "owner"] => W6::User {
            user_id: (*id).into(),
            what: UserWhat::Owner(true),
        },
        ["user", id, "not-owner"] => W6::User {
            user_id: (*id).into(),
            what: UserWhat::Owner(false),
        },
        ["user", id, "role", role] => W6::User {
            user_id: (*id).into(),
            what: UserWhat::Role((*role).into()),
        },
        ["community", id, "listed"] => W6::Community {
            community_id: (*id).into(),
            listed: true,
        },
        ["community", id, "gone"] => W6::Community {
            community_id: (*id).into(),
            listed: false,
        },
        ["role", name, "exists"] => W6::Role {
            name: (*name).into(),
            what: RoleWhat::Exists(true),
        },
        ["role", name, "gone"] => W6::Role {
            name: (*name).into(),
            what: RoleWhat::Exists(false),
        },
        ["role", name, "has", action] => W6::Role {
            name: (*name).into(),
            what: RoleWhat::Has((*action).into()),
        },
        ["storage", "filter", percent] => W6::StorageFilter(number(percent)?.try_into()?),
        ["storage", "quota", id, gib] => W6::StorageQuota {
            user_id: (*id).into(),
            gib: number(gib)?,
        },
        ["invites", count] => W6::Invites(number(count)?.try_into()?),
        _ => bail!("not a w6 condition: {}", words.join(" ")),
    })
}

impl super::Rig {
    /// W6's conditions, read from core's views and the app's open admin area.
    pub(crate) fn w6_holds(&mut self, condition: &W6) -> Result<bool> {
        let app = self.app()?.clone();
        Ok(self.driver.cx.update(|cx| {
            let root = app.read(cx);
            let Some(core) = root.core() else {
                return false;
            };
            let open = root.admin_open();
            match condition {
                W6::Page(page) => root.shell().is_some_and(|shell| {
                    matches!(
                        shell.read(cx).nav().current(),
                        Route::Admin { page: shown } if shown == page
                    )
                }),
                W6::Attention { id, severity } => core
                    .admin_dashboard()
                    .attention
                    .iter()
                    .any(|item| item.id == *id && item.severity == *severity),
                W6::InstanceName(name) => core.instance_settings().name == *name,
                W6::InstanceRegistration(mode) => core.instance_settings().registration == *mode,
                W6::User { user_id, what } => match what {
                    UserWhat::Role(role) => core
                        .admin_user_roles(user_id.clone())
                        .held
                        .iter()
                        .any(|held| held.name == *role),
                    UserWhat::Listed(listed) => {
                        let Some(open) = open else {
                            return false;
                        };
                        core.admin_users(open.users_query)
                            .rows
                            .iter()
                            .any(|row| row.user.id == *user_id)
                            == *listed
                    }
                    UserWhat::Banned(banned) => {
                        let Some(open) = open else {
                            return false;
                        };
                        core.admin_users(open.users_query)
                            .rows
                            .iter()
                            .find(|row| row.user.id == *user_id)
                            .is_some_and(|row| row.banned == *banned)
                    }
                    UserWhat::Owner(owner) => {
                        let Some(open) = open else {
                            return false;
                        };
                        core.admin_users(open.users_query)
                            .rows
                            .iter()
                            .find(|row| row.user.id == *user_id)
                            .is_some_and(|row| row.is_owner == *owner)
                    }
                },
                W6::Community {
                    community_id,
                    listed,
                } => {
                    // What the admin list shows, and the rail: the delete leaves both.
                    let in_list =
                        open.is_some_and(|open| {
                            core.admin_communities(open.communities_search)
                                .rows
                                .iter()
                                .any(|row| row.id == *community_id)
                        }) && core.communities().iter().any(|row| row.id == *community_id);
                    in_list == *listed
                }
                W6::Role { name, what } => {
                    let roles = core.instance_roles().roles;
                    match what {
                        RoleWhat::Exists(exists) => {
                            roles.iter().any(|role| role.name == *name) == *exists
                        }
                        RoleWhat::Has(action) => roles
                            .iter()
                            .any(|role| role.name == *name && role.actions.contains(action)),
                    }
                }
                W6::StorageFilter(percent) => {
                    open.is_some_and(|open| open.storage_min_percent == *percent)
                }
                W6::StorageQuota { user_id, gib } => core
                    .admin_storage(0)
                    .rows
                    .iter()
                    .find(|row| row.user_id == *user_id)
                    .is_some_and(|row| row.quota_bytes / (1 << 30) == *gib),
                W6::Invites(count) => core.admin_invites().rows.len() == *count,
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
        let good: [(&[&str], W6); 15] = [
            (&["page", "users"], W6::Page(AdminPage::Users)),
            (
                &["attention", "disk", "error"],
                W6::Attention {
                    id: AttentionId::Disk,
                    severity: AttentionSeverity::Error,
                },
            ),
            (
                &["instance", "name", "Lumen Chat"],
                W6::InstanceName("Lumen Chat".into()),
            ),
            (
                &["instance", "registration", "closed"],
                W6::InstanceRegistration(RegistrationMode::Closed),
            ),
            (
                &["user", "u1", "banned"],
                W6::User {
                    user_id: "u1".into(),
                    what: UserWhat::Banned(true),
                },
            ),
            (
                &["user", "u1", "gone"],
                W6::User {
                    user_id: "u1".into(),
                    what: UserWhat::Listed(false),
                },
            ),
            (
                &["user", "u1", "owner"],
                W6::User {
                    user_id: "u1".into(),
                    what: UserWhat::Owner(true),
                },
            ),
            (
                &["user", "u1", "not-owner"],
                W6::User {
                    user_id: "u1".into(),
                    what: UserWhat::Owner(false),
                },
            ),
            (
                &["user", "u1", "role", "Instance Admin"],
                W6::User {
                    user_id: "u1".into(),
                    what: UserWhat::Role("Instance Admin".into()),
                },
            ),
            (
                &["community", "c1", "gone"],
                W6::Community {
                    community_id: "c1".into(),
                    listed: false,
                },
            ),
            (
                &["role", "Helpers", "exists"],
                W6::Role {
                    name: "Helpers".into(),
                    what: RoleWhat::Exists(true),
                },
            ),
            (
                &["role", "Helpers", "has", "READ_USER"],
                W6::Role {
                    name: "Helpers".into(),
                    what: RoleWhat::Has("READ_USER".into()),
                },
            ),
            (&["storage", "filter", "90"], W6::StorageFilter(90)),
            (
                &["storage", "quota", "u1", "10"],
                W6::StorageQuota {
                    user_id: "u1".into(),
                    gib: 10,
                },
            ),
            (&["invites", "2"], W6::Invites(2)),
        ];
        for (words, want) in good {
            assert_eq!(parse(words).unwrap(), want, "{words:?}");
        }
        let bad: [&[&str]; 10] = [
            &[],
            &["page", "debug"],
            &["attention", "disk", "fatal"],
            &["instance", "registration", "sometimes"],
            &["user", "u1", "left"],
            &["community", "c1"],
            &["role", "Helpers"],
            &["storage", "filter", "lots"],
            &["storage", "quota", "u1", "-1"],
            &["invites", "many"],
        ];
        for words in bad {
            assert!(parse(words).is_err(), "{words:?}");
        }
    }
}
