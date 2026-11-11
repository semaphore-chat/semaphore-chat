//! W4: DM calls, server mute, kick, the soundboard, the replay buffer, clips and join failures,
//! over real HTTP and sockets. Each test names the backend behaviour it keeps; `contract.rs`
//! checks the shapes against the pinned spec.

mod common;

use common::*;
use semaphore_fake_server::{FakeServer, entity_uuid};
use serde_json::{Value, json};

fn id(readable: &str) -> String {
    entity_uuid(readable)
}

async fn showcase() -> (FakeServer, reqwest::Client, String) {
    let server = start("showcase").await;
    let base = server.base_url();
    (server, http(), base)
}

fn names(events: &[(String, Value)]) -> Vec<&str> {
    events.iter().map(|(name, _)| name.as_str()).collect()
}

async fn control(client: &reqwest::Client, base: &str, name: &str, body: Value) -> (u16, Value) {
    post(client, base, &format!("/__control/{name}"), body).await
}

// ----- DM calls --------------------------------------------------------------------------------

#[tokio::test]
async fn the_first_refresh_starts_the_call_for_every_member_and_later_joins_are_joins() {
    let (server, client, base) = showcase().await;
    let dm = id("dm-launch");
    let mut me = connect_as(&base, &id("me")).await;
    let mut samira = connect_as(&base, &id("u-samira")).await;
    let mut grace = connect_as(&base, &id("u-grace")).await;

    let (status, body) = post(
        &client,
        &base,
        &format!("/api/dm-groups/{dm}/voice-presence/refresh"),
        json!({}),
    )
    .await;
    assert_eq!(status, 201, "{body}");
    assert_eq!(
        body,
        json!({ "success": true, "message": "DM presence refreshed successfully", "dmGroupId": dm })
    );
    // A second refresh only extends the TTL: no event.
    post(
        &client,
        &base,
        &format!("/api/dm-groups/{dm}/voice-presence/refresh"),
        json!({}),
    )
    .await;
    let (status, _) = control(
        &client,
        &base,
        "dm_call_join",
        json!({ "dmGroupId": dm, "userId": id("u-samira") }),
    )
    .await;
    assert_eq!(status, 200);

    let heard = settle(&server, &mut [&mut me, &mut samira, &mut grace]).await;
    // The group's room: every member, the caller included; not grace, who isn't in it.
    assert_eq!(
        names(&heard[0]),
        ["dmVoiceCallStarted", "dmVoiceUserJoined"]
    );
    assert_eq!(
        names(&heard[1]),
        ["dmVoiceCallStarted", "dmVoiceUserJoined"]
    );
    assert!(heard[2].is_empty(), "{:?}", heard[2]);
    let started = &heard[1][0].1;
    assert_eq!(started["dmGroupId"], dm.as_str());
    assert_eq!(started["startedBy"], id("me").as_str());
    assert_eq!(started["starter"]["id"], id("me").as_str());
    assert_eq!(heard[1][1].1["user"]["id"], id("u-samira").as_str());

    let (_, presence) = get(
        &client,
        &base,
        &format!("/api/dm-groups/{dm}/voice-presence"),
    )
    .await;
    assert_eq!(presence["count"], 2);
    let listed: Vec<&str> = presence["users"]
        .as_array()
        .unwrap()
        .iter()
        .map(|user| user["id"].as_str().unwrap())
        .collect();
    assert_eq!(listed, [id("me"), id("u-samira")]);
}

#[tokio::test]
async fn leaving_tells_the_group_and_the_call_can_start_again() {
    let (server, client, base) = showcase().await;
    let dm = id("dm-priya");
    let mut me = connect_as(&base, &id("me")).await;
    assert!(server.dm_call_join(&dm, &id("u-priya")));
    assert!(
        server.dm_call_join(&dm, &id("u-priya")),
        "already in: no event"
    );
    assert!(server.dm_call_leave(&dm, &id("u-priya")));
    assert!(
        !server.dm_call_leave(&dm, &id("u-priya")),
        "not in the call"
    );
    let (status, _) = control(
        &client,
        &base,
        "dm_call_leave",
        json!({ "dmGroupId": dm, "userId": id("u-priya") }),
    )
    .await;
    assert_eq!(status, 200);
    server.dm_call_join(&dm, &id("u-priya"));
    let heard = settle(&server, &mut [&mut me]).await.remove(0);
    assert_eq!(
        names(&heard),
        [
            "dmVoiceCallStarted",
            "dmVoiceUserLeft",
            "dmVoiceCallStarted"
        ]
    );
    let left = &heard[1].1;
    assert_eq!(left["userId"], id("u-priya").as_str());
    assert_eq!(left["user"]["username"], "pri");
}

#[tokio::test]
async fn dm_calls_are_for_the_groups_members() {
    let (server, client, base) = showcase().await;
    let not_mine = uuid::Uuid::from_u128(7).to_string();
    for path in [
        format!("/api/dm-groups/{not_mine}/voice-presence"),
        format!("/api/dm-groups/{not_mine}/voice-presence/refresh"),
    ] {
        let method = if path.ends_with("refresh") {
            reqwest::Method::POST
        } else {
            reqwest::Method::GET
        };
        let (status, body) = request(&client, method, &base, &path, None, true).await;
        assert_eq!(status, 403, "{path}: {body}");
        assert_eq!(body["message"], "You are not a member of this DM group");
    }
    let (status, _) = post(
        &client,
        &base,
        "/api/livekit/dm-token",
        json!({ "identity": "x", "roomId": not_mine }),
    )
    .await;
    assert_eq!(status, 403);
    assert!(!server.dm_call_join(&id("dm-priya"), &id("u-grace")));
    let (status, _) = control(
        &client,
        &base,
        "dm_call_join",
        json!({ "dmGroupId": id("dm-priya"), "userId": id("u-grace") }),
    )
    .await;
    assert_eq!(status, 400);
}

#[tokio::test]
async fn a_dm_token_is_for_the_groups_room_and_names_the_caller() {
    let (_server, client, base) = showcase().await;
    let dm = id("dm-marcus");
    let (status, token) = post(
        &client,
        &base,
        "/api/livekit/dm-token",
        json!({ "identity": "someone-else", "roomId": dm, "name": "Impostor" }),
    )
    .await;
    assert_eq!(status, 201, "{token}");
    assert_eq!(token["roomId"], dm.as_str());
    // The backend takes the identity from the session, never the body.
    assert_eq!(token["identity"], id("me").as_str());
    assert!(token["token"].is_string());
}

// ----- Server mute and kick --------------------------------------------------------------------

#[tokio::test]
async fn a_server_mute_updates_the_participant_and_outlives_the_call() {
    let (server, client, base) = showcase().await;
    let squad = id("vc-squad");
    let mut me = connect_as(&base, &id("me")).await;
    let path = format!("/api/livekit/channels/{squad}/mute-participant");
    let (status, body) = post(
        &client,
        &base,
        &path,
        json!({ "participantIdentity": id("u-marcus"), "mute": true }),
    )
    .await;
    assert_eq!(status, 201, "{body}");
    assert_eq!(body, json!({ "success": true }));
    // Somebody not in the call: remembered, no event.
    post(
        &client,
        &base,
        &path,
        json!({ "participantIdentity": id("u-grace"), "mute": true }),
    )
    .await;
    let heard = settle(&server, &mut [&mut me]).await.remove(0);
    assert_eq!(names(&heard), ["voiceChannelUserUpdated"]);
    let updated = &heard[0].1;
    assert_eq!(updated["channelId"], squad.as_str());
    assert_eq!(updated["userId"], id("u-marcus").as_str());
    assert_eq!(updated["user"]["isServerMuted"], true);
    let (_, presence) = get(
        &client,
        &base,
        &format!("/api/channels/{squad}/voice-presence"),
    )
    .await;
    let marcus = presence["users"]
        .as_array()
        .unwrap()
        .iter()
        .find(|user| user["id"] == id("u-marcus").as_str())
        .unwrap();
    assert_eq!(marcus["isServerMuted"], true);

    // A moderator mutes me (the control); I join later and am listed muted.
    let (status, _) = control(
        &client,
        &base,
        "server_mute",
        json!({ "channelId": squad, "userId": id("me"), "mute": true }),
    )
    .await;
    assert_eq!(status, 200);
    post(
        &client,
        &base,
        &format!("/api/channels/{squad}/voice-presence/join"),
        json!({}),
    )
    .await;
    let (_, presence) = get(
        &client,
        &base,
        &format!("/api/channels/{squad}/voice-presence"),
    )
    .await;
    let mine = presence["users"]
        .as_array()
        .unwrap()
        .iter()
        .find(|user| user["id"] == id("me").as_str())
        .unwrap();
    assert_eq!(mine["isServerMuted"], true);
    server.server_mute(&squad, &id("me"), false);
    let heard = settle(&server, &mut [&mut me]).await.remove(0);
    // My join is announced, listing me muted; lifting it updates me.
    assert_eq!(
        names(&heard),
        ["voiceChannelUserJoined", "voiceChannelUserUpdated"]
    );
    assert_eq!(heard[0].1["user"]["isServerMuted"], true);
    assert_eq!(heard[1].1["user"]["isServerMuted"], false);
}

#[tokio::test]
async fn server_mute_refuses_myself_an_unknown_channel_and_a_bad_body() {
    let (_server, client, base) = showcase().await;
    let squad = id("vc-squad");
    let (status, body) = post(
        &client,
        &base,
        &format!("/api/livekit/channels/{squad}/mute-participant"),
        json!({ "participantIdentity": id("me"), "mute": true }),
    )
    .await;
    assert_eq!(status, 403);
    assert_eq!(
        body["message"],
        "You can only server mute someone you outrank"
    );
    let unknown = uuid::Uuid::from_u128(3);
    let (status, body) = post(
        &client,
        &base,
        &format!("/api/livekit/channels/{unknown}/mute-participant"),
        json!({ "participantIdentity": id("u-priya"), "mute": true }),
    )
    .await;
    assert_eq!(status, 404);
    assert_eq!(body["message"], "Channel not found");
    let (status, _) = post(
        &client,
        &base,
        &format!("/api/livekit/channels/{squad}/mute-participant"),
        json!({ "participantIdentity": id("u-priya") }),
    )
    .await;
    assert_eq!(status, 400);
}

#[tokio::test]
async fn a_kick_tells_the_member_ends_their_call_and_unlists_them() {
    let (server, client, base) = showcase().await;
    let couch = id("c-couch");
    // W5: kicking needs a role that outranks theirs; `me` is only a Member there.
    server.act_as(&couch, None, &["role-community-admin-c-couch"]);
    let mut me = connect_as(&base, &id("me")).await;
    let mut kwame = connect_as(&base, &id("u-kwame")).await;
    let (status, body) = post(
        &client,
        &base,
        &format!("/api/moderation/kick/{couch}/{}", id("u-kwame")),
        json!({ "reason": "spam" }),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(
        body,
        json!({ "success": true, "message": "User kicked successfully" })
    );
    let heard = settle(&server, &mut [&mut me, &mut kwame]).await;
    assert_eq!(names(&heard[0]), ["voiceChannelUserLeft", "userKicked"]);
    assert_eq!(heard[0][0].1["channelId"], id("vc-afk").as_str());
    assert_eq!(
        heard[0][1].1,
        json!({ "communityId": couch, "userId": id("u-kwame"), "moderatorId": id("me"), "reason": "spam" })
    );
    // Theirs first, from their own room, then the voice removal.
    assert_eq!(names(&heard[1]), ["userKicked", "voiceChannelUserLeft"]);

    let (_, presence) = get(
        &client,
        &base,
        &format!("/api/channels/{}/voice-presence", id("vc-afk")),
    )
    .await;
    assert_eq!(presence["count"], 0);
    let (_, members) = get(
        &client,
        &base,
        &format!("/api/membership/community/{couch}"),
    )
    .await;
    let listed = serde_json::to_string(&members).unwrap();
    assert!(!listed.contains(&id("u-kwame")), "{listed}");

    let (status, body) = post(
        &client,
        &base,
        &format!("/api/moderation/kick/{couch}/{}", id("u-kwame")),
        json!({}),
    )
    .await;
    assert_eq!(status, 404);
    assert_eq!(body["message"], "User is not a member of this community");
    let (status, _) = post(
        &client,
        &base,
        &format!("/api/moderation/kick/{couch}/{}", id("me")),
        json!({}),
    )
    .await;
    assert_eq!(status, 403);
    let (status, _) = post(
        &client,
        &base,
        &format!("/api/moderation/kick/{couch}/not-a-uuid"),
        json!({}),
    )
    .await;
    assert_eq!(status, 400);
}

// ----- Soundboard ------------------------------------------------------------------------------

#[tokio::test]
async fn each_community_lists_its_sounds_by_name_and_their_files_download() {
    let (_server, client, base) = showcase().await;
    let couch = id("c-couch");
    let (status, sounds) = get(
        &client,
        &base,
        &format!("/api/soundboard/community/{couch}"),
    )
    .await;
    assert_eq!(status, 200, "{sounds}");
    let sounds = sounds.as_array().unwrap();
    let names: Vec<&str> = sounds
        .iter()
        .map(|sound| sound["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, ["Airhorn", "Rimshot", "Silence"]);
    let (sound_id, file_id) = FakeServer::sound_ids(&couch, "Rimshot");
    assert_eq!(sounds[1]["id"], sound_id.as_str());
    assert_eq!(sounds[1]["fileId"], file_id.as_str());
    assert_eq!(sounds[1]["communityId"], couch.as_str());

    for (sound, magic) in sounds.iter().zip([&b"ID3"[..], b"OggS", b"RIFF"]) {
        let response = client
            .get(format!(
                "{base}/api/file/{}",
                sound["fileId"].as_str().unwrap()
            ))
            .header("Authorization", TOKEN)
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 200);
        let mime = response.headers()["content-type"]
            .to_str()
            .unwrap()
            .to_owned();
        assert!(mime.starts_with("audio/"), "{mime}");
        let bytes = response.bytes().await.unwrap();
        assert!(bytes.starts_with(magic), "{} {mime}", sound["name"]);
    }
    // Another community's sounds are its own.
    let (_, lumen) = get(
        &client,
        &base,
        &format!("/api/soundboard/community/{}", id("c-lumen")),
    )
    .await;
    assert_ne!(lumen[0]["id"], sounds[0]["id"]);
    let (status, _) = get(
        &client,
        &base,
        &format!("/api/soundboard/community/{}", uuid::Uuid::from_u128(5)),
    )
    .await;
    assert_eq!(status, 403);
}

// ----- Replay ----------------------------------------------------------------------------------

/// Me in vc-squad's call with a running replay buffer of `segments` complete segments.
async fn recording(segments: usize) -> (FakeServer, reqwest::Client, String, Socket) {
    let (server, client, base) = showcase().await;
    let mut me = connect_as(&base, &id("me")).await;
    let squad = id("vc-squad");
    post(
        &client,
        &base,
        &format!("/api/channels/{squad}/voice-presence/join"),
        json!({}),
    )
    .await;
    // The join's own announcement, heard before what the tests look for.
    let joined = settle(&server, &mut [&mut me]).await.remove(0);
    assert_eq!(names(&joined), ["voiceChannelUserJoined"]);
    let (status, body) = post(
        &client,
        &base,
        "/api/livekit/replay/start",
        json!({ "channelId": squad, "videoTrackId": "TR_v" }),
    )
    .await;
    assert_eq!(status, 201, "{body}");
    assert_eq!(body["status"], "active");
    if segments > 0 {
        assert!(server.emit_segments_ready(segments));
    }
    (server, client, base, me)
}

#[tokio::test]
async fn starting_needs_the_call_and_a_restart_replaces_the_session() {
    let (_server, client, base) = showcase().await;
    let squad = id("vc-squad");
    let (status, body) = post(
        &client,
        &base,
        "/api/livekit/replay/start",
        json!({ "channelId": squad, "videoTrackId": "TR_v" }),
    )
    .await;
    assert_eq!(status, 403);
    assert_eq!(body["message"], "You can only record your own tracks");
    let (status, _) = post(
        &client,
        &base,
        "/api/livekit/replay/start",
        json!({ "channelId": "nope", "videoTrackId": "TR_v" }),
    )
    .await;
    assert_eq!(status, 400);

    post(
        &client,
        &base,
        &format!("/api/channels/{squad}/voice-presence/join"),
        json!({}),
    )
    .await;
    let start = || {
        post(
            &client,
            &base,
            "/api/livekit/replay/start",
            json!({ "channelId": squad, "videoTrackId": "TR_v" }),
        )
    };
    let (_, first) = start().await;
    let (_, second) = start().await;
    assert_ne!(first["sessionId"], second["sessionId"]);
    let (_, info) = get(&client, &base, "/api/livekit/replay/session-info").await;
    assert_eq!(
        info,
        json!({ "hasActiveSession": true, "sessionId": second["sessionId"], "totalSegments": 0, "totalDurationSeconds": 0 })
    );
}

#[tokio::test]
async fn segments_ready_fills_the_session_playlist_and_segments() {
    let (server, client, base, mut me) = recording(0).await;
    let (status, body) = get(&client, &base, "/api/livekit/replay/preview/playlist.m3u8").await;
    assert_eq!(status, 400, "warming up: {body}");
    let (status, _) = control(
        &client,
        &base,
        "emit_segments_ready",
        json!({ "segments": 3 }),
    )
    .await;
    assert_eq!(status, 200);
    let heard = settle(&server, &mut [&mut me]).await.remove(0);
    assert_eq!(names(&heard), ["egressSegmentsReady"]);
    assert_eq!(heard[0].1["channelId"], id("vc-squad").as_str());

    let (_, info) = get(&client, &base, "/api/livekit/replay/session-info").await;
    assert_eq!(info["hasActiveSession"], true);
    assert_eq!(info["totalSegments"], 3);
    assert_eq!(info["totalDurationSeconds"], 30);
    assert_eq!(info["sessionId"], heard[0].1["sessionId"]);
    assert!(info["bufferStartTime"].is_string() && info["bufferEndTime"].is_string());

    let response = client
        .get(format!("{base}/api/livekit/replay/preview/playlist.m3u8"))
        .header("Authorization", TOKEN)
        .send()
        .await
        .unwrap();
    assert_eq!(
        response.headers()["content-type"],
        "application/vnd.apple.mpegurl"
    );
    let playlist = response.text().await.unwrap();
    assert!(playlist.starts_with("#EXTM3U\n"), "{playlist}");
    assert!(playlist.ends_with("#EXT-X-ENDLIST"), "{playlist}");
    let segments: Vec<&str> = playlist
        .lines()
        .filter(|line| line.starts_with("/api/"))
        .collect();
    assert_eq!(segments.len(), 3);
    let response = client
        .get(format!("{base}{}", segments[1]))
        .header("Authorization", TOKEN)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(response.headers()["content-type"], "video/mp2t");
    let bytes = response.bytes().await.unwrap();
    assert!(bytes.len() >= 10_000 && bytes[0] == 0x47 && bytes.len() % 188 == 0);

    let (status, _) = get(
        &client,
        &base,
        "/api/livekit/replay/preview/segment/missing-segment_00009.ts",
    )
    .await;
    assert_eq!(status, 404);
    let (status, _) = get(
        &client,
        &base,
        "/api/livekit/replay/preview/segment/bad.name.ts",
    )
    .await;
    assert_eq!(status, 400);
}

#[tokio::test]
async fn capture_takes_one_two_five_or_ten_minutes_and_refuses_others() {
    let (_server, client, base, _me) = recording(90).await;
    for minutes in [1, 2, 5, 10] {
        let (status, body) = post(
            &client,
            &base,
            "/api/livekit/replay/capture",
            json!({ "durationMinutes": minutes, "destination": "library" }),
        )
        .await;
        assert_eq!(status, 201, "{minutes}: {body}");
        assert_eq!(body["requestedDurationSeconds"], minutes * 60);
        // 90 segments (15 min) are there: 10 minutes takes 60 of them.
        assert_eq!(body["durationSeconds"], minutes * 60);
        assert_eq!(
            body["downloadUrl"],
            format!("/file/{}", body["fileId"].as_str().unwrap()).as_str()
        );
        assert!(body.get("messageId").is_none());
    }
    for minutes in [json!(3), json!(0), json!(15), json!("5")] {
        let (status, body) = post(
            &client,
            &base,
            "/api/livekit/replay/capture",
            json!({ "durationMinutes": minutes, "destination": "library" }),
        )
        .await;
        assert_eq!(status, 400, "{minutes}: {body}");
        assert_eq!(body["message"], "Duration must be 1, 2, 5, or 10 minutes");
    }
    let (status, _) = post(
        &client,
        &base,
        "/api/livekit/replay/capture",
        json!({ "durationMinutes": 1, "destination": "everywhere" }),
    )
    .await;
    assert_eq!(status, 400);
    let (status, _) = post(
        &client,
        &base,
        "/api/livekit/replay/capture",
        json!({ "durationMinutes": 1, "destination": "channel", "targetChannelId": "general" }),
    )
    .await;
    assert_eq!(status, 400);
    let (_, clips) = get(&client, &base, "/api/livekit/clips").await;
    assert_eq!(clips.as_array().unwrap().len(), 4);
}

#[tokio::test]
async fn capture_clamps_a_range_to_what_is_buffered() {
    let (_server, client, base, _me) = recording(3).await;
    let capture = |body: Value| post(&client, &base, "/api/livekit/replay/capture", body);
    // Only 30 s are there: 2 minutes gives 30 s, asked for 120.
    let (_, body) = capture(json!({ "durationMinutes": 2, "destination": "library" })).await;
    assert_eq!(body["durationSeconds"], 30);
    assert_eq!(body["requestedDurationSeconds"], 120);
    // No duration at all: one minute.
    let (_, body) = capture(json!({ "destination": "library" })).await;
    assert_eq!(body["requestedDurationSeconds"], 60);
    let (_, body) =
        capture(json!({ "startSeconds": 12, "endSeconds": 60, "destination": "library" })).await;
    assert_eq!(body["durationSeconds"], 18);
    assert_eq!(body["requestedDurationSeconds"], 48);
    let (status, body) =
        capture(json!({ "startSeconds": 20, "endSeconds": 20, "destination": "library" })).await;
    assert_eq!(status, 400);
    assert_eq!(body["message"], "Start time must be before end time");
    let (status, body) =
        capture(json!({ "startSeconds": 25, "endSeconds": 50, "destination": "library" })).await;
    assert_eq!(status, 201, "clamped to the last segment: {body}");
    assert_eq!(body["durationSeconds"], 5);
    // Past the buffer altogether (the backend's clamp would trim a negative length here).
    let (status, _) =
        capture(json!({ "startSeconds": 40, "endSeconds": 50, "destination": "library" })).await;
    assert_eq!(status, 400);
    // A range ignores durationMinutes, so its value isn't checked.
    let (status, _) = capture(
        json!({ "durationMinutes": 3, "startSeconds": 10, "endSeconds": 20, "destination": "library" }),
    )
    .await;
    assert_eq!(status, 201);
}

#[tokio::test]
async fn capture_without_a_buffer_or_before_segments_is_refused() {
    let (_server, client, base) = showcase().await;
    let (status, body) = post(
        &client,
        &base,
        "/api/livekit/replay/capture",
        json!({ "durationMinutes": 1, "destination": "library" }),
    )
    .await;
    assert_eq!(status, 404);
    assert_eq!(
        body["message"],
        "No active replay found. Start screen sharing first."
    );
    let (_, info) = get(&client, &base, "/api/livekit/replay/session-info").await;
    assert_eq!(info, json!({ "hasActiveSession": false }));

    let (_server, client, base, _me) = recording(0).await;
    let (status, body) = post(
        &client,
        &base,
        "/api/livekit/replay/capture",
        json!({ "durationMinutes": 1, "destination": "library" }),
    )
    .await;
    assert_eq!(status, 400);
    assert!(body["message"].as_str().unwrap().contains("warming up"));
}

#[tokio::test]
async fn capture_to_a_channel_posts_the_clip_and_a_refused_dm_keeps_it_in_the_library() {
    let (server, client, base, mut me) = recording(6).await;
    settle(&server, &mut [&mut me]).await;
    let general = id("cc-general");
    let (status, body) = post(
        &client,
        &base,
        "/api/livekit/replay/capture",
        json!({ "durationMinutes": 1, "destination": "channel", "targetChannelId": general }),
    )
    .await;
    assert_eq!(status, 201, "{body}");
    let heard = settle(&server, &mut [&mut me]).await.remove(0);
    assert_eq!(names(&heard), ["newMessage"]);
    let message = &heard[0].1["message"];
    assert_eq!(message["id"], body["messageId"]);
    assert_eq!(message["channelId"], general.as_str());
    assert_eq!(message["authorId"], id("me").as_str());
    assert_eq!(message["spans"][0]["text"], "Replay clip - 60s (0MB)");
    let attachment = &message["attachments"][0];
    assert_eq!(attachment["id"], body["fileId"]);
    assert_eq!(attachment["mimeType"], "video/mp4");
    assert_eq!(attachment["fileType"], "VIDEO");
    let response = client
        .get(format!(
            "{base}/api/file/{}",
            body["fileId"].as_str().unwrap()
        ))
        .header("Authorization", TOKEN)
        .send()
        .await
        .unwrap();
    assert_eq!(response.headers()["content-type"], "video/mp4");
    assert_eq!(
        response.bytes().await.unwrap().len() as i64,
        body["sizeBytes"].as_i64().unwrap()
    );

    // A DM that isn't mine: refused after the clip is made, as the backend orders it.
    let (status, body) = post(
        &client,
        &base,
        "/api/livekit/replay/capture",
        json!({ "durationMinutes": 1, "destination": "dm", "targetDirectMessageGroupId": uuid::Uuid::from_u128(4).to_string() }),
    )
    .await;
    assert_eq!(status, 403, "{body}");
    let (_, clips) = get(&client, &base, "/api/livekit/clips").await;
    assert_eq!(clips.as_array().unwrap().len(), 2);
    let (status, body) = post(
        &client,
        &base,
        "/api/livekit/replay/capture",
        json!({ "durationMinutes": 1, "destination": "channel", "targetChannelId": uuid::Uuid::from_u128(4).to_string() }),
    )
    .await;
    assert_eq!(status, 404);
    assert_eq!(body["message"], "That channel could not be found.");
}

#[tokio::test]
async fn stop_and_egress_end_tell_the_owner_as_the_backend_does() {
    let (server, client, base, mut me) = recording(2).await;
    let (status, body) = post(&client, &base, "/api/livekit/replay/stop", json!({})).await;
    assert_eq!(status, 201, "{body}");
    assert_eq!(body["status"], "stopped");
    // An explicit stop sends nothing; the next session-info sends the "missed" stop.
    let heard = settle(&server, &mut [&mut me]).await.remove(0);
    assert_eq!(names(&heard), ["egressSegmentsReady"]);
    let (_, info) = get(&client, &base, "/api/livekit/replay/session-info").await;
    assert_eq!(info, json!({ "hasActiveSession": false }));
    let heard = settle(&server, &mut [&mut me]).await.remove(0);
    assert_eq!(names(&heard), ["replayBufferStopped"]);
    assert_eq!(heard[0].1["sessionId"], body["sessionId"]);
    assert_eq!(heard[0].1["egressId"], body["egressId"]);

    let (status, _) = control(&client, &base, "emit_replay_failed", json!({})).await;
    assert_eq!(status, 400, "nothing is running");
    post(
        &client,
        &base,
        "/api/livekit/replay/start",
        json!({ "channelId": id("vc-squad"), "videoTrackId": "TR_v" }),
    )
    .await;
    let (status, _) = control(
        &client,
        &base,
        "emit_replay_failed",
        json!({ "error": "Egress crashed" }),
    )
    .await;
    assert_eq!(status, 200);
    let heard = settle(&server, &mut [&mut me]).await.remove(0);
    assert_eq!(names(&heard), ["replayBufferFailed"]);
    assert_eq!(heard[0].1["error"], "Egress crashed");
    assert_eq!(heard[0].1["channelId"], id("vc-squad").as_str());
    let (status, body) = post(
        &client,
        &base,
        "/api/livekit/replay/capture",
        json!({ "durationMinutes": 1, "destination": "library" }),
    )
    .await;
    assert_eq!(status, 404);
    assert_eq!(
        body["message"],
        "Your replay recording has ended — start screen sharing again to capture."
    );
    // The heal resends the failure it thinks the client missed.
    let heard = settle(&server, &mut [&mut me]).await.remove(0);
    assert_eq!(names(&heard), ["replayBufferFailed"]);
    let (status, _) = post(&client, &base, "/api/livekit/replay/stop", json!({})).await;
    assert_eq!(status, 404);
}

#[tokio::test]
async fn the_clip_library_lists_mine_and_others_public_and_updates_shares_and_deletes() {
    let (server, client, base) = showcase().await;
    let mut me = connect_as(&base, &id("me")).await;
    let (mine, mine_file) = server.seed_clip(&id("me"), false, 30);
    server.advance_clock(std::time::Duration::from_secs(5));
    let (status, seeded) = control(
        &client,
        &base,
        "seed_clip",
        json!({ "userId": id("u-priya"), "isPublic": true, "durationSeconds": 12, "id": "11111111-1111-4111-8111-111111111111" }),
    )
    .await;
    assert_eq!(status, 200, "{seeded}");
    assert_eq!(seeded["id"], "11111111-1111-4111-8111-111111111111");
    server.seed_clip(&id("u-priya"), false, 40);

    let (_, clips) = get(&client, &base, "/api/livekit/clips").await;
    assert_eq!(clips.as_array().unwrap().len(), 1);
    assert_eq!(clips[0]["id"], mine.as_str());
    assert_eq!(clips[0]["fileId"], mine_file.as_str());
    assert_eq!(clips[0]["isPublic"], false);
    assert_eq!(clips[0]["channelId"], Value::Null);
    let (_, priyas) = get(
        &client,
        &base,
        &format!("/api/livekit/clips/user/{}", id("u-priya")),
    )
    .await;
    assert_eq!(priyas.as_array().unwrap().len(), 1, "only the public one");
    assert_eq!(priyas[0]["durationSeconds"], 12);
    let (_, my_public) = get(
        &client,
        &base,
        &format!("/api/livekit/clips/user/{}", id("me")),
    )
    .await;
    assert_eq!(my_public, json!([]));

    let (status, updated) = put(
        &client,
        &base,
        &format!("/api/livekit/clips/{mine}"),
        json!({ "isPublic": true }),
    )
    .await;
    assert_eq!(status, 200, "{updated}");
    assert_eq!(updated["isPublic"], true);
    let (status, _) = put(
        &client,
        &base,
        &format!("/api/livekit/clips/{}", seeded["id"].as_str().unwrap()),
        json!({ "isPublic": false }),
    )
    .await;
    assert_eq!(status, 404, "not mine");

    let (status, shared) = post(
        &client,
        &base,
        &format!("/api/livekit/clips/{mine}/share"),
        json!({ "destination": "channel", "targetChannelId": id("cc-general") }),
    )
    .await;
    assert_eq!(status, 201, "{shared}");
    assert_eq!(shared["destination"], "channel");
    assert_eq!(shared["clipId"], mine.as_str());
    let heard = settle(&server, &mut [&mut me]).await.remove(0);
    assert_eq!(names(&heard), ["newMessage"]);
    assert_eq!(heard[0].1["message"]["id"], shared["messageId"]);
    assert_eq!(
        heard[0].1["message"]["spans"][0]["text"],
        "Replay clip - 30s (0MB)"
    );
    let (status, body) = post(
        &client,
        &base,
        &format!("/api/livekit/clips/{mine}/share"),
        json!({ "destination": "dm", "targetDirectMessageGroupId": uuid::Uuid::from_u128(4).to_string() }),
    )
    .await;
    assert_eq!(status, 403);
    assert_eq!(
        body["message"],
        "You are not a member of the target DM group"
    );
    let (status, _) = post(
        &client,
        &base,
        &format!("/api/livekit/clips/{mine}/share"),
        json!({ "destination": "library" }),
    )
    .await;
    assert_eq!(status, 400);

    let (status, body) = delete(
        &client,
        &base,
        &format!("/api/livekit/clips/{mine}"),
        json!({}),
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(body, json!({ "success": true }));
    let (status, _) = get(&client, &base, &format!("/api/file/{mine_file}")).await;
    assert_eq!(status, 200, "the file route draws any id it doesn't hold");
    let (_, clips) = get(&client, &base, "/api/livekit/clips").await;
    assert_eq!(clips, json!([]));
}

// ----- Join failures ---------------------------------------------------------------------------

fn join_failure(platform: &str) -> Value {
    json!({
        "errorClass": "server_unreachable",
        "message": "x".repeat(600),
        "durationMs": 1500,
        "platform": platform,
        "appVersion": "0.8.0",
        "channelId": "c-1",
        "isDm": true,
    })
}

#[tokio::test]
async fn join_failures_are_kept_as_the_backend_validates_and_throttles_them() {
    let (server, client, base) = showcase().await;
    let path = "/api/voice/diagnostics/join-failure";
    let (status, body) = post(&client, &base, path, join_failure("electron")).await;
    assert_eq!(status, 204, "{body}");
    // A native platform isn't one the backend takes yet.
    let (status, body) = post(&client, &base, path, join_failure("native")).await;
    assert_eq!(status, 400, "{body}");
    let (status, _) = post(&client, &base, path, join_failure("web")).await;
    assert_eq!(status, 204);
    // The fourth in a minute, invalid ones counted.
    let (status, body) = post(&client, &base, path, join_failure("web")).await;
    assert_eq!(status, 429, "{body}");
    assert_eq!(body["errorCode"], "RATE_LIMITED");
    server.advance_clock(std::time::Duration::from_secs(61));
    let (status, _) = post(&client, &base, path, join_failure("web")).await;
    assert_eq!(status, 204);

    let reports = server.join_failures();
    assert_eq!(reports.len(), 3);
    assert_eq!(reports[0]["platform"], "electron");
    assert_eq!(
        reports[0]["message"].as_str().unwrap().len(),
        500,
        "truncated"
    );
    assert_eq!(
        reports[0]["channelId"],
        Value::Null,
        "a DM's channel isn't logged"
    );
    let (_, listed) = control(&client, &base, "join_failures", json!({})).await;
    assert_eq!(listed["reports"].as_array().unwrap().len(), 3);
}

#[tokio::test]
async fn join_failure_fields_are_checked() {
    let (server, client, base) = showcase().await;
    let path = "/api/voice/diagnostics/join-failure";
    let mut cases = Vec::new();
    for (field, value) in [
        ("errorClass", json!("cosmic_rays")),
        ("durationMs", json!(-1)),
        ("durationMs", json!(600_001)),
        ("candidateTypes", json!(["host", "turn"])),
        ("isDm", json!("yes")),
        ("appVersion", Value::Null),
    ] {
        let mut body = join_failure("web");
        body[field] = value;
        cases.push(body);
    }
    for body in cases {
        // Past the throttle's window each time.
        server.advance_clock(std::time::Duration::from_secs(61));
        let (status, response) = post(&client, &base, path, body.clone()).await;
        assert_eq!(status, 400, "{body}: {response}");
    }
    assert!(server.join_failures().is_empty());
}

// ----- Faults ----------------------------------------------------------------------------------

#[tokio::test]
async fn every_w4_operation_can_be_failed_by_its_operation_id() {
    let (server, client, base) = showcase().await;
    use reqwest::Method as M;
    let some = uuid::Uuid::from_u128(1).to_string();
    let cases: Vec<(&str, M, String)> = vec![
        (
            "LivekitController_generateDmToken",
            M::POST,
            "/api/livekit/dm-token".into(),
        ),
        (
            "LivekitController_muteParticipant",
            M::POST,
            format!("/api/livekit/channels/{some}/mute-participant"),
        ),
        (
            "DmVoicePresenceController_getDmPresence",
            M::GET,
            format!("/api/dm-groups/{some}/voice-presence"),
        ),
        (
            "DmVoicePresenceController_refreshDmPresence",
            M::POST,
            format!("/api/dm-groups/{some}/voice-presence/refresh"),
        ),
        (
            "ModerationController_kickUser",
            M::POST,
            format!("/api/moderation/kick/{some}/{some}"),
        ),
        (
            "SoundboardController_listCommunitySounds",
            M::GET,
            format!("/api/soundboard/community/{some}"),
        ),
        (
            "LivekitController_startReplayBuffer",
            M::POST,
            "/api/livekit/replay/start".into(),
        ),
        (
            "LivekitController_stopReplayBuffer",
            M::POST,
            "/api/livekit/replay/stop".into(),
        ),
        (
            "LivekitController_getSessionInfo",
            M::GET,
            "/api/livekit/replay/session-info".into(),
        ),
        (
            "LivekitController_getPreviewPlaylist",
            M::GET,
            "/api/livekit/replay/preview/playlist.m3u8".into(),
        ),
        (
            "LivekitController_getPreviewSegment",
            M::GET,
            "/api/livekit/replay/preview/segment/a.ts".into(),
        ),
        (
            "LivekitController_captureReplay",
            M::POST,
            "/api/livekit/replay/capture".into(),
        ),
        (
            "LivekitController_getMyClips",
            M::GET,
            "/api/livekit/clips".into(),
        ),
        (
            "LivekitController_getUserPublicClips",
            M::GET,
            format!("/api/livekit/clips/user/{some}"),
        ),
        (
            "LivekitController_updateClip",
            M::PUT,
            format!("/api/livekit/clips/{some}"),
        ),
        (
            "LivekitController_deleteClip",
            M::DELETE,
            format!("/api/livekit/clips/{some}"),
        ),
        (
            "LivekitController_shareClip",
            M::POST,
            format!("/api/livekit/clips/{some}/share"),
        ),
        (
            "VoiceDiagnosticsController_reportJoinFailure",
            M::POST,
            "/api/voice/diagnostics/join-failure".into(),
        ),
    ];
    for (operation, method, path) in cases {
        server.fail_route(operation, 503, "UNAVAILABLE");
        let body = (method == M::POST || method == M::PUT).then(|| json!({}));
        let (status, body) = request(&client, method.clone(), &base, &path, body, true).await;
        assert_eq!(status, 503, "{operation}: {method} {path}: {body}");
        assert_eq!(body["errorCode"], "UNAVAILABLE", "{operation}");
        let recorded = server.requests();
        let last = serde_json::to_value(recorded.last().unwrap()).unwrap();
        assert_eq!(last["operation"], operation);
    }
}

#[tokio::test]
async fn joining_a_channel_call_tells_the_channel_once() {
    // As the backend's handleWebhookChannelParticipantJoined: a new participant is announced; one
    // already listed only has its presence refreshed.
    let (server, client, base) = showcase().await;
    let squad = id("vc-squad");
    let mut me = connect_as(&base, &id("me")).await;
    let path = format!("/api/channels/{squad}/voice-presence/join");
    post(&client, &base, &path, json!({})).await;
    post(&client, &base, &path, json!({})).await;
    let heard = settle(&server, &mut [&mut me]).await.remove(0);
    assert_eq!(names(&heard), ["voiceChannelUserJoined"]);
    assert_eq!(heard[0].1["channelId"], squad.as_str());
    assert_eq!(heard[0].1["user"]["id"], id("me").as_str());
    assert_eq!(heard[0].1["user"]["isServerMuted"], false);
}

#[tokio::test]
async fn download_only_streams_the_last_minutes_as_an_mp4_and_keeps_nothing() {
    // As `GET replay/stream`: the duration is required and one of the four; the active session
    // (or the heal's 404) and a segment are needed, as for a capture.
    let (_server, client, base) = showcase().await;
    let (status, _) = get(
        &client,
        &base,
        "/api/livekit/replay/stream?durationMinutes=1",
    )
    .await;
    assert_eq!(status, 404, "no buffer");
    let (server, client, base, _me) = recording(0).await;
    let (status, body) = get(
        &client,
        &base,
        "/api/livekit/replay/stream?durationMinutes=1",
    )
    .await;
    assert_eq!(status, 400, "warming up: {body}");
    assert!(server.emit_segments_ready(3));
    for bad in ["", "?durationMinutes=3", "?durationMinutes=x"] {
        let (status, _) = get(&client, &base, &format!("/api/livekit/replay/stream{bad}")).await;
        assert_eq!(status, 400, "{bad}");
    }
    let response = client
        .get(format!(
            "{base}/api/livekit/replay/stream?durationMinutes=2"
        ))
        .header("Authorization", TOKEN)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(response.headers()["content-type"], "video/mp4");
    let disposition = response.headers()["content-disposition"]
        .to_str()
        .unwrap()
        .to_owned();
    assert!(
        disposition.starts_with("attachment; filename=\"replay-"),
        "{disposition}"
    );
    let bytes = response.bytes().await.unwrap();
    assert_eq!(&bytes[4..8], b"ftyp");
    let (_, clips) = get(&client, &base, "/api/livekit/clips").await;
    assert_eq!(clips, json!([]), "saved nowhere");
}
