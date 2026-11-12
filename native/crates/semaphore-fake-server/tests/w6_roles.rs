//! W6-E: instance roles over real HTTP. Each answer decodes as its wire type (the contract's
//! shape), and each test names the backend behaviour it keeps
//! (`backend/src/roles/instance-roles.service.ts`).

mod common;

use common::*;
use semaphore_fake_server::{FakeServer, entity_uuid};
use semaphore_wire::enums::UserRoleResourceType;
use semaphore_wire::types as wire;
use serde_json::{Value, json};

fn id(readable: &str) -> String {
    entity_uuid(readable)
}

async fn showcase() -> (FakeServer, reqwest::Client, String) {
    let server = start("showcase").await;
    let base = server.base_url();
    (server, http(), base)
}

fn decode<T: serde::de::DeserializeOwned>(value: &Value) -> T {
    serde_json::from_value(value.clone()).unwrap_or_else(|error| panic!("{error}: {value}"))
}

/// Sends `body` with `bearer` and answers the status and the body.
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
    let response = builder.send().await.expect("the fake answers");
    let status = response.status().as_u16();
    let text = response.text().await.expect("a body");
    (
        status,
        serde_json::from_str(&text).unwrap_or(Value::String(text)),
    )
}

/// A bearer for a session as another scenario user.
async fn bearer_for(
    server: &FakeServer,
    client: &reqwest::Client,
    base: &str,
    username: &str,
    user_id: &str,
) -> String {
    server.sign_in_as(username, user_id);
    let response = client
        .post(format!("{base}/api/auth/login"))
        .json(&json!({ "username": username, "password": "pw" }))
        .send()
        .await
        .unwrap();
    let body: Value = response.json().await.unwrap();
    format!("Bearer {}", body["accessToken"].as_str().expect("a token"))
}

fn actions(role: &wire::RoleDto) -> Vec<String> {
    role.actions
        .iter()
        .map(|action| action.as_str().into_owned())
        .collect()
}

async fn roles(client: &reqwest::Client, base: &str, bearer: &str) -> Vec<wire::RoleDto> {
    let (status, body) = send(
        client,
        reqwest::Method::GET,
        base,
        "/api/roles/instance/all",
        bearer,
        None,
    )
    .await;
    assert_eq!(status, 200, "{body}");
    decode(&body)
}

async fn create_role(
    client: &reqwest::Client,
    base: &str,
    bearer: &str,
    name: &str,
    actions: &[&str],
) -> wire::RoleDto {
    let (status, body) = send(
        client,
        reqwest::Method::POST,
        base,
        "/api/roles/instance",
        bearer,
        Some(json!({ "name": name, "actions": actions })),
    )
    .await;
    assert_eq!(status, 201, "{body}");
    decode(&body)
}

#[tokio::test]
async fn every_answer_decodes_and_the_owner_walks_the_manager() {
    let (_server, client, base) = showcase().await;

    // The list: the backend's two defaults, by position.
    let list = roles(&client, &base, TOKEN).await;
    assert_eq!(
        list.iter()
            .map(|role| role.name.as_str())
            .collect::<Vec<_>>(),
        ["Instance Admin", "Community Creator"]
    );
    let admin = &list[0];
    assert!(admin.is_default && admin.position == 10);
    assert_eq!(actions(admin).len(), 12);
    assert_eq!(
        actions(admin),
        [
            "READ_INSTANCE_SETTINGS",
            "UPDATE_INSTANCE_SETTINGS",
            "READ_INSTANCE_STATS",
            "MANAGE_USER_STORAGE",
            "READ_USER",
            "UPDATE_USER",
            "BAN_USER",
            "DELETE_USER",
            "READ_INSTANCE_INVITE",
            "CREATE_INSTANCE_INVITE",
            "DELETE_INSTANCE_INVITE",
            "UPDATE_INSTANCE_INVITE",
        ]
    );
    let creator = &list[1];
    assert!(creator.is_default && creator.position == 20);
    let creator_actions = actions(creator);
    assert_eq!(creator_actions.len(), 50);
    for action in [
        "CREATE_COMMUNITY",
        "MANAGE_WEBHOOKS",
        "MANAGE_EMOJIS",
        "VIEW_MODERATION_LOGS",
        "READ_SOUNDBOARD_SOUND",
    ] {
        assert!(creator_actions.contains(&action.to_owned()), "{action}");
    }

    // A create: at the lowest priority, not default, its name trimmed.
    let created = create_role(
        &client,
        &base,
        TOKEN,
        " Builders ",
        &["READ_USER", "UPDATE_USER"],
    )
    .await;
    assert_eq!(created.name, "Builders");
    assert!(!created.is_default);
    assert_eq!(created.position, 30, "the highest position plus ten");
    assert_eq!(actions(&created), ["READ_USER", "UPDATE_USER"]);
    assert!(
        roles(&client, &base, TOKEN)
            .await
            .iter()
            .any(|role| role.id == created.id)
    );

    // Its users, then an edit, then a delete.
    let (status, body) = send(
        &client,
        reqwest::Method::GET,
        &base,
        &format!("/api/roles/instance/{}/users", created.id),
        TOKEN,
        None,
    )
    .await;
    assert_eq!(status, 200, "{body}");
    let users: Vec<wire::RoleUserDto> = decode(&body);
    assert!(users.is_empty());

    let (status, body) = send(
        &client,
        reqwest::Method::PUT,
        &base,
        &format!("/api/roles/instance/{}", created.id),
        TOKEN,
        Some(json!({ "name": "Deployers", "actions": ["READ_USER"] })),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    let updated: wire::RoleDto = decode(&body);
    assert_eq!(updated.name, "Deployers");
    assert_eq!(actions(&updated), ["READ_USER"]);

    let (status, body) = send(
        &client,
        reqwest::Method::DELETE,
        &base,
        &format!("/api/roles/instance/{}", created.id),
        TOKEN,
        None,
    )
    .await;
    assert_eq!(status, 204, "{body}");
    assert!(
        !roles(&client, &base, TOKEN)
            .await
            .iter()
            .any(|role| role.id == created.id)
    );

    // The owner's own instance roles: the default Member role, which may create communities.
    let (status, body) = send(
        &client,
        reqwest::Method::GET,
        &base,
        &format!("/api/roles/user/{}/instance", id("me")),
        TOKEN,
        None,
    )
    .await;
    assert_eq!(status, 200, "{body}");
    let mine: wire::UserRolesResponseDto = decode(&body);
    assert_eq!(mine.user_id, id("me"));
    assert_eq!(mine.resource_type, Some(UserRoleResourceType::Instance));
    assert_eq!(actions(&mine.roles[0]), ["CREATE_COMMUNITY"]);
}

#[tokio::test]
async fn each_refusal_keeps_the_backends_words() {
    let (server, client, base) = showcase().await;
    let priya = bearer_for(&server, &client, &base, "pri", &id("u-priya")).await;

    // The guard: pri holds no instance action the manager needs.
    let unknown = id("no-such-role");
    let priya_id = id("u-priya");
    let checks: Vec<(reqwest::Method, String, Option<Value>)> = vec![
        (
            reqwest::Method::GET,
            "/api/roles/instance/all".to_owned(),
            None,
        ),
        (
            reqwest::Method::POST,
            "/api/roles/instance".to_owned(),
            Some(json!({ "name": "Mine", "actions": ["READ_USER"] })),
        ),
        (
            reqwest::Method::PUT,
            format!("/api/roles/instance/{unknown}"),
            Some(json!({ "name": "Mine" })),
        ),
        (
            reqwest::Method::DELETE,
            format!("/api/roles/instance/{unknown}"),
            None,
        ),
        (
            reqwest::Method::GET,
            format!("/api/roles/instance/{unknown}/users"),
            None,
        ),
        (
            reqwest::Method::POST,
            format!("/api/roles/instance/{unknown}/assign"),
            Some(json!({ "userId": priya_id })),
        ),
        (
            reqwest::Method::DELETE,
            format!("/api/roles/instance/{unknown}/users/{priya_id}"),
            None,
        ),
        (
            reqwest::Method::GET,
            format!("/api/roles/user/{priya_id}/instance"),
            None,
        ),
    ];
    for (method, path, body) in checks {
        let (status, answer) = send(&client, method.clone(), &base, &path, &priya, body).await;
        assert_eq!(status, 403, "{method} {path}: {answer}");
        assert_eq!(answer["message"], "Forbidden resource", "{method} {path}");
        assert_eq!(answer["errorCode"], "FORBIDDEN");
    }

    // A malformed id is refused before anything else.
    let (status, body) = send(
        &client,
        reqwest::Method::PUT,
        &base,
        "/api/roles/instance/not-a-uuid",
        TOKEN,
        Some(json!({ "name": "Any" })),
    )
    .await;
    assert_eq!(status, 400, "{body}");
    assert_eq!(body["errorCode"], "BAD_REQUEST");

    // The DTO's own checks: 400 VALIDATION_FAILED, with the backend's messages.
    for (body, message) in [
        (
            json!({ "name": "   ", "actions": ["READ_USER"] }),
            "Role name must not be empty",
        ),
        (
            json!({ "name": "n".repeat(51), "actions": ["READ_USER"] }),
            "Role name must not exceed 50 characters",
        ),
        (
            json!({ "name": "Empty", "actions": [] }),
            "Role must have at least one permission",
        ),
    ] {
        let (status, answer) = send(
            &client,
            reqwest::Method::POST,
            &base,
            "/api/roles/instance",
            TOKEN,
            Some(body.clone()),
        )
        .await;
        assert_eq!(status, 400, "{body} {answer}");
        assert_eq!(answer["errorCode"], "VALIDATION_FAILED");
        assert_eq!(answer["message"], message);
    }

    // An action no instance role may hold: 400 BAD_REQUEST, in the draft's order.
    let (status, body) = send(
        &client,
        reqwest::Method::POST,
        &base,
        "/api/roles/instance",
        TOKEN,
        Some(json!({ "name": "Chatty", "actions": ["READ_USER", "DELETE_MESSAGE", "SPEAK"] })),
    )
    .await;
    assert_eq!(status, 400, "{body}");
    assert_eq!(body["errorCode"], "BAD_REQUEST");
    assert_eq!(
        body["message"],
        "Actions not valid for instance roles: DELETE_MESSAGE, SPEAK"
    );

    // A name another instance role already has.
    let (status, body) = send(
        &client,
        reqwest::Method::POST,
        &base,
        "/api/roles/instance",
        TOKEN,
        Some(json!({ "name": "Instance Admin", "actions": ["READ_USER"] })),
    )
    .await;
    assert_eq!(status, 409, "{body}");
    assert_eq!(body["errorCode"], "CONFLICT");
    assert_eq!(
        body["message"],
        "Role with name \"Instance Admin\" already exists"
    );

    let admin = roles(&client, &base, TOKEN)
        .await
        .into_iter()
        .find(|role| role.name == "Instance Admin")
        .unwrap();

    // An unknown role: 404 NOT_FOUND, naming what was asked for.
    let (status, body) = send(
        &client,
        reqwest::Method::PUT,
        &base,
        &format!("/api/roles/instance/{unknown}"),
        TOKEN,
        Some(json!({ "name": "Any" })),
    )
    .await;
    assert_eq!(status, 404, "{body}");
    assert_eq!(body["errorCode"], "NOT_FOUND");
    assert_eq!(body["message"], format!("Role with ID {unknown} not found"));

    // Renaming a default role, and invalid actions on an edit.
    let (status, body) = send(
        &client,
        reqwest::Method::PUT,
        &base,
        &format!("/api/roles/instance/{}", admin.id),
        TOKEN,
        Some(json!({ "name": "Renamed" })),
    )
    .await;
    assert_eq!(status, 400, "{body}");
    assert_eq!(body["errorCode"], "BAD_REQUEST");
    assert_eq!(body["message"], "Cannot rename a default role");

    let helpers = create_role(&client, &base, TOKEN, "Helpers", &["READ_USER"]).await;
    let (status, body) = send(
        &client,
        reqwest::Method::PUT,
        &base,
        &format!("/api/roles/instance/{}", helpers.id),
        TOKEN,
        Some(json!({ "actions": ["DELETE_MESSAGE"] })),
    )
    .await;
    assert_eq!(status, 400, "{body}");
    assert_eq!(body["errorCode"], "BAD_REQUEST");
    assert_eq!(
        body["message"],
        "Actions not valid for instance roles: DELETE_MESSAGE"
    );

    let (status, body) = send(
        &client,
        reqwest::Method::PUT,
        &base,
        &format!("/api/roles/instance/{}", helpers.id),
        TOKEN,
        Some(json!({ "name": "Instance Admin" })),
    )
    .await;
    assert_eq!(status, 409, "{body}");
    assert_eq!(body["errorCode"], "CONFLICT");

    // The default Instance Admin role is never deleted.
    let (status, body) = send(
        &client,
        reqwest::Method::DELETE,
        &base,
        &format!("/api/roles/instance/{}", admin.id),
        TOKEN,
        None,
    )
    .await;
    assert_eq!(status, 400, "{body}");
    assert_eq!(body["errorCode"], "BAD_REQUEST");
    assert_eq!(
        body["message"],
        "Cannot delete the default Instance Admin role"
    );

    // Assign, then a role with a holder can't be deleted.
    let (status, body) = send(
        &client,
        reqwest::Method::POST,
        &base,
        &format!("/api/roles/instance/{}/assign", helpers.id),
        TOKEN,
        Some(json!({ "userId": id("u-priya") })),
    )
    .await;
    assert_eq!(status, 204, "{body}");
    let (status, body) = send(
        &client,
        reqwest::Method::POST,
        &base,
        &format!("/api/roles/instance/{}/assign", helpers.id),
        TOKEN,
        Some(json!({ "userId": id("u-priya") })),
    )
    .await;
    assert_eq!(status, 409, "{body}");
    assert_eq!(body["errorCode"], "CONFLICT");
    assert_eq!(body["message"], "User already has this instance role");

    let (status, body) = send(
        &client,
        reqwest::Method::DELETE,
        &base,
        &format!("/api/roles/instance/{}", helpers.id),
        TOKEN,
        None,
    )
    .await;
    assert_eq!(status, 400, "{body}");
    assert_eq!(
        body["message"],
        "Cannot delete role with 1 assigned user(s). Remove all role assignments first."
    );

    // Unassign: once, then it's not there.
    let (status, body) = send(
        &client,
        reqwest::Method::DELETE,
        &base,
        &format!("/api/roles/instance/{}/users/{}", helpers.id, id("u-priya")),
        TOKEN,
        None,
    )
    .await;
    assert_eq!(status, 204, "{body}");
    let (status, body) = send(
        &client,
        reqwest::Method::DELETE,
        &base,
        &format!("/api/roles/instance/{}/users/{}", helpers.id, id("u-priya")),
        TOKEN,
        None,
    )
    .await;
    assert_eq!(status, 404, "{body}");
    assert_eq!(body["errorCode"], "NOT_FOUND");
    assert_eq!(body["message"], "User role assignment not found");

    // Assigning to an unknown role.
    let (status, body) = send(
        &client,
        reqwest::Method::POST,
        &base,
        &format!("/api/roles/instance/{unknown}/assign"),
        TOKEN,
        Some(json!({ "userId": priya_id })),
    )
    .await;
    assert_eq!(status, 404, "{body}");
    assert_eq!(body["message"], "Role not found");

    // A role's users, for an unknown role.
    let (status, body) = send(
        &client,
        reqwest::Method::GET,
        &base,
        &format!("/api/roles/instance/{unknown}/users"),
        TOKEN,
        None,
    )
    .await;
    assert_eq!(status, 404, "{body}");
    assert_eq!(body["errorCode"], "NOT_FOUND");
}

#[tokio::test]
async fn below_full_authority_an_actor_may_only_touch_what_they_hold() {
    let (server, client, base) = showcase().await;

    // A junior admin role: read the settings, change them, read users, and nothing else.
    let junior = create_role(
        &client,
        &base,
        TOKEN,
        "Junior Admin",
        &[
            "READ_INSTANCE_SETTINGS",
            "UPDATE_INSTANCE_SETTINGS",
            "READ_USER",
        ],
    )
    .await;
    let (status, body) = send(
        &client,
        reqwest::Method::POST,
        &base,
        &format!("/api/roles/instance/{}/assign", junior.id),
        TOKEN,
        Some(json!({ "userId": id("u-priya") })),
    )
    .await;
    assert_eq!(status, 204, "{body}");

    let priya = bearer_for(&server, &client, &base, "pri", &id("u-priya")).await;
    // The guard now lets her read the list.
    let list = roles(&client, &base, &priya).await;
    assert_eq!(list.len(), 3);

    // She may not grant an action she lacks.
    let (status, body) = send(
        &client,
        reqwest::Method::POST,
        &base,
        "/api/roles/instance",
        &priya,
        Some(json!({ "name": "Auditors", "actions": ["READ_USER", "UPDATE_USER"] })),
    )
    .await;
    assert_eq!(status, 403, "{body}");
    assert_eq!(body["errorCode"], "FORBIDDEN");
    assert_eq!(
        body["message"],
        "Cannot grant permissions you do not have: UPDATE_USER"
    );

    // Editing takes what the role has and what it gets.
    let (status, body) = send(
        &client,
        reqwest::Method::PUT,
        &base,
        &format!("/api/roles/instance/{}", junior.id),
        &priya,
        Some(json!({ "actions": ["READ_USER", "UPDATE_USER"] })),
    )
    .await;
    assert_eq!(status, 403, "{body}");
    assert_eq!(
        body["message"],
        "Cannot grant permissions you do not have: UPDATE_USER"
    );

    // So does deleting.
    let auditor = create_role(
        &client,
        &base,
        TOKEN,
        "Auditor",
        &["READ_USER", "DELETE_USER"],
    )
    .await;
    let (status, body) = send(
        &client,
        reqwest::Method::DELETE,
        &base,
        &format!("/api/roles/instance/{}", auditor.id),
        &priya,
        None,
    )
    .await;
    assert_eq!(status, 403, "{body}");
    assert_eq!(
        body["message"],
        "Cannot grant permissions you do not have: DELETE_USER"
    );

    // Assigning the junior role to someone else takes UPDATE_USER, which she lacks: the guard.
    let (status, body) = send(
        &client,
        reqwest::Method::POST,
        &base,
        &format!("/api/roles/instance/{}/assign", junior.id),
        &priya,
        Some(json!({ "userId": id("u-marcus") })),
    )
    .await;
    assert_eq!(status, 403, "{body}");
    assert_eq!(body["message"], "Forbidden resource");
}

#[tokio::test]
async fn an_assignment_shows_in_both_role_lists() {
    let (server, client, base) = showcase().await;
    let admin = roles(&client, &base, TOKEN)
        .await
        .into_iter()
        .find(|role| role.name == "Instance Admin")
        .unwrap();
    let priya_id = id("u-priya");
    let (status, body) = send(
        &client,
        reqwest::Method::POST,
        &base,
        &format!("/api/roles/instance/{}/assign", admin.id),
        TOKEN,
        Some(json!({ "userId": priya_id })),
    )
    .await;
    assert_eq!(status, 204, "{body}");

    // The role's users.
    let (status, body) = send(
        &client,
        reqwest::Method::GET,
        &base,
        &format!("/api/roles/instance/{}/users", admin.id),
        TOKEN,
        None,
    )
    .await;
    assert_eq!(status, 200, "{body}");
    let users: Vec<wire::RoleUserDto> = decode(&body);
    assert_eq!(users.len(), 1);
    assert_eq!(
        (users[0].user_id.as_str(), users[0].username.as_str()),
        (priya_id.as_str(), "pri")
    );

    // Her instance roles, as the owner reads them for her, and as she reads them.
    let (status, body) = send(
        &client,
        reqwest::Method::GET,
        &base,
        &format!("/api/roles/user/{priya_id}/instance"),
        TOKEN,
        None,
    )
    .await;
    assert_eq!(status, 200, "{body}");
    let for_her: wire::UserRolesResponseDto = decode(&body);
    assert_eq!(
        for_her
            .roles
            .iter()
            .map(|role| role.name.as_str())
            .collect::<Vec<_>>(),
        ["Member", "Instance Admin"]
    );
    assert_eq!(actions(&for_her.roles[0]), ["CREATE_COMMUNITY"]);
    assert_eq!(actions(&for_her.roles[1]).len(), 12);

    let priya = bearer_for(&server, &client, &base, "pri", &priya_id).await;
    let (status, body) = send(
        &client,
        reqwest::Method::GET,
        &base,
        "/api/roles/my/instance",
        &priya,
        None,
    )
    .await;
    assert_eq!(status, 200, "{body}");
    let mine: wire::UserRolesResponseDto = decode(&body);
    assert_eq!(mine.user_id, priya_id);
    assert_eq!(
        mine.roles
            .iter()
            .map(|role| role.name.as_str())
            .collect::<Vec<_>>(),
        ["Member", "Instance Admin"]
    );
    // And the default role every user keeps is still the one that may create communities.
    let member: Vec<String> = mine.roles[0]
        .actions
        .iter()
        .map(|action| action.as_str().into_owned())
        .collect();
    assert_eq!(member, ["CREATE_COMMUNITY"]);
}
