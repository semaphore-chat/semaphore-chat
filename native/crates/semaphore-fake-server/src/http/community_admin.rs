//! W5-A's routes: community update and delete, channel CRUD and moves, private channel members,
//! adding members, mention groups, custom emoji and sound management, webhooks and invites.
//!
//! Each handler keeps the backend's order: `ParseUUIDPipe` on path ids (a scenario's ids pass),
//! the RBAC guard (`rbac::allows` with the controller's action, before any lock), then the
//! service's checks and messages, status codes and socket events
//! (`backend/src/{community,channels,channel-membership,membership,alias-groups,custom-emoji,
//! soundboard,webhooks,invite}`). The emoji and sound list routes stay where they were
//! (`communities.rs`, `soundboard.rs`); their POSTs are here.

use super::{bearer_token, json_response, typed};
use crate::admin::{self, AliasGroup};
use crate::{Inner, lock};
use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use semaphore_wire::enums::ChannelType;
use semaphore_wire::types::{
    AliasGroupSummaryDto, AliasGroupWithMembersDto, ChannelDto, ChannelMembershipResponseDto,
    CommunityResponseDto, CreateWebhookResponseDto, CustomEmojiDto, InviteDefaultCommunityDto,
    InviteResponseDto, MembershipResponseDto, SoundboardSoundDto, WebhookDto,
};
use serde_json::json;
use std::sync::Arc;

pub(super) fn routes() -> Router<Arc<Inner>> {
    Router::new()
        .route(
            "/api/community/{id}",
            get(find_community)
                .patch(update_community)
                .delete(delete_community),
        )
        .route("/api/channels", post(create_channel))
        .route(
            "/api/channels/{channelId}",
            axum::routing::patch(update_channel).delete(delete_channel),
        )
        .route("/api/channels/{channelId}/move-up", post(move_up))
        .route("/api/channels/{channelId}/move-down", post(move_down))
        .route("/api/channel-membership", post(add_private))
        .route(
            "/api/channel-membership/channel/{channelId}",
            get(private_members),
        )
        .route(
            "/api/channel-membership/channel/{channelId}/user/{userId}",
            axum::routing::delete(remove_private),
        )
        .route("/api/membership", post(add_member))
        .route(
            "/api/alias-groups/community/{communityId}",
            get(list_groups).post(create_group),
        )
        .route(
            "/api/alias-groups/{groupId}",
            get(get_group).put(rename_group).delete(delete_group),
        )
        .route(
            "/api/alias-groups/{groupId}/members",
            post(add_group_member).put(set_group_members),
        )
        .route(
            "/api/alias-groups/{groupId}/members/{userId}",
            axum::routing::delete(remove_group_member),
        )
        .route(
            "/api/custom-emoji/community/{communityId}/{emojiId}",
            axum::routing::delete(delete_emoji),
        )
        .route(
            "/api/soundboard/community/{communityId}/{soundId}",
            axum::routing::delete(delete_sound),
        )
        .route(
            "/api/channels/{channelId}/webhooks",
            get(list_webhooks).post(create_webhook),
        )
        .route(
            "/api/channels/{channelId}/webhooks/{webhookId}",
            axum::routing::delete(delete_webhook),
        )
        .route("/api/invite", get(list_invites).post(create_invite))
        .route("/api/invite/{code}", axum::routing::delete(delete_invite))
}

pub(super) fn operation_id(method: &Method, route: &str) -> Option<&'static str> {
    Some(match (method.as_str(), route) {
        ("GET", "/api/community/{id}") => "CommunityController_findOne",
        ("PATCH", "/api/community/{id}") => "CommunityController_update",
        ("DELETE", "/api/community/{id}") => "CommunityController_remove",
        ("POST", "/api/channels") => "ChannelsController_create",
        ("PATCH", "/api/channels/{channelId}") => "ChannelsController_update",
        ("DELETE", "/api/channels/{channelId}") => "ChannelsController_remove",
        ("POST", "/api/channels/{channelId}/move-up") => "ChannelsController_moveUp",
        ("POST", "/api/channels/{channelId}/move-down") => "ChannelsController_moveDown",
        ("POST", "/api/channel-membership") => "ChannelMembershipController_create",
        ("GET", "/api/channel-membership/channel/{channelId}") => {
            "ChannelMembershipController_findAllForChannel"
        }
        ("DELETE", "/api/channel-membership/channel/{channelId}/user/{userId}") => {
            "ChannelMembershipController_remove"
        }
        ("POST", "/api/membership") => "MembershipController_create",
        ("GET", "/api/alias-groups/community/{communityId}") => {
            "AliasGroupsController_getCommunityAliasGroups"
        }
        ("POST", "/api/alias-groups/community/{communityId}") => {
            "AliasGroupsController_createAliasGroup"
        }
        ("GET", "/api/alias-groups/{groupId}") => "AliasGroupsController_getAliasGroup",
        ("PUT", "/api/alias-groups/{groupId}") => "AliasGroupsController_updateAliasGroup",
        ("DELETE", "/api/alias-groups/{groupId}") => "AliasGroupsController_deleteAliasGroup",
        ("POST", "/api/alias-groups/{groupId}/members") => "AliasGroupsController_addMember",
        ("PUT", "/api/alias-groups/{groupId}/members") => "AliasGroupsController_updateMembers",
        ("DELETE", "/api/alias-groups/{groupId}/members/{userId}") => {
            "AliasGroupsController_removeMember"
        }
        ("POST", "/api/custom-emoji/community/{communityId}") => {
            "CustomEmojiController_createEmoji"
        }
        ("DELETE", "/api/custom-emoji/community/{communityId}/{emojiId}") => {
            "CustomEmojiController_deleteEmoji"
        }
        ("POST", "/api/soundboard/community/{communityId}") => "SoundboardController_createSound",
        ("DELETE", "/api/soundboard/community/{communityId}/{soundId}") => {
            "SoundboardController_deleteSound"
        }
        ("POST", "/api/channels/{channelId}/webhooks") => "WebhooksController_create",
        ("GET", "/api/channels/{channelId}/webhooks") => "WebhooksController_findAllForChannel",
        ("DELETE", "/api/channels/{channelId}/webhooks/{webhookId}") => "WebhooksController_remove",
        ("GET", "/api/invite") => "InviteController_getInvites",
        ("POST", "/api/invite") => "InviteController_createInvite",
        ("DELETE", "/api/invite/{code}") => "InviteController_deleteInvite",
        _ => return None,
    })
}

// ----- shared ---------------------------------------------------------------------------------

fn me(inner: &Inner, headers: &HeaderMap) -> String {
    inner.user_of(bearer_token(headers))
}

/// Nest's answer when the RBAC guard says no.
fn denied(inner: &Inner) -> Response {
    inner.error(403, "FORBIDDEN", "Forbidden resource", false)
}

fn forbidden(inner: &Inner, message: impl Into<String>) -> Response {
    inner.error(403, "FORBIDDEN", message, false)
}

fn not_found(inner: &Inner, message: &str) -> Response {
    inner.error(404, "NOT_FOUND", message, false)
}

fn conflict(inner: &Inner, message: impl Into<String>) -> Response {
    inner.error(409, "CONFLICT", message, false)
}

fn bad_request(inner: &Inner, message: impl Into<String>) -> Response {
    inner.error(400, "BAD_REQUEST", message, false)
}

fn no_content() -> Response {
    StatusCode::NO_CONTENT.into_response()
}

fn ok(value: impl serde::Serialize) -> Response {
    json_response(
        StatusCode::OK,
        serde_json::to_value(value).expect("a response serializes"),
    )
}

fn created(value: impl serde::Serialize) -> Response {
    json_response(
        StatusCode::CREATED,
        serde_json::to_value(value).expect("a response serializes"),
    )
}

/// `ParseUUIDPipe`: a scenario's own ids (`known`) pass as well.
fn check_uuid(inner: &Inner, id: &str, known: bool) -> Result<(), Response> {
    if crate::social::valid_id(id, known) {
        Ok(())
    } else {
        Err(super::dms::bad_id(inner, "uuid"))
    }
}

fn allows(inner: &Inner, user: &str, community: &str, action: &str) -> Result<(), Response> {
    if crate::rbac::allows(inner, user, community, action) {
        Ok(())
    } else {
        Err(denied(inner))
    }
}

/// The guard on an instance resource. The fake's instance roles (`actions::my_instance_roles`)
/// give everyone but the instance owner `CREATE_COMMUNITY` only, so only the owner (whom
/// `RbacGuard` lets past every check) holds the instance invite actions.
fn allows_instance(inner: &Inner, user: &str, _action: &str) -> Result<(), Response> {
    if crate::rbac::is_owner(inner, user) {
        Ok(())
    } else {
        Err(denied(inner))
    }
}

macro_rules! tri {
    ($result:expr) => {
        match $result {
            Ok(value) => value,
            Err(response) => return response,
        }
    };
}

fn community_dto(community: &crate::scenario::Community) -> CommunityResponseDto {
    CommunityResponseDto {
        avatar: community.avatar.clone(),
        banner: community.banner.clone(),
        created_at: community.created_at,
        description: community.description.clone(),
        id: community.id.clone(),
        name: community.name.clone(),
    }
}

/// The channels `user` sees, as `findAll` orders them: TEXT before VOICE, then by position.
fn visible_channels(
    inner: &Inner,
    community: &crate::scenario::Community,
    user: &str,
) -> Vec<ChannelDto> {
    let mut channels: Vec<ChannelDto> = community
        .channels
        .iter()
        .filter(|channel| admin::sees(inner, channel, user))
        .cloned()
        .collect();
    channels.sort_by(|a, b| {
        let kind = |channel: &ChannelDto| matches!(channel.type_, ChannelType::Voice);
        kind(a)
            .cmp(&kind(b))
            .then(a.position.cmp(&b.position))
            .then(a.created_at.cmp(&b.created_at))
    });
    channels
}

/// The stored file's uploader and kind, if it exists.
fn file_of(inner: &Inner, file_id: &str) -> Option<(String, String)> {
    lock(&inner.data)
        .files
        .get(file_id)
        .map(|file| (file.uploaded_by.clone(), file.resource_type.clone()))
}

// ----- the community --------------------------------------------------------------------------

async fn find_community(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    let user = me(&inner, &headers);
    let found = admin::community(&inner, &id);
    tri!(check_uuid(&inner, &id, found.is_some()));
    tri!(allows(&inner, &user, &id, "READ_COMMUNITY"));
    match found {
        Some(community) => ok(community_dto(&community)),
        None => not_found(&inner, "Community not found"),
    }
}

async fn update_community(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    let user = me(&inner, &headers);
    let found = admin::community(&inner, &id);
    tri!(check_uuid(&inner, &id, found.is_some()));
    tri!(allows(&inner, &user, &id, "UPDATE_COMMUNITY"));
    let update: semaphore_wire::types::UpdateCommunityDto = tri!(typed(&body));
    let Some(current) = found else {
        return not_found(&inner, "Community not found");
    };
    // `assertImagesUsable`: a new image must be one this user uploaded, as that kind.
    for (file_id, existing, kind) in [
        (&update.avatar, &current.avatar, "COMMUNITY_AVATAR"),
        (&update.banner, &current.banner, "COMMUNITY_BANNER"),
    ] {
        if let Some(file_id) = file_id.as_deref().filter(|id| !id.is_empty())
            && Some(file_id) != existing.as_deref()
            && file_of(&inner, file_id).is_none_or(|(by, of)| by != user || of != kind)
        {
            return forbidden(&inner, "You can only use images you uploaded");
        }
    }
    let updated = {
        let mut admin = lock(&inner.admin);
        let Some(community) = admin.community_mut(&inner, &id) else {
            return not_found(&inner, "Community not found");
        };
        if let Some(name) = &update.name {
            community.name = name.to_string();
        }
        if let Some(description) = &update.description {
            community.description = Some(description.to_string());
        }
        if let Some(avatar) = &update.avatar {
            community.avatar = Some(avatar.clone());
        }
        if let Some(banner) = &update.banner {
            community.banner = Some(banner.clone());
        }
        community.clone()
    };
    inner.emit_to_users(
        &admin::member_ids(&inner, &id),
        "communityUpdated",
        json!({
            "communityId": id, "name": updated.name, "description": updated.description,
            "avatar": updated.avatar, "banner": updated.banner,
        }),
    );
    ok(community_dto(&updated))
}

async fn delete_community(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    let user = me(&inner, &headers);
    let found = admin::community(&inner, &id);
    tri!(check_uuid(&inner, &id, found.is_some()));
    tri!(allows(&inner, &user, &id, "DELETE_COMMUNITY"));
    if found.is_none() {
        return not_found(&inner, "Community not found");
    }
    // Told before it goes, while the room still has them.
    inner.emit_to_users(
        &admin::member_ids(&inner, &id),
        "communityDeleted",
        json!({ "communityId": id }),
    );
    let mut admin = lock(&inner.admin);
    admin.communities.remove(&id);
    admin.deleted.insert(id.clone());
    admin.alias_groups.retain(|group| group.community_id != id);
    admin.invites.iter_mut().for_each(|invite| {
        invite
            .default_communities
            .retain(|community| community.community_id != id)
    });
    no_content()
}

// ----- channels -------------------------------------------------------------------------------

async fn create_channel(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let user = me(&inner, &headers);
    let create: semaphore_wire::types::CreateChannelDto = tri!(typed(&body));
    let community_id = create.community_id.to_string();
    tri!(allows(&inner, &user, &community_id, "CREATE_CHANNEL"));
    if matches!(create.type_, ChannelType::Unknown(_)) {
        return super::invalid("type must be one of the following values: TEXT, VOICE");
    }
    let channel = {
        let mut admin = lock(&inner.admin);
        let id = admin.next_id("channel");
        let now = inner.now();
        let Some(community) = admin.community_mut(&inner, &community_id) else {
            return not_found(&inner, "Community not found");
        };
        let name = create.name.to_string();
        if community
            .channels
            .iter()
            .any(|channel| channel.name == name)
        {
            return conflict(
                &inner,
                "Channel with this name already exists in the community",
            );
        }
        let position = community
            .channels
            .iter()
            .filter(|channel| channel.type_ == create.type_)
            .map(|channel| channel.position)
            .max()
            .unwrap_or(-1)
            + 1;
        let channel = ChannelDto {
            community_id: community_id.clone(),
            created_at: now,
            id,
            is_private: create.is_private,
            name,
            position,
            preset: semaphore_wire::enums::ChannelPreset::Normal,
            slowmode_seconds: create.slowmode_seconds.unwrap_or(0),
            type_: create.type_.clone(),
        };
        community.channels.push(channel.clone());
        // The creator is its first member.
        if channel.is_private {
            admin.private_members.insert(
                channel.id.clone(),
                vec![ChannelMembershipResponseDto {
                    added_by: None,
                    channel_id: channel.id.clone(),
                    id: entity(&channel.id, &user),
                    joined_at: now,
                    user: inner.user_entity(&user),
                    user_id: user.clone(),
                }],
            );
        }
        channel
    };
    // The community, or for a hidden channel its creator, its only viewer so far.
    let audience = if channel.is_private {
        vec![user.clone()]
    } else {
        admin::member_ids(&inner, &community_id)
    };
    inner.emit_to_users(
        &audience,
        "channelCreated",
        json!({ "communityId": community_id, "channel": channel }),
    );
    created(channel)
}

fn entity(channel: &str, user: &str) -> String {
    crate::scenario::entity_uuid(&format!("w5a-cm:{channel}:{user}"))
}

async fn update_channel(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    let user = me(&inner, &headers);
    let found = admin::channel_of(&inner, &id);
    tri!(check_uuid(&inner, &id, found.is_some()));
    let Some((community, before)) = found else {
        return not_found(&inner, "Channel not found");
    };
    tri!(allows(&inner, &user, &community.id, "UPDATE_CHANNEL"));
    let update: semaphore_wire::types::UpdateChannelDto = tri!(typed(&body));
    let privacy_changes = update
        .is_private
        .is_some_and(|private| private != before.is_private);
    if privacy_changes
        && !crate::rbac::allows(&inner, &user, &community.id, "MANAGE_CHANNEL_PERMISSIONS")
    {
        return forbidden(
            &inner,
            "Changing channel privacy requires the manage channel permissions permission",
        );
    }
    let updated = {
        let mut admin = lock(&inner.admin);
        let Some(community) = admin.community_mut(&inner, &community.id) else {
            return not_found(&inner, "Channel not found");
        };
        if let Some(name) = &update.name
            && community
                .channels
                .iter()
                .any(|channel| channel.id != id && channel.name == name.to_string())
        {
            return conflict(
                &inner,
                "Channel with this name already exists in the community",
            );
        }
        let Some(channel) = community.channels.iter_mut().find(|c| c.id == id) else {
            return not_found(&inner, "Channel not found");
        };
        if let Some(name) = &update.name {
            channel.name = name.to_string();
        }
        if let Some(private) = update.is_private {
            channel.is_private = private;
        }
        if let Some(slowmode) = update.slowmode_seconds {
            channel.slowmode_seconds = slowmode;
        }
        if let Some(position) = update.position {
            channel.position = position as i64;
        }
        channel.clone()
    };
    if privacy_changes {
        inner.emit_to_users(
            &admin::member_ids(&inner, &community.id),
            "channelPermissionsUpdated",
            json!({ "communityId": community.id, "channelId": id }),
        );
    }
    inner.emit_to_users(
        &admin::audience(&inner, &updated),
        "channelUpdated",
        json!({ "communityId": community.id, "channel": updated }),
    );
    ok(updated)
}

async fn delete_channel(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    let user = me(&inner, &headers);
    let found = admin::channel_of(&inner, &id);
    tri!(check_uuid(&inner, &id, found.is_some()));
    let Some((community, channel)) = found else {
        return not_found(&inner, "Channel not found");
    };
    tri!(allows(&inner, &user, &community.id, "DELETE_CHANNEL"));
    // Told before it goes, and only whoever could see it.
    inner.emit_to_users(
        &admin::audience(&inner, &channel),
        "channelDeleted",
        json!({ "communityId": community.id, "channelId": id }),
    );
    let mut admin = lock(&inner.admin);
    if let Some(community) = admin.community_mut(&inner, &community.id) {
        community.channels.retain(|channel| channel.id != id);
    }
    admin.private_members.remove(&id);
    admin
        .webhooks
        .retain(|(webhook, _)| webhook.channel_id != id);
    no_content()
}

async fn move_up(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    move_channel(&inner, &headers, &id, &body, true)
}

async fn move_down(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    move_channel(&inner, &headers, &id, &body, false)
}

/// `moveChannelUp`/`moveChannelDown`: positions made unique per kind, a swap with the neighbour of
/// the same kind (none at the end: nothing changes), `channelsReordered` with the public channels
/// to the community, and the caller's visible list.
fn move_channel(inner: &Inner, headers: &HeaderMap, id: &str, body: &Bytes, up: bool) -> Response {
    let user = me(inner, headers);
    tri!(check_uuid(
        inner,
        id,
        admin::channel_of(inner, id).is_some()
    ));
    let moved: semaphore_wire::types::MoveChannelDto = tri!(typed(body));
    let community_id = moved.community_id.to_string();
    tri!(allows(inner, &user, &community_id, "UPDATE_CHANNEL"));
    let (community, swapped) = {
        let mut admin = lock(&inner.admin);
        let Some(community) = admin.community_mut(inner, &community_id) else {
            return not_found(inner, "Channel not found");
        };
        let Some(kind) = community
            .channels
            .iter()
            .find(|channel| channel.id == id)
            .map(|channel| channel.type_.clone())
        else {
            return not_found(inner, "Channel not found");
        };
        // `normalizePositions`, for this kind.
        let mut same: Vec<usize> = (0..community.channels.len())
            .filter(|index| community.channels[*index].type_ == kind)
            .collect();
        same.sort_by_key(|index| {
            let channel = &community.channels[*index];
            (channel.position, channel.created_at)
        });
        for (position, index) in same.iter().enumerate() {
            community.channels[*index].position = position as i64;
        }
        let at = same
            .iter()
            .position(|index| community.channels[*index].id == id)
            .expect("the channel is of its kind");
        let other = if up { at.checked_sub(1) } else { Some(at + 1) };
        let swapped = match other.filter(|other| *other < same.len()) {
            Some(other) => {
                let (a, b) = (same[at], same[other]);
                let position = community.channels[a].position;
                community.channels[a].position = community.channels[b].position;
                community.channels[b].position = position;
                true
            }
            None => false,
        };
        (community.clone(), swapped)
    };
    if swapped {
        let public: Vec<&ChannelDto> = community
            .channels
            .iter()
            .filter(|channel| !channel.is_private)
            .collect();
        inner.emit_to_users(
            &admin::member_ids(inner, &community_id),
            "channelsReordered",
            json!({ "communityId": community_id, "channels": public }),
        );
    }
    ok(visible_channels(inner, &community, &user))
}

// ----- private channel members ----------------------------------------------------------------

async fn add_private(State(inner): State<Arc<Inner>>, headers: HeaderMap, body: Bytes) -> Response {
    let actor = me(&inner, &headers);
    let create: semaphore_wire::types::CreateChannelMembershipDto = tri!(typed(&body));
    let (channel_id, user_id) = (create.channel_id.to_string(), create.user_id.to_string());
    let Some((community, channel)) = admin::channel_of(&inner, &channel_id) else {
        // The guard can't resolve the channel's community.
        return denied(&inner);
    };
    tri!(allows(&inner, &actor, &community.id, "CREATE_MEMBER"));
    if !channel.is_private {
        return forbidden(
            &inner,
            "Cannot manage membership for public channels - users automatically join public channels when they join the community",
        );
    }
    if inner.user_entity(&user_id).is_none() {
        return not_found(&inner, "User not found");
    }
    if !admin::is_member(&inner, &community.id, &user_id) {
        return forbidden(
            &inner,
            "User must be a member of the community before being added to a private channel",
        );
    }
    let row = {
        let mut admin = lock(&inner.admin);
        admin.seed(&inner);
        let members = admin.private_members.entry(channel_id.clone()).or_default();
        if members.iter().any(|member| member.user_id == user_id) {
            return conflict(&inner, "User is already a member of this channel");
        }
        let row = ChannelMembershipResponseDto {
            added_by: Some(actor),
            channel_id: channel_id.clone(),
            id: entity(&channel_id, &user_id),
            joined_at: inner.now(),
            user: None,
            user_id: user_id.clone(),
        };
        members.push(ChannelMembershipResponseDto {
            user: inner.user_entity(&user_id),
            ..row.clone()
        });
        row
    };
    // The backend tells nobody (#682's private-channel ask): only its rooms change.
    created(row)
}

async fn private_members(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path(channel_id): Path<String>,
) -> Response {
    let actor = me(&inner, &headers);
    let found = admin::channel_of(&inner, &channel_id);
    tri!(check_uuid(&inner, &channel_id, found.is_some()));
    let Some((community, channel)) = found else {
        return not_found(&inner, "Channel not found");
    };
    tri!(allows(&inner, &actor, &community.id, "READ_MEMBER"));
    if !channel.is_private {
        return forbidden(
            &inner,
            "This endpoint is only for private channels. Public channel members are managed automatically through community membership.",
        );
    }
    let mut admin = lock(&inner.admin);
    admin.seed(&inner);
    ok(admin
        .private_members
        .get(&channel_id)
        .cloned()
        .unwrap_or_default())
}

async fn remove_private(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path((channel_id, user_id)): Path<(String, String)>,
) -> Response {
    let actor = me(&inner, &headers);
    let found = admin::channel_of(&inner, &channel_id);
    tri!(check_uuid(&inner, &channel_id, found.is_some()));
    tri!(check_uuid(
        &inner,
        &user_id,
        inner.user_entity(&user_id).is_some()
    ));
    let Some((community, channel)) = found else {
        return not_found(&inner, "Channel not found");
    };
    tri!(allows(&inner, &actor, &community.id, "DELETE_MEMBER"));
    if !channel.is_private {
        return forbidden(
            &inner,
            "Cannot manage membership for public channels - users automatically leave public channels when they leave the community",
        );
    }
    let mut admin = lock(&inner.admin);
    admin.seed(&inner);
    let Some(members) = admin.private_members.get_mut(&channel_id) else {
        return not_found(&inner, "Channel membership not found");
    };
    let before = members.len();
    members.retain(|member| member.user_id != user_id);
    if members.len() == before {
        return not_found(&inner, "Channel membership not found");
    }
    no_content()
}

// ----- adding members -------------------------------------------------------------------------

async fn add_member(State(inner): State<Arc<Inner>>, headers: HeaderMap, body: Bytes) -> Response {
    let actor = me(&inner, &headers);
    let create: semaphore_wire::types::CreateMembershipDto = tri!(typed(&body));
    let (community_id, user_id) = (create.community_id.to_string(), create.user_id.to_string());
    tri!(allows(&inner, &actor, &community_id, "CREATE_MEMBER"));
    let Some(user) = inner.user_entity(&user_id) else {
        return not_found(&inner, "User or community not found");
    };
    if admin::community(&inner, &community_id).is_none() {
        return not_found(&inner, "User or community not found");
    }
    if admin::is_member(&inner, &community_id, &user_id) {
        return conflict(&inner, "User is already a member of this community");
    }
    if crate::rbac::is_banned(&inner, &community_id, &user_id) {
        return forbidden(&inner, "You are banned from this community");
    }
    let row = {
        let mut admin = lock(&inner.admin);
        let row = MembershipResponseDto {
            community: None,
            community_id: community_id.clone(),
            id: admin.next_id("membership"),
            joined_at: inner.now(),
            roles: Vec::new(),
            user: Some(user),
            user_id: user_id.clone(),
        };
        admin
            .members
            .entry(community_id.clone())
            .or_default()
            .push(row.clone());
        row
    };
    // W5-B's model: a member now, with the default Member role.
    crate::rbac::add_member(&inner, &community_id, &user_id);
    inner.emit_to_user(
        &user_id,
        "memberAddedToCommunity",
        json!({ "communityId": community_id, "userId": user_id }),
    );
    created(MembershipResponseDto { user: None, ..row })
}

// ----- mention groups -------------------------------------------------------------------------

fn group_dto(inner: &Inner, group: &AliasGroup) -> AliasGroupWithMembersDto {
    AliasGroupWithMembersDto {
        community_id: group.community_id.clone(),
        created_at: group.created_at,
        id: group.id.clone(),
        member_count: group.members.len() as i64,
        members: group
            .members
            .iter()
            .map(|user| admin::alias_member(inner, user))
            .collect(),
        name: group.name.clone(),
    }
}

/// The group, for a route on it: 404 when there's none (the guard's lookup).
fn group_of(
    inner: &Inner,
    user: &str,
    group_id: &str,
    action: &str,
) -> Result<AliasGroup, Response> {
    let group = lock(&inner.admin).group(group_id).cloned();
    check_uuid(inner, group_id, group.is_some())?;
    let Some(group) = group else {
        return Err(not_found(inner, "Alias group not found"));
    };
    allows(inner, user, &group.community_id, action)?;
    Ok(group)
}

/// Ids that aren't the community's members, as the service lists them.
fn not_members(inner: &Inner, community_id: &str, ids: &[String]) -> Option<Response> {
    let invalid: Vec<&str> = ids
        .iter()
        .filter(|id| !admin::is_member(inner, community_id, id))
        .map(String::as_str)
        .collect();
    (!invalid.is_empty()).then(|| {
        bad_request(
            inner,
            format!(
                "Users not members of this community: {}",
                invalid.join(", ")
            ),
        )
    })
}

async fn list_groups(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path(community_id): Path<String>,
) -> Response {
    let user = me(&inner, &headers);
    tri!(check_uuid(
        &inner,
        &community_id,
        admin::community(&inner, &community_id).is_some()
    ));
    tri!(allows(&inner, &user, &community_id, "READ_ALIAS_GROUP"));
    let mut groups: Vec<AliasGroupSummaryDto> = lock(&inner.admin)
        .alias_groups
        .iter()
        .filter(|group| group.community_id == community_id)
        .map(|group| AliasGroupSummaryDto {
            community_id: group.community_id.clone(),
            id: group.id.clone(),
            member_count: group.members.len() as i64,
            name: group.name.clone(),
        })
        .collect();
    groups.sort_by(|a, b| a.name.cmp(&b.name));
    ok(groups)
}

async fn create_group(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path(community_id): Path<String>,
    body: Bytes,
) -> Response {
    let user = me(&inner, &headers);
    tri!(check_uuid(
        &inner,
        &community_id,
        admin::community(&inner, &community_id).is_some()
    ));
    tri!(allows(&inner, &user, &community_id, "CREATE_ALIAS_GROUP"));
    let create: semaphore_wire::types::CreateAliasGroupDto = tri!(typed(&body));
    let name = create.name.to_string();
    let members: Vec<String> = create.member_ids.iter().map(ToString::to_string).collect();
    let taken = lock(&inner.admin)
        .alias_groups
        .iter()
        .any(|group| group.community_id == community_id && group.name == name);
    if taken {
        return conflict(
            &inner,
            format!("Alias group \"{name}\" already exists in this community"),
        );
    }
    if let Some(refused) = not_members(&inner, &community_id, &members) {
        return refused;
    }
    let group = {
        let mut admin = lock(&inner.admin);
        let group = AliasGroup {
            id: admin.next_id("alias-group"),
            community_id,
            name,
            created_at: inner.now(),
            members,
        };
        admin.alias_groups.push(group.clone());
        group
    };
    created(group_dto(&inner, &group))
}

async fn get_group(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path(group_id): Path<String>,
) -> Response {
    let user = me(&inner, &headers);
    let group = tri!(group_of(&inner, &user, &group_id, "READ_ALIAS_GROUP"));
    ok(group_dto(&inner, &group))
}

async fn rename_group(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path(group_id): Path<String>,
    body: Bytes,
) -> Response {
    let user = me(&inner, &headers);
    let group = tri!(group_of(&inner, &user, &group_id, "UPDATE_ALIAS_GROUP"));
    let update: semaphore_wire::types::UpdateAliasGroupDto = tri!(typed(&body));
    let name = update.name.to_string();
    let renamed = {
        let mut admin = lock(&inner.admin);
        if name != group.name
            && admin
                .alias_groups
                .iter()
                .any(|other| other.community_id == group.community_id && other.name == name)
        {
            return conflict(
                &inner,
                format!("Alias group \"{name}\" already exists in this community"),
            );
        }
        let Some(stored) = admin.alias_groups.iter_mut().find(|g| g.id == group_id) else {
            return not_found(&inner, "Alias group not found");
        };
        stored.name = name;
        stored.clone()
    };
    ok(group_dto(&inner, &renamed))
}

async fn delete_group(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path(group_id): Path<String>,
) -> Response {
    let user = me(&inner, &headers);
    tri!(group_of(&inner, &user, &group_id, "DELETE_ALIAS_GROUP"));
    lock(&inner.admin)
        .alias_groups
        .retain(|group| group.id != group_id);
    no_content()
}

async fn add_group_member(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path(group_id): Path<String>,
    body: Bytes,
) -> Response {
    let user = me(&inner, &headers);
    let group = tri!(group_of(
        &inner,
        &user,
        &group_id,
        "CREATE_ALIAS_GROUP_MEMBER"
    ));
    let add: semaphore_wire::types::AddMemberDto = tri!(typed(&body));
    let member = add.user_id.to_string();
    if !admin::is_member(&inner, &group.community_id, &member) {
        return bad_request(&inner, "User is not a member of this community");
    }
    let mut admin = lock(&inner.admin);
    let Some(stored) = admin.alias_groups.iter_mut().find(|g| g.id == group_id) else {
        return not_found(&inner, "Alias group not found");
    };
    if stored.members.contains(&member) {
        return conflict(&inner, "User is already a member of this group");
    }
    stored.members.push(member);
    no_content()
}

async fn remove_group_member(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path((group_id, member)): Path<(String, String)>,
) -> Response {
    let user = me(&inner, &headers);
    tri!(group_of(
        &inner,
        &user,
        &group_id,
        "DELETE_ALIAS_GROUP_MEMBER"
    ));
    tri!(check_uuid(
        &inner,
        &member,
        inner.user_entity(&member).is_some()
    ));
    let mut admin = lock(&inner.admin);
    let Some(stored) = admin.alias_groups.iter_mut().find(|g| g.id == group_id) else {
        return not_found(&inner, "Alias group not found");
    };
    let before = stored.members.len();
    stored.members.retain(|id| *id != member);
    if stored.members.len() == before {
        return not_found(&inner, "User is not a member of this group");
    }
    no_content()
}

async fn set_group_members(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path(group_id): Path<String>,
    body: Bytes,
) -> Response {
    let user = me(&inner, &headers);
    let group = tri!(group_of(
        &inner,
        &user,
        &group_id,
        "UPDATE_ALIAS_GROUP_MEMBER"
    ));
    let update: semaphore_wire::types::UpdateMembersDto = tri!(typed(&body));
    let mut members: Vec<String> = Vec::new();
    for id in update.member_ids.iter().map(ToString::to_string) {
        if !members.contains(&id) {
            members.push(id);
        }
    }
    if let Some(refused) = not_members(&inner, &group.community_id, &members) {
        return refused;
    }
    let mut admin = lock(&inner.admin);
    if let Some(stored) = admin.alias_groups.iter_mut().find(|g| g.id == group_id) {
        stored.members = members;
    }
    no_content()
}

// ----- custom emoji and sounds ----------------------------------------------------------------

/// `POST /custom-emoji/community/{communityId}`; its GET is in `communities.rs`.
pub(super) async fn create_emoji(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path(community_id): Path<String>,
    body: Bytes,
) -> Response {
    let user = me(&inner, &headers);
    tri!(check_uuid(
        &inner,
        &community_id,
        admin::community(&inner, &community_id).is_some()
    ));
    tri!(allows(&inner, &user, &community_id, "MANAGE_EMOJIS"));
    let create: semaphore_wire::types::CreateCustomEmojiDto = tri!(typed(&body));
    if !crate_emoji_name_ok(&create.name) {
        return super::invalid(
            "Name must be 2-32 lowercase letters, digits or underscores, with at least one letter",
        );
    }
    let in_use = crate::messages::emojis_in_use(&inner, &community_id);
    let listed = admin::emojis(&inner, &community_id, in_use);
    if listed
        .iter()
        .any(|emoji| emoji["name"] == create.name.as_str())
    {
        return conflict(
            &inner,
            format!(
                "An emoji named \":{}:\" already exists in this community",
                create.name
            ),
        );
    }
    let file_id = create.file_id.to_string();
    match file_of(&inner, &file_id) {
        None => return not_found(&inner, "Emoji image file not found"),
        Some((_, kind)) if kind != "CUSTOM_EMOJI" => {
            return bad_request(&inner, "File is not a custom emoji image");
        }
        Some(_) => {}
    }
    let emoji = {
        let mut admin = lock(&inner.admin);
        let emoji = CustomEmojiDto {
            community_id: community_id.clone(),
            created_at: inner.now(),
            created_by: Some(user),
            file_id,
            id: admin.next_id("emoji"),
            name: create.name,
        };
        admin
            .emojis
            .entry(community_id)
            .or_default()
            .push(emoji.clone());
        emoji
    };
    created(emoji)
}

fn crate_emoji_name_ok(name: &str) -> bool {
    (2..=32).contains(&name.len())
        && name
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
        && name.bytes().any(|byte| byte.is_ascii_lowercase())
}

async fn delete_emoji(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path((community_id, emoji_id)): Path<(String, String)>,
) -> Response {
    let user = me(&inner, &headers);
    tri!(check_uuid(
        &inner,
        &community_id,
        admin::community(&inner, &community_id).is_some()
    ));
    tri!(check_uuid(&inner, &emoji_id, false));
    tri!(allows(&inner, &user, &community_id, "MANAGE_EMOJIS"));
    let in_use = crate::messages::emojis_in_use(&inner, &community_id);
    let listed = admin::emojis(&inner, &community_id, in_use);
    if !listed.iter().any(|emoji| emoji["id"] == emoji_id.as_str()) {
        return not_found(&inner, "Custom emoji not found");
    }
    let mut admin = lock(&inner.admin);
    admin.removed_assets.insert(emoji_id.clone());
    if let Some(emojis) = admin.emojis.get_mut(&community_id) {
        emojis.retain(|emoji| emoji.id != emoji_id);
    }
    no_content()
}

/// `POST /soundboard/community/{communityId}`; its GET is in `soundboard.rs`.
pub(super) async fn create_sound(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path(community_id): Path<String>,
    body: Bytes,
) -> Response {
    let user = me(&inner, &headers);
    tri!(check_uuid(
        &inner,
        &community_id,
        admin::community(&inner, &community_id).is_some()
    ));
    tri!(allows(
        &inner,
        &user,
        &community_id,
        "CREATE_SOUNDBOARD_SOUND"
    ));
    let create: semaphore_wire::types::CreateSoundboardSoundDto = tri!(typed(&body));
    let name = create.name.to_string();
    let listed = super::soundboard::listed(&inner, &community_id);
    if listed.iter().any(|sound| sound.name == name) {
        return conflict(
            &inner,
            format!("A soundboard sound named \"{name}\" already exists in this community"),
        );
    }
    let file_id = create.file_id.to_string();
    match file_of(&inner, &file_id) {
        None => return not_found(&inner, "Referenced file not found"),
        Some((_, kind)) if kind != "SOUNDBOARD_SOUND" => {
            return bad_request(&inner, "File is not a soundboard sound for this community");
        }
        Some(_) => {}
    }
    if listed.iter().any(|sound| sound.file_id == file_id) {
        return conflict(
            &inner,
            "This audio file is already used by another soundboard sound",
        );
    }
    let sound = {
        let mut admin = lock(&inner.admin);
        let sound = SoundboardSoundDto {
            community_id: community_id.clone(),
            created_at: inner.now(),
            created_by: Some(user),
            emoji: create.emoji.map(|emoji| emoji.to_string()),
            file_id,
            id: admin.next_id("sound"),
            name,
        };
        admin
            .sounds
            .entry(community_id)
            .or_default()
            .push(sound.clone());
        sound
    };
    created(sound)
}

async fn delete_sound(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path((community_id, sound_id)): Path<(String, String)>,
) -> Response {
    let user = me(&inner, &headers);
    tri!(check_uuid(
        &inner,
        &community_id,
        admin::community(&inner, &community_id).is_some()
    ));
    tri!(check_uuid(&inner, &sound_id, false));
    tri!(allows(
        &inner,
        &user,
        &community_id,
        "DELETE_SOUNDBOARD_SOUND"
    ));
    let listed = super::soundboard::listed(&inner, &community_id);
    if !listed.iter().any(|sound| sound.id == sound_id) {
        return not_found(&inner, "Soundboard sound not found");
    }
    let mut admin = lock(&inner.admin);
    admin.removed_assets.insert(sound_id.clone());
    if let Some(sounds) = admin.sounds.get_mut(&community_id) {
        sounds.retain(|sound| sound.id != sound_id);
    }
    no_content()
}

// ----- webhooks -------------------------------------------------------------------------------

fn webhook_channel(inner: &Inner, user: &str, channel_id: &str) -> Result<ChannelDto, Response> {
    let found = admin::channel_of(inner, channel_id);
    check_uuid(inner, channel_id, found.is_some())?;
    let Some((community, channel)) = found else {
        // The guard can't place the channel in a community.
        return Err(denied(inner));
    };
    allows(inner, user, &community.id, "MANAGE_WEBHOOKS")?;
    Ok(channel)
}

async fn create_webhook(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path(channel_id): Path<String>,
    body: Bytes,
) -> Response {
    let user = me(&inner, &headers);
    let channel = tri!(webhook_channel(&inner, &user, &channel_id));
    let create: semaphore_wire::types::CreateWebhookDto = tri!(typed(&body));
    if channel.type_ != ChannelType::Text {
        return bad_request(&inner, "Webhooks can only be created for text channels");
    }
    let mut admin = lock(&inner.admin);
    let id = admin.next_id("webhook");
    let token = format!("{:064x}", admin.webhooks.len() as u128 + 0x5ec7e7);
    let webhook = WebhookDto {
        avatar_url: create.avatar_url,
        channel_id,
        created_at: inner.now(),
        id: id.clone(),
        name: create.name.to_string(),
    };
    admin.webhooks.push((webhook.clone(), token.clone()));
    // Without PUBLIC_APP_URL the backend answers the path alone.
    created(CreateWebhookResponseDto {
        avatar_url: webhook.avatar_url,
        channel_id: webhook.channel_id,
        created_at: webhook.created_at,
        id: webhook.id,
        name: webhook.name,
        url: format!("/api/webhooks/{id}/{token}"),
    })
}

async fn list_webhooks(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path(channel_id): Path<String>,
) -> Response {
    let user = me(&inner, &headers);
    tri!(webhook_channel(&inner, &user, &channel_id));
    let webhooks: Vec<WebhookDto> = lock(&inner.admin)
        .webhooks
        .iter()
        .filter(|(webhook, _)| webhook.channel_id == channel_id)
        .map(|(webhook, _)| webhook.clone())
        .take(100)
        .collect();
    ok(webhooks)
}

async fn delete_webhook(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path((channel_id, webhook_id)): Path<(String, String)>,
) -> Response {
    let user = me(&inner, &headers);
    tri!(webhook_channel(&inner, &user, &channel_id));
    let mut admin = lock(&inner.admin);
    let before = admin.webhooks.len();
    admin
        .webhooks
        .retain(|(webhook, _)| !(webhook.id == webhook_id && webhook.channel_id == channel_id));
    if admin.webhooks.len() == before {
        return not_found(&inner, "Webhook not found");
    }
    no_content()
}

// ----- invites --------------------------------------------------------------------------------

async fn list_invites(State(inner): State<Arc<Inner>>, headers: HeaderMap) -> Response {
    let user = me(&inner, &headers);
    tri!(allows_instance(&inner, &user, "READ_INSTANCE_INVITE"));
    let creator = inner.user_entity(&user);
    let mut invites: Vec<InviteResponseDto> = lock(&inner.admin)
        .invites
        .iter()
        .filter(|invite| invite.created_by_id.as_deref() == Some(user.as_str()))
        .cloned()
        .map(|mut invite| {
            invite.created_by =
                creator
                    .as_ref()
                    .map(|creator| semaphore_wire::types::InviteCreatorDto {
                        display_name: creator.display_name.clone(),
                        id: creator.id.clone(),
                        username: creator.username.clone(),
                    });
            invite
        })
        .collect();
    invites.sort_by_key(|invite| std::cmp::Reverse(invite.created_at));
    ok(invites)
}

/// `createInvite`: instance CREATE_INSTANCE_INVITE (the guard), then community CREATE_INVITE for
/// each community it names. The invite also works for registration (W3's store).
async fn create_invite(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let user = me(&inner, &headers);
    tri!(allows_instance(&inner, &user, "CREATE_INSTANCE_INVITE"));
    let create: semaphore_wire::types::CreateInviteDto = tri!(typed(&body));
    let communities: Vec<String> = create
        .community_ids
        .iter()
        .map(ToString::to_string)
        .collect();
    for community in &communities {
        if !crate::rbac::allows(&inner, &user, community, "CREATE_INVITE") {
            return forbidden(
                &inner,
                format!("You don't have permission to invite to community {community}"),
            );
        }
    }
    let invite = {
        let mut admin = lock(&inner.admin);
        let id = admin.next_id("invite");
        let code = format!("w5a{:05}", admin.invites.len() + 1);
        let invite = InviteResponseDto {
            code,
            created_at: inner.now(),
            created_by: None,
            created_by_id: Some(user.clone()),
            default_communities: communities
                .iter()
                .map(|community| InviteDefaultCommunityDto {
                    community_id: community.clone(),
                    id: crate::scenario::entity_uuid(&format!("w5a-dc:{id}:{community}")),
                })
                .collect(),
            disabled: false,
            id,
            max_uses: create.max_uses.map(|max| max.get() as i64),
            usages: Vec::new(),
            uses: 0,
            valid_until: create.valid_until,
        };
        admin.invites.push(invite.clone());
        invite
    };
    let username = inner.user_entity(&user).map(|user| user.username);
    lock(&inner.accounts).invites.push(crate::accounts::Invite {
        code: invite.code.clone(),
        uses: 0,
        max_uses: invite.max_uses,
        valid_until: invite.valid_until,
        disabled: false,
        created_by: username,
    });
    created(invite)
}

async fn delete_invite(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path(code): Path<String>,
) -> Response {
    let user = me(&inner, &headers);
    tri!(allows_instance(&inner, &user, "DELETE_INSTANCE_INVITE"));
    {
        let mut admin = lock(&inner.admin);
        let Some(index) = admin.invites.iter().position(|invite| invite.code == code) else {
            return not_found(&inner, "Invite not found");
        };
        // Only the creator, whatever the role (the comment says admins bypass; they don't).
        if admin.invites[index].created_by_id.as_deref() != Some(user.as_str()) {
            return forbidden(&inner, "Unauthorized to delete this invite");
        }
        admin.invites.remove(index);
    }
    lock(&inner.accounts)
        .invites
        .retain(|invite| invite.code != code);
    no_content()
}
