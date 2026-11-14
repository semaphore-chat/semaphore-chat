//! W24: a v0.8.x/v0.9.0 server's `GET /channels/community/:id/permissions/me` has no `pin`,
//! `deleteAny` or `seeRemoved` (added in fde1d761, first released in v0.10.0). Below the
//! contract's floor (`contract/FLOOR`), so they decode as `None` instead of failing the response.
//!
//! The payloads are built byte for byte as v0.9.0's `ChannelAccessService.capabilitiesFor` sends
//! them; the sizes are the two a real server's failures logged (2614 and 916 bytes, both failing
//! at column 348 before the floor).

use semaphore_wire::{CommunityChannelCapabilitiesDto, FileUploadResponseDto};

const COMMUNITY: &str = "0b6f2c1e-7d1a-4c55-9a3e-2f8a6c1d9e01";

/// One channel object, in v0.9.0's key order. `extra` goes after `managePermissions`, where
/// v0.10.0 puts its new flags.
fn channel(i: usize, roles: &str, extra: &str) -> String {
    format!(
        "{{\"channelId\":\"{i:08}-7d1a-4c55-9a3e-2f8a6c1d9e01\",\"view\":true,\"post\":true,\
         \"attach\":true,\"react\":true,\"threadReply\":true,\"connect\":true,\"speak\":true,\
         \"video\":true,\"share\":true,\"managePermissions\":true{extra},\"timedOutUntil\":null,\
         \"postingRoleNames\":{roles}}}"
    )
}

fn body(channels: usize, extra: &str) -> String {
    // 38 bytes of role names beyond `[]` make each v0.9.0 channel object 282 bytes.
    let roles = r#"["Community Admin","Moderator","Member"]"#;
    let objects: Vec<String> = (0..channels).map(|i| channel(i, roles, extra)).collect();
    format!(
        "{{\"communityId\":\"{COMMUNITY}\",\"channels\":[{}]}}",
        objects.join(",")
    )
}

#[test]
fn an_old_servers_capabilities_decode_with_the_new_flags_unknown() {
    for (channels, bytes) in [(9, 2614), (3, 916)] {
        let text = body(channels, "");
        assert_eq!(text.len(), bytes, "the logged payload size");
        let decoded: CommunityChannelCapabilitiesDto =
            serde_json::from_str(&text).expect("an older server's list decodes");
        assert_eq!(decoded.community_id, COMMUNITY);
        assert_eq!(decoded.channels.len(), channels);
        for capability in &decoded.channels {
            assert!(capability.view && capability.post && capability.manage_permissions);
            assert_eq!(
                (
                    capability.pin,
                    capability.delete_any,
                    capability.see_removed
                ),
                (None, None, None)
            );
            assert_eq!(capability.posting_role_names.len(), 3);
        }
    }
}

#[test]
fn a_current_servers_capabilities_decode_with_the_flags() {
    let text = body(2, r#","pin":true,"deleteAny":false,"seeRemoved":true"#);
    let decoded: CommunityChannelCapabilitiesDto = serde_json::from_str(&text).unwrap();
    let first = &decoded.channels[0];
    assert_eq!(
        (first.pin, first.delete_any, first.see_removed),
        (Some(true), Some(false), Some(true))
    );
}

#[test]
fn a_field_the_floor_has_is_still_required() {
    // `view` was there in v0.8.0: a list without it is broken, not old.
    let text = body(1, "").replace("\"view\":true,", "");
    let error = serde_json::from_str::<CommunityChannelCapabilitiesDto>(&text).unwrap_err();
    assert!(
        error.to_string().starts_with("missing field `view`"),
        "{error}"
    );
}

#[test]
fn an_unknown_flag_is_still_a_decoded_flag_and_null_reads_as_unknown() {
    // A null where a newer server sends a bool: unknown, like missing.
    let text = body(1, r#","pin":null"#);
    let decoded: CommunityChannelCapabilitiesDto = serde_json::from_str(&text).unwrap();
    assert_eq!(decoded.channels[0].pin, None);
}

#[test]
fn an_old_servers_upload_response_decodes_without_has_thumbnail() {
    // v0.8.0/v0.9.0's `FileUploadResponseDto`: every field the floor has, no `hasThumbnail`.
    let upload = serde_json::json!({
        "fileType": "IMAGE", "resourceType": "MESSAGE_ATTACHMENT", "storageType": "LOCAL",
        "id": "f-1", "filename": "a.png", "mimeType": "image/png", "size": 10, "checksum": "c",
        "uploadedById": "u", "uploadedAt": "2026-09-22T18:00:00.000Z", "deletedAt": null,
        "fileUserId": null, "fileCommunityId": null, "fileMessageId": "m",
        "storagePath": "/x", "thumbnailPath": null,
    });
    let decoded: FileUploadResponseDto = serde_json::from_value(upload).expect("decodes");
    assert_eq!(decoded.has_thumbnail, None);
}
