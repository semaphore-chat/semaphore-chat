//! Who may download a file: `backend/src/file/file-access` as its strategies decide it — a
//! message's attachment for the channel's viewers or the DM's participants, a community's assets
//! for its members, profile images for anyone signed in, a replay clip for its owner, once it is
//! public, or wherever it was shared and the reader can see it. The download, thumbnail and
//! metadata routes all ask the same question.

mod common;

use common::*;
use image::codecs::png::PngEncoder;
use image::{ExtendedColorType, ImageEncoder, Rgba, RgbaImage};
use semaphore_fake_server::{entity_uuid, message_uuid};
use serde_json::{Value, json};

fn id(readable: &str) -> String {
    entity_uuid(readable)
}

fn png(width: u32, height: u32) -> Vec<u8> {
    let mut image = RgbaImage::new(width, height);
    for (x, y, pixel) in image.enumerate_pixels_mut() {
        *pixel = Rgba([(x % 256) as u8, (y % 256) as u8, 96, 255]);
    }
    let mut out = Vec::new();
    PngEncoder::new(&mut out)
        .write_image(image.as_raw(), width, height, ExtendedColorType::Rgba8)
        .expect("a PNG in memory");
    out
}

/// A bearer for a session as another scenario user (`sign_in_as`, then a login), as W5's tests do.
async fn bearer_for(client: &reqwest::Client, base: &str, username: &str, user_id: &str) -> String {
    let (status, body) = post(
        client,
        base,
        "/__control/sign_in_as",
        json!({ "username": username, "userId": user_id }),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    let response = client
        .post(format!("{base}/api/auth/login"))
        .json(&json!({ "username": username, "password": "pw" }))
        .send()
        .await
        .unwrap();
    let body: Value = response.json().await.unwrap();
    format!("Bearer {}", body["accessToken"].as_str().expect("a token"))
}

/// `POST /api/file-upload` as `bearer`, answering its record.
async fn upload(
    client: &reqwest::Client,
    base: &str,
    bearer: &str,
    resource_type: &str,
    resource_id: Option<&str>,
    bytes: &[u8],
) -> Value {
    const BOUNDARY: &str = "access-boundary";
    let mut body = Vec::new();
    body.extend_from_slice(
        format!(
            "--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"resourceType\"\r\n\r\n{resource_type}\r\n"
        )
        .as_bytes(),
    );
    if let Some(resource_id) = resource_id {
        body.extend_from_slice(
            format!(
                "--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"resourceId\"\r\n\r\n{resource_id}\r\n"
            )
            .as_bytes(),
        );
    }
    body.extend_from_slice(
        format!(
            "--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"picture.png\"\r\nContent-Type: image/png\r\n\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(bytes);
    body.extend_from_slice(format!("\r\n--{BOUNDARY}--\r\n").as_bytes());
    let response = client
        .post(format!("{base}/api/file-upload"))
        .header("Authorization", bearer)
        .header(
            "Content-Type",
            format!("multipart/form-data; boundary={BOUNDARY}"),
        )
        .body(body)
        .send()
        .await
        .expect("the fake answers");
    let status = response.status().as_u16();
    let record: Value = response.json().await.expect("a record");
    assert_eq!(status, 201, "{resource_type}: {record}");
    record
}

/// One route as `bearer`: its status, and its error body when it refuses.
async fn fetch(client: &reqwest::Client, base: &str, path: &str, bearer: &str) -> (u16, Value) {
    let response = client
        .get(format!("{base}{path}"))
        .header("Authorization", bearer)
        .send()
        .await
        .expect("the fake answers");
    let status = response.status().as_u16();
    let text = response.text().await.expect("a body");
    (status, serde_json::from_str(&text).unwrap_or(Value::Null))
}

/// The download and metadata routes serve the file to `bearer`.
async fn assert_readable(client: &reqwest::Client, base: &str, file_id: &str, bearer: &str) {
    for path in [
        format!("/api/file/{file_id}"),
        format!("/api/file/{file_id}/metadata"),
        format!("/api/file/{file_id}/thumbnail"),
    ] {
        let (status, body) = fetch(client, base, &path, bearer).await;
        assert_eq!(status, 200, "{path}: {body}");
    }
}

/// All three routes refuse together, with the backend's status, `errorCode` and message.
async fn assert_refused(
    client: &reqwest::Client,
    base: &str,
    file_id: &str,
    bearer: &str,
    message: &str,
) {
    for path in [
        format!("/api/file/{file_id}"),
        format!("/api/file/{file_id}/metadata"),
        format!("/api/file/{file_id}/thumbnail"),
    ] {
        let (status, body) = fetch(client, base, &path, bearer).await;
        assert_eq!(status, 403, "{path}: {body}");
        assert_eq!(body["errorCode"], "FORBIDDEN", "{path}");
        assert_eq!(body["message"], message, "{path}");
    }
}

#[tokio::test]
async fn a_private_channels_attachment_is_for_the_people_who_can_see_it() {
    let server = start("showcase").await;
    let base = server.base_url();
    let client = http();
    let couch = id("c-couch");

    // The owner makes a private channel and writes in it.
    let (status, channel) = post(
        &client,
        &base,
        "/api/channels",
        json!({ "name": "secret", "communityId": couch, "type": "TEXT", "isPrivate": true }),
    )
    .await;
    assert_eq!(status, 201, "{channel}");
    let secret = channel["id"].as_str().expect("an id").to_owned();
    let (status, message) = post(
        &client,
        &base,
        "/api/messages",
        json!({ "channelId": secret, "spans": [{ "type": "PLAINTEXT", "text": "for us" }], "pendingAttachments": 1 }),
    )
    .await;
    assert_eq!(status, 201, "{message}");
    let message_id = message["id"].as_str().expect("an id").to_owned();
    let record = upload(
        &client,
        &base,
        TOKEN,
        "MESSAGE_ATTACHMENT",
        Some(&message_id),
        &png(600, 1200),
    )
    .await;
    let file_id = record["id"].as_str().expect("an id").to_owned();
    assert_eq!(record["fileMessageId"], message_id.as_str());

    // Whoever may see the channel may have the file, thumbnail included.
    assert_readable(&client, &base, &file_id, TOKEN).await;

    // Its community's members who aren't on the private list cannot, and neither can someone
    // outside the community.
    let samira = bearer_for(&client, &base, "samira", &id("u-samira")).await;
    let mateo = bearer_for(&client, &base, "mateo", &id("u-mateo")).await;
    let refused = "You must be able to view this channel to access this file";
    assert_refused(&client, &base, &file_id, &samira, refused).await;
    assert_refused(&client, &base, &file_id, &mateo, refused).await;

    // Put samira on the list and the same file is hers.
    let (status, body) = post(
        &client,
        &base,
        "/api/channel-membership",
        json!({ "channelId": secret, "userId": id("u-samira") }),
    )
    .await;
    assert_eq!(status, 201, "{body}");
    assert_readable(&client, &base, &file_id, &samira).await;
}

#[tokio::test]
async fn a_direct_messages_attachment_is_only_for_its_participants() {
    let server = start("showcase").await;
    let base = server.base_url();
    let client = http();

    // Uploaded for a message, like the app's upload: the message the file will join is named by
    // the attach that follows, and until then the file belongs to nobody.
    let record = upload(
        &client,
        &base,
        TOKEN,
        "MESSAGE_ATTACHMENT",
        None,
        &png(600, 1200),
    )
    .await;
    let file_id = record["id"].as_str().expect("an id").to_owned();
    let (status, body) = fetch(&client, &base, &format!("/api/file/{file_id}"), TOKEN).await;
    assert_eq!(status, 403, "{body}");
    assert_eq!(body["errorCode"], "FORBIDDEN");

    // Attached to one of Priya and me's messages.
    let message = message_uuid("sc-msg-56");
    let (status, body) = post(
        &client,
        &base,
        &format!("/api/messages/{message}/attachments"),
        json!({ "fileId": file_id }),
    )
    .await;
    assert_eq!(status, 201, "{body}");

    assert_readable(&client, &base, &file_id, TOKEN).await;
    let priya = bearer_for(&client, &base, "pri", &id("u-priya")).await;
    assert_readable(&client, &base, &file_id, &priya).await;

    let mateo = bearer_for(&client, &base, "mateo", &id("u-mateo")).await;
    assert_refused(
        &client,
        &base,
        &file_id,
        &mateo,
        "You must be a member of this conversation to access this file",
    )
    .await;
}

#[tokio::test]
async fn profile_images_are_public_and_a_communitys_are_for_its_members() {
    let server = start("showcase").await;
    let base = server.base_url();
    let client = http();
    let mateo = bearer_for(&client, &base, "mateo", &id("u-mateo")).await;

    // `PublicAccessStrategy`: an avatar is anyone's, signed in.
    let avatar = upload(
        &client,
        &base,
        TOKEN,
        "USER_AVATAR",
        Some(&id("me")),
        &png(600, 1200),
    )
    .await;
    let avatar_id = avatar["id"].as_str().expect("an id").to_owned();
    assert_readable(&client, &base, &avatar_id, &mateo).await;

    // `CommunityMembershipStrategy`: Couch Co-op's own image needs Couch Co-op's membership.
    let couch = id("c-couch");
    let image = upload(
        &client,
        &base,
        TOKEN,
        "COMMUNITY_AVATAR",
        Some(&couch),
        &png(600, 1200),
    )
    .await;
    let image_id = image["id"].as_str().expect("an id").to_owned();
    assert_readable(&client, &base, &image_id, TOKEN).await;
    let samira = bearer_for(&client, &base, "samira", &id("u-samira")).await;
    assert_readable(&client, &base, &image_id, &samira).await;
    assert_refused(
        &client,
        &base,
        &image_id,
        &mateo,
        "You must be a member of this community to access this file",
    )
    .await;

    // A soundboard sound is a community file too, though it has no thumbnail of its own.
    let (_, sounds) = get(
        &client,
        &base,
        &format!("/api/soundboard/community/{couch}"),
    )
    .await;
    let sound_file = sounds[0]["fileId"].as_str().expect("a file id").to_owned();
    let (status, _) = fetch(&client, &base, &format!("/api/file/{sound_file}"), &samira).await;
    assert_eq!(status, 200);
    assert_refused(
        &client,
        &base,
        &sound_file,
        &mateo,
        "You must be a member of this community to access this file",
    )
    .await;
}

#[tokio::test]
async fn a_clip_is_its_owners_once_public_or_where_it_was_shared() {
    let server = start("showcase").await;
    let base = server.base_url();
    let client = http();
    let general = id("cc-general");

    // A replay of my share, captured into #general of Couch Co-op.
    let squad = id("vc-squad");
    let (status, body) = post(
        &client,
        &base,
        &format!("/api/channels/{squad}/voice-presence/join"),
        json!({}),
    )
    .await;
    assert_eq!(status, 201, "{body}");
    let (status, body) = post(
        &client,
        &base,
        "/api/livekit/replay/start",
        json!({ "channelId": squad, "videoTrackId": "TR_v" }),
    )
    .await;
    assert_eq!(status, 201, "{body}");
    assert!(server.emit_segments_ready(3));
    let (status, capture) = post(
        &client,
        &base,
        "/api/livekit/replay/capture",
        json!({ "durationMinutes": 1, "destination": "channel", "targetChannelId": general }),
    )
    .await;
    assert_eq!(status, 201, "{capture}");
    let clip_id = capture["clipId"].as_str().expect("a clip").to_owned();
    let file_id = capture["fileId"].as_str().expect("a file").to_owned();

    // The owner has it; a member of the channel it was shared into does too. A clip has no
    // thumbnail (the backend's cover image is not a file thumbnail), so only the download and
    // metadata routes are checked here.
    let samira = bearer_for(&client, &base, "samira", &id("u-samira")).await;
    for bearer in [TOKEN.to_owned(), samira] {
        for path in [
            format!("/api/file/{file_id}"),
            format!("/api/file/{file_id}/metadata"),
        ] {
            let (status, body) = fetch(&client, &base, &path, &bearer).await;
            assert_eq!(status, 200, "{path}: {body}");
        }
    }

    // Someone outside the community can't read the message it was shared into.
    let mateo = bearer_for(&client, &base, "mateo", &id("u-mateo")).await;
    assert_refused(&client, &base, &file_id, &mateo, "Access denied").await;

    // Public on my profile: anyone.
    let response = client
        .put(format!("{base}/api/livekit/clips/{clip_id}"))
        .header("Authorization", TOKEN)
        .json(&json!({ "isPublic": true }))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status().as_u16(), 200);
    let (status, body) = fetch(&client, &base, &format!("/api/file/{file_id}"), &mateo).await;
    assert_eq!(status, 200, "{body}");
}

#[tokio::test]
async fn a_clip_in_my_library_alone_is_not_someone_elses() {
    let server = start("showcase").await;
    let base = server.base_url();
    let client = http();

    // Captured to my library only: no message carries it.
    let squad = id("vc-squad");
    post(
        &client,
        &base,
        &format!("/api/channels/{squad}/voice-presence/join"),
        json!({}),
    )
    .await;
    post(
        &client,
        &base,
        "/api/livekit/replay/start",
        json!({ "channelId": squad, "videoTrackId": "TR_v" }),
    )
    .await;
    assert!(server.emit_segments_ready(3));
    let (status, capture) = post(
        &client,
        &base,
        "/api/livekit/replay/capture",
        json!({ "durationMinutes": 1, "destination": "library" }),
    )
    .await;
    assert_eq!(status, 201, "{capture}");
    let file_id = capture["fileId"].as_str().expect("a file").to_owned();

    let (status, body) = fetch(&client, &base, &format!("/api/file/{file_id}"), TOKEN).await;
    assert_eq!(status, 200, "{body}");
    let samira = bearer_for(&client, &base, "samira", &id("u-samira")).await;
    assert_refused(&client, &base, &file_id, &samira, "Access denied").await;
}

#[tokio::test]
async fn an_id_the_fake_never_stored_is_still_the_scenarios_picture() {
    // The scenario's avatars, emoji and seeded attachments are pictures by id, never uploaded:
    // they stay the stand-in image for anyone signed in, as they always were.
    let server = start("showcase").await;
    let base = server.base_url();
    let client = http();
    let (status, _) = fetch(&client, &base, "/api/file/attach-screenshot-1", TOKEN).await;
    assert_eq!(status, 200);
}
