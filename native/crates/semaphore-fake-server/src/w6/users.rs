//! W6-B's state: what ban and delete changed in the fake world. Its own lock (`Inner::w6_users`):
//! never held with `data`, `admin` or `rbac`, and `accounts` is taken before it, never after. A
//! role change is written into `inner.accounts`'s users instead, so the rest of the fake (the
//! owner bypass included) sees it. Seeded from the scenario's `adminUsers` key would go here; the
//! showcase scenario has none.

use crate::Inner;
use axum::response::Response;
use chrono::{DateTime, Utc};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

/// When and by whom a user was banned.
#[derive(Debug, Clone)]
pub(crate) struct Ban {
    pub at: DateTime<Utc>,
    pub by: String,
}

#[derive(Debug, Default)]
pub(crate) struct Users {
    /// Banned users, by id.
    banned: BTreeMap<String, Ban>,
    /// Deleted users: never listed, never found.
    deleted: BTreeSet<String>,
}

impl Users {
    pub fn ban(&self, user_id: &str) -> Option<&Ban> {
        self.banned.get(user_id)
    }

    pub fn is_deleted(&self, user_id: &str) -> bool {
        self.deleted.contains(user_id)
    }

    pub fn set_ban(&mut self, user_id: &str, by: &str, at: DateTime<Utc>) {
        self.banned.insert(
            user_id.to_owned(),
            Ban {
                at,
                by: by.to_owned(),
            },
        );
    }

    pub fn clear_ban(&mut self, user_id: &str) {
        self.banned.remove(user_id);
    }

    pub fn delete(&mut self, user_id: &str) {
        self.deleted.insert(user_id.to_owned());
        self.banned.remove(user_id);
    }
}

/// A W6-B control (`POST /__control/{name}`), or `None` when the name isn't W6-B's. This lane has
/// none: its routes are driven through the API itself.
pub(crate) fn control(_inner: &Inner, _name: &str, _request: &Value) -> Option<Response> {
    None
}
