//! A LiveKit token for `native/scripts/lk-stack.sh`'s dev key. Tests and rigs only.

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use hmac::{Hmac, Mac};
use sha2::Sha256;

pub const KEY: &str = "devkey";
pub const SECRET: &str = "secret-that-is-at-least-32-characters-long";

#[allow(dead_code)]
pub fn dev_token(room: &str, identity: &str, name: &str) -> String {
    dev_token_publishing(room, identity, name, None)
}

/// With `sources`, only those may be published (LiveKit's names: "camera", "microphone",
/// "screen_share", "screen_share_audio"), as the backend's `publishGrantFor` grants.
#[allow(dead_code)]
pub fn dev_token_publishing(
    room: &str,
    identity: &str,
    name: &str,
    sources: Option<&[&str]>,
) -> String {
    let sources = sources.map_or(String::new(), |sources| {
        let quoted: Vec<String> = sources.iter().map(|s| format!("\"{s}\"")).collect();
        format!(r#","canPublishSources":[{}]"#, quoted.join(","))
    });
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("the clock is past 1970")
        .as_secs();
    let claims = format!(
        r#"{{"iss":"{KEY}","sub":"{identity}","name":"{name}","nbf":{},"exp":{},"video":{{"room":"{room}","roomJoin":true,"canPublish":true,"canSubscribe":true,"canUpdateOwnMetadata":true{sources}}}}}"#,
        now - 5,
        now + 7200,
    );
    let header = URL_SAFE_NO_PAD.encode(r#"{"alg":"HS256","typ":"JWT"}"#);
    let body = URL_SAFE_NO_PAD.encode(claims);
    let signed = format!("{header}.{body}");
    let mut mac = Hmac::<Sha256>::new_from_slice(SECRET.as_bytes()).expect("HMAC takes any key");
    mac.update(signed.as_bytes());
    let signature = URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes());
    format!("{signed}.{signature}")
}
