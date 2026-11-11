//! A community's soundboard (W4): the list, from fixture sounds every community has. Their files
//! are stored at start, so `GET /api/file/{fileId}` serves their bytes. Managing sounds is W5's.

use super::json_response;
use crate::scenario::{Scenario, entity_uuid};
use crate::{Inner, StoredFile};
use axum::Router;
use axum::extract::{Path, State};
use axum::http::{Method, StatusCode};
use axum::response::Response;
use axum::routing::get;
use semaphore_wire::types::SoundboardSoundDto;
use std::collections::HashMap;
use std::sync::Arc;

pub(super) fn routes() -> Router<Arc<Inner>> {
    Router::new().route("/api/soundboard/community/{communityId}", get(list))
}

pub(super) fn operation_id(method: &Method, route: &str) -> Option<&'static str> {
    Some(match (method.as_str(), route) {
        ("GET", "/api/soundboard/community/{communityId}") => {
            "SoundboardController_listCommunitySounds"
        }
        _ => return None,
    })
}

/// Name, emoji, file name, MIME type and bytes of each fixture sound (1 s of a 440 Hz sine).
/// Name, emoji, file name, MIME type and bytes.
type Sound = (
    &'static str,
    Option<&'static str>,
    &'static str,
    &'static str,
    &'static [u8],
);

const SOUNDS: &[Sound] = &[
    (
        "Airhorn",
        Some("📯"),
        "airhorn.mp3",
        "audio/mpeg",
        include_bytes!("../../fixtures/sound-airhorn.mp3"),
    ),
    (
        "Rimshot",
        Some("🥁"),
        "rimshot.ogg",
        "audio/ogg",
        include_bytes!("../../fixtures/sound-rimshot.ogg"),
    ),
    ("Silence", None, "silence.wav", "audio/wav", SILENCE_WAV),
];

/// 0.1 s of 8 kHz mono 16-bit silence, a whole WAV file.
const SILENCE_WAV: &[u8] = &{
    const DATA: usize = 1600;
    let mut wav = [0u8; 44 + DATA];
    let header: [u8; 44] = [
        b'R', b'I', b'F', b'F', 0x64, 0x06, 0, 0, b'W', b'A', b'V', b'E', b'f', b'm', b't', b' ',
        16, 0, 0, 0, 1, 0, 1, 0, 0x40, 0x1f, 0, 0, 0x80, 0x3e, 0, 0, 2, 0, 16, 0, b'd', b'a', b't',
        b'a', 0x40, 0x06, 0, 0,
    ];
    let mut i = 0;
    while i < 44 {
        wav[i] = header[i];
        i += 1;
    }
    wav
};

/// A community's fixture sounds' ids: the same on every run (`entity_uuid` of the community and
/// the name), so a test can name one.
pub(crate) fn sound_ids(community_id: &str, name: &str) -> (String, String) {
    (
        entity_uuid(&format!("sound:{community_id}:{name}")),
        entity_uuid(&format!("sound-file:{community_id}:{name}")),
    )
}

/// Every community's sounds, sorted by name as `listCommunitySounds` orders them.
fn sounds_of(scenario: &Scenario, community_id: &str) -> Option<Vec<SoundboardSoundDto>> {
    let community = scenario.community(community_id)?;
    Some(
        SOUNDS
            .iter()
            .map(|(name, emoji, _, _, _)| {
                let (id, file_id) = sound_ids(community_id, name);
                SoundboardSoundDto {
                    community_id: community_id.to_owned(),
                    created_at: community.created_at,
                    created_by: None,
                    emoji: emoji.map(str::to_owned),
                    file_id,
                    id,
                    name: (*name).to_owned(),
                }
            })
            .collect(),
    )
}

/// The sounds' files, for the file routes.
pub(crate) fn seed_files(scenario: &Scenario, files: &mut HashMap<String, StoredFile>) {
    for community in &scenario.communities {
        for (name, _, filename, mime, bytes) in SOUNDS {
            let (_, file_id) = sound_ids(&community.id, name);
            files.insert(
                file_id,
                StoredFile {
                    uploaded_by: scenario.me.id.clone(),
                    resource_type: "SOUNDBOARD_SOUND".to_owned(),
                    filename: (*filename).to_owned(),
                    mime_type: (*mime).to_owned(),
                    bytes: bytes.to_vec(),
                },
            );
        }
    }
}

/// `GET /soundboard/community/{communityId}`: `ParseUUIDPipe` on the id (a scenario's own
/// readable ids pass), then the RBAC guard, which stops a community the user isn't in.
async fn list(State(inner): State<Arc<Inner>>, Path(community_id): Path<String>) -> Response {
    let known = inner.scenario.community(&community_id).is_some();
    if !crate::social::valid_id(&community_id, known) {
        return super::dms::bad_id(&inner, "uuid");
    }
    match sounds_of(&inner.scenario, &community_id) {
        Some(sounds) => json_response(
            StatusCode::OK,
            serde_json::to_value(sounds).expect("sounds serialize"),
        ),
        // The guard's `false`, which Nest answers as its default 403.
        None => inner.error(403, "FORBIDDEN", "Forbidden resource", false),
    }
}
