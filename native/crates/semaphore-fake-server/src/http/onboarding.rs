//! Joining an instance: registration, the public invite lookup, password-reset requests and
//! creating a community.

use super::{bearer_token, invalid, json_response, typed};
use crate::accounts::{new_user, plausible_email};
use crate::{Inner, lock};
use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, Method, StatusCode};
use axum::response::Response;
use axum::routing::{get, post};
use semaphore_wire::enums::RegistrationMode;
use semaphore_wire::types::{
    CommunityResponseDto, CreateCommunityDto, CreateUserDto, ForgotPasswordRequestDto,
    PublicInviteCreatorDto, PublicInviteDto,
};
use serde_json::json;
use std::sync::Arc;

pub(super) fn routes() -> Router<Arc<Inner>> {
    Router::new()
        .route("/api/users", post(register))
        .route("/api/auth/forgot-password", post(forgot_password))
        .route("/api/invite/public/{code}", get(public_invite))
        .route("/api/onboarding/status", get(instance_status))
        .route("/api/invite/{code}/accept", post(accept_invite))
        .route("/api/community", post(create_community))
}

pub(super) fn operation_id(method: &Method, route: &str) -> Option<&'static str> {
    Some(match (method.as_str(), route) {
        ("POST", "/api/users") => "UserController_register",
        ("POST", "/api/auth/forgot-password") => "AuthController_forgotPassword",
        ("GET", "/api/invite/public/{code}") => "InviteController_getPublicInvite",
        ("GET", "/api/onboarding/status") => "OnboardingController_getStatus",
        ("POST", "/api/invite/{code}/accept") => "inviteControllerAcceptInvite",
        ("POST", "/api/community") => "CommunityController_create",
        _ => return None,
    })
}

/// The instance's registration mode: a `public_settings` control wins, else the instance settings
/// the admin page edits. Read before the accounts lock, which it never holds with another.
fn registration_mode(inner: &Inner) -> RegistrationMode {
    if let Some(mode) = lock(&inner.accounts)
        .public_settings
        .get("registrationMode")
        .cloned()
    {
        return serde_json::from_value(mode).unwrap_or(RegistrationMode::InviteOnly);
    }
    lock(&inner.w6_instance).settings.registration_mode.clone()
}

/// `UserService.createUser`, which honours the instance's registration mode: `CLOSED` refuses
/// before anything else, `INVITE_ONLY` needs a usable code, and `OPEN` takes a code when one is
/// given. An unknown, expired, used-up or disabled code is a 404, checked before any name; a taken
/// username or email is a 409. The username is stored lowercase, and is the display name.
async fn register(State(inner): State<Arc<Inner>>, body: Bytes) -> Response {
    let Ok(dto) = typed::<CreateUserDto>(&body) else {
        return invalid("The request body does not match the contract");
    };
    if dto
        .email
        .as_deref()
        .is_some_and(|email| !plausible_email(email))
    {
        return invalid("email must be an email");
    }
    let mode = registration_mode(&inner);
    if mode == RegistrationMode::Closed {
        return inner.error(
            403,
            "FORBIDDEN",
            "Registration is closed on this server",
            false,
        );
    }
    let now = inner.now();
    let username = dto.username.to_lowercase();
    let mut accounts = lock(&inner.accounts);

    let wanted = accounts
        .invites
        .iter()
        .position(|invite| invite.code == dto.code && invite.usable(now));
    let invite = match (mode, wanted) {
        // Open with no code: no invite, and the account joins no community.
        (RegistrationMode::Open, None) if dto.code.trim().is_empty() => None,
        (_, Some(index)) => Some(index),
        _ => {
            drop(accounts);
            return inner.error(
                404,
                "NOT_FOUND",
                "No invite found for the provided code.",
                false,
            );
        }
    };

    let username_taken = accounts.credentials.contains_key(&username)
        || std::iter::once(&inner.scenario.me)
            .chain(inner.scenario.users.iter())
            .any(|user| user.username.to_lowercase() == username);
    let email_taken = dto.email.as_ref().is_some_and(|email| {
        accounts
            .credentials
            .values()
            .any(|credential| credential.email.as_ref() == Some(email))
    });
    if username_taken || email_taken {
        drop(accounts);
        let field = if username_taken { "username" } else { "email" };
        return inner.error(
            409,
            "CONFLICT",
            format!("A user with this {field} already exists."),
            false,
        );
    }

    let id = accounts.new_id("user");
    let user = new_user(id.clone(), &username);
    accounts.users.insert(id.clone(), user.clone());
    accounts.credentials.insert(
        username,
        crate::accounts::Credential {
            user_id: id,
            password: dto.password.to_string(),
            email: dto.email.clone(),
        },
    );
    if let Some(invite) = invite {
        accounts.invites[invite].uses += 1;
    }
    drop(accounts);
    json_response(
        StatusCode::CREATED,
        serde_json::to_value(user).expect("a user serializes"),
    )
}

/// Always the same answer, whether or not the email has an account.
async fn forgot_password(State(inner): State<Arc<Inner>>, body: Bytes) -> Response {
    let Ok(dto) = typed::<ForgotPasswordRequestDto>(&body) else {
        return invalid("The request body does not match the contract");
    };
    if !plausible_email(&dto.email) {
        return invalid("email must be an email");
    }
    let _ = inner;
    json_response(
        StatusCode::OK,
        json!({ "message": "If an account with that email exists, a reset link has been sent." }),
    )
}

/// `OnboardingService.getStatus`: an instance with no users yet must be set up in a browser. The
/// fake always has its scenario's users, so this answers "set up" unless a control says a fresh
/// instance. A fresh one gets a setup token, as the backend makes one on every such read.
async fn instance_status(State(inner): State<Arc<Inner>>) -> Response {
    let needs_setup = lock(&inner.accounts).needs_setup;
    let mut body = json!({ "needsSetup": needs_setup, "hasUsers": !needs_setup });
    if needs_setup {
        body["setupToken"] = json!("fixture-setup-token");
    }
    json_response(StatusCode::OK, body)
}

/// `InviteService.getPublicInvite`: what the join screen shows. Every unusable code answers 404
/// with its own reason (expiry and exhaustion before `disabled`, as the backend orders them), so
/// the join screen can say why and a generated client never decodes an empty body.
async fn public_invite(State(inner): State<Arc<Inner>>, Path(code): Path<String>) -> Response {
    let now = inner.now();
    let invite = lock(&inner.accounts)
        .invites
        .iter()
        .find(|invite| invite.code == code)
        .cloned();
    let Some(invite) = invite else {
        return inner.error(
            404,
            "INVITE_NOT_FOUND",
            "This invite link is invalid.",
            false,
        );
    };
    if invite.valid_until.is_some_and(|until| now > until) {
        return inner.error(404, "INVITE_EXPIRED", "This invite has expired.", false);
    }
    if invite.max_uses.is_some_and(|max| invite.uses >= max) {
        return inner.error(
            404,
            "INVITE_EXHAUSTED",
            "This invite has reached its maximum number of uses.",
            false,
        );
    }
    if invite.disabled {
        return inner.error(
            404,
            "INVITE_DISABLED",
            "This invite has been disabled.",
            false,
        );
    }
    let dto = PublicInviteDto {
        code: invite.code.clone(),
        created_by: invite
            .created_by
            .clone()
            .map(|username| PublicInviteCreatorDto { username }),
        disabled: invite.disabled,
        max_uses: invite.max_uses,
        uses: invite.uses,
        valid_until: invite.valid_until,
    };
    json_response(
        StatusCode::OK,
        serde_json::to_value(dto).expect("an invite serializes"),
    )
}

/// `CommunityService.create`: the creator is the first member, with a "general" channel. A taken
/// name is a 409; an avatar or banner must be the creator's own upload of that kind.
async fn create_community(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let Ok(dto) = typed::<CreateCommunityDto>(&body) else {
        return invalid("The request body does not match the contract");
    };
    let creator = inner.user_of(bearer_token(&headers));

    for (wanted, resource_type) in [
        (&dto.avatar, "COMMUNITY_AVATAR"),
        (&dto.banner, "COMMUNITY_BANNER"),
    ] {
        let Some(file_id) = wanted.as_ref().filter(|id| !id.is_empty()) else {
            continue;
        };
        let own = lock(&inner.data)
            .files
            .get(file_id)
            .is_some_and(|file| file.uploaded_by == creator && file.resource_type == resource_type);
        if !own {
            return inner.error(
                403,
                "FILE_NOT_OWNED",
                "You can only use images you uploaded",
                false,
            );
        }
    }

    let name = dto.name.to_string();
    let duplicate = inner
        .scenario
        .communities
        .iter()
        .any(|community| community.name == name)
        || lock(&inner.accounts)
            .communities
            .iter()
            .any(|created| created.community.name == name);
    if duplicate {
        return inner.error(409, "CONFLICT", "Duplicate community name", false);
    }

    let community = inner.create_community(
        &creator,
        &name,
        dto.description.map(|text| text.to_string()),
        dto.avatar.filter(|id| !id.is_empty()),
        dto.banner.filter(|id| !id.is_empty()),
    );
    inner.emit_to_user(
        &creator,
        "memberAddedToCommunity",
        json!({ "communityId": community.id, "userId": creator }),
    );
    json_response(
        StatusCode::CREATED,
        serde_json::to_value(CommunityResponseDto {
            avatar: community.avatar,
            banner: community.banner,
            created_at: community.created_at,
            description: community.description,
            id: community.id,
            name: community.name,
        })
        .expect("a community serializes"),
    )
}

/// `MembershipService.acceptInvite`: an existing account joins the communities an invite names.
/// A usable code is required (404 with its message otherwise); each community is joined, or
/// skipped as `already_member` (the invite spends no use on it) or `banned`. The use is redeemed
/// once, only when at least one community is actually joined, as the backend does under its row
/// lock.
async fn accept_invite(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path(code): Path<String>,
) -> Response {
    let user = inner.user_of(bearer_token(&headers));
    let now = inner.now();
    let invite = lock(&inner.accounts)
        .invites
        .iter()
        .find(|invite| invite.code == code && invite.usable(now))
        .cloned();
    let Some(invite) = invite else {
        return inner.error(
            404,
            "NOT_FOUND",
            "No invite found for the provided code.",
            false,
        );
    };

    let mut joined: Vec<serde_json::Value> = Vec::new();
    let mut skipped: Vec<serde_json::Value> = Vec::new();
    let mut pending: Vec<(String, String)> = Vec::new();
    for community_id in &invite.community_ids {
        let name = inner
            .scenario
            .community(community_id)
            .map(|community| community.name.clone())
            .unwrap_or_else(|| community_id.clone());
        if crate::rbac::is_member(&inner, community_id, &user) {
            skipped.push(json!({
                "id": community_id, "name": name, "reason": "already_member",
            }));
        } else {
            pending.push((community_id.clone(), name));
        }
    }
    if pending.is_empty() {
        return json_response(
            StatusCode::OK,
            json!({ "joined": joined, "skipped": skipped }),
        );
    }

    // Redeem first: one use, however many communities follow.
    let redeemed = {
        let mut accounts = lock(&inner.accounts);
        match accounts
            .invites
            .iter_mut()
            .find(|invite| invite.code == code && invite.usable(now))
        {
            Some(invite) => {
                invite.uses += 1;
                true
            }
            None => false,
        }
    };
    if !redeemed {
        return inner.error(
            404,
            "NOT_FOUND",
            "No invite found for the provided code.",
            false,
        );
    }

    for (community_id, name) in pending {
        if crate::rbac::is_banned(&inner, &community_id, &user) {
            skipped.push(json!({ "id": community_id, "name": name, "reason": "banned" }));
            continue;
        }
        crate::rbac::add_member(&inner, &community_id, &user);
        inner.emit_to_user(
            &user,
            "memberAddedToCommunity",
            json!({ "communityId": community_id, "userId": user }),
        );
        joined.push(json!({ "id": community_id, "name": name }));
    }

    json_response(
        StatusCode::OK,
        json!({ "joined": joined, "skipped": skipped }),
    )
}
