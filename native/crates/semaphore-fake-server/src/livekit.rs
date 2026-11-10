//! Real LiveKit tokens, for a fake server pointed at a real LiveKit (`--livekit-url`): the
//! slice's voice e2e joins `scripts/lk-stack.sh`'s dev server through it. HS256, as LiveKit's own
//! `AccessToken` signs them, with the room join grant the backend's `LivekitService` gives.

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use hmac::{Hmac, Mac};
use serde_json::json;
use sha2::Sha256;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, Debug)]
pub struct LiveKit {
    pub url: String,
    pub key: String,
    pub secret: String,
}

impl LiveKit {
    /// A token to join `room` as `identity`, valid for `ttl_secs` of wall-clock time: LiveKit
    /// checks it against its own clock, not the scenario's.
    pub fn token(&self, identity: &str, name: Option<&str>, room: &str, ttl_secs: u64) -> String {
        let now = now_secs();
        self.sign(json!({
            "iss": self.key,
            "sub": identity,
            "name": name.unwrap_or(identity),
            "nbf": now.saturating_sub(10),
            "exp": now + ttl_secs,
            "video": {
                "room": room,
                "roomJoin": true,
                "canPublish": true,
                "canSubscribe": true,
                "canPublishData": true,
                "canUpdateOwnMetadata": true,
            },
        }))
    }

    /// A token for the server API on `room`: what a test uses to remove a participant.
    pub fn admin_token(&self, room: &str) -> String {
        let now = now_secs();
        self.sign(json!({
            "iss": self.key,
            "sub": "slice-admin",
            "nbf": now.saturating_sub(10),
            "exp": now + 300,
            "video": { "room": room, "roomAdmin": true },
        }))
    }

    fn sign(&self, claims: serde_json::Value) -> String {
        let header = json!({ "alg": "HS256", "typ": "JWT" });
        let signing_input = format!(
            "{}.{}",
            URL_SAFE_NO_PAD.encode(header.to_string()),
            URL_SAFE_NO_PAD.encode(claims.to_string())
        );
        let mut mac =
            Hmac::<Sha256>::new_from_slice(self.secret.as_bytes()).expect("HMAC takes any key");
        mac.update(signing_input.as_bytes());
        let signature = URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes());
        format!("{signing_input}.{signature}")
    }
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_secs())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_token_carries_the_grant_and_verifies_with_the_secret() {
        let livekit = LiveKit {
            url: "ws://lk:7880".into(),
            key: "devkey".into(),
            secret: "secret".into(),
        };
        let token = livekit.token("u-1", Some("Ava"), "room-1", 60);
        let parts: Vec<&str> = token.split('.').collect();
        assert_eq!(parts.len(), 3);
        let claims: serde_json::Value =
            serde_json::from_slice(&URL_SAFE_NO_PAD.decode(parts[1]).unwrap()).unwrap();
        assert_eq!(claims["iss"], "devkey");
        assert_eq!(claims["sub"], "u-1");
        assert_eq!(claims["video"]["room"], "room-1");
        assert_eq!(claims["video"]["roomJoin"], true);
        let mut mac = Hmac::<Sha256>::new_from_slice(b"secret").unwrap();
        mac.update(format!("{}.{}", parts[0], parts[1]).as_bytes());
        mac.verify_slice(&URL_SAFE_NO_PAD.decode(parts[2]).unwrap())
            .expect("the signature verifies");
    }
}
