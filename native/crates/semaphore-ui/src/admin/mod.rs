//! Wave 6: the instance admin area, one directory per page group, each its own UI lane
//! (W6-ui-shell: `layout`, `dashboard`, `settings`; W6-ui-users: `users`; W6-ui-content:
//! `communities`, `invites`; W6-ui-roles-storage: `roles`, `storage`). This file is the freeze's.

pub mod communities;
pub mod dashboard;
pub mod invites;
pub mod layout;
pub mod roles;
pub mod settings;
pub mod storage;
pub mod users;

#[cfg(feature = "stories")]
pub fn stories() -> Vec<crate::stories::Story> {
    [
        layout::stories(),
        dashboard::stories(),
        settings::stories(),
        users::stories(),
        communities::stories(),
        invites::stories(),
        roles::stories(),
        storage::stories(),
    ]
    .into_iter()
    .flatten()
    .collect()
}
