//! LiveKit's RoomService (Twirp over HTTP), as the backend calls it: what a participant has
//! published, and a server mute. Tests only, against `native/scripts/lk-stack.sh`'s dev key.

use super::token::{KEY, SECRET};
use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use hmac::{Hmac, Mac};
use sha2::Sha256;
use std::io::{Read, Write};

fn admin_token(room: &str) -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("the clock is past 1970")
        .as_secs();
    let claims = format!(
        r#"{{"iss":"{KEY}","sub":"test-admin","nbf":{},"exp":{},"video":{{"room":"{room}","roomAdmin":true}}}}"#,
        now - 5,
        now + 600,
    );
    let header = URL_SAFE_NO_PAD.encode(r#"{"alg":"HS256","typ":"JWT"}"#);
    let signed = format!("{header}.{}", URL_SAFE_NO_PAD.encode(claims));
    let mut mac = Hmac::<Sha256>::new_from_slice(SECRET.as_bytes()).expect("HMAC takes any key");
    mac.update(signed.as_bytes());
    format!(
        "{signed}.{}",
        URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes())
    )
}

/// One RoomService call; `lk_url` is the `ws://host:port` the engines join.
fn call(lk_url: &str, room: &str, method: &str, body: serde_json::Value) -> serde_json::Value {
    let host = lk_url.trim_start_matches("ws://").trim_end_matches('/');
    let body = body.to_string();
    let request = format!(
        "POST /twirp/livekit.RoomService/{method} HTTP/1.1\r\nHost: {host}\r\nAuthorization: Bearer {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        admin_token(room),
        body.len()
    );
    let mut stream = std::net::TcpStream::connect(host).expect("LiveKit's HTTP port");
    stream.write_all(request.as_bytes()).expect("sends");
    let mut response = String::new();
    stream.read_to_string(&mut response).expect("reads");
    let (head, mut payload) = response.split_once("\r\n\r\n").expect("an HTTP response");
    assert!(
        head.starts_with("HTTP/1.1 200"),
        "{method}: {head}\n{payload}"
    );
    let dechunked;
    if head
        .to_ascii_lowercase()
        .contains("transfer-encoding: chunked")
    {
        let mut out = String::new();
        let mut rest = payload;
        while let Some((size, after)) = rest.split_once("\r\n") {
            let size = usize::from_str_radix(size.trim(), 16).unwrap_or(0);
            if size == 0 {
                break;
            }
            out.push_str(&after[..size]);
            rest = &after[size + 2..];
        }
        dechunked = out;
        payload = &dechunked;
    }
    serde_json::from_str(payload).expect("JSON")
}

/// `identity`'s published tracks with this source (`MICROPHONE`, `SCREEN_SHARE_AUDIO`, ...).
#[allow(dead_code)]
pub fn track_sids(lk_url: &str, room: &str, identity: &str, source: &str) -> Vec<String> {
    let participant = call(
        lk_url,
        room,
        "GetParticipant",
        serde_json::json!({ "room": room, "identity": identity }),
    );
    participant["tracks"]
        .as_array()
        .into_iter()
        .flatten()
        // JSON leaves out an enum at its zero value, which for the source is UNKNOWN.
        .filter(|track| track["source"].as_str().unwrap_or("UNKNOWN") == source)
        .filter_map(|track| track["sid"].as_str().map(str::to_owned))
        .collect()
}

/// What the backend's server mute does (`livekit.service.ts`, `mutePublishedTrack`).
#[allow(dead_code)]
pub fn mute_published_track(lk_url: &str, room: &str, identity: &str, sid: &str, muted: bool) {
    call(
        lk_url,
        room,
        "MutePublishedTrack",
        serde_json::json!({ "room": room, "identity": identity, "track_sid": sid, "muted": muted }),
    );
}
