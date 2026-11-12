//! W5-B: roles, assignment, channel overrides, bans, timeouts and the moderation log, over real
//! HTTP and sockets, with the backend's rules. Each test names the rule it keeps.

mod common;

use common::*;
use semaphore_fake_server::{FakeServer, entity_uuid};
use serde_json::{Value, json};

fn id(readable: &str) -> String {
    entity_uuid(readable)
}

fn role(readable: &str) -> String {
    entity_uuid(readable)
}

async fn showcase() -> (FakeServer, reqwest::Client, String) {
    let server = start("showcase").await;
    let base = server.base_url();
    (server, http(), base)
}

/// A bearer for a session as another scenario user (`sign_in_as`, then a login).
async fn bearer_for(client: &reqwest::Client, base: &str, username: &str, user_id: &str) -> String {
    let (status, _) = post(
        client,
        base,
        "/__control/sign_in_as",
        json!({ "username": username, "userId": user_id }),
    )
    .await;
    assert_eq!(status, 200);
    let response = client
        .post(format!("{base}/api/auth/login"))
        .json(&json!({ "username": username, "password": "pw" }))
        .send()
        .await
        .unwrap();
    let body: Value = response.json().await.unwrap();
    format!("Bearer {}", body["accessToken"].as_str().expect("a token"))
}

async fn send(
    client: &reqwest::Client,
    method: reqwest::Method,
    base: &str,
    path: &str,
    bearer: &str,
    body: Option<Value>,
) -> (u16, Value) {
    let mut builder = client
        .request(method, format!("{base}{path}"))
        .header("Authorization", bearer);
    if let Some(body) = body {
        builder = builder.json(&body);
    }
    let response = builder.send().await.unwrap();
    let status = response.status().as_u16();
    let text = response.text().await.unwrap();
    (
        status,
        serde_json::from_str(&text).unwrap_or(Value::String(text)),
    )
}

#[tokio::test]
async fn the_guard_lets_the_instance_owner_through_but_not_past_the_moderation_rank_rule() {
    let (_server, client, base) = showcase().await;
    let couch = id("c-couch");
    // `me` is the instance owner and only a Member here: RbacGuard lets them read roles...
    let (status, body) = get(&client, &base, &format!("/api/roles/community/{couch}")).await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["roles"].as_array().unwrap().len(), 4);
    assert_eq!(body["roles"][0]["id"], role("role-community-admin-c-couch"));
    // ...but `canModerate` has no owner bypass (#679): a Member can't outrank a Member.
    let (status, body) = post(
        &client,
        &base,
        &format!("/api/moderation/timeout/{couch}/{}", id("u-priya")),
        json!({ "durationSeconds": 60 }),
    )
    .await;
    assert_eq!(status, 403);
    assert_eq!(
        body["message"],
        "Cannot timeout a user with equal or higher role"
    );

    // A plain member lacks READ_ROLE: the guard's refusal.
    let aiko = bearer_for(&client, &base, "aiko", &id("u-aiko")).await;
    let (status, body) = send(
        &client,
        reqwest::Method::GET,
        &base,
        &format!("/api/roles/community/{couch}"),
        &aiko,
        None,
    )
    .await;
    assert_eq!(status, 403);
    assert_eq!(body["errorCode"], "FORBIDDEN");
    assert_eq!(body["message"], "Forbidden resource");
    // Their own roles need nothing.
    let (status, body) = send(
        &client,
        reqwest::Method::GET,
        &base,
        &format!("/api/roles/my/community/{couch}"),
        &aiko,
        None,
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(body["roles"][0]["name"], "Member");
}

#[tokio::test]
async fn roles_are_managed_below_your_own_with_only_what_you_hold() {
    let (server, client, base) = showcase().await;
    let couch = id("c-couch");
    // The owner makes a "Lead" role between Admin (10) and Moderator (20) and hands it to Marcus.
    let (status, lead) = post(
        &client,
        &base,
        &format!("/api/roles/community/{couch}"),
        json!({ "name": "Lead", "position": 15, "actions": ["READ_ROLE", "CREATE_ROLE", "UPDATE_ROLE", "UPDATE_MEMBER", "KICK_USER", "BAN_USER", "READ_MEMBER"] }),
    )
    .await;
    assert_eq!(status, 201, "{lead}");
    assert_eq!(lead["position"], 15);
    let lead_id = lead["id"].as_str().unwrap().to_owned();
    server.act_as(&couch, Some(&id("u-marcus")), &[&lead_id]);
    let marcus = bearer_for(&client, &base, "dropbear", &id("u-marcus")).await;
    let put_role = |role_id: String, body: Value| {
        let (client, base, marcus) = (client.clone(), base.clone(), marcus.clone());
        let couch = couch.clone();
        async move {
            send(
                &client,
                reqwest::Method::PUT,
                &base,
                &format!("/api/roles/community/{couch}/{role_id}"),
                &marcus,
                Some(body),
            )
            .await
        }
    };

    // Below him, with actions he holds: fine.
    let (status, body) = put_role(
        role("role-moderator-c-couch"),
        json!({ "actions": ["KICK_USER", "BAN_USER"] }),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    // An action he lacks.
    let (status, body) = put_role(
        role("role-moderator-c-couch"),
        json!({ "actions": ["KICK_USER", "DELETE_COMMUNITY"] }),
    )
    .await;
    assert_eq!(status, 403);
    assert_eq!(
        body["message"],
        "Cannot grant permissions you do not have: DELETE_COMMUNITY"
    );
    // A role above him.
    let (status, body) = put_role(
        role("role-community-admin-c-couch"),
        json!({ "actions": ["KICK_USER"] }),
    )
    .await;
    assert_eq!(status, 403);
    assert_eq!(
        body["message"],
        "You can only manage roles below your highest role"
    );
    // A default role keeps its name.
    let (status, body) = put_role(
        role("role-member-c-couch"),
        json!({ "name": "Folks", "actions": [] }),
    )
    .await;
    assert_eq!(status, 400);
    assert_eq!(
        body["message"],
        "Cannot change the name of default roles. Only permissions can be modified."
    );
    // A new role of his lands just below him when no position is asked for.
    let (status, made) = send(
        &client,
        reqwest::Method::POST,
        &base,
        &format!("/api/roles/community/{couch}"),
        &marcus,
        Some(json!({ "name": "Helpers", "actions": ["KICK_USER"] })),
    )
    .await;
    assert_eq!(status, 201, "{made}");
    assert_eq!(made["position"], 31);
    // A name taken.
    let (status, _) = send(
        &client,
        reqwest::Method::POST,
        &base,
        &format!("/api/roles/community/{couch}"),
        &marcus,
        Some(json!({ "name": "Helpers", "actions": [] })),
    )
    .await;
    assert_eq!(status, 409);

    // Reordering may not move what is at or above him.
    let all: Vec<String> = [
        role("role-moderator-c-couch"),
        role("role-community-admin-c-couch"),
        lead_id.clone(),
        role("role-mods-c-couch"),
        made["id"].as_str().unwrap().to_owned(),
    ]
    .into();
    let (status, body) = send(
        &client,
        reqwest::Method::PATCH,
        &base,
        &format!("/api/roles/community/{couch}/reorder"),
        &marcus,
        Some(json!({ "roleIds": all })),
    )
    .await;
    assert_eq!(status, 403);
    assert_eq!(
        body["message"],
        "You can only reorder roles below your highest role"
    );
    // The owner may, and positions become 10, 20, ... with Member at 100.
    let (status, body) = request(
        &client,
        reqwest::Method::PATCH,
        &base,
        &format!("/api/roles/community/{couch}/reorder"),
        Some(json!({ "roleIds": all })),
        true,
    )
    .await;
    assert_eq!(status, 200, "{body}");
    let positions: Vec<(String, i64)> = body
        .as_array()
        .unwrap()
        .iter()
        .map(|r| {
            (
                r["name"].as_str().unwrap().to_owned(),
                r["position"].as_i64().unwrap(),
            )
        })
        .collect();
    assert_eq!(
        positions,
        [
            ("Moderator".to_owned(), 10),
            ("Community Admin".to_owned(), 20),
            ("Lead".to_owned(), 30),
            ("mods".to_owned(), 40),
            ("Helpers".to_owned(), 50),
            ("Member".to_owned(), 100),
        ]
    );
}

#[tokio::test]
async fn assigning_needs_the_role_below_you_and_a_member_you_outrank() {
    let (server, client, base) = showcase().await;
    let couch = id("c-couch");
    server.act_as(
        &couch,
        Some(&id("u-marcus")),
        &["role-moderator-c-couch", "role-member-c-couch"],
    );
    let marcus = bearer_for(&client, &base, "dropbear", &id("u-marcus")).await;
    let mut priya = connect_as(&base, &id("u-priya")).await;
    let assign = |user: &str, role_id: &str| {
        let (client, base, marcus) = (client.clone(), base.clone(), marcus.clone());
        let path = format!("/api/roles/community/{couch}/assign");
        let body = json!({ "userId": id(user), "roleId": role(role_id) });
        async move {
            send(
                &client,
                reqwest::Method::POST,
                &base,
                &path,
                &marcus,
                Some(body),
            )
            .await
        }
    };
    // Moderator (20, and Member) gives a Member "mods" (30): it holds CREATE_INVITE, which he
    // doesn't, so it is refused (`assertHolds` on the role's actions).
    let (status, body) = assign("u-priya", "role-mods-c-couch").await;
    assert_eq!(status, 403);
    assert!(
        body["message"]
            .as_str()
            .unwrap()
            .starts_with("Cannot grant permissions you do not have:"),
        "{body}"
    );
    // The Member role: fine, and the community hears of it.
    server.act_as(&couch, Some(&id("u-priya")), &[]);
    let (status, body) = assign("u-priya", "role-member-c-couch").await;
    assert_eq!(status, 204, "{body}");
    let heard = settle(&server, &mut [&mut priya]).await;
    assert_eq!(names(&heard[0]), ["roleAssigned"]);
    assert_eq!(heard[0][0].1["roleName"], "Member");
    // Someone above him.
    let (status, body) = assign("u-samira", "role-member-c-couch").await;
    assert_eq!(status, 403);
    assert_eq!(
        body["message"],
        "You can only change the roles of members ranked below you"
    );
    // Roles of a non-member.
    let (status, body) = assign("u-mateo", "role-member-c-couch").await;
    assert_eq!(status, 400, "{body}");
    assert_eq!(body["message"], "User is not a member of this community");
}

#[tokio::test]
async fn a_ban_removes_the_member_tells_them_first_and_is_logged() {
    let (server, client, base) = showcase().await;
    let couch = id("c-couch");
    let (status, banner) = post(
        &client,
        &base,
        &format!("/api/roles/community/{couch}"),
        json!({ "name": "Bouncer", "position": 15, "actions": ["BAN_USER", "UNBAN_USER", "TIMEOUT_USER", "VIEW_BAN_LIST", "VIEW_MODERATION_LOGS", "READ_MEMBER"] }),
    )
    .await;
    assert_eq!(status, 201);
    server.act_as(&couch, None, &[banner["id"].as_str().unwrap()]);
    let mut me = connect_as(&base, &id("me")).await;
    let mut kwame = connect_as(&base, &id("u-kwame")).await;
    let (status, body) = post(
        &client,
        &base,
        &format!("/api/moderation/ban/{couch}/{}", id("u-kwame")),
        json!({ "reason": "spam" }),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["message"], "User banned successfully");
    let heard = settle(&server, &mut [&mut me, &mut kwame]).await;
    assert_eq!(names(&heard[1])[0], "userBanned");
    assert!(names(&heard[0]).contains(&"userBanned"));
    assert_eq!(heard[1][0].1["reason"], "spam");
    // Banned again: no longer a member (with no role left, the rank rule passes first).
    let (status, body) = post(
        &client,
        &base,
        &format!("/api/moderation/ban/{couch}/{}", id("u-kwame")),
        json!({}),
    )
    .await;
    assert_eq!(status, 404, "{body}");
    // Above me.
    let (status, body) = post(
        &client,
        &base,
        &format!("/api/moderation/ban/{couch}/{}", id("u-samira")),
        json!({}),
    )
    .await;
    assert_eq!(status, 403);
    assert_eq!(
        body["message"],
        "Cannot ban a user with equal or higher role"
    );

    let (status, list) = get(&client, &base, &format!("/api/moderation/bans/{couch}")).await;
    assert_eq!(status, 200);
    assert_eq!(list.as_array().unwrap().len(), 1);
    assert_eq!(list[0]["user"]["id"], id("u-kwame"));
    assert_eq!(list[0]["moderator"]["id"], id("me"));
    let (_, logs) = get(
        &client,
        &base,
        &format!("/api/moderation/logs/{couch}?action=BAN_USER"),
    )
    .await;
    assert_eq!(logs["total"], 1);
    assert_eq!(logs["logs"][0]["targetUser"]["id"], id("u-kwame"));

    // Lifting: by the instance owner, whatever set it.
    let (status, body) = delete(
        &client,
        &base,
        &format!("/api/moderation/ban/{couch}/{}", id("u-kwame")),
        json!({}),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    let (_, list) = get(&client, &base, &format!("/api/moderation/bans/{couch}")).await;
    assert_eq!(list, json!([]));
    let (status, _) = delete(
        &client,
        &base,
        &format!("/api/moderation/ban/{couch}/{}", id("u-kwame")),
        json!({}),
    )
    .await;
    assert_eq!(status, 404);
}

#[tokio::test]
async fn a_timeout_set_by_a_higher_rank_is_not_yours_to_lift() {
    let (server, client, base) = showcase().await;
    let couch = id("c-couch");
    // Samira (Admin, 10) times Priya out; Marcus (Moderator, 20) may not lift it.
    let samira = bearer_for(&client, &base, "samira", &id("u-samira")).await;
    server.act_as(&couch, Some(&id("u-marcus")), &["role-moderator-c-couch"]);
    let marcus = bearer_for(&client, &base, "dropbear", &id("u-marcus")).await;
    let mut priya = connect_as(&base, &id("u-priya")).await;
    let path = format!("/api/moderation/timeout/{couch}/{}", id("u-priya"));
    let (status, body) = send(
        &client,
        reqwest::Method::POST,
        &base,
        &path,
        &samira,
        Some(json!({ "durationSeconds": 30 })),
    )
    .await;
    assert_eq!(status, 400, "{body}");
    let (status, body) = send(
        &client,
        reqwest::Method::POST,
        &base,
        &path,
        &samira,
        Some(json!({ "durationSeconds": 600, "reason": "cool off" })),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    let heard = settle(&server, &mut [&mut priya]).await;
    assert_eq!(names(&heard[0]), ["userTimedOut"]);
    assert_eq!(heard[0][0].1["durationSeconds"], 600);
    let (_, status_body) = get(
        &client,
        &base,
        &format!("/api/moderation/timeout-status/{couch}/{}", id("u-priya")),
    )
    .await;
    assert_eq!(status_body["isTimedOut"], true);

    let (status, body) = send(
        &client,
        reqwest::Method::DELETE,
        &base,
        &path,
        &marcus,
        Some(json!({})),
    )
    .await;
    assert_eq!(status, 403);
    assert_eq!(
        body["message"],
        "Cannot lift a timeout set by a higher role"
    );
    let (status, _) = send(
        &client,
        reqwest::Method::DELETE,
        &base,
        &path,
        &samira,
        Some(json!({})),
    )
    .await;
    assert_eq!(status, 200);
    let heard = settle(&server, &mut [&mut priya]).await;
    assert_eq!(names(&heard[0]), ["timeoutRemoved"]);
}

#[tokio::test]
async fn overrides_are_replaced_whole_and_checked_like_the_backend() {
    let (server, client, base) = showcase().await;
    let general = id("cc-general");
    let mut aiko = connect_as(&base, &id("u-aiko")).await;
    let path = format!("/api/channels/{general}/overwrites");
    let (status, body) = get(&client, &base, &path).await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["overwrites"], json!([]));
    let (status, body) = put(
        &client,
        &base,
        &path,
        json!({ "preset": "READ_ONLY", "overwrites": [
            { "targetType": "EVERYONE", "allow": [], "deny": ["CREATE_MESSAGE"] },
            { "targetType": "ROLE", "roleId": role("role-moderator-c-couch"), "allow": ["CREATE_MESSAGE"], "deny": [] }
        ] }),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["preset"], "READ_ONLY");
    assert_eq!(body["overwrites"].as_array().unwrap().len(), 2);
    let heard = settle(&server, &mut [&mut aiko]).await;
    assert_eq!(names(&heard[0]), ["channelPermissionsUpdated"]);
    let (status, body) = put(
        &client,
        &base,
        &path,
        json!({ "preset": "CUSTOM", "overwrites": [
            { "targetType": "EVERYONE", "allow": ["READ_CHANNEL"], "deny": [] }
        ] }),
    )
    .await;
    assert_eq!(status, 400);
    assert_eq!(
        body["message"],
        "READ_CHANNEL can't be overwritten per channel"
    );
    let (status, body) = put(
        &client,
        &base,
        &path,
        json!({ "preset": "CUSTOM", "overwrites": [] }),
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(body["overwrites"], json!([]));
}

#[tokio::test]
async fn overrides_work_on_a_channel_made_at_runtime() {
    let (_server, client, base) = showcase().await;
    let couch = id("c-couch");
    let (status, made) = post(
        &client,
        &base,
        "/api/channels",
        json!({ "name": "fresh", "communityId": couch, "type": "TEXT", "isPrivate": false }),
    )
    .await;
    assert!(status == 201 || status == 200, "{made}");
    let channel = made["id"].as_str().unwrap().to_owned();
    let path = format!("/api/channels/{channel}/overwrites");
    let (status, body) = get(&client, &base, &path).await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["channelId"], channel.as_str());
    let (status, body) = put(
        &client,
        &base,
        &path,
        json!({ "preset": "ANNOUNCEMENT", "overwrites": [
            { "targetType": "EVERYONE", "allow": [], "deny": ["CREATE_MESSAGE", "ATTACH_FILES"] }
        ] }),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["preset"], "ANNOUNCEMENT");
    // A channel nobody made.
    let (status, _) = get(
        &client,
        &base,
        "/api/channels/00000000-0000-4000-8000-00000000dead/overwrites",
    )
    .await;
    assert_eq!(status, 404);
}

#[tokio::test]
async fn moderate_as_acts_with_the_moderators_own_checks_and_events() {
    let (server, client, base) = showcase().await;
    let couch = id("c-couch");
    let (status, bouncer) = post(
        &client,
        &base,
        &format!("/api/roles/community/{couch}"),
        json!({ "name": "Bouncer", "position": 15, "actions": ["BAN_USER", "TIMEOUT_USER", "KICK_USER", "VIEW_BAN_LIST", "READ_MEMBER"] }),
    )
    .await;
    assert_eq!(status, 201);
    let bouncer = bouncer["id"].as_str().unwrap().to_owned();
    server.act_as(&couch, Some(&id("u-marcus")), &[&bouncer]);
    let mut kwame = connect_as(&base, &id("u-kwame")).await;
    let control = |body: Value| {
        let (client, base) = (client.clone(), base.clone());
        async move { post(&client, &base, "/__control/moderate_as", body).await }
    };

    // A timeout, as marcus: the room hears it, the list has it, with marcus as the moderator.
    let (status, body) = control(json!({
        "moderatorId": id("u-marcus"), "action": "timeout", "communityId": couch,
        "userId": id("u-kwame"), "durationSeconds": 600, "reason": "cool off",
    }))
    .await;
    assert_eq!(status, 200, "{body}");
    let heard = settle(&server, &mut [&mut kwame]).await;
    assert!(names(&heard[0]).contains(&"userTimedOut"), "{heard:?}");
    let (_, list) = get(&client, &base, &format!("/api/moderation/timeouts/{couch}")).await;
    assert_eq!(list[0]["user"]["id"], id("u-kwame"));
    assert_eq!(list[0]["moderator"]["id"], id("u-marcus"));
    // Their channel capabilities say until when, as the composer's lock reads it.
    let kwame_bearer = bearer_for(&client, &base, "kwam3", &id("u-kwame")).await;
    let (status, caps) = send(
        &client,
        reqwest::Method::GET,
        &base,
        &format!("/api/channels/community/{couch}/permissions/me"),
        &kwame_bearer,
        None,
    )
    .await;
    assert_eq!(status, 200, "{caps}");
    assert!(caps["channels"][0]["timedOutUntil"].is_string(), "{caps}");
    let (_, mine) = get(
        &client,
        &base,
        &format!("/api/channels/community/{couch}/permissions/me"),
    )
    .await;
    assert!(mine["channels"][0]["timedOutUntil"].is_null(), "{mine}");

    // The checks are the moderator's: no ban on someone ranked above them, nothing without the
    // action.
    let (status, body) = control(json!({
        "moderatorId": id("u-marcus"), "action": "ban", "communityId": couch,
        "userId": id("u-samira"),
    }))
    .await;
    assert_eq!(status, 403, "{body}");
    let (status, _) = control(json!({
        "moderatorId": id("u-kwame"), "action": "kick", "communityId": couch,
        "userId": id("u-marcus"),
    }))
    .await;
    assert_eq!(status, 403);

    // A ban: they hear it first, then they're gone.
    let (status, body) = control(json!({
        "moderatorId": id("u-marcus"), "action": "ban", "communityId": couch,
        "userId": id("u-kwame"), "reason": "spam",
    }))
    .await;
    assert_eq!(status, 200, "{body}");
    let heard = settle(&server, &mut [&mut kwame]).await;
    assert_eq!(names(&heard[0])[0], "userBanned");
    assert_eq!(heard[0][0].1["reason"], "spam");
    // Their community list no longer has it.
    let (_, mine) = send(
        &client,
        reqwest::Method::GET,
        &base,
        "/api/community/mine",
        &kwame_bearer,
        None,
    )
    .await;
    assert!(
        mine.as_array()
            .unwrap()
            .iter()
            .all(|community| community["id"] != couch.as_str()),
        "{mine}"
    );

    // Bad requests.
    for body in [
        json!({ "action": "ban", "communityId": couch, "userId": id("u-kwame") }),
        json!({ "moderatorId": id("u-marcus"), "action": "mute", "communityId": couch, "userId": id("u-kwame") }),
        json!({ "moderatorId": id("u-marcus"), "action": "timeout", "communityId": couch, "userId": id("u-kwame"), "durationSeconds": 5 }),
    ] {
        let (status, _) = control(body).await;
        assert_eq!(status, 400);
    }
}
