//! W3: accounts, sessions, onboarding and sign-in with browser, over real HTTP and sockets. Each
//! test names the backend behaviour it keeps; `contract.rs` checks every shape against the spec.

mod common;

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use common::*;
use semaphore_fake_server::{FakeServer, InviteSeed, ProfileOrder, entity_uuid};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::time::Duration;

struct Api {
    server: FakeServer,
    client: reqwest::Client,
    base: String,
}

async fn api() -> Api {
    let server = start("showcase").await;
    let base = server.base_url();
    Api {
        server,
        client: http(),
        base,
    }
}

impl Api {
    async fn call(
        &self,
        method: reqwest::Method,
        path: &str,
        token: Option<&str>,
        headers: &[(&str, &str)],
        body: Option<Value>,
    ) -> (u16, Value) {
        let mut builder = self.client.request(method, format!("{}{path}", self.base));
        if let Some(token) = token {
            builder = builder.header("Authorization", format!("Bearer {token}"));
        }
        for (name, value) in headers {
            builder = builder.header(*name, *value);
        }
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

    async fn get(&self, path: &str, token: &str) -> (u16, Value) {
        self.call(reqwest::Method::GET, path, Some(token), &[], None)
            .await
    }

    async fn send(
        &self,
        method: reqwest::Method,
        path: &str,
        token: &str,
        body: Value,
    ) -> (u16, Value) {
        self.call(method, path, Some(token), &[], Some(body)).await
    }

    async fn public_post(&self, path: &str, body: Value) -> (u16, Value) {
        self.call(reqwest::Method::POST, path, None, &[], Some(body))
            .await
    }

    /// Signs in; the tokens.
    async fn login(
        &self,
        username: &str,
        password: &str,
        device: Option<&str>,
    ) -> (String, String) {
        let headers: Vec<(&str, &str)> = device.map(|d| ("X-Device-Name", d)).into_iter().collect();
        let (status, body) = self
            .call(
                reqwest::Method::POST,
                "/api/auth/login",
                None,
                &headers,
                Some(json!({ "username": username, "password": password })),
            )
            .await;
        assert_eq!(status, 200, "{body}");
        (
            body["accessToken"].as_str().unwrap().to_owned(),
            body["refreshToken"].as_str().unwrap().to_owned(),
        )
    }

    async fn upload(&self, token: &str, resource_type: &str) -> String {
        let boundary = "w3-boundary";
        let mut body = Vec::new();
        body.extend_from_slice(
            format!(
                "--{boundary}\r\nContent-Disposition: form-data; name=\"resourceType\"\r\n\r\n{resource_type}\r\n"
            )
            .as_bytes(),
        );
        body.extend_from_slice(
            format!(
                "--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"a.png\"\r\nContent-Type: image/png\r\n\r\n"
            )
            .as_bytes(),
        );
        body.extend_from_slice(b"png-bytes");
        body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
        let response = self
            .client
            .post(format!("{}/api/file-upload", self.base))
            .header("Authorization", format!("Bearer {token}"))
            .header(
                "Content-Type",
                format!("multipart/form-data; boundary={boundary}"),
            )
            .body(body)
            .send()
            .await
            .expect("the fake answers");
        assert_eq!(response.status().as_u16(), 201);
        let record: Value = response.json().await.unwrap();
        record["id"].as_str().unwrap().to_owned()
    }
}

async fn socket_for(base: &str, token: &str) -> Socket {
    Socket::connect(
        base,
        json!({ "token": format!("Bearer {token}"), "protocol": 2 }),
    )
    .await
}

fn challenge_of(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

const VERIFIER: &str = "verifier-verifier-verifier-verifier-verifier-1234";
const OTHER_VERIFIER: &str = "another-another-another-another-another-another-1";

fn is_uuid(text: &str) -> bool {
    text.len() == 36 && uuid::Uuid::parse_str(text).is_ok()
}

// ----- onboarding ------------------------------------------------------------------------------

#[tokio::test]
async fn register_needs_a_usable_invite_whatever_the_mode_and_checks_it_before_names() {
    let api = api().await;
    let body = |code: &str, username: &str| json!({ "code": code, "username": username, "password": "Password123!" });

    // The public settings say INVITE_ONLY, but the backend asks for the invite in every mode, and
    // there is none yet: 404, not an open door.
    let (status, error) = api
        .public_post("/api/users", body("nope", "New-User"))
        .await;
    assert_eq!(status, 404, "{error}");
    assert_eq!(error["errorCode"], "NOT_FOUND");
    assert_eq!(error["message"], "No invite found for the provided code.");

    api.server.seed_invite(InviteSeed::new("GOOD"));
    // A taken username with an unknown code is still the invite's 404: names are not revealed.
    let (status, error) = api.public_post("/api/users", body("nope", "me")).await;
    assert_eq!(status, 404, "{error}");

    let (status, user) = api
        .public_post("/api/users", body("GOOD", "New-User"))
        .await;
    assert_eq!(status, 201, "{user}");
    assert_eq!(user["username"], "new-user");
    assert_eq!(user["displayName"], "new-user");
    assert_eq!(user["role"], "USER");
    assert!(is_uuid(user["id"].as_str().unwrap()));
    assert!(user.get("hashedPassword").is_none() && user.get("email").is_none());

    // The invite's uses went up.
    let (_, invite) = api
        .call(
            reqwest::Method::GET,
            "/api/invite/public/GOOD",
            None,
            &[],
            None,
        )
        .await;
    assert_eq!(invite["uses"], 1);

    // The name is taken whatever its case; so is an email.
    let (status, error) = api
        .public_post("/api/users", body("GOOD", "NEW-user"))
        .await;
    assert_eq!(
        (status, error["errorCode"].as_str()),
        (409, Some("CONFLICT")),
        "{error}"
    );
    assert_eq!(
        error["message"],
        "A user with this username already exists."
    );
    let mut with_email = body("GOOD", "second");
    with_email["email"] = json!("a@example.com");
    assert_eq!(
        api.public_post("/api/users", with_email.clone()).await.0,
        201
    );
    with_email["username"] = json!("third");
    let (status, error) = api.public_post("/api/users", with_email).await;
    assert_eq!(status, 409, "{error}");
    assert_eq!(error["message"], "A user with this email already exists.");
    // A scenario user's name is taken too, whatever its case.
    for taken in ["alexk", "PRI"] {
        let (status, error) = api.public_post("/api/users", body("GOOD", taken)).await;
        assert_eq!(status, 409, "{taken}: {error}");
    }

    // The new account signs in with its own password, and then is the one acting.
    let (token, _) = api.login("NEW-USER", "Password123!", None).await;
    let (status, profile) = api.get("/api/users/profile", &token).await;
    assert_eq!(status, 200);
    assert_eq!(profile["username"], "new-user");
    let (status, _) = api
        .call(
            reqwest::Method::POST,
            "/api/auth/login",
            None,
            &[],
            Some(json!({ "username": "new-user", "password": "wrong-password" })),
        )
        .await;
    assert_eq!(status, 401);
    // It sees no community of the scenario.
    let (_, mine) = api.get("/api/community/mine", &token).await;
    assert_eq!(mine, json!([]));
}

#[tokio::test]
async fn an_expired_used_up_or_disabled_invite_does_not_register_or_show() {
    let api = api().await;
    type Change = fn(&mut InviteSeed);
    let seeds: [(&str, Change); 3] = [
        ("EXPIRED", |seed: &mut InviteSeed| {
            seed.valid_until = Some(chrono::DateTime::<chrono::Utc>::MIN_UTC);
        }),
        ("USEDUP", |seed: &mut InviteSeed| {
            seed.max_uses = Some(1);
            seed.uses = 1;
        }),
        ("DISABLED", |seed: &mut InviteSeed| seed.disabled = true),
    ];
    for (code, change) in seeds {
        let mut seed = InviteSeed::new(code);
        change(&mut seed);
        api.server.seed_invite(seed);
        // The public lookup answers 200 with nothing, as the backend does for a `null`.
        let (status, body) = api
            .call(
                reqwest::Method::GET,
                &format!("/api/invite/public/{code}"),
                None,
                &[],
                None,
            )
            .await;
        assert_eq!(
            (status, &body),
            (200, &Value::String(String::new())),
            "{code}"
        );
        let (status, error) = api
            .public_post(
                "/api/users",
                json!({ "code": code, "username": "someone", "password": "Password123!" }),
            )
            .await;
        assert_eq!(status, 404, "{code}: {error}");
    }

    // A limited invite runs out as it is used, and one with a date expires on the server's clock.
    let mut limited = InviteSeed::new("ONCE");
    limited.max_uses = Some(1);
    api.server.seed_invite(limited);
    let mut dated = InviteSeed::new("DATED");
    dated.valid_until = Some(
        chrono::DateTime::parse_from_rfc3339("2100-01-01T00:00:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc),
    );
    api.server.seed_invite(dated);
    let register = |name: &'static str, code: &'static str| {
        api.public_post(
            "/api/users",
            json!({ "code": code, "username": name, "password": "Password123!" }),
        )
    };
    assert_eq!(register("first", "ONCE").await.0, 201);
    assert_eq!(register("second", "ONCE").await.0, 404);
    assert_eq!(register("third", "DATED").await.0, 201);
    api.server
        .advance_clock(Duration::from_secs(60 * 60 * 24 * 365 * 100));
    assert_eq!(register("fourth", "DATED").await.0, 404);
}

#[tokio::test]
async fn a_good_public_invite_shows_what_the_join_screen_needs() {
    let api = api().await;
    let mut seed = InviteSeed::new("SHOW");
    seed.max_uses = Some(5);
    seed.uses = 2;
    api.server.seed_invite(seed);
    let (status, invite) = api
        .call(
            reqwest::Method::GET,
            "/api/invite/public/SHOW",
            None,
            &[],
            None,
        )
        .await;
    assert_eq!(status, 200);
    assert_eq!(
        invite,
        json!({
            "code": "SHOW", "uses": 2, "maxUses": 5, "validUntil": null, "disabled": false,
            "createdBy": { "username": "inviter" },
        })
    );
    // An unknown code is the same empty 200.
    let (status, body) = api
        .call(
            reqwest::Method::GET,
            "/api/invite/public/none",
            None,
            &[],
            None,
        )
        .await;
    assert_eq!((status, body), (200, Value::String(String::new())));
}

#[tokio::test]
async fn forgot_password_answers_the_same_for_any_email() {
    let api = api().await;
    let mut seed = InviteSeed::new("C");
    seed.max_uses = None;
    api.server.seed_invite(seed);
    api.public_post(
        "/api/users",
        json!({ "code": "C", "username": "known", "password": "Password123!", "email": "known@example.com" }),
    )
    .await;
    let known = api
        .public_post(
            "/api/auth/forgot-password",
            json!({ "email": "known@example.com" }),
        )
        .await;
    let unknown = api
        .public_post(
            "/api/auth/forgot-password",
            json!({ "email": "nobody@example.com" }),
        )
        .await;
    assert_eq!(known.0, 200);
    assert_eq!(known, unknown);
    assert_eq!(
        known.1["message"],
        "If an account with that email exists, a reset link has been sent."
    );
    let (status, _) = api
        .public_post(
            "/api/auth/forgot-password",
            json!({ "email": "not-an-email" }),
        )
        .await;
    assert_eq!(status, 400);
}

#[tokio::test]
async fn creating_a_community_makes_the_creator_its_first_member_with_a_general_channel() {
    let api = api().await;
    let (token, _) = api.login("mike", "Password123!", None).await;
    let mut socket = socket_for(&api.base, &token).await;

    let (status, community) = api
        .send(
            reqwest::Method::POST,
            "/api/community",
            &token,
            json!({ "name": "Brand New", "description": "  desc " }),
        )
        .await;
    assert_eq!(status, 201, "{community}");
    let id = community["id"].as_str().unwrap().to_owned();
    assert!(is_uuid(&id));
    assert_eq!(community["name"], "Brand New");
    assert_eq!(community["avatar"], Value::Null);

    let (_, mine) = api.get("/api/community/mine", &token).await;
    assert!(mine.as_array().unwrap().iter().any(|c| c["id"] == id));
    // The scenario's own communities are still listed.
    assert!(mine.as_array().unwrap().len() > 1);
    let (status, channels) = api
        .get(&format!("/api/channels/community/{id}"), &token)
        .await;
    assert_eq!(status, 200);
    assert_eq!(channels.as_array().unwrap().len(), 1);
    assert_eq!(channels[0]["name"], "general");
    assert_eq!(channels[0]["type"], "TEXT");
    assert_eq!(channels[0]["communityId"], id);
    let (status, members) = api
        .get(&format!("/api/membership/community/{id}"), &token)
        .await;
    assert_eq!(status, 200);
    assert_eq!(members["members"].as_array().unwrap().len(), 1);
    assert_eq!(members["members"][0]["userId"], entity_uuid("me"));

    let heard = settle(&api.server, &mut [&mut socket]).await;
    assert_eq!(names(&heard[0]), vec!["memberAddedToCommunity"]);
    assert_eq!(
        heard[0][0].1,
        json!({ "communityId": id, "userId": entity_uuid("me") })
    );

    // The name is unique.
    let (status, error) = api
        .send(
            reqwest::Method::POST,
            "/api/community",
            &token,
            json!({ "name": "Brand New" }),
        )
        .await;
    assert_eq!(
        (status, error["errorCode"].as_str()),
        (409, Some("CONFLICT")),
        "{error}"
    );
    let (status, _) = api
        .send(
            reqwest::Method::POST,
            "/api/community",
            &token,
            json!({ "name": "" }),
        )
        .await;
    assert_eq!(status, 400);

    // An image must be the creator's own, uploaded for a community.
    let (status, error) = api
        .send(
            reqwest::Method::POST,
            "/api/community",
            &token,
            json!({ "name": "Pictured", "avatar": "not-a-file" }),
        )
        .await;
    assert_eq!(
        (status, error["errorCode"].as_str()),
        (403, Some("FILE_NOT_OWNED")),
        "{error}"
    );
    let wrong_kind = api.upload(&token, "USER_AVATAR").await;
    let (status, _) = api
        .send(
            reqwest::Method::POST,
            "/api/community",
            &token,
            json!({ "name": "Pictured", "avatar": wrong_kind }),
        )
        .await;
    assert_eq!(status, 403);
    let file = api.upload(&token, "COMMUNITY_AVATAR").await;
    let (status, pictured) = api
        .send(
            reqwest::Method::POST,
            "/api/community",
            &token,
            json!({ "name": "Pictured", "avatar": file }),
        )
        .await;
    assert_eq!(status, 201, "{pictured}");
    assert_eq!(pictured["avatar"], file);
}

// ----- profile ---------------------------------------------------------------------------------

#[tokio::test]
async fn a_profile_update_trims_clears_and_checks_the_files() {
    let api = api().await;
    let (token, _) = api.login("mike", "Password123!", None).await;

    let (status, user) = api
        .send(
            reqwest::Method::PATCH,
            "/api/users/profile",
            &token,
            json!({ "displayName": "  Mike  ", "bio": "   ", "status": " busy " }),
        )
        .await;
    assert_eq!(status, 200, "{user}");
    assert_eq!(user["displayName"], "Mike");
    assert_eq!(user["bio"], Value::Null);
    assert_eq!(user["status"], "busy");
    // Fields not sent stay; the next read shows the change.
    let (_, again) = api.get("/api/users/profile", &token).await;
    assert_eq!(again, user);
    let (_, by_id) = api
        .get(&format!("/api/users/{}", entity_uuid("me")), &token)
        .await;
    assert_eq!(by_id["displayName"], "Mike");
    // An empty status clears it.
    let (_, cleared) = api
        .send(
            reqwest::Method::PATCH,
            "/api/users/profile",
            &token,
            json!({ "status": " " }),
        )
        .await;
    assert_eq!(cleared["status"], Value::Null);
    assert_eq!(cleared["displayName"], "Mike");

    // A file that was never uploaded, one uploaded as the other kind, and one that is not this
    // user's are refused alike.
    let (status, error) = api
        .send(
            reqwest::Method::PATCH,
            "/api/users/profile",
            &token,
            json!({ "avatar": "nope" }),
        )
        .await;
    assert_eq!(
        (status, error["errorCode"].as_str()),
        (403, Some("FILE_NOT_OWNED")),
        "{error}"
    );
    assert_eq!(error["message"], "You can only use images you uploaded");
    let banner_file = api.upload(&token, "USER_BANNER").await;
    let (status, _) = api
        .send(
            reqwest::Method::PATCH,
            "/api/users/profile",
            &token,
            json!({ "avatar": banner_file }),
        )
        .await;
    assert_eq!(status, 403);
    let avatar_file = api.upload(&token, "USER_AVATAR").await;
    let (status, _) = api
        .send(
            reqwest::Method::PATCH,
            "/api/users/profile",
            &token,
            json!({ "banner": avatar_file }),
        )
        .await;
    assert_eq!(status, 403);

    let (status, user) = api
        .send(
            reqwest::Method::PATCH,
            "/api/users/profile",
            &token,
            json!({ "avatar": avatar_file, "banner": banner_file }),
        )
        .await;
    assert_eq!(status, 200, "{user}");
    assert_eq!(user["avatarUrl"], avatar_file);
    assert_eq!(user["bannerUrl"], banner_file);
    // Resending the current id is accepted without the check, and "" clears.
    let (status, _) = api
        .send(
            reqwest::Method::PATCH,
            "/api/users/profile",
            &token,
            json!({ "avatar": avatar_file }),
        )
        .await;
    assert_eq!(status, 200);
    let (_, cleared) = api
        .send(
            reqwest::Method::PATCH,
            "/api/users/profile",
            &token,
            json!({ "avatar": "", "banner": "" }),
        )
        .await;
    assert_eq!(
        (&cleared["avatarUrl"], &cleared["bannerUrl"]),
        (&Value::Null, &Value::Null)
    );

    // Someone else's upload is refused: a registered account can't use mike's avatar file.
    api.server.seed_invite(InviteSeed::new("C"));
    api.public_post(
        "/api/users",
        json!({ "code": "C", "username": "other", "password": "Password123!" }),
    )
    .await;
    let (other, _) = api.login("other", "Password123!", None).await;
    let (status, _) = api
        .send(
            reqwest::Method::PATCH,
            "/api/users/profile",
            &other,
            json!({ "avatar": avatar_file }),
        )
        .await;
    assert_eq!(status, 403);
    let (status, _) = api
        .send(
            reqwest::Method::PATCH,
            "/api/users/profile",
            &other,
            json!({ "displayName": "" }),
        )
        .await;
    assert_eq!(status, 400);
}

#[tokio::test]
async fn the_profile_event_goes_to_the_user_and_their_community_in_either_order() {
    let api = api().await;
    let (token, _) = api.login("mike", "Password123!", None).await;
    let mut mine = socket_for(&api.base, &token).await;
    // Priya shares a community with me; a user of no shared community is not told.
    let mut priya = connect_as(&api.base, &entity_uuid("u-priya")).await;
    let mut stranger = connect_as(&api.base, &entity_uuid("u-tomas")).await;
    let patch = |name: &'static str| {
        api.send(
            reqwest::Method::PATCH,
            "/api/users/profile",
            &token,
            json!({ "displayName": name }),
        )
    };

    // The event is written before the reply goes out.
    api.server.set_profile_order(ProfileOrder::EventThenReply);
    assert_eq!(patch("One").await.0, 200);
    let heard = settle(&api.server, &mut [&mut mine, &mut priya, &mut stranger]).await;
    assert_eq!(names(&heard[0]), vec!["userProfileUpdated"]);
    assert_eq!(names(&heard[1]), vec!["userProfileUpdated"]);
    assert_eq!(heard[0][0].1["displayName"], "One");
    assert_eq!(heard[0][0].1["userId"], entity_uuid("me"));
    // Tomas shares c-trail with me in this scenario, so he hears it too; the user above is only
    // told once per socket.
    assert_eq!(names(&heard[2]), vec!["userProfileUpdated"]);

    // The event waits for the test: the reply is in hand and nothing has been sent.
    api.server.set_profile_order(ProfileOrder::ReplyThenEvent);
    let (status, reply) = patch("Two").await;
    assert_eq!((status, &reply["displayName"]), (200, &json!("Two")));
    let heard = settle(&api.server, &mut [&mut mine]).await;
    assert!(heard[0].is_empty(), "{heard:?}");
    assert_eq!(api.server.release_held_events(), 1);
    assert_eq!(api.server.release_held_events(), 0);
    let heard = settle(&api.server, &mut [&mut mine]).await;
    assert_eq!(names(&heard[0]), vec!["userProfileUpdated"]);
    assert_eq!(heard[0][0].1["displayName"], "Two");
}

// ----- sessions --------------------------------------------------------------------------------

fn ids_of(list: &Value) -> Vec<String> {
    list.as_array()
        .unwrap()
        .iter()
        .map(|s| s["id"].as_str().unwrap().to_owned())
        .collect()
}

#[tokio::test]
async fn each_login_is_a_session_and_the_asking_one_is_current() {
    let api = api().await;
    let (first, _) = api.login("mike", "Password123!", Some("Desk")).await;
    let (second, _) = api.login("mike", "Password123!", Some("Laptop")).await;
    assert_ne!(first, second);
    let phone = api.server.add_session("Phone", Some("203.0.113.7"));

    let (status, list) = api.get("/api/auth/sessions", &first).await;
    assert_eq!(status, 200, "{list}");
    let list_arr = list.as_array().unwrap();
    assert_eq!(list_arr.len(), 3);
    let devices: Vec<&str> = list_arr
        .iter()
        .map(|s| s["deviceName"].as_str().unwrap())
        .collect();
    assert_eq!(devices, vec!["Desk", "Laptop", "Phone"]);
    assert!(list_arr.iter().all(|s| is_uuid(s["id"].as_str().unwrap())));
    let current: Vec<&str> = list_arr
        .iter()
        .filter(|s| s["isCurrent"] == true)
        .map(|s| s["deviceName"].as_str().unwrap())
        .collect();
    assert_eq!(current, vec!["Desk"]);
    assert_eq!(list_arr[2]["ipAddress"], "203.0.113.7");

    // The other bearer sees the same sessions, with itself as the current one.
    let (_, from_phone) = api.get("/api/auth/sessions", &phone.access_token).await;
    assert_eq!(ids_of(&from_phone), ids_of(&list));
    let current: Vec<&str> = from_phone
        .as_array()
        .unwrap()
        .iter()
        .filter(|s| s["isCurrent"] == true)
        .map(|s| s["id"].as_str().unwrap())
        .collect();
    assert_eq!(current, vec![phone.id.as_str()]);

    // A session of another account is not listed, and not revocable.
    api.server.seed_invite(InviteSeed::new("C"));
    api.public_post(
        "/api/users",
        json!({ "code": "C", "username": "other", "password": "Password123!" }),
    )
    .await;
    let (other, _) = api.login("other", "Password123!", Some("Elsewhere")).await;
    let (_, theirs) = api.get("/api/auth/sessions", &other).await;
    assert_eq!(theirs.as_array().unwrap().len(), 1);
    let (status, error) = api
        .call(
            reqwest::Method::DELETE,
            &format!("/api/auth/sessions/{}", theirs[0]["id"].as_str().unwrap()),
            Some(&first),
            &[],
            None,
        )
        .await;
    assert_eq!(
        (status, error["errorCode"].as_str()),
        (404, Some("NOT_FOUND")),
        "{error}"
    );
}

#[tokio::test]
async fn revoking_a_session_ends_its_tokens_and_tells_only_its_sockets() {
    let api = api().await;
    let (mine, _) = api.login("mike", "Password123!", Some("Desk")).await;
    let (laptop, laptop_refresh) = api.login("mike", "Password123!", Some("Laptop")).await;
    let phone = api.server.add_session("Phone", None);
    let mut on_desk = socket_for(&api.base, &mine).await;
    let mut on_laptop = socket_for(&api.base, &laptop).await;
    let mut on_phone = socket_for(&api.base, &phone.access_token).await;

    let (_, list) = api.get("/api/auth/sessions", &mine).await;
    let laptop_id = list
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["deviceName"] == "Laptop")
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();

    let (status, body) = api
        .call(
            reqwest::Method::DELETE,
            &format!("/api/auth/sessions/{laptop_id}"),
            Some(&mine),
            &[],
            None,
        )
        .await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["message"], "Session revoked successfully");

    let heard = settle(
        &api.server,
        &mut [&mut on_desk, &mut on_laptop, &mut on_phone],
    )
    .await;
    assert!(heard[0].is_empty() && heard[2].is_empty(), "{heard:?}");
    assert_eq!(
        heard[1],
        vec![(
            "sessionTerminated".to_owned(),
            json!({ "reason": "SESSION_REVOKED" })
        )]
    );

    // Its access token, its refresh token and a new socket with it all fail; the others work.
    assert_eq!(api.get("/api/users/profile", &laptop).await.0, 401);
    let (status, _) = api
        .public_post(
            "/api/auth/refresh",
            json!({ "refreshToken": laptop_refresh }),
        )
        .await;
    assert_eq!(status, 401);
    let mut again = Socket::open(&api.base).await;
    again
        .send(&format!(
            "40{}",
            json!({ "token": format!("Bearer {laptop}"), "protocol": 2 })
        ))
        .await;
    assert!(again.next_text().await.starts_with("44"));
    assert_eq!(api.get("/api/users/profile", &mine).await.0, 200);
    assert_eq!(
        api.get("/api/users/profile", &phone.access_token).await.0,
        200
    );
    let (_, after) = api.get("/api/auth/sessions", &mine).await;
    assert_eq!(after.as_array().unwrap().len(), 2);

    // It is gone; revoking it again, an id nobody has, and something that is no id.
    let (status, _) = api
        .call(
            reqwest::Method::DELETE,
            &format!("/api/auth/sessions/{laptop_id}"),
            Some(&mine),
            &[],
            None,
        )
        .await;
    assert_eq!(status, 404);
    let (status, _) = api
        .call(
            reqwest::Method::DELETE,
            &format!("/api/auth/sessions/{}", entity_uuid("no-such-session")),
            Some(&mine),
            &[],
            None,
        )
        .await;
    assert_eq!(status, 404);
    let (status, error) = api
        .call(
            reqwest::Method::DELETE,
            "/api/auth/sessions/not-a-uuid",
            Some(&mine),
            &[],
            None,
        )
        .await;
    assert_eq!(
        (status, error["errorCode"].as_str()),
        (400, Some("VALIDATION_FAILED"))
    );
}

#[tokio::test]
async fn revoking_the_others_keeps_the_caller() {
    let api = api().await;
    let (mine, mine_refresh) = api.login("mike", "Password123!", Some("Desk")).await;
    let (laptop, _) = api.login("mike", "Password123!", Some("Laptop")).await;
    let phone = api.server.add_session("Phone", None);
    let mut on_desk = socket_for(&api.base, &mine).await;
    let mut on_laptop = socket_for(&api.base, &laptop).await;
    let mut on_phone = socket_for(&api.base, &phone.access_token).await;

    let (status, body) = api
        .call(
            reqwest::Method::DELETE,
            "/api/auth/sessions",
            Some(&mine),
            &[],
            None,
        )
        .await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["revokedCount"], 2);
    assert_eq!(body["message"], "Revoked 2 sessions");
    let heard = settle(
        &api.server,
        &mut [&mut on_desk, &mut on_laptop, &mut on_phone],
    )
    .await;
    assert!(heard[0].is_empty(), "the caller is told nothing: {heard:?}");
    assert_eq!(names(&heard[1]), vec!["sessionTerminated"]);
    assert_eq!(names(&heard[2]), vec!["sessionTerminated"]);

    assert_eq!(api.get("/api/users/profile", &laptop).await.0, 401);
    assert_eq!(
        api.get("/api/users/profile", &phone.access_token).await.0,
        401
    );
    assert_eq!(api.get("/api/users/profile", &mine).await.0, 200);
    let (status, _) = api
        .public_post("/api/auth/refresh", json!({ "refreshToken": mine_refresh }))
        .await;
    assert_eq!(status, 200);
    let (_, list) = api.get("/api/auth/sessions", &mine).await;
    assert_eq!(list.as_array().unwrap().len(), 1);
    assert_eq!(list[0]["isCurrent"], true);

    // Nothing left to revoke: one fewer, and the singular.
    let (_, none) = api
        .call(
            reqwest::Method::DELETE,
            "/api/auth/sessions",
            Some(&mine),
            &[],
            None,
        )
        .await;
    assert_eq!(
        (none["revokedCount"].clone(), none["message"].clone()),
        (json!(0), json!("Revoked 0 sessions"))
    );
    api.server.add_session("Tablet", None);
    let (_, one) = api
        .call(
            reqwest::Method::DELETE,
            "/api/auth/sessions",
            Some(&mine),
            &[],
            None,
        )
        .await;
    assert_eq!(one["message"], "Revoked 1 session");
}

// ----- appearance ------------------------------------------------------------------------------

#[tokio::test]
async fn appearance_settings_are_created_on_first_read_and_updated_partially() {
    let api = api().await;
    let (token, _) = api.login("mike", "Password123!", None).await;

    let (status, first) = api.get("/api/appearance-settings", &token).await;
    assert_eq!(status, 200, "{first}");
    assert_eq!(
        (
            &first["themeMode"],
            &first["accentColor"],
            &first["intensity"]
        ),
        (&json!("dark"), &json!("teal"), &json!("minimal"))
    );
    assert_eq!(first["userId"], entity_uuid("me"));
    assert!(is_uuid(first["id"].as_str().unwrap()));
    let (_, again) = api.get("/api/appearance-settings", &token).await;
    assert_eq!(again, first);

    api.server.advance_clock(Duration::from_secs(5));
    let (status, updated) = api
        .send(
            reqwest::Method::PATCH,
            "/api/appearance-settings",
            &token,
            json!({ "accentColor": "rose" }),
        )
        .await;
    assert_eq!(status, 200, "{updated}");
    assert_eq!(updated["accentColor"], "rose");
    assert_eq!(updated["themeMode"], "dark");
    assert_eq!(updated["id"], first["id"]);
    assert_eq!(updated["createdAt"], first["createdAt"]);
    assert_ne!(updated["updatedAt"], first["updatedAt"]);
    let (_, read) = api.get("/api/appearance-settings", &token).await;
    assert_eq!(read, updated);

    // A PATCH before any read creates the row with the rest at the defaults.
    api.server.seed_invite(InviteSeed::new("C"));
    api.public_post(
        "/api/users",
        json!({ "code": "C", "username": "other", "password": "Password123!" }),
    )
    .await;
    let (other, _) = api.login("other", "Password123!", None).await;
    let (_, created) = api
        .send(
            reqwest::Method::PATCH,
            "/api/appearance-settings",
            &other,
            json!({ "themeMode": "light", "intensity": "vibrant" }),
        )
        .await;
    assert_eq!(
        (
            &created["themeMode"],
            &created["accentColor"],
            &created["intensity"]
        ),
        (&json!("light"), &json!("teal"), &json!("vibrant"))
    );
    // And it is the other user's own; mike's did not change.
    assert_eq!(api.get("/api/appearance-settings", &token).await.1, read);

    // Not a value the backend allows.
    for bad in [
        json!({ "themeMode": "sepia" }),
        json!({ "accentColor": "pink" }),
        json!({ "intensity": "subtle" }),
    ] {
        let (status, _) = api
            .send(
                reqwest::Method::PATCH,
                "/api/appearance-settings",
                &token,
                bad,
            )
            .await;
        assert_eq!(status, 400);
    }
    assert_eq!(api.get("/api/appearance-settings", &token).await.1, read);
}

// ----- sign in with browser --------------------------------------------------------------------

async fn redeem(api: &Api, code: &str, verifier: &str) -> (u16, Value) {
    api.call(
        reqwest::Method::POST,
        "/api/auth/desktop/token",
        None,
        &[
            ("X-Client-Type", "native"),
            ("X-Device-Id", "device-1"),
            ("X-Device-Name", "Desktop app"),
        ],
        Some(json!({ "code": code, "codeVerifier": verifier })),
    )
    .await
}

#[tokio::test]
async fn a_desktop_code_redeems_once_for_a_new_session_and_tells_the_others() {
    let api = api().await;
    let (browser, _) = api.login("mike", "Password123!", Some("Browser")).await;
    let mut in_browser = socket_for(&api.base, &browser).await;

    let code = api.server.approve_desktop(&challenge_of(VERIFIER));
    assert_eq!(code.len(), 43);
    assert!(
        code.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    );
    assert_ne!(code, api.server.approve_desktop(&challenge_of(VERIFIER)));

    let (status, tokens) = redeem(&api, &code, VERIFIER).await;
    assert_eq!(status, 200, "{tokens}");
    let access = tokens["accessToken"].as_str().unwrap().to_owned();
    assert!(tokens["refreshToken"].is_string());
    assert_ne!(access, browser);

    // A session of its own, for the approving user, named by the device that redeemed.
    let (status, profile) = api.get("/api/users/profile", &access).await;
    assert_eq!(status, 200);
    assert_eq!(profile["id"], entity_uuid("me"));
    let (_, list) = api.get("/api/auth/sessions", &access).await;
    let devices: Vec<(&str, bool)> = list
        .as_array()
        .unwrap()
        .iter()
        .map(|s| (s["deviceName"].as_str().unwrap(), s["isCurrent"] == true))
        .collect();
    assert_eq!(devices, vec![("Browser", false), ("Desktop app", true)]);

    // The browser's socket is told; the redeemer's session is not.
    let heard = settle(&api.server, &mut [&mut in_browser]).await;
    assert_eq!(names(&heard[0]), vec!["desktopSignIn"]);
    assert_eq!(heard[0][0].1["ipAddress"], "127.0.0.1");
    assert!(heard[0][0].1["signedInAt"].is_string());

    // Single use.
    let (status, error) = redeem(&api, &code, VERIFIER).await;
    assert_eq!(status, 401, "{error}");
    assert_eq!(error["errorCode"], "UNAUTHENTICATED");
    assert_eq!(error["message"], "Invalid or expired sign-in code");

    // Revoking the session it made ends it like any other.
    let own = list
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["isCurrent"] == true)
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let (status, _) = api
        .call(
            reqwest::Method::DELETE,
            &format!("/api/auth/sessions/{own}"),
            Some(&browser),
            &[],
            None,
        )
        .await;
    assert_eq!(status, 200);
    assert_eq!(api.get("/api/users/profile", &access).await.0, 401);
}

#[tokio::test]
async fn a_wrong_verifier_spends_the_code_and_so_does_every_other_failure() {
    let api = api().await;
    let code = api.server.approve_desktop(&challenge_of(VERIFIER));
    // Well-formed but not the one the challenge came from: refused, and the code is gone.
    let (status, error) = redeem(&api, &code, OTHER_VERIFIER).await;
    assert_eq!(status, 401, "{error}");
    assert_eq!(error["message"], "Invalid or expired sign-in code");
    assert_eq!(redeem(&api, &code, VERIFIER).await.0, 401);

    // A code nobody approved.
    let unknown = URL_SAFE_NO_PAD.encode(Sha256::digest(b"never approved"));
    assert_eq!(redeem(&api, &unknown, VERIFIER).await.0, 401);

    // The approving session ended in the meantime.
    let revoked = api
        .server
        .approve_desktop_with_revoked_approver(&challenge_of(VERIFIER));
    assert_eq!(redeem(&api, &revoked, VERIFIER).await.0, 401);
    assert_eq!(redeem(&api, &revoked, VERIFIER).await.0, 401);

    // A code or verifier of the wrong shape never gets to the check: the validation 400, and an
    // approved code is still there afterwards.
    let kept = api.server.approve_desktop(&challenge_of(VERIFIER));
    for (code, verifier) in [
        (kept.as_str(), "short"),
        (
            kept.as_str(),
            "has spaces in it which a verifier can never hold!!!!",
        ),
        ("short", VERIFIER),
    ] {
        let (status, error) = redeem(&api, code, verifier).await;
        assert_eq!(
            (status, error["errorCode"].as_str()),
            (400, Some("VALIDATION_FAILED")),
            "{error}"
        );
    }
    assert_eq!(redeem(&api, &kept, VERIFIER).await.0, 200);

    // The wrong verifier first, then the right one: still refused.
    let both = api.server.approve_desktop(&challenge_of(VERIFIER));
    assert_eq!(redeem(&api, &both, OTHER_VERIFIER).await.0, 401);
    assert_eq!(redeem(&api, &both, VERIFIER).await.0, 401);
}

#[tokio::test]
async fn a_desktop_code_is_good_for_60_seconds_of_the_server_clock() {
    let api = api().await;
    let just_in_time = api.server.approve_desktop(&challenge_of(VERIFIER));
    api.server.advance_clock(Duration::from_secs(60));
    assert_eq!(redeem(&api, &just_in_time, VERIFIER).await.0, 200);

    let late = api.server.approve_desktop(&challenge_of(VERIFIER));
    api.server.advance_clock(Duration::from_secs(61));
    assert_eq!(redeem(&api, &late, VERIFIER).await.0, 401);
    // Expired, it is spent too: a second look at the clock would not bring it back.
    assert_eq!(redeem(&api, &late, VERIFIER).await.0, 401);
}

#[tokio::test]
async fn emit_desktop_sign_in_reaches_the_users_sockets() {
    let api = api().await;
    let (mine, _) = api.login("mike", "Password123!", None).await;
    let mut socket = socket_for(&api.base, &mine).await;
    api.server.emit_desktop_sign_in(Some("203.0.113.9"));
    api.server.emit_desktop_sign_in(None);
    let heard = settle(&api.server, &mut [&mut socket]).await;
    assert_eq!(names(&heard[0]), vec!["desktopSignIn", "desktopSignIn"]);
    assert_eq!(heard[0][0].1["ipAddress"], "203.0.113.9");
    assert_eq!(heard[0][1].1["ipAddress"], Value::Null);
}

#[tokio::test]
async fn the_first_login_keeps_the_placeholder_tokens() {
    // Other crates' tests were written against these.
    let api = api().await;
    let (access, refresh) = api.login("mike", "Password123!", None).await;
    assert_eq!(
        (access.as_str(), refresh.as_str()),
        ("fake-access-token", "fake-refresh-token")
    );
    let (status, body) = api
        .public_post(
            "/api/auth/refresh",
            json!({ "refreshToken": "fake-refresh-token" }),
        )
        .await;
    assert_eq!(
        (status, &body["accessToken"]),
        (200, &json!("fake-access-token"))
    );
    // After the access token is expired, a refresh brings the new one, for that session.
    api.server.expire_access_token();
    let (_, body) = api
        .public_post(
            "/api/auth/refresh",
            json!({ "refreshToken": "fake-refresh-token" }),
        )
        .await;
    let fresh = body["accessToken"].as_str().unwrap().to_owned();
    assert_ne!(fresh, "fake-access-token");
    assert_eq!(api.get("/api/users/profile", &fresh).await.0, 200);
    assert_eq!(
        api.get("/api/users/profile", "fake-access-token").await.0,
        401
    );
}
