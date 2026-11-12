//! This account's sessions and appearance settings. Unit W3-core.
//!
//! The server sends no event when the sessions list changes, so it's read again after each revoke
//! here, when a desktop app signs in (`desktopSignIn`), and when shown and older than
//! [`SESSIONS_STALE_MS`]. A revoke isn't shown before the server agrees: its row is `busy`
//! meanwhile. Appearance changes show at once as overlays numbered by the change, as W2's
//! notification settings do; a failure takes away only its own.

use std::collections::HashMap;

use crate::cache::{CacheValue, keys};
use crate::client::{Core, State};
use crate::model::{
    AccentColor, Appearance, AppearancePatch, AppearanceView, ErrorView, InstancePermissionsView,
    LoadState, ProfileUpload, SessionRow, SessionsView, ThemeIntensity, ThemeMode, ViewKey,
};
use crate::platform::CoreError;
use semaphore_wire::enums::RbacAction;
use semaphore_wire::enums::{
    AccentColor as WireAccent, ThemeIntensity as WireIntensity, ThemeMode as WireMode,
};
use semaphore_wire::types as wire;

/// Sessions read longer ago than this are read again when shown: nothing says they changed.
pub const SESSIONS_STALE_MS: u64 = 30_000;

/// W3's state of one session.
#[derive(Default)]
pub struct W3State {
    /// Profile edits on their way, with the text each shows meanwhile.
    pub(crate) profile_overlays: Vec<(u64, super::profile::ProfileText)>,
    /// The newest edit whose answer is in the cache.
    pub(crate) profile_applied: u64,
    pub(crate) edits_running: u32,
    pub(crate) edit_upload: Option<ProfileUpload>,
    /// The edit `edit_upload` belongs to.
    pub(crate) edit_upload_change: u64,
    pub(crate) edit_error: Option<ErrorView>,
    /// Sessions being revoked, with the number of the revoke.
    pub(crate) busy_sessions: HashMap<String, u64>,
    pub(crate) revoking_others: u32,
    pub(crate) appearance_overlays: Vec<(u64, AppearancePatch)>,
    pub(crate) appearance_applied: u64,
}

fn mode(raw: &str) -> ThemeMode {
    match raw {
        "light" => ThemeMode::Light,
        _ => ThemeMode::Dark,
    }
}

fn accent(raw: &str) -> AccentColor {
    match raw {
        "blue" => AccentColor::Blue,
        "indigo" => AccentColor::Indigo,
        "purple" => AccentColor::Purple,
        "rose" => AccentColor::Rose,
        "red" => AccentColor::Red,
        "orange" => AccentColor::Orange,
        "amber" => AccentColor::Amber,
        "lime" => AccentColor::Lime,
        "emerald" => AccentColor::Emerald,
        "cyan" => AccentColor::Cyan,
        "slate" => AccentColor::Slate,
        _ => AccentColor::Teal,
    }
}

fn intensity(raw: &str) -> ThemeIntensity {
    match raw {
        "balanced" => ThemeIntensity::Balanced,
        "vibrant" => ThemeIntensity::Vibrant,
        _ => ThemeIntensity::Minimal,
    }
}

fn wire_mode(mode: ThemeMode) -> WireMode {
    match mode {
        ThemeMode::Dark => WireMode::Dark,
        ThemeMode::Light => WireMode::Light,
    }
}

fn wire_accent(accent: AccentColor) -> WireAccent {
    match accent {
        AccentColor::Teal => WireAccent::Teal,
        AccentColor::Blue => WireAccent::Blue,
        AccentColor::Indigo => WireAccent::Indigo,
        AccentColor::Purple => WireAccent::Purple,
        AccentColor::Rose => WireAccent::Rose,
        AccentColor::Red => WireAccent::Red,
        AccentColor::Orange => WireAccent::Orange,
        AccentColor::Amber => WireAccent::Amber,
        AccentColor::Lime => WireAccent::Lime,
        AccentColor::Emerald => WireAccent::Emerald,
        AccentColor::Cyan => WireAccent::Cyan,
        AccentColor::Slate => WireAccent::Slate,
    }
}

fn wire_intensity(intensity: ThemeIntensity) -> WireIntensity {
    match intensity {
        ThemeIntensity::Minimal => WireIntensity::Minimal,
        ThemeIntensity::Balanced => WireIntensity::Balanced,
        ThemeIntensity::Vibrant => WireIntensity::Vibrant,
    }
}

fn session_row(session: &wire::SessionInfoDto, busy: bool) -> SessionRow {
    SessionRow {
        id: session.id.clone(),
        device_name: Some(session.device_name.clone()).filter(|name| !name.trim().is_empty()),
        ip_address: session.ip_address.clone().filter(|ip| !ip.is_empty()),
        created_at_ms: session.created_at.timestamp_millis(),
        last_used_at_ms: session.last_used_at.timestamp_millis(),
        expires_at_ms: session.expires_at.timestamp_millis(),
        is_current: session.is_current,
        busy,
    }
}

impl State {
    /// The server's appearance, or its defaults, with the changes on their way over it.
    fn effective_appearance(&self) -> Appearance {
        let mut appearance = self
            .cache
            .appearance(&keys::op(keys::APPEARANCE))
            .map(|dto| Appearance {
                mode: mode(&dto.theme_mode),
                accent: accent(&dto.accent_color),
                intensity: intensity(&dto.intensity),
            })
            .unwrap_or_default();
        for (_, patch) in &self.w3.appearance_overlays {
            if let Some(mode) = patch.mode {
                appearance.mode = mode;
            }
            if let Some(accent) = patch.accent {
                appearance.accent = accent;
            }
            if let Some(intensity) = patch.intensity {
                appearance.intensity = intensity;
            }
        }
        appearance
    }

    /// The sessions changed here: read them again.
    fn sessions_touched(&mut self) {
        let key = keys::op(keys::SESSIONS);
        self.failed_queries.remove(&key);
        if self.invalidate(&key).is_empty() {
            self.ensure_query(key);
        }
        self.view_changed(ViewKey::Sessions);
    }
}

impl Core {
    /// This account's sessions, most recently used first. `ViewKey::Sessions` says when to read
    /// again.
    pub fn sessions(&self) -> SessionsView {
        self.write(|state, now| {
            let key = keys::op(keys::SESSIONS);
            let old = state.cache.get(&key).is_some_and(|entry| {
                !entry.stale && now.saturating_sub(entry.fetched_at_ms) > SESSIONS_STALE_MS
            });
            if old {
                state.invalidate(&key);
            }
            state.ensure_query(key.clone());
            let mut sessions: Vec<SessionRow> = state
                .cache
                .sessions(&key)
                .map(|list| {
                    list.iter()
                        .map(|session| {
                            session_row(session, state.w3.busy_sessions.contains_key(&session.id))
                        })
                        .collect()
                })
                .unwrap_or_default();
            sessions.sort_by(|a, b| {
                b.is_current
                    .cmp(&a.is_current)
                    .then(b.last_used_at_ms.cmp(&a.last_used_at_ms))
            });
            SessionsView {
                state: state.query_load_state(&key),
                sessions,
                revoking_others: state.w3.revoking_others > 0,
            }
        })
    }

    /// Signs another device out. Its row shows `busy` until the server answers. This client's own
    /// session is refused: that's `sign_out`.
    pub async fn revoke_session(&self, session_id: String) -> Result<(), CoreError> {
        let (services, epoch) = self.begin("sessions")?;
        let number = self.write(|state, _| {
            let current = state
                .cache
                .sessions(&keys::op(keys::SESSIONS))
                .is_some_and(|list| {
                    list.iter()
                        .any(|session| session.id == session_id && session.is_current)
                });
            if current {
                return Err(CoreError::Failed {
                    message: "This is this device's own session: sign out instead.".into(),
                });
            }
            let number = state.next_change();
            state.w3.busy_sessions.insert(session_id.clone(), number);
            state.view_changed(ViewKey::Sessions);
            Ok(number)
        })?;
        let result = services
            .backend
            .auth_controller_revoke_session(session_id.clone())
            .await
            .map(|_| ())
            .map_err(|error| self.backend_failed(error));
        self.write(|state, _| {
            if state.session_epoch != epoch {
                return;
            }
            if state.w3.busy_sessions.get(&session_id) == Some(&number) {
                state.w3.busy_sessions.remove(&session_id);
            }
            if result.is_ok() {
                let key = keys::op(keys::SESSIONS);
                state.note_direct_update(&key);
                if let Some(list) = state.cache.sessions_mut(&key) {
                    list.retain(|session| session.id != session_id);
                }
            }
            state.sessions_touched();
        });
        self.same_session(epoch)?;
        result
    }

    /// Signs every other device out, never this one: the server keeps the session of the token
    /// that asks. Returns how many it ended.
    ///
    /// A refusal doesn't sign this client out, even a 401: the server answers 401 when it can't tell
    /// which session is asking, which says nothing about whether this one still stands.
    pub async fn revoke_other_sessions(&self) -> Result<u32, CoreError> {
        let (services, epoch) = self.begin("sessions")?;
        self.write(|state, _| {
            state.w3.revoking_others += 1;
            state.view_changed(ViewKey::Sessions);
        });
        let result = services
            .backend
            .auth_controller_revoke_all_other_sessions()
            .await;
        self.write(|state, _| {
            if state.session_epoch != epoch {
                return;
            }
            state.w3.revoking_others = state.w3.revoking_others.saturating_sub(1);
            if result.is_ok() {
                let key = keys::op(keys::SESSIONS);
                state.note_direct_update(&key);
                if let Some(list) = state.cache.sessions_mut(&key) {
                    list.retain(|session| session.is_current);
                }
            }
            state.sessions_touched();
        });
        self.same_session(epoch)?;
        match result {
            Ok(answer) => Ok(u32::try_from(answer.revoked_count.max(0)).unwrap_or(u32::MAX)),
            Err(error) => Err(CoreError::Failed {
                message: error.message,
            }),
        }
    }

    /// What this user may do on the instance. An owner may do everything without their roles.
    pub fn instance_permissions(&self) -> InstancePermissionsView {
        self.write(|state, _| {
            let key = keys::op(keys::INSTANCE_ROLES);
            if state.is_instance_owner() {
                return InstancePermissionsView {
                    state: LoadState::Ready,
                    can_create_community: true,
                    can_create_invite: true,
                    can_delete_invite: true,
                    admin: state.instance_admin_caps(),
                };
            }
            state.ensure_query(key.clone());
            let has = |action: RbacAction| {
                state.cache.instance_roles(&key).is_some_and(|roles| {
                    roles
                        .roles
                        .iter()
                        .any(|role| role.actions.contains(&action))
                })
            };
            InstancePermissionsView {
                can_create_community: has(RbacAction::CreateCommunity),
                can_create_invite: has(RbacAction::CreateInstanceInvite),
                can_delete_invite: has(RbacAction::DeleteInstanceInvite),
                admin: state.instance_admin_caps(),
                state: state.query_load_state(&key),
            }
        })
    }

    /// The theme the server keeps for this account, or its defaults while it loads.
    /// `ViewKey::Appearance` says when to read again.
    pub fn appearance(&self) -> AppearanceView {
        self.write(|state, _| {
            let key = keys::op(keys::APPEARANCE);
            state.ensure_query(key.clone());
            AppearanceView {
                state: state.query_load_state(&key),
                appearance: state.effective_appearance(),
            }
        })
    }

    /// Changes the fields the patch sets. Shown at once; back if the server refuses.
    pub async fn update_appearance(&self, patch: AppearancePatch) -> Result<(), CoreError> {
        let (services, epoch) = self.begin("appearance settings")?;
        let body = wire::UpdateAppearanceSettingsDto {
            accent_color: patch.accent.map(wire_accent),
            intensity: patch.intensity.map(wire_intensity),
            theme_mode: patch.mode.map(wire_mode),
        };
        let change = self.write(|state, _| {
            let change = state.next_change();
            state.w3.appearance_overlays.push((change, patch));
            state.view_changed(ViewKey::Appearance);
            change
        });
        let result = services
            .backend
            .appearance_settings_controller_update_settings(body)
            .await
            .map_err(|error| self.backend_failed(error));
        self.write(|state, now| {
            if state.session_epoch != epoch {
                return;
            }
            state
                .w3
                .appearance_overlays
                .retain(|(overlay, _)| *overlay != change);
            if let Ok(dto) = &result
                && change > state.w3.appearance_applied
            {
                state.w3.appearance_applied = change;
                let key = keys::op(keys::APPEARANCE);
                state.note_direct_update(&key);
                state
                    .cache
                    .set(key, CacheValue::Appearance(dto.clone()), now);
            }
            state.view_changed(ViewKey::Appearance);
        });
        self.same_session(epoch)?;
        result.map(|_| ())
    }
}
