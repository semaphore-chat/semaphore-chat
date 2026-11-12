//! Accounts, sessions, invites and sign-in with browser (W3): the store and its rules.
//!
//! The rules are the backend's (`backend/src/{auth,user,invite,community,appearance-settings}`);
//! each function says which. Everything is under one lock, [`Inner::accounts`]; never hold it across
//! an `.await` or while taking the data lock.
//!
//! Who is signed in: a bearer token that belongs to a session is that session's user. Any other
//! non-empty bearer (the rest of the fake accepts any) is the scenario's `me`, and is adopted as a
//! session of `me` the first time a session route needs one.

use crate::scenario::{Community, entity_uuid};
use crate::{Inner, lock};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use chrono::{DateTime, Duration, Utc};
use semaphore_wire::enums::{ChannelPreset, ChannelType, InstanceRole};
use semaphore_wire::types::{
    AppearanceSettingsResponseDto, ChannelDto, MembershipResponseDto, UserEntity,
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap};

/// How long an approved desktop sign-in grant can be redeemed (`APPROVED_GRANT_TTL_SECONDS`).
pub(crate) const GRANT_TTL: Duration = Duration::seconds(60);
/// How long a session lasts, from its start.
const SESSION_LIFETIME: Duration = Duration::days(30);
/// The tokens the first sign-in gets: what the fake has always handed out.
const LEGACY_ACCESS: &str = "fake-access-token";
const LEGACY_REFRESH: &str = "fake-refresh-token";

/// An invite for a test to plant: what `GET /api/invite/public/{code}` shows and registration
/// checks. Expired, used up and disabled are each a field.
#[derive(Clone, Debug)]
pub struct InviteSeed {
    pub code: String,
    pub uses: i64,
    pub max_uses: Option<i64>,
    pub valid_until: Option<DateTime<Utc>>,
    pub disabled: bool,
    /// The username shown as who created it.
    pub created_by: Option<String>,
    /// The communities an existing account joins with `POST /api/invite/{code}/accept`.
    pub community_ids: Vec<String>,
}

impl InviteSeed {
    /// A good invite: unlimited, never expiring, enabled.
    pub fn new(code: &str) -> Self {
        Self {
            code: code.to_owned(),
            uses: 0,
            max_uses: None,
            valid_until: None,
            disabled: false,
            created_by: Some("inviter".to_owned()),
            community_ids: Vec::new(),
        }
    }
}

/// A session a test added, and the tokens that act as it.
#[derive(Clone, Debug)]
pub struct SeededSession {
    pub id: String,
    pub access_token: String,
    pub refresh_token: String,
}

/// When `PATCH /api/users/profile` sends `userProfileUpdated`, relative to its reply.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ProfileOrder {
    /// The event is queued, then the reply goes out: the order the two reach a client is not set.
    #[default]
    Race,
    /// The reply waits until the event has been written to the sockets.
    EventThenReply,
    /// The event is held back until [`crate::FakeServer::release_held_events`], so the reply
    /// always arrives first.
    ReplyThenEvent,
}

pub(crate) struct Credential {
    pub user_id: String,
    pub password: String,
    pub email: Option<String>,
}

pub(crate) struct Session {
    pub id: String,
    pub user_id: String,
    /// Every access token this session has had: a socket that connected with an old one is still
    /// this session's.
    pub tokens: Vec<String>,
    pub access: String,
    pub refresh: String,
    pub device_name: String,
    pub ip: Option<String>,
    pub created_at: DateTime<Utc>,
    pub last_used_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub revoked: bool,
}

#[derive(Clone)]
pub(crate) struct Invite {
    pub code: String,
    pub uses: i64,
    pub max_uses: Option<i64>,
    pub valid_until: Option<DateTime<Utc>>,
    pub disabled: bool,
    pub created_by: Option<String>,
    /// The communities an existing account joins when it accepts this invite.
    pub community_ids: Vec<String>,
}

impl Invite {
    /// `validateInviteCode` / `getPublicInvite`: not disabled, not expired, not used up.
    pub fn usable(&self, now: DateTime<Utc>) -> bool {
        !self.disabled
            && self.valid_until.is_none_or(|until| now <= until)
            && self.max_uses.is_none_or(|max| self.uses < max)
    }
}

pub(crate) struct Grant {
    pub challenge: String,
    pub user_id: String,
    pub approved_at: DateTime<Utc>,
    pub approver_revoked: bool,
}

/// A community someone created over the API, with its members.
pub(crate) struct CreatedCommunity {
    pub community: Community,
    pub members: Vec<MembershipResponseDto>,
}

/// A socket event to send once the lock is dropped.
pub(crate) struct HeldEvent {
    pub users: Vec<String>,
    pub event: &'static str,
    pub payload: Value,
}

pub(crate) struct Accounts {
    /// Users registered here, and scenario users whose profile was edited: the whole row.
    pub users: BTreeMap<String, UserEntity>,
    /// By lowercase username. Only registered users have one; the fake signs anyone else in as `me`.
    pub credentials: HashMap<String, Credential>,
    pub sessions: Vec<Session>,
    pub invites: Vec<Invite>,
    pub grants: HashMap<String, Grant>,
    pub appearance: BTreeMap<String, AppearanceSettingsResponseDto>,
    pub communities: Vec<CreatedCommunity>,
    pub profile_order: ProfileOrder,
    pub held: Vec<HeldEvent>,
    /// Fields `GET /instance/public-settings` answers differently, from the `public_settings`
    /// control.
    pub public_settings: serde_json::Map<String, serde_json::Value>,
    /// `GET /onboarding/status`: a fresh instance with no users, from the `onboarding` control.
    pub needs_setup: bool,
    legacy_claimed: bool,
    next: u64,
}

impl Accounts {
    pub fn new() -> Self {
        Self {
            users: BTreeMap::new(),
            credentials: HashMap::new(),
            sessions: Vec::new(),
            invites: Vec::new(),
            grants: HashMap::new(),
            appearance: BTreeMap::new(),
            communities: Vec::new(),
            profile_order: ProfileOrder::default(),
            held: Vec::new(),
            public_settings: serde_json::Map::new(),
            needs_setup: false,
            legacy_claimed: false,
            next: 0,
        }
    }

    /// A new row id: a UUID, the same on every run.
    pub fn new_id(&mut self, kind: &str) -> String {
        self.next += 1;
        entity_uuid(&format!("w3-{kind}-{:06}", self.next))
    }

    pub fn session_of_token(&self, token: &str) -> Option<usize> {
        // A live session wins over a revoked one that held the same token.
        let held = |session: &Session| session.tokens.iter().any(|held| held == token);
        self.sessions
            .iter()
            .position(|session| !session.revoked && held(session))
            .or_else(|| self.sessions.iter().position(held))
    }

    pub fn token_revoked(&self, token: &str) -> bool {
        self.session_of_token(token)
            .is_some_and(|index| self.sessions[index].revoked)
    }

    /// Starts a session. The first sign-in gets the tokens the fake always handed out, so a client
    /// written against that keeps working; every other gets its own. After
    /// `expire_access_token`, new sessions take the one token the server still accepts.
    pub fn start_session(
        &mut self,
        user_id: &str,
        device_name: Option<&str>,
        ip: Option<&str>,
        now: DateTime<Utc>,
        required: Option<String>,
        claims_legacy: bool,
    ) -> usize {
        let id = self.new_id("session");
        let n = self.next;
        let (access, refresh) = if claims_legacy && !self.legacy_claimed {
            self.legacy_claimed = true;
            (
                required.unwrap_or_else(|| LEGACY_ACCESS.to_owned()),
                LEGACY_REFRESH.to_owned(),
            )
        } else {
            (
                required.unwrap_or_else(|| format!("{LEGACY_ACCESS}-s{n}")),
                format!("{LEGACY_REFRESH}-s{n}"),
            )
        };
        self.push_session(id, user_id, access, refresh, device_name, ip, now)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn push_session(
        &mut self,
        id: String,
        user_id: &str,
        access: String,
        refresh: String,
        device_name: Option<&str>,
        ip: Option<&str>,
        now: DateTime<Utc>,
    ) -> usize {
        self.sessions.push(Session {
            id,
            user_id: user_id.to_owned(),
            tokens: vec![access.clone()],
            access,
            refresh,
            device_name: device_name
                .filter(|name| !name.trim().is_empty())
                .unwrap_or("Unknown device")
                .to_owned(),
            ip: ip.map(str::to_owned),
            created_at: now,
            last_used_at: now,
            expires_at: now + SESSION_LIFETIME,
            revoked: false,
        });
        self.sessions.len() - 1
    }

    /// The session this bearer is, adopting an unknown token as a session of `me`.
    pub fn resolve_or_adopt(&mut self, token: &str, me: &str, now: DateTime<Utc>) -> usize {
        if let Some(index) = self.session_of_token(token) {
            return index;
        }
        let id = self.new_id("session");
        let refresh = format!("{LEGACY_REFRESH}-s{}", self.next);
        self.push_session(id, me, token.to_owned(), refresh, None, None, now)
    }

    /// Ends a session: its tokens fail from now on.
    pub fn revoke(&mut self, index: usize) {
        self.sessions[index].revoked = true;
    }

    pub fn live_sessions_of(&self, user_id: &str, now: DateTime<Utc>) -> Vec<usize> {
        let mut live: Vec<usize> = (0..self.sessions.len())
            .filter(|&index| {
                let session = &self.sessions[index];
                session.user_id == user_id && !session.revoked && session.expires_at > now
            })
            .collect();
        // Oldest first; sessions started at the same instant keep the order they were made in.
        live.sort_by_key(|&index| (self.sessions[index].created_at, index));
        live
    }

    /// `getUserSettings`: the row, with the defaults stored first if the user has none.
    pub fn appearance_for(
        &mut self,
        user_id: &str,
        now: DateTime<Utc>,
    ) -> &mut AppearanceSettingsResponseDto {
        if !self.appearance.contains_key(user_id) {
            let id = self.new_id("appearance");
            self.appearance.insert(
                user_id.to_owned(),
                AppearanceSettingsResponseDto {
                    accent_color: "teal".to_owned(),
                    created_at: now,
                    id,
                    intensity: "minimal".to_owned(),
                    theme_mode: "dark".to_owned(),
                    updated_at: now,
                    user_id: user_id.to_owned(),
                },
            );
        }
        self.appearance
            .get_mut(user_id)
            .expect("the row was just stored")
    }

    /// Mints a grant for an approved sign-in: the 43-character code a browser would have handed
    /// the app.
    pub fn approve(
        &mut self,
        challenge: &str,
        user_id: &str,
        now: DateTime<Utc>,
        approver_revoked: bool,
    ) -> String {
        self.next += 1;
        let digest = Sha256::digest(format!("w3-desktop-grant-{:06}", self.next).as_bytes());
        let code = URL_SAFE_NO_PAD.encode(digest);
        self.grants.insert(
            code.clone(),
            Grant {
                challenge: challenge.to_owned(),
                user_id: user_id.to_owned(),
                approved_at: now,
                approver_revoked,
            },
        );
        code
    }
}

/// The row of a user registered here: what `UserEntity` shows of a new account.
pub(crate) fn new_user(id: String, username: &str) -> UserEntity {
    UserEntity {
        avatar_url: None,
        banner_url: None,
        bio: None,
        display_name: Some(username.to_owned()),
        id,
        last_seen: None,
        role: InstanceRole::User,
        status: None,
        username: username.to_owned(),
    }
}

/// `base64url(SHA-256(verifier))` is the challenge (RFC 7636, S256).
pub(crate) fn pkce_matches(verifier: &str, challenge: &str) -> bool {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes())) == challenge
}

/// The class-validator `IsEmail` rule, roughly: one `@`, text each side, a dot in the domain.
pub(crate) fn plausible_email(email: &str) -> bool {
    let Some((local, domain)) = email.split_once('@') else {
        return false;
    };
    !local.is_empty()
        && !email.chars().any(char::is_whitespace)
        && !domain.contains('@')
        && domain.contains('.')
        && !domain.starts_with('.')
        && !domain.ends_with('.')
}

impl Inner {
    /// The user a bearer acts as: its session's, otherwise `me`.
    pub fn user_of(&self, token: Option<&str>) -> String {
        let accounts = lock(&self.accounts);
        token
            .and_then(|token| accounts.session_of_token(token))
            .map(|index| accounts.sessions[index].user_id.clone())
            .unwrap_or_else(|| self.scenario.me.id.clone())
    }

    /// A user as the API shows them now: edited rows first, then the scenario's.
    pub fn user_entity(&self, id: &str) -> Option<UserEntity> {
        lock(&self.accounts)
            .users
            .get(id)
            .cloned()
            .or_else(|| self.scenario.user(id).cloned())
    }

    pub fn token_revoked(&self, token: &str) -> bool {
        lock(&self.accounts).token_revoked(token)
    }

    /// The community with this id, the scenario's or one created over the API.
    pub fn find_community(&self, id: &str) -> Option<Community> {
        self.scenario.community(id).cloned().or_else(|| {
            lock(&self.accounts)
                .communities
                .iter()
                .find(|created| created.community.id == id)
                .map(|created| created.community.clone())
        })
    }

    /// Communities a user belongs to that were created over the API.
    pub fn created_communities_of(&self, user_id: &str) -> Vec<Community> {
        lock(&self.accounts)
            .communities
            .iter()
            .filter(|created| {
                created
                    .members
                    .iter()
                    .any(|member| member.user_id == user_id)
            })
            .map(|created| created.community.clone())
            .collect()
    }

    /// Members of a community created over the API.
    pub fn created_members(&self, community_id: &str) -> Option<Vec<MembershipResponseDto>> {
        lock(&self.accounts)
            .communities
            .iter()
            .find(|created| created.community.id == community_id)
            .map(|created| created.members.clone())
    }

    /// Whether this user is a registered account, and so sees only what they made.
    pub fn is_registered(&self, user_id: &str) -> bool {
        lock(&self.accounts)
            .credentials
            .values()
            .any(|credential| credential.user_id == user_id)
    }

    /// Everyone who shares a community with `user_id`, and the user: who hears of a profile change.
    pub fn community_peers(&self, user_id: &str) -> Vec<String> {
        let mut peers = vec![user_id.to_owned()];
        for members in self.scenario.memberships.values() {
            if members.iter().any(|member| member.user_id == user_id) {
                peers.extend(members.iter().map(|member| member.user_id.clone()));
            }
        }
        for created in &lock(&self.accounts).communities {
            if created
                .members
                .iter()
                .any(|member| member.user_id == user_id)
            {
                peers.extend(created.members.iter().map(|member| member.user_id.clone()));
            }
        }
        peers.sort();
        peers.dedup();
        peers
    }

    /// Sends to the sockets of a session: those that connected with one of its tokens.
    pub fn emit_to_tokens(&self, tokens: &[String], event: &str, payload: Value) {
        let frame = crate::socket::event_frame(event, payload);
        let sockets: Vec<_> = {
            let held = lock(&self.socket_tokens);
            lock(&self.sockets)
                .iter()
                .filter(|(sid, _)| held.get(sid).is_some_and(|token| tokens.contains(token)))
                .map(|(_, tx)| tx.clone())
                .collect()
        };
        for socket in sockets {
            self.enqueue_text(&socket, frame.clone());
        }
    }

    /// Sends to a user's sockets, except those of the session that holds `except_tokens`.
    pub fn emit_to_user_except(
        &self,
        user_id: &str,
        except_tokens: &[String],
        event: &str,
        payload: Value,
    ) {
        let frame = crate::socket::event_frame(event, payload);
        let sockets: Vec<_> = {
            let users = lock(&self.socket_users);
            let held = lock(&self.socket_tokens);
            lock(&self.sockets)
                .iter()
                .filter(|(sid, _)| {
                    users.get(sid).is_some_and(|user| user == user_id)
                        && !held
                            .get(sid)
                            .is_some_and(|token| except_tokens.contains(token))
                })
                .map(|(_, tx)| tx.clone())
                .collect()
        };
        for socket in sockets {
            self.enqueue_text(&socket, frame.clone());
        }
    }

    /// Resolve once every queued frame has been written to its socket.
    pub async fn frames_flushed(&self) {
        crate::wait_flushed(self).await;
    }

    /// A community and its default channel and first member, as `CommunityService.create` makes them.
    pub fn create_community(
        &self,
        creator: &str,
        name: &str,
        description: Option<String>,
        avatar: Option<String>,
        banner: Option<String>,
    ) -> Community {
        let now = self.now();
        let creator_user = self.user_entity(creator);
        let mut accounts = lock(&self.accounts);
        let id = accounts.new_id("community");
        let channel_id = accounts.new_id("channel");
        let membership_id = accounts.new_id("membership");
        let community = Community {
            id: id.clone(),
            name: name.to_owned(),
            description,
            avatar,
            banner,
            created_at: now,
            channels: vec![ChannelDto {
                community_id: id.clone(),
                created_at: now,
                id: channel_id,
                is_private: false,
                name: "general".to_owned(),
                position: 0,
                preset: ChannelPreset::Normal,
                slowmode_seconds: 0,
                type_: ChannelType::Text,
            }],
        };
        accounts.communities.push(CreatedCommunity {
            community: community.clone(),
            members: vec![MembershipResponseDto {
                community: None,
                community_id: id,
                id: membership_id,
                joined_at: now,
                roles: Vec::new(),
                user: creator_user,
                user_id: creator.to_owned(),
            }],
        });
        community
    }

    /// The payload `userProfileUpdated` carries for this user now.
    pub fn profile_payload(user: &UserEntity) -> Value {
        json!({
            "userId": user.id,
            "displayName": user.display_name,
            "avatarUrl": user.avatar_url,
            "bannerUrl": user.banner_url,
            "bio": user.bio,
        })
    }
}
