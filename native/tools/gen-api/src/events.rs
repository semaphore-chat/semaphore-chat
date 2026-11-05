//! `semaphore_wire::events`: the socket side of the contract.
//!
//! One `ServerEvent` variant per server event, decoded without ever failing, and one
//! function per client event that serialises its typed payload.

use anyhow::Context;

use crate::spec::{pascal_case, ref_name, snake_case};

struct ClientEvent {
    name: String,
    payload: Option<String>,
    ack: Option<String>,
}

/// Reads `socket-events.json` and returns `semaphore-wire/src/events.rs`.
pub fn module_source(events: &serde_json::Value) -> anyhow::Result<String> {
    let server = events
        .get("server")
        .and_then(|server| server.as_object())
        .context("socket-events.json has no server object")?;
    let client = events
        .get("client")
        .and_then(|client| client.as_object())
        .context("socket-events.json has no client object")?;

    let mut source = String::from(HEADER);

    source.push_str("pub enum ServerEvent {\n");
    for (name, event) in server {
        let payload = ref_name(event.get("payload").with_context(|| {
            format!("server event {name} has no payload (only client events may omit it)")
        })?)?;
        source.push_str(&format!(
            "    /// `{name}`\n    {}(types::{payload}),\n",
            pascal_case(name)
        ));
    }
    source.push_str(UNKNOWN_AND_MALFORMED);
    source.push_str("}\n\n");

    source.push_str(DECODE_START);
    for name in server.keys() {
        source.push_str(&format!(
            "            {name:?} => decode_payload(name, payload, ServerEvent::{}),\n",
            pascal_case(name)
        ));
    }
    source.push_str(DECODE_END);

    let mut client_events = Vec::new();
    for (name, event) in client {
        client_events.push(ClientEvent {
            name: name.clone(),
            payload: event
                .get("payload")
                .map(ref_name)
                .transpose()
                .with_context(|| format!("client event {name}"))?,
            ack: event.get("ack").map(ref_name).transpose()?,
        });
    }
    client_events.sort_by(|a, b| a.name.cmp(&b.name));

    for event in &client_events {
        source.push_str(&format!(
            "/// The name `{}` is sent under.\npub const {}: &str = {:?};\n\n",
            event.name,
            snake_case(&event.name).to_uppercase(),
            event.name
        ));
    }

    for event in &client_events {
        let function = snake_case(&event.name);
        match &event.payload {
            Some(payload) => source.push_str(&format!(
                "/// The payload `{}` sends.\npub fn {function}(payload: &types::{payload}) -> Value {{\n    payload_value(payload)\n}}\n\n",
                event.name
            )),
            None => source.push_str(&format!(
                "/// `{}` has no payload.\npub fn {function}() -> Value {{\n    Value::Null\n}}\n\n",
                event.name
            )),
        }
    }

    for event in &client_events {
        if let Some(ack) = &event.ack {
            source.push_str(&format!(
                "/// The ack `{}` resolves with.\npub type {}Ack = types::{ack};\n\n",
                event.name,
                pascal_case(&event.name)
            ));
        }
    }

    source.push_str(FOOTER);
    // Parse it once so a broken generator fails here, with a line number, not in the crate.
    syn::parse_file(&source).context("the generated event module does not parse")?;
    Ok(source)
}

const HEADER: &str = r#"#![allow(clippy::all)]

use serde::de::DeserializeOwned;
use serde_json::Value;

use crate::types;

/// An event the server sent.
///
/// [`ServerEvent::decode`] always produces one: an event this build does not know is
/// [`ServerEvent::Unknown`], and a known event whose payload does not match its type is
/// [`ServerEvent::Malformed`]. Neither loses the payload.
#[derive(Clone, Debug)]
"#;

const UNKNOWN_AND_MALFORMED: &str = r#"    /// An event this build does not know, kept whole so a newer server's event is still
    /// visible to the caller.
    Unknown { name: String, payload: Value },
    /// A known event whose payload did not match its type, kept whole with the
    /// deserializer's error, so one bad payload never takes down the connection.
    Malformed { name: String, payload: Value, error: String },
"#;

const DECODE_START: &str = r#"impl ServerEvent {
    /// Decodes one server event. Never fails.
    pub fn decode(name: &str, payload: Value) -> ServerEvent {
        match name {
"#;

const DECODE_END: &str = r#"            _ => ServerEvent::Unknown {
                name: name.to_owned(),
                payload,
            },
        }
    }
}

fn decode_payload<T, F>(name: &str, payload: Value, variant: F) -> ServerEvent
where
    T: DeserializeOwned,
    F: FnOnce(T) -> ServerEvent,
{
    match T::deserialize(&payload) {
        Ok(value) => variant(value),
        Err(error) => ServerEvent::Malformed {
            name: name.to_owned(),
            payload,
            error: error.to_string(),
        },
    }
}
"#;

const FOOTER: &str = r#"
fn payload_value<T: serde::Serialize>(payload: &T) -> Value {
    serde_json::to_value(payload).expect("a typed payload always serialises to JSON")
}
"#;
