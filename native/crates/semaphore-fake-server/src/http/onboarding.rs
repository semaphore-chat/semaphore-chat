//! Joining an instance: registration, the public invite lookup, password-reset requests and
//! creating a community.

use super::{bearer_token, invalid, json_response, typed};
use crate::accounts::{new_user, plausible_email};
use crate::{Inner, lock};
use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
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
        .route("/api/community", post(create_community))
}

pub(super) fn operation_id(method: &Method, route: &str) -> Option<&'static str> {
    Some(match (method.as_str(), route) {
        ("POST", "/api/users") => "UserController_register",
        ("POST", "/api/auth/forgot-password") => "AuthController_forgotPassword",
        ("GET", "/api/invite/public/{code}") => "InviteController_getPublicInvite",
        ("POST", "/api/community") => "CommunityController_create",
        _ => return None,
    })
}

/// `UserService.createUser`. A usable invite is required whatever the registration mode (an
/// unknown, expired, used-up or disabled code is a 404, checked before any name), then a taken
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
    let now = inner.now();
    let username = dto.username.to_lowercase();
    let mut accounts = lock(&inner.accounts);

    let invite = accounts
        .invites
        .iter()
        .position(|invite| invite.code == dto.code && invite.usable(now));
    let Some(invite) = invite else {
        drop(accounts);
        return inner.error(
            404,
            "NOT_FOUND",
            "No invite found for the provided code.",
            false,
        );
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
    accounts.invites[invite].uses += 1;
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

/// `InviteService.getPublicInvite`: what the join screen shows. The backend returns `null` for an
/// unknown, expired, used-up or disabled invite, which Nest sends as a 200 with an empty body, so
/// does this.
async fn public_invite(State(inner): State<Arc<Inner>>, Path(code): Path<String>) -> Response {
    let now = inner.now();
    let accounts = lock(&inner.accounts);
    let Some(invite) = accounts
        .invites
        .iter()
        .find(|invite| invite.code == code && invite.usable(now))
    else {
        drop(accounts);
        return StatusCode::OK.into_response();
    };
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
    drop(accounts);
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
