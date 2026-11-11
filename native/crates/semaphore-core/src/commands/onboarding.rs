//! Registering, a forgotten password, invites and creating a community. Unit W3-core.
//!
//! Register, forgot password and the invite preview go to the server set last
//! (`Core::probe_server`), before anyone signs in.

use crate::backend::BackendError;
use crate::cache::{CacheValue, keys};
use crate::client::{Core, Effect, State};
use crate::model::{
    CreatedCommunity, InvitePreview, InvitePreviewView, InviteUsable, LoadState, NewCommunity,
    RegisterForm, SessionState, ViewKey,
};
use crate::platform::CoreError;
use crate::resync::unavailable;
use semaphore_wire::types as wire;

/// What `register` says to someone already signed in: an invite makes a new account, and the
/// server has no way to apply one to an existing account.
pub const ALREADY_SIGNED_IN: &str = "You already have an account and are signed in. This invite \
     creates a new account, so it can't be applied to yours from here.";

/// A value the contract would refuse, said without echoing it (it may be a password).
fn invalid(field: &str) -> CoreError {
    CoreError::Failed {
        message: format!("the {field} isn't valid"),
    }
}

/// A refusal of a form, in the server's words ("Username already taken").
fn refused(error: BackendError) -> CoreError {
    CoreError::Failed {
        message: error.message,
    }
}

impl State {
    pub(crate) fn retry_failed_invites(&mut self) {
        let failed: Vec<String> = self
            .auth
            .invites
            .iter()
            .filter(|(_, view)| matches!(view.state, LoadState::Failed { .. }))
            .map(|(code, _)| code.clone())
            .collect();
        for code in failed {
            self.auth.invites.remove(&code);
            self.view_changed(ViewKey::InvitePreview { code });
        }
    }
}

fn preview(invite: wire::PublicInviteDto, now_ms: u64) -> InvitePreview {
    let valid_until_ms = invite.valid_until.map(|at| at.timestamp_millis());
    let max_uses = invite
        .max_uses
        .filter(|max| *max > 0)
        .map(|max| u32::try_from(max).unwrap_or(u32::MAX));
    let uses = u32::try_from(invite.uses.max(0)).unwrap_or(u32::MAX);
    let usable = if invite.disabled {
        InviteUsable::Disabled
    } else if valid_until_ms.is_some_and(|until| until <= now_ms as i64) {
        InviteUsable::Expired
    } else if max_uses.is_some_and(|max| uses >= max) {
        InviteUsable::UsedUp
    } else {
        InviteUsable::Usable
    };
    InvitePreview {
        code: invite.code,
        created_by: invite
            .created_by
            .map(|creator| creator.username)
            .filter(|name| !name.is_empty()),
        uses,
        max_uses,
        valid_until_ms,
        usable,
    }
}

impl Core {
    /// Creates the account, then signs in with it, as the web does: the session shows how. Joining
    /// by invite is this with the invite's code. A refusal (taken name, bad code) is the server's
    /// message in `CoreError::Failed`. Refused while signed in, with [`ALREADY_SIGNED_IN`].
    pub async fn register(&self, form: RegisterForm) -> Result<(), CoreError> {
        let services = self
            .services()
            .ok_or_else(|| unavailable("registering"))?
            .clone();
        let server_url = self.read(|state| {
            if matches!(state.session, SessionState::SignedIn { .. }) {
                return Err(CoreError::Failed {
                    message: ALREADY_SIGNED_IN.into(),
                });
            }
            state
                .auth
                .server_url
                .clone()
                .ok_or_else(|| CoreError::Failed {
                    message: "no server is set".into(),
                })
        })?;
        let username = form.username.trim().to_owned();
        let body = wire::CreateUserDto {
            code: form.invite_code.trim().to_owned(),
            email: form
                .email
                .map(|email| email.trim().to_owned())
                .filter(|email| !email.is_empty()),
            password: form.password.parse().map_err(|_| invalid("password"))?,
            username: username.parse().map_err(|_| invalid("username"))?,
        };
        services
            .backend
            .user_controller_register(body)
            .await
            .map_err(refused)?;
        // The server may have moved on meanwhile: sign in only where the account was made.
        if self.read(|state| state.auth.server_url.as_deref() != Some(server_url.as_str())) {
            return Err(CoreError::Failed {
                message: "the server changed".into(),
            });
        }
        self.sign_in(server_url, username, form.password).await
    }

    /// Asks the server to email a reset link. The reset itself happens in the web app the email
    /// opens. Succeeds whether or not the address has an account.
    pub async fn forgot_password(&self, email: String) -> Result<(), CoreError> {
        let services = self
            .services()
            .ok_or_else(|| unavailable("password reset"))?;
        services
            .backend
            .auth_controller_forgot_password(wire::ForgotPasswordRequestDto {
                email: email.trim().to_owned(),
            })
            .await
            .map(|_| ())
            .map_err(refused)
    }

    /// An invite, before signing in. `ViewKey::InvitePreview { code }` says when to read again.
    pub fn invite_preview(&self, code: String) -> InvitePreviewView {
        self.write(|state, _| {
            if let Some(view) = state.auth.invites.get(&code) {
                return view.clone();
            }
            let view = InvitePreviewView::default();
            if state.auth.server_url.is_some() && self.services().is_some() {
                state.auth.invites.insert(code.clone(), view.clone());
                state.push_effect(Effect::FetchInvite(code));
            }
            view
        })
    }

    pub(crate) async fn fetch_invite(&self, code: String) {
        let Some(services) = self.services() else {
            return;
        };
        let server_url = self.read(|state| state.auth.server_url.clone());
        let result = services
            .backend
            .invite_controller_get_public_invite(code.clone())
            .await;
        self.write(|state, now| {
            // Another server's, or forgotten since.
            if state.auth.server_url != server_url || !state.auth.invites.contains_key(&code) {
                return;
            }
            let view = match result {
                Ok(invite) => InvitePreviewView {
                    state: LoadState::Ready,
                    invite: Some(preview(invite, now)),
                },
                Err(error) => InvitePreviewView {
                    state: LoadState::Failed {
                        error: error.view(),
                    },
                    invite: None,
                },
            };
            state.auth.invites.insert(code.clone(), view);
            state.view_changed(ViewKey::InvitePreview { code });
        });
    }

    /// Creates a community this user owns. It joins `communities` at once.
    pub async fn create_community(
        &self,
        community: NewCommunity,
    ) -> Result<CreatedCommunity, CoreError> {
        let (services, epoch) = self.begin("creating communities")?;
        let body = wire::CreateCommunityDto {
            avatar: None,
            banner: None,
            description: community
                .description
                .map(|text| text.trim().to_owned())
                .filter(|text| !text.is_empty())
                .map(|text| text.parse())
                .transpose()
                .map_err(|_| invalid("description"))?,
            name: community.name.trim().parse().map_err(|_| invalid("name"))?,
        };
        let created = services
            .backend
            .community_controller_create(body)
            .await
            .map_err(|error| self.backend_failed(error))?;
        let id = created.id.clone();
        self.write(|state, now| {
            if state.session_epoch != epoch {
                return;
            }
            // `memberAddedToCommunity` may have come first and read the list again: once only.
            let key = keys::op(keys::COMMUNITIES);
            state.note_direct_update(&key);
            if let Some(list) = state.cache.communities_mut(&key) {
                if !list.iter().any(|known| known.id == created.id) {
                    list.push(created);
                }
            } else {
                state
                    .cache
                    .set(key.clone(), CacheValue::Communities(vec![created]), now);
                // A partial list: the next read fetches the whole.
                state.invalidate(&key);
            }
            state.query_changed(&key);
        });
        self.same_session(epoch)?;
        Ok(CreatedCommunity { id })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn invite(json: serde_json::Value) -> wire::PublicInviteDto {
        serde_json::from_value(json).unwrap()
    }

    #[test]
    fn an_invite_says_why_it_cant_be_used() {
        let base = serde_json::json!({
            "code": "abc", "uses": 1, "maxUses": 5, "validUntil": null, "disabled": false,
            "createdBy": { "username": "ann" },
        });
        let now = 1_700_000_000_000;
        assert_eq!(
            preview(invite(base.clone()), now).usable,
            InviteUsable::Usable
        );
        assert_eq!(
            preview(invite(base.clone()), now).created_by.as_deref(),
            Some("ann")
        );
        let mut used = base.clone();
        used["uses"] = 5.into();
        assert_eq!(preview(invite(used), now).usable, InviteUsable::UsedUp);
        let mut unlimited = base.clone();
        unlimited["uses"] = 50.into();
        unlimited["maxUses"] = serde_json::Value::Null;
        assert_eq!(preview(invite(unlimited), now).usable, InviteUsable::Usable);
        let mut expired = base.clone();
        expired["validUntil"] = "2023-01-01T00:00:00Z".into();
        assert_eq!(preview(invite(expired), now).usable, InviteUsable::Expired);
        let mut disabled = base;
        disabled["disabled"] = true.into();
        assert_eq!(
            preview(invite(disabled), now).usable,
            InviteUsable::Disabled
        );
    }
}
