//! W5-A: community administration over real HTTP and sockets. Each answer decodes as its wire
//! type (the contract's shape), and each test names the backend behaviour it keeps.

mod common;

use common::*;
use semaphore_fake_server::{FakeServer, entity_uuid};
use semaphore_wire::events::ServerEvent;
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

/// Each event decodes as the contract's payload.
fn decoded(events: &[(String, Value)]) {
    for (name, payload) in events {
        if name == "marker" {
            continue;
        }
        assert!(
            !matches!(
                ServerEvent::decode(name, payload.clone()),
                ServerEvent::Unknown { .. } | ServerEvent::Malformed { .. }
            ),
            "{name}: {payload}"
        );
    }
}

async fn patch(client: &reqwest::Client, base: &str, path: &str, body: Value) -> (u16, Value) {
    request(client, reqwest::Method::PATCH, base, path, Some(body), true).await
}

async fn del(client: &reqwest::Client, base: &str, path: &str) -> (u16, Value) {
    request(client, reqwest::Method::DELETE, base, path, None, true).await
}

async fn upload(client: &reqwest::Client, base: &str, kind: &str, community: &str) -> String {
    let record = upload_record(client, base, kind, Some(community)).await;
    record["id"].as_str().unwrap().to_owned()
}

/// An upload as the fake's file record, optionally naming a `resourceId`.
async fn upload_record(
    client: &reqwest::Client,
    base: &str,
    kind: &str,
    resource_id: Option<&str>,
) -> Value {
    let boundary = "w5aboundary";
    let mut body = Vec::new();
    let mut fields = vec![("resourceType", kind)];
    if let Some(resource_id) = resource_id {
        fields.push(("resourceId", resource_id));
    }
    for (name, value) in fields {
        body.extend_from_slice(
            format!(
                "--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n"
            )
            .as_bytes(),
        );
    }
    body.extend_from_slice(
        format!("--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"f.png\"\r\nContent-Type: image/png\r\n\r\n")
            .as_bytes(),
    );
    body.extend_from_slice(b"bytes");
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    let response = client
        .post(format!("{base}/api/file-upload"))
        .header("Authorization", TOKEN)
        .header(
            "Content-Type",
            format!("multipart/form-data; boundary={boundary}"),
        )
        .body(body)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status().as_u16(), 201);
    response.json().await.unwrap()
}

fn channel_names(channels: &Value) -> Vec<String> {
    channels
        .as_array()
        .unwrap()
        .iter()
        .map(|channel| channel["name"].as_str().unwrap().to_owned())
        .collect()
}

// ----- the community --------------------------------------------------------------------------

#[tokio::test]
async fn a_community_reads_updates_tells_its_members_and_refuses_others_images() {
    let (server, client, base) = showcase().await;
    let couch = id("c-couch");
    let mut samira = connect_as(&base, &id("u-samira")).await;
    let mut mateo = connect_as(&base, &id("u-mateo")).await;
    let (status, body) = get(&client, &base, &format!("/api/community/{couch}")).await;
    assert_eq!(status, 200);
    let community: wire::CommunityResponseDto = decode(&body);
    assert_eq!(community.name, "Couch Co-op");

    let avatar = upload(&client, &base, "COMMUNITY_AVATAR", &couch).await;
    let (status, body) = patch(
        &client,
        &base,
        &format!("/api/community/{couch}"),
        json!({ "name": "Sofa Club", "description": "", "avatar": avatar }),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    let updated: wire::CommunityResponseDto = decode(&body);
    assert_eq!(
        (
            updated.name.as_str(),
            updated.description.as_deref(),
            updated.avatar.as_deref()
        ),
        ("Sofa Club", Some(""), Some(avatar.as_str()))
    );
    let heard = settle(&server, &mut [&mut samira, &mut mateo]).await;
    assert_eq!(names(&heard[0]), ["communityUpdated"]);
    assert!(heard[1].is_empty(), "not a member: {:?}", heard[1]);
    decoded(&heard[0]);
    assert_eq!(heard[0][0].1["name"], "Sofa Club");
    let (_, mine) = get(&client, &base, "/api/community/mine").await;
    assert!(
        mine.as_array()
            .unwrap()
            .iter()
            .any(|c| c["name"] == "Sofa Club")
    );

    // An image of another kind isn't one this user uploaded as a community avatar.
    let other = upload(&client, &base, "USER_AVATAR", &couch).await;
    let (status, body) = patch(
        &client,
        &base,
        &format!("/api/community/{couch}"),
        json!({ "avatar": other }),
    )
    .await;
    assert_eq!(status, 403, "{body}");
    assert_eq!(body["message"], "You can only use images you uploaded");
    let (status, _) = patch(
        &client,
        &base,
        &format!("/api/community/{couch}"),
        json!({ "name": "" }),
    )
    .await;
    assert_eq!(status, 400, "MinLength(1)");
    let (status, _) = get(&client, &base, "/api/community/not-a-uuid").await;
    assert_eq!(status, 400);
    let missing = uuid::Uuid::from_u128(9).to_string();
    let (status, _) = get(&client, &base, &format!("/api/community/{missing}")).await;
    assert_eq!(status, 404);
}

#[tokio::test]
async fn deleting_a_community_tells_its_members_first_then_it_is_gone() {
    let (server, client, base) = showcase().await;
    let couch = id("c-couch");
    let mut samira = connect_as(&base, &id("u-samira")).await;
    let (status, _) = del(&client, &base, &format!("/api/community/{couch}")).await;
    assert_eq!(status, 204);
    let heard = settle(&server, &mut [&mut samira]).await;
    assert_eq!(names(&heard[0]), ["communityDeleted"]);
    decoded(&heard[0]);
    assert_eq!(heard[0][0].1, json!({ "communityId": couch }));
    let (status, _) = get(&client, &base, &format!("/api/community/{couch}")).await;
    assert_eq!(status, 404);
    let (_, mine) = get(&client, &base, "/api/community/mine").await;
    assert!(
        !mine
            .as_array()
            .unwrap()
            .iter()
            .any(|c| c["id"] == couch.as_str())
    );
    let (status, _) = del(&client, &base, &format!("/api/community/{couch}")).await;
    assert_eq!(status, 404);
}

#[tokio::test]
async fn community_assets_only_use_files_uploaded_for_that_community() {
    // `FileUploadService.mapResourceIdToTypedColumn`: a community upload records the community;
    // `CustomEmojiService.createEmoji` and `SoundboardService.createSound` then refuse a file that
    // isn't theirs, with the backend's messages.
    let (_server, client, base) = showcase().await;
    let couch = id("c-couch");
    let lumen = id("c-lumen");

    let emoji_record = upload_record(&client, &base, "CUSTOM_EMOJI", Some(&couch)).await;
    let emoji_id = emoji_record["id"].as_str().unwrap().to_owned();
    assert_eq!(emoji_record["resourceType"], "CUSTOM_EMOJI");
    assert_eq!(emoji_record["fileCommunityId"], couch.as_str());
    assert!(emoji_record["fileMessageId"].is_null());
    assert!(emoji_record["fileUserId"].is_null());
    // A message attachment lands in its own column.
    let attachment = upload_record(&client, &base, "MESSAGE_ATTACHMENT", Some(&couch)).await;
    assert_eq!(attachment["fileMessageId"], couch.as_str());
    assert!(attachment["fileCommunityId"].is_null());
    // Without a resourceId none of the typed columns is set.
    let loose = upload_record(&client, &base, "COMMUNITY_AVATAR", None).await;
    assert!(loose["fileCommunityId"].is_null());

    // An emoji file uploaded for another community.
    let elsewhere = upload(&client, &base, "CUSTOM_EMOJI", &lumen).await;
    let (status, body) = post(
        &client,
        &base,
        &format!("/api/custom-emoji/community/{couch}"),
        json!({ "name": "borrowed", "fileId": elsewhere }),
    )
    .await;
    assert_eq!(
        (status, body["message"].as_str()),
        (400, Some("Emoji image does not belong to this community"))
    );

    // A sound file uploaded for another community.
    let sound_elsewhere = upload(&client, &base, "SOUNDBOARD_SOUND", &lumen).await;
    let (status, body) = post(
        &client,
        &base,
        &format!("/api/soundboard/community/{couch}"),
        json!({ "name": "Borrowed", "fileId": sound_elsewhere }),
    )
    .await;
    assert_eq!(
        (status, body["message"].as_str()),
        (
            400,
            Some("File is not a soundboard sound for this community")
        )
    );

    // A file of the wrong kind.
    let (status, body) = post(
        &client,
        &base,
        &format!("/api/soundboard/community/{couch}"),
        json!({ "name": "Wrong", "fileId": emoji_id }),
    )
    .await;
    assert_eq!(
        (status, body["message"].as_str()),
        (
            400,
            Some("File is not a soundboard sound for this community")
        )
    );

    // Its own community's file is accepted.
    let (status, body) = post(
        &client,
        &base,
        &format!("/api/custom-emoji/community/{couch}"),
        json!({ "name": "ours", "fileId": emoji_id }),
    )
    .await;
    assert_eq!(status, 201, "{body}");
    let sound = upload(&client, &base, "SOUNDBOARD_SOUND", &couch).await;
    let (status, body) = post(
        &client,
        &base,
        &format!("/api/soundboard/community/{couch}"),
        json!({ "name": "Ours", "fileId": sound }),
    )
    .await;
    assert_eq!(status, 201, "{body}");
}

// ----- channels -------------------------------------------------------------------------------

#[tokio::test]
async fn channels_are_made_renamed_moved_and_deleted_as_the_backend_does() {
    let (server, client, base) = showcase().await;
    let couch = id("c-couch");
    let mut samira = connect_as(&base, &id("u-samira")).await;
    let (status, body) = post(
        &client,
        &base,
        "/api/channels",
        json!({ "name": "news", "communityId": couch, "type": "TEXT", "isPrivate": false }),
    )
    .await;
    assert_eq!(status, 201, "{body}");
    let made: wire::ChannelDto = decode(&body);
    assert_eq!(made.position, 4, "after the last text channel");
    let (status, body) = post(
        &client,
        &base,
        "/api/channels",
        json!({ "name": "news", "communityId": couch, "type": "TEXT", "isPrivate": false }),
    )
    .await;
    assert_eq!(status, 409);
    assert_eq!(
        body["message"],
        "Channel with this name already exists in the community"
    );

    let (status, body) = patch(
        &client,
        &base,
        &format!("/api/channels/{}", made.id),
        json!({ "name": "headlines", "slowmodeSeconds": 5 }),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(decode::<wire::ChannelDto>(&body).slowmode_seconds, 5);

    let (status, body) = post(
        &client,
        &base,
        &format!("/api/channels/{}/move-up", made.id),
        json!({ "communityId": couch }),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    let order: Vec<wire::ChannelDto> = decode(&body);
    assert_eq!(
        channel_names(&body)[..5],
        ["general", "clips", "lfg", "headlines", "memes"]
    );
    assert!(order.iter().all(|channel| channel.community_id == couch));
    // At the top already: nothing moves and nobody hears.
    let general = id("cc-general");
    let (status, body) = post(
        &client,
        &base,
        &format!("/api/channels/{general}/move-up"),
        json!({ "communityId": couch }),
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(channel_names(&body)[0], "general");
    // The channel must be in the community the body names.
    let other = id("c-lumen");
    let (status, _) = post(
        &client,
        &base,
        &format!("/api/channels/{general}/move-down"),
        json!({ "communityId": other }),
    )
    .await;
    assert_eq!(status, 404);

    let (status, _) = del(&client, &base, &format!("/api/channels/{}", made.id)).await;
    assert_eq!(status, 204);
    let heard = settle(&server, &mut [&mut samira]).await;
    assert_eq!(
        names(&heard[0]),
        [
            "channelCreated",
            "channelUpdated",
            "channelsReordered",
            "channelDeleted"
        ]
    );
    decoded(&heard[0]);
    assert_eq!(
        heard[0][3].1,
        json!({ "communityId": couch, "channelId": made.id })
    );
    let (_, list) = get(&client, &base, &format!("/api/channels/community/{couch}")).await;
    assert!(!channel_names(&list).contains(&"headlines".to_owned()));
}

#[tokio::test]
async fn a_private_channel_is_told_only_to_its_members_and_needs_them_added() {
    let (server, client, base) = showcase().await;
    let couch = id("c-couch");
    let mut me = connect_as(&base, &id("me")).await;
    let mut samira = connect_as(&base, &id("u-samira")).await;
    let (status, body) = post(
        &client,
        &base,
        "/api/channels",
        json!({ "name": "staff", "communityId": couch, "type": "TEXT", "isPrivate": true }),
    )
    .await;
    assert_eq!(status, 201);
    let staff = body["id"].as_str().unwrap().to_owned();
    let heard = settle(&server, &mut [&mut me, &mut samira]).await;
    assert_eq!(names(&heard[0]), ["channelCreated"]);
    assert!(
        heard[1].is_empty(),
        "a hidden channel: only its creator hears"
    );

    let (_, members) = get(
        &client,
        &base,
        &format!("/api/channel-membership/channel/{staff}"),
    )
    .await;
    let members: Vec<wire::ChannelMembershipResponseDto> = decode(&members);
    assert_eq!(members.len(), 1, "the creator");

    let add = |user: String| json!({ "channelId": staff, "userId": user });
    let (status, body) = post(
        &client,
        &base,
        "/api/channel-membership",
        add(id("u-samira")),
    )
    .await;
    assert_eq!(status, 201, "{body}");
    let row: wire::ChannelMembershipResponseDto = decode(&body);
    assert!(row.user.is_none(), "the create answer names no user");
    assert_eq!(row.added_by.as_deref(), Some(id("me").as_str()));
    let (status, _) = post(
        &client,
        &base,
        "/api/channel-membership",
        add(id("u-samira")),
    )
    .await;
    assert_eq!(status, 409);
    let (status, body) = post(
        &client,
        &base,
        "/api/channel-membership",
        add(id("u-mateo")),
    )
    .await;
    assert_eq!(status, 403);
    assert_eq!(
        body["message"],
        "User must be a member of the community before being added to a private channel"
    );
    let (status, _) = post(
        &client,
        &base,
        "/api/channel-membership",
        json!({ "channelId": id("cc-general"), "userId": id("u-samira") }),
    )
    .await;
    assert_eq!(status, 403, "a public channel has no member list");
    let (_, members) = get(
        &client,
        &base,
        &format!("/api/channel-membership/channel/{staff}"),
    )
    .await;
    assert_eq!(members.as_array().unwrap().len(), 2);
    assert!(
        members[1]["user"]["username"].is_string(),
        "the list names users"
    );

    // samira sees it now; mateo doesn't (and isn't asked).
    let (status, _) = del(
        &client,
        &base,
        &format!(
            "/api/channel-membership/channel/{staff}/user/{}",
            id("u-samira")
        ),
    )
    .await;
    assert_eq!(status, 204);
    let (status, _) = del(
        &client,
        &base,
        &format!(
            "/api/channel-membership/channel/{staff}/user/{}",
            id("u-samira")
        ),
    )
    .await;
    assert_eq!(status, 404);
    // The channel list hides it from someone not on it.
    let heard = settle(&server, &mut [&mut samira]).await;
    assert!(
        heard[0].is_empty(),
        "membership changes send no event: {:?}",
        heard[0]
    );
}

#[tokio::test]
async fn changing_privacy_tells_the_community_to_read_permissions_again() {
    let (server, client, base) = showcase().await;
    let couch = id("c-couch");
    let memes = id("cc-memes");
    let mut samira = connect_as(&base, &id("u-samira")).await;
    let (status, _) = patch(
        &client,
        &base,
        &format!("/api/channels/{memes}"),
        json!({ "isPrivate": true }),
    )
    .await;
    assert_eq!(status, 200);
    let heard = settle(&server, &mut [&mut samira]).await;
    // Private with no member list yet: only its viewers (the instance owner) are still in its
    // room, so the community only learns to read permissions again.
    assert_eq!(names(&heard[0]), ["channelPermissionsUpdated"]);
    assert_eq!(
        heard[0][0].1,
        json!({ "communityId": couch, "channelId": memes })
    );
}

// ----- members --------------------------------------------------------------------------------

#[tokio::test]
async fn adding_a_member_lists_them_tells_them_and_takes_them_out_of_the_search() {
    let (server, client, base) = showcase().await;
    let couch = id("c-couch");
    let mateo = id("u-mateo");
    let mut theirs = connect_as(&base, &mateo).await;
    let (_, found) = get(
        &client,
        &base,
        &format!("/api/users/search?q=mateo&communityId={couch}"),
    )
    .await;
    assert_eq!(found.as_array().unwrap().len(), 1);
    let (status, body) = post(
        &client,
        &base,
        "/api/membership",
        json!({ "communityId": couch, "userId": mateo }),
    )
    .await;
    assert_eq!(status, 201, "{body}");
    let _: wire::MembershipResponseDto = decode(&body);
    let (status, body) = post(
        &client,
        &base,
        "/api/membership",
        json!({ "communityId": couch, "userId": mateo }),
    )
    .await;
    assert_eq!(status, 409);
    assert_eq!(
        body["message"],
        "User is already a member of this community"
    );
    let heard = settle(&server, &mut [&mut theirs]).await;
    assert_eq!(names(&heard[0]), ["memberAddedToCommunity"]);
    decoded(&heard[0]);
    let (_, page) = get(
        &client,
        &base,
        &format!("/api/membership/community/{couch}?limit=500"),
    )
    .await;
    assert!(
        page["members"]
            .as_array()
            .unwrap()
            .iter()
            .any(|m| m["userId"] == mateo.as_str())
    );
    let (_, found) = get(
        &client,
        &base,
        &format!("/api/users/search?q=mateo&communityId={couch}"),
    )
    .await;
    assert!(found.as_array().unwrap().is_empty());
}

// ----- mention groups -------------------------------------------------------------------------

#[tokio::test]
async fn mention_groups_take_all_eight_operations() {
    let (_server, client, base) = showcase().await;
    let couch = id("c-couch");
    let (samira, marcus) = (id("u-samira"), id("u-marcus"));
    let groups = format!("/api/alias-groups/community/{couch}");
    let (status, body) = post(
        &client,
        &base,
        &groups,
        json!({ "name": "raid-team", "memberIds": [samira] }),
    )
    .await;
    assert_eq!(status, 201, "{body}");
    let group: wire::AliasGroupWithMembersDto = decode(&body);
    assert_eq!(group.member_count, 1);
    let path = format!("/api/alias-groups/{}", group.id);
    let (status, _) = post(&client, &base, &groups, json!({ "name": "raid-team" })).await;
    assert_eq!(status, 409);
    let (status, body) = post(
        &client,
        &base,
        &groups,
        json!({ "name": "x", "memberIds": [id("u-mateo")] }),
    )
    .await;
    assert_eq!(status, 400);
    assert!(
        body["message"]
            .as_str()
            .unwrap()
            .starts_with("Users not members of this community")
    );
    let (status, _) = post(&client, &base, &groups, json!({ "name": "has space" })).await;
    assert_eq!(status, 400);

    let (status, body) = put(&client, &base, &path, json!({ "name": "raiders" })).await;
    assert_eq!(status, 200);
    assert_eq!(
        decode::<wire::AliasGroupWithMembersDto>(&body).name,
        "raiders"
    );
    let (status, _) = post(
        &client,
        &base,
        &format!("{path}/members"),
        json!({ "userId": marcus }),
    )
    .await;
    assert_eq!(status, 204);
    let (status, _) = post(
        &client,
        &base,
        &format!("{path}/members"),
        json!({ "userId": marcus }),
    )
    .await;
    assert_eq!(status, 409);
    let (status, _) = del(&client, &base, &format!("{path}/members/{samira}")).await;
    assert_eq!(status, 204);
    let (status, _) = del(&client, &base, &format!("{path}/members/{samira}")).await;
    assert_eq!(status, 404);
    let (status, _) = put(
        &client,
        &base,
        &format!("{path}/members"),
        json!({ "memberIds": [samira, marcus] }),
    )
    .await;
    assert_eq!(status, 204);
    let (_, body) = get(&client, &base, &path).await;
    let group: wire::AliasGroupWithMembersDto = decode(&body);
    assert_eq!(group.members.len(), 2);
    let (_, list) = get(&client, &base, &groups).await;
    let list: Vec<wire::AliasGroupSummaryDto> = decode(&list);
    assert_eq!((list.len(), list[0].member_count), (1, 2));
    let (status, _) = del(&client, &base, &path).await;
    assert_eq!(status, 204);
    let (status, _) = get(&client, &base, &path).await;
    assert_eq!(status, 404);
}

// ----- emoji and sounds -----------------------------------------------------------------------

#[tokio::test]
async fn emoji_and_sounds_need_an_upload_of_their_kind_and_list_until_deleted() {
    let (_server, client, base) = showcase().await;
    let couch = id("c-couch");
    let image = upload(&client, &base, "CUSTOM_EMOJI", &couch).await;
    let emoji_path = format!("/api/custom-emoji/community/{couch}");
    let (status, body) = post(
        &client,
        &base,
        &emoji_path,
        json!({ "name": "aaa_party", "fileId": image }),
    )
    .await;
    assert_eq!(status, 201, "{body}");
    let emoji: wire::CustomEmojiDto = decode(&body);
    let (status, _) = post(
        &client,
        &base,
        &emoji_path,
        json!({ "name": "aaa_party", "fileId": image }),
    )
    .await;
    assert_eq!(status, 409);
    let (status, _) = post(
        &client,
        &base,
        &emoji_path,
        json!({ "name": "Bad", "fileId": image }),
    )
    .await;
    assert_eq!(status, 400);
    let wrong = upload(&client, &base, "SOUNDBOARD_SOUND", &couch).await;
    let (status, body) = post(
        &client,
        &base,
        &emoji_path,
        json!({ "name": "bbb", "fileId": wrong }),
    )
    .await;
    assert_eq!(
        (status, body["message"].as_str()),
        (400, Some("File is not a custom emoji image"))
    );
    let (_, list) = get(&client, &base, &emoji_path).await;
    assert_eq!(list[0]["name"], "aaa_party", "listed by name");
    let (status, _) = del(&client, &base, &format!("{emoji_path}/{}", emoji.id)).await;
    assert_eq!(status, 204);
    let (status, _) = del(&client, &base, &format!("{emoji_path}/{}", emoji.id)).await;
    assert_eq!(status, 404);

    let sound_path = format!("/api/soundboard/community/{couch}");
    let (status, body) = post(
        &client,
        &base,
        &sound_path,
        json!({ "name": "Bell", "emoji": "🔔", "fileId": wrong }),
    )
    .await;
    assert_eq!(status, 201, "{body}");
    let sound: wire::SoundboardSoundDto = decode(&body);
    let (status, body) = post(
        &client,
        &base,
        &sound_path,
        json!({ "name": "Gong", "fileId": wrong }),
    )
    .await;
    assert_eq!(status, 409);
    assert_eq!(
        body["message"],
        "This audio file is already used by another soundboard sound"
    );
    let (status, _) = post(
        &client,
        &base,
        &sound_path,
        json!({ "name": "Airhorn", "fileId": wrong }),
    )
    .await;
    assert_eq!(status, 409, "a fixture sound's name");
    let (_, list) = get(&client, &base, &sound_path).await;
    let list: Vec<wire::SoundboardSoundDto> = decode(&list);
    assert_eq!(
        list.iter().map(|s| s.name.as_str()).collect::<Vec<_>>(),
        ["Airhorn", "Bell", "Rimshot", "Silence"]
    );
    let (status, _) = del(&client, &base, &format!("{sound_path}/{}", sound.id)).await;
    assert_eq!(status, 204);
    let airhorn = list[0].id.clone();
    let (status, _) = del(&client, &base, &format!("{sound_path}/{airhorn}")).await;
    assert_eq!(status, 204, "a fixture sound can go too");
    let (_, list) = get(&client, &base, &sound_path).await;
    assert_eq!(list.as_array().unwrap().len(), 2);
}

// ----- webhooks and invites -------------------------------------------------------------------

#[tokio::test]
async fn a_webhook_answers_its_url_once_and_only_text_channels_have_them() {
    let (_server, client, base) = showcase().await;
    let general = id("cc-general");
    let path = format!("/api/channels/{general}/webhooks");
    let (status, body) = post(&client, &base, &path, json!({ "name": "CI" })).await;
    assert_eq!(status, 201, "{body}");
    let made: wire::CreateWebhookResponseDto = decode(&body);
    assert!(made.url.starts_with(&format!("/api/webhooks/{}/", made.id)));
    let (_, list) = get(&client, &base, &path).await;
    let list: Vec<wire::WebhookDto> = decode(&list);
    assert_eq!(list.len(), 1);
    assert!(!serde_json::to_string(&list).unwrap().contains("url"));
    let voice = id("vc-squad");
    let (status, body) = post(
        &client,
        &base,
        &format!("/api/channels/{voice}/webhooks"),
        json!({ "name": "CI" }),
    )
    .await;
    assert_eq!(
        (status, body["message"].as_str()),
        (400, Some("Webhooks can only be created for text channels"))
    );
    let (status, _) = del(&client, &base, &format!("{path}/{}", made.id)).await;
    assert_eq!(status, 204);
    let (status, _) = del(&client, &base, &format!("{path}/{}", made.id)).await;
    assert_eq!(status, 404);
}

#[tokio::test]
async fn invites_are_mine_name_their_community_register_and_delete() {
    let (_server, client, base) = showcase().await;
    let couch = id("c-couch");
    let (status, body) = post(
        &client,
        &base,
        "/api/invite",
        json!({ "communityIds": [couch], "maxUses": 3 }),
    )
    .await;
    assert_eq!(status, 201, "{body}");
    let invite: wire::InviteResponseDto = decode(&body);
    assert_eq!(invite.default_communities[0].community_id, couch);
    assert_eq!((invite.uses, invite.max_uses), (0, Some(3)));
    let (_, list) = get(&client, &base, "/api/invite").await;
    let list: Vec<wire::InviteResponseDto> = decode(&list);
    assert_eq!(list.len(), 1);
    assert!(list[0].created_by.is_some(), "the list names its creator");
    let (status, public) = request(
        &client,
        reqwest::Method::GET,
        &base,
        &format!("/api/invite/public/{}", invite.code),
        None,
        false,
    )
    .await;
    assert_eq!(status, 200, "the code works for joining: {public}");
    let (status, _) = del(&client, &base, &format!("/api/invite/{}", invite.code)).await;
    assert_eq!(status, 204);
    let (status, _) = del(&client, &base, &format!("/api/invite/{}", invite.code)).await;
    assert_eq!(status, 404);
}

#[tokio::test]
async fn every_w5a_operation_can_be_failed_by_its_operation_id() {
    let (server, client, base) = showcase().await;
    let some = uuid::Uuid::from_u128(1).to_string();
    use reqwest::Method as M;
    let cases: Vec<(&str, M, String)> = vec![
        (
            "CommunityController_findOne",
            M::GET,
            format!("/api/community/{some}"),
        ),
        (
            "CommunityController_update",
            M::PATCH,
            format!("/api/community/{some}"),
        ),
        (
            "CommunityController_remove",
            M::DELETE,
            format!("/api/community/{some}"),
        ),
        ("ChannelsController_create", M::POST, "/api/channels".into()),
        (
            "ChannelsController_update",
            M::PATCH,
            format!("/api/channels/{some}"),
        ),
        (
            "ChannelsController_remove",
            M::DELETE,
            format!("/api/channels/{some}"),
        ),
        (
            "ChannelsController_moveUp",
            M::POST,
            format!("/api/channels/{some}/move-up"),
        ),
        (
            "ChannelsController_moveDown",
            M::POST,
            format!("/api/channels/{some}/move-down"),
        ),
        (
            "ChannelMembershipController_create",
            M::POST,
            "/api/channel-membership".into(),
        ),
        (
            "ChannelMembershipController_findAllForChannel",
            M::GET,
            format!("/api/channel-membership/channel/{some}"),
        ),
        (
            "ChannelMembershipController_remove",
            M::DELETE,
            format!("/api/channel-membership/channel/{some}/user/{some}"),
        ),
        (
            "MembershipController_create",
            M::POST,
            "/api/membership".into(),
        ),
        (
            "AliasGroupsController_getCommunityAliasGroups",
            M::GET,
            format!("/api/alias-groups/community/{some}"),
        ),
        (
            "AliasGroupsController_createAliasGroup",
            M::POST,
            format!("/api/alias-groups/community/{some}"),
        ),
        (
            "AliasGroupsController_getAliasGroup",
            M::GET,
            format!("/api/alias-groups/{some}"),
        ),
        (
            "AliasGroupsController_updateAliasGroup",
            M::PUT,
            format!("/api/alias-groups/{some}"),
        ),
        (
            "AliasGroupsController_deleteAliasGroup",
            M::DELETE,
            format!("/api/alias-groups/{some}"),
        ),
        (
            "AliasGroupsController_addMember",
            M::POST,
            format!("/api/alias-groups/{some}/members"),
        ),
        (
            "AliasGroupsController_updateMembers",
            M::PUT,
            format!("/api/alias-groups/{some}/members"),
        ),
        (
            "AliasGroupsController_removeMember",
            M::DELETE,
            format!("/api/alias-groups/{some}/members/{some}"),
        ),
        (
            "CustomEmojiController_createEmoji",
            M::POST,
            format!("/api/custom-emoji/community/{some}"),
        ),
        (
            "CustomEmojiController_deleteEmoji",
            M::DELETE,
            format!("/api/custom-emoji/community/{some}/{some}"),
        ),
        (
            "SoundboardController_createSound",
            M::POST,
            format!("/api/soundboard/community/{some}"),
        ),
        (
            "SoundboardController_deleteSound",
            M::DELETE,
            format!("/api/soundboard/community/{some}/{some}"),
        ),
        (
            "WebhooksController_create",
            M::POST,
            format!("/api/channels/{some}/webhooks"),
        ),
        (
            "WebhooksController_findAllForChannel",
            M::GET,
            format!("/api/channels/{some}/webhooks"),
        ),
        (
            "WebhooksController_remove",
            M::DELETE,
            format!("/api/channels/{some}/webhooks/{some}"),
        ),
        ("InviteController_getInvites", M::GET, "/api/invite".into()),
        (
            "InviteController_createInvite",
            M::POST,
            "/api/invite".into(),
        ),
        (
            "InviteController_deleteInvite",
            M::DELETE,
            "/api/invite/abc".into(),
        ),
    ];
    for (operation, method, path) in cases {
        server.fail_route(operation, 503, "UNAVAILABLE");
        let (status, body) =
            request(&client, method.clone(), &base, &path, Some(json!({})), true).await;
        assert_eq!(status, 503, "{operation} {method} {path}: {body}");
    }
}

// ----- permissions ----------------------------------------------------------------------------

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

async fn send_as(
    client: &reqwest::Client,
    method: reqwest::Method,
    base: &str,
    path: &str,
    bearer: &str,
    body: Value,
) -> (u16, Value) {
    let response = client
        .request(method, format!("{base}{path}"))
        .header("Authorization", bearer)
        .json(&body)
        .send()
        .await
        .unwrap();
    let status = response.status().as_u16();
    let text = response.text().await.unwrap();
    (
        status,
        serde_json::from_str(&text).unwrap_or(Value::String(text)),
    )
}

#[tokio::test]
async fn every_change_is_refused_by_the_guard_without_its_action() {
    let (server, client, base) = showcase().await;
    let couch = id("c-couch");
    let (general, voice) = (id("cc-general"), id("vc-squad"));
    // As the owner: a group and a webhook to aim at.
    let (_, group) = post(
        &client,
        &base,
        &format!("/api/alias-groups/community/{couch}"),
        json!({ "name": "raiders" }),
    )
    .await;
    let group = group["id"].as_str().unwrap().to_owned();
    // samira holds only the Member role (no instance role but the default's CREATE_COMMUNITY).
    server.act_as(&couch, Some(&id("u-samira")), &["role-member-c-couch"]);
    let samira = bearer_for(&client, &base, "samira-login", &id("u-samira")).await;
    let some = uuid::Uuid::from_u128(7).to_string();
    let marcus = id("u-marcus");
    use reqwest::Method as M;
    let cases: Vec<(M, String, Value)> = vec![
        (
            M::PATCH,
            format!("/api/community/{couch}"),
            json!({ "name": "Mine" }),
        ),
        (M::DELETE, format!("/api/community/{couch}"), json!({})),
        (
            M::POST,
            "/api/channels".into(),
            json!({ "name": "x", "communityId": couch, "type": "TEXT", "isPrivate": false }),
        ),
        (
            M::PATCH,
            format!("/api/channels/{general}"),
            json!({ "name": "x" }),
        ),
        (M::DELETE, format!("/api/channels/{general}"), json!({})),
        (
            M::POST,
            format!("/api/channels/{general}/move-down"),
            json!({ "communityId": couch }),
        ),
        (
            M::POST,
            format!("/api/channels/{general}/move-up"),
            json!({ "communityId": couch }),
        ),
        (
            M::POST,
            "/api/channel-membership".into(),
            json!({ "channelId": general, "userId": marcus }),
        ),
        (
            M::DELETE,
            format!("/api/channel-membership/channel/{general}/user/{marcus}"),
            json!({}),
        ),
        (
            M::POST,
            "/api/membership".into(),
            json!({ "communityId": couch, "userId": id("u-mateo") }),
        ),
        (
            M::POST,
            format!("/api/alias-groups/community/{couch}"),
            json!({ "name": "mine" }),
        ),
        (
            M::PUT,
            format!("/api/alias-groups/{group}"),
            json!({ "name": "mine" }),
        ),
        (M::DELETE, format!("/api/alias-groups/{group}"), json!({})),
        (
            M::POST,
            format!("/api/alias-groups/{group}/members"),
            json!({ "userId": marcus }),
        ),
        (
            M::PUT,
            format!("/api/alias-groups/{group}/members"),
            json!({ "memberIds": [marcus] }),
        ),
        (
            M::DELETE,
            format!("/api/alias-groups/{group}/members/{marcus}"),
            json!({}),
        ),
        (
            M::POST,
            format!("/api/custom-emoji/community/{couch}"),
            json!({ "name": "abc", "fileId": some }),
        ),
        (
            M::DELETE,
            format!("/api/custom-emoji/community/{couch}/{some}"),
            json!({}),
        ),
        (
            M::POST,
            format!("/api/soundboard/community/{couch}"),
            json!({ "name": "x", "fileId": some }),
        ),
        (
            M::DELETE,
            format!("/api/soundboard/community/{couch}/{some}"),
            json!({}),
        ),
        (
            M::POST,
            format!("/api/channels/{general}/webhooks"),
            json!({ "name": "CI" }),
        ),
        (
            M::GET,
            format!("/api/channels/{general}/webhooks"),
            json!({}),
        ),
        (
            M::DELETE,
            format!("/api/channels/{voice}/webhooks/{some}"),
            json!({}),
        ),
        (M::GET, "/api/invite".into(), json!({})),
        (
            M::POST,
            "/api/invite".into(),
            json!({ "communityIds": [couch] }),
        ),
        (M::DELETE, "/api/invite/abc".into(), json!({})),
    ];
    for (method, path, body) in cases {
        let (status, answer) = send_as(&client, method.clone(), &base, &path, &samira, body).await;
        assert_eq!(status, 403, "{method} {path}: {answer}");
        assert_eq!(answer["message"], "Forbidden resource", "{method} {path}");
    }
    // What the Member role holds still answers.
    for path in [
        format!("/api/community/{couch}"),
        format!("/api/alias-groups/community/{couch}"),
        format!("/api/alias-groups/{group}"),
    ] {
        let (status, answer) = send_as(&client, M::GET, &base, &path, &samira, json!({})).await;
        assert_eq!(status, 200, "{path}: {answer}");
    }
    // Nothing changed.
    let (_, community) = get(&client, &base, &format!("/api/community/{couch}")).await;
    assert_eq!(community["name"], "Couch Co-op");
}

#[tokio::test]
async fn invites_need_the_community_action_too_and_only_the_creator_deletes() {
    let (server, client, base) = showcase().await;
    let couch = id("c-couch");
    // The owner may invite anywhere; a code they made isn't someone else's to delete, even with
    // the community's roles (the backend's creator check, whatever "admins bypass" says).
    let (status, invite) = post(
        &client,
        &base,
        "/api/invite",
        json!({ "communityIds": [couch] }),
    )
    .await;
    assert_eq!(status, 201);
    server.act_as(
        &couch,
        Some(&id("u-samira")),
        &["role-community-admin-c-couch"],
    );
    let samira = bearer_for(&client, &base, "samira-login", &id("u-samira")).await;
    let code = invite["code"].as_str().unwrap();
    let (status, _) = send_as(
        &client,
        reqwest::Method::DELETE,
        &base,
        &format!("/api/invite/{code}"),
        &samira,
        json!({}),
    )
    .await;
    assert_eq!(status, 403, "no instance DELETE_INSTANCE_INVITE");
}

#[tokio::test]
async fn a_kicked_member_leaves_the_list_and_a_role_change_shows_on_it() {
    let (server, client, base) = showcase().await;
    let couch = id("c-couch");
    server.act_as(
        &couch,
        Some(&id("u-samira")),
        &["role-moderator-c-couch", "role-member-c-couch"],
    );
    let (_, page) = get(
        &client,
        &base,
        &format!("/api/membership/community/{couch}?limit=500"),
    )
    .await;
    let samira = page["members"]
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["userId"] == id("u-samira").as_str())
        .unwrap()
        .clone();
    let names: Vec<&str> = samira["roles"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["name"].as_str().unwrap())
        .collect();
    assert!(names.contains(&"Moderator"), "{names:?}");
    // The owner meets the rank rule too (#679): it kicks as the community's admin.
    server.act_as(&couch, None, &["role-community-admin-c-couch"]);
    let (status, body) = post(
        &client,
        &base,
        &format!("/api/moderation/kick/{couch}/{}", id("u-grace")),
        json!({ "reason": "test" }),
    )
    .await;
    assert!(status < 300, "{status} {body}");
    let (_, page) = get(
        &client,
        &base,
        &format!("/api/membership/community/{couch}?limit=500"),
    )
    .await;
    assert!(
        !page["members"]
            .as_array()
            .unwrap()
            .iter()
            .any(|m| m["userId"] == id("u-grace").as_str())
    );
}
