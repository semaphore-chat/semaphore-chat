//! Engine.IO v4 and Socket.IO v5 text framing, as the server actually uses them: WebSocket
//! only, no namespaces, no binary. Pure, so it stays in core; the socket that carries these
//! frames lives in `semaphore-net`.

use serde_json::Value;

/// What the server says in its Engine.IO open packet.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EngineOpen {
    pub sid: String,
    pub ping_interval_ms: u64,
    pub ping_timeout_ms: u64,
}

/// One WebSocket text frame from the server.
#[derive(Debug, Clone, PartialEq)]
pub enum Frame {
    EngineOpen(EngineOpen),
    EngineClose,
    Ping,
    Pong,
    /// Upgrade probes and no-ops: nothing to do on a WebSocket-only connection.
    Noop,
    /// The namespace accepted us.
    Connected {
        sid: String,
    },
    /// `44`: the connection middleware refused us, for example `AUTH_FAILED`.
    ConnectRefused {
        message: String,
    },
    /// `41`: the server ended this connection ("io server disconnect").
    ServerDisconnect,
    Event {
        name: String,
        payload: Value,
        ack_id: Option<u64>,
    },
    Ack {
        id: u64,
        args: Vec<Value>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum FrameError {
    #[error("empty frame")]
    Empty,
    #[error("unknown packet type in {0:?}")]
    UnknownType(String),
    #[error("binary packets are not part of this protocol")]
    Binary,
    #[error("namespaced packets are not part of this protocol: {0:?}")]
    Namespace(String),
    #[error("malformed packet {frame:?}: {reason}")]
    Malformed { frame: String, reason: String },
}

fn malformed(frame: &str, reason: impl ToString) -> FrameError {
    FrameError::Malformed {
        frame: frame.chars().take(120).collect(),
        reason: reason.to_string(),
    }
}

pub fn parse_frame(text: &str) -> Result<Frame, FrameError> {
    let mut chars = text.chars();
    match chars.next().ok_or(FrameError::Empty)? {
        '0' => parse_open(text, chars.as_str()),
        '1' => Ok(Frame::EngineClose),
        '2' => Ok(Frame::Ping),
        '3' => Ok(Frame::Pong),
        '4' => parse_socket_packet(text, chars.as_str()),
        '5' | '6' => Ok(Frame::Noop),
        _ => Err(FrameError::UnknownType(text.chars().take(20).collect())),
    }
}

fn parse_open(frame: &str, body: &str) -> Result<Frame, FrameError> {
    let value: Value = serde_json::from_str(body).map_err(|error| malformed(frame, error))?;
    let field = |name: &str| {
        value
            .get(name)
            .and_then(Value::as_u64)
            .ok_or_else(|| malformed(frame, format!("no {name}")))
    };
    Ok(Frame::EngineOpen(EngineOpen {
        sid: value
            .get("sid")
            .and_then(Value::as_str)
            .ok_or_else(|| malformed(frame, "no sid"))?
            .to_owned(),
        ping_interval_ms: field("pingInterval")?,
        ping_timeout_ms: field("pingTimeout")?,
    }))
}

fn parse_socket_packet(frame: &str, body: &str) -> Result<Frame, FrameError> {
    let mut chars = body.chars();
    let kind = chars
        .next()
        .ok_or_else(|| malformed(frame, "no socket packet type"))?;
    let rest = chars.as_str();
    if rest.starts_with('/') {
        return Err(FrameError::Namespace(rest.chars().take(40).collect()));
    }
    match kind {
        '0' => {
            let value: Value =
                serde_json::from_str(rest).map_err(|error| malformed(frame, error))?;
            let sid = value
                .get("sid")
                .and_then(Value::as_str)
                .ok_or_else(|| malformed(frame, "no sid"))?;
            Ok(Frame::Connected {
                sid: sid.to_owned(),
            })
        }
        '1' => Ok(Frame::ServerDisconnect),
        '2' => {
            let (ack_id, json) = split_ack_id(frame, rest)?;
            let args = parse_array(frame, json)?;
            let mut args = args.into_iter();
            let name = match args.next() {
                Some(Value::String(name)) => name,
                _ => return Err(malformed(frame, "event name is not a string")),
            };
            // One argument is every event this server sends. Extra ones are kept, not dropped.
            let payload = match (args.next(), args.next()) {
                (None, _) => Value::Null,
                (Some(only), None) => only,
                (Some(first), Some(second)) => {
                    let mut all = vec![first, second];
                    all.extend(args);
                    Value::Array(all)
                }
            };
            Ok(Frame::Event {
                name,
                payload,
                ack_id,
            })
        }
        '3' => {
            let (id, json) = split_ack_id(frame, rest)?;
            let id = id.ok_or_else(|| malformed(frame, "ack without an id"))?;
            Ok(Frame::Ack {
                id,
                args: parse_array(frame, json)?,
            })
        }
        '4' => {
            let value: Value =
                serde_json::from_str(rest).map_err(|error| malformed(frame, error))?;
            let message = value
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned();
            Ok(Frame::ConnectRefused { message })
        }
        '5' | '6' => Err(FrameError::Binary),
        _ => Err(FrameError::UnknownType(frame.chars().take(20).collect())),
    }
}

fn split_ack_id<'a>(frame: &str, rest: &'a str) -> Result<(Option<u64>, &'a str), FrameError> {
    let digits = rest.chars().take_while(char::is_ascii_digit).count();
    if digits == 0 {
        return Ok((None, rest));
    }
    let id = rest[..digits]
        .parse()
        .map_err(|error| malformed(frame, error))?;
    Ok((Some(id), &rest[digits..]))
}

fn parse_array(frame: &str, json: &str) -> Result<Vec<Value>, FrameError> {
    match serde_json::from_str(json).map_err(|error| malformed(frame, error))? {
        Value::Array(items) => Ok(items),
        _ => Err(malformed(frame, "not an array")),
    }
}

pub const PONG: &str = "3";
pub const DISCONNECT: &str = "41";

/// `40{auth}`: join the default namespace.
pub fn encode_connect(auth: &Value) -> String {
    format!("40{auth}")
}

/// `42["name",payload]`, or `42<id>["name",payload]` when an ack is wanted.
pub fn encode_event(name: &str, payload: &Value, ack_id: Option<u64>) -> String {
    // `emit("subscribeAll")` has no payload argument at all, and neither should this.
    let mut args = vec![Value::String(name.to_owned())];
    if !payload.is_null() {
        args.push(payload.clone());
    }
    let args = Value::Array(args);
    match ack_id {
        Some(id) => format!("42{id}{args}"),
        None => format!("42{args}"),
    }
}

/// The socket URL for an http(s) or ws(s) base URL.
pub fn websocket_url(base: &str) -> String {
    let base = base.trim_end_matches('/');
    let base = base
        .strip_prefix("https://")
        .map(|rest| format!("wss://{rest}"))
        .or_else(|| {
            base.strip_prefix("http://")
                .map(|rest| format!("ws://{rest}"))
        })
        .unwrap_or_else(|| base.to_owned());
    format!("{base}/socket.io/?EIO=4&transport=websocket")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_the_open_packet_the_gateway_sends() {
        let frame = parse_frame(
            r#"0{"sid":"abc","upgrades":[],"pingInterval":25000,"pingTimeout":60000,"maxPayload":1000000}"#,
        );
        assert_eq!(
            frame,
            Ok(Frame::EngineOpen(EngineOpen {
                sid: "abc".into(),
                ping_interval_ms: 25_000,
                ping_timeout_ms: 60_000,
            }))
        );
    }

    #[test]
    fn parses_connect_and_refusal() {
        assert_eq!(
            parse_frame(r#"40{"sid":"s1"}"#),
            Ok(Frame::Connected { sid: "s1".into() })
        );
        assert_eq!(
            parse_frame(r#"44{"message":"AUTH_FAILED"}"#),
            Ok(Frame::ConnectRefused {
                message: "AUTH_FAILED".into()
            })
        );
    }

    #[test]
    fn parses_events_with_and_without_an_ack_id() {
        assert_eq!(
            parse_frame(r#"42["newMessage",{"a":1}]"#),
            Ok(Frame::Event {
                name: "newMessage".into(),
                payload: json!({"a":1}),
                ack_id: None
            })
        );
        assert_eq!(
            parse_frame(r#"4217["ping"]"#),
            Ok(Frame::Event {
                name: "ping".into(),
                payload: Value::Null,
                ack_id: Some(17)
            })
        );
        assert_eq!(
            parse_frame(r#"42["many",1,2,3]"#),
            Ok(Frame::Event {
                name: "many".into(),
                payload: json!([1, 2, 3]),
                ack_id: None
            })
        );
    }

    #[test]
    fn parses_acks() {
        assert_eq!(
            parse_frame(r#"439["ACK"]"#),
            Ok(Frame::Ack {
                id: 9,
                args: vec![json!("ACK")]
            })
        );
    }

    #[test]
    fn digits_in_the_payload_are_not_an_ack_id() {
        let Ok(Frame::Event { ack_id, name, .. }) = parse_frame(r#"42["7up",7]"#) else {
            panic!("did not parse");
        };
        assert_eq!((ack_id, name.as_str()), (None, "7up"));
    }

    #[test]
    fn engine_control_packets() {
        assert_eq!(parse_frame("2"), Ok(Frame::Ping));
        assert_eq!(parse_frame("3"), Ok(Frame::Pong));
        assert_eq!(parse_frame("1"), Ok(Frame::EngineClose));
        assert_eq!(parse_frame("6"), Ok(Frame::Noop));
        assert_eq!(parse_frame("41"), Ok(Frame::ServerDisconnect));
    }

    #[test]
    fn refuses_what_this_protocol_does_not_have() {
        assert_eq!(parse_frame(""), Err(FrameError::Empty));
        assert_eq!(
            parse_frame(r#"451-["x",{"_placeholder":true,"num":0}]"#),
            Err(FrameError::Binary)
        );
        assert!(matches!(
            parse_frame(r#"42/admin,["x"]"#),
            Err(FrameError::Namespace(_))
        ));
        assert!(matches!(
            parse_frame("42{not json"),
            Err(FrameError::Malformed { .. })
        ));
        assert!(matches!(parse_frame("9"), Err(FrameError::UnknownType(_))));
    }

    #[test]
    fn encodes_what_the_web_client_sends() {
        assert_eq!(
            encode_connect(&json!({"token":"Bearer x"})),
            r#"40{"token":"Bearer x"}"#
        );
        assert_eq!(
            encode_event("presenceOnline", &json!({"idle":false}), None),
            r#"42["presenceOnline",{"idle":false}]"#
        );
        assert_eq!(
            encode_event("subscribeAll", &Value::Null, None),
            r#"42["subscribeAll"]"#
        );
        assert_eq!(
            encode_event("sendMessage", &json!({"x":1}), Some(3)),
            r#"423["sendMessage",{"x":1}]"#
        );
    }

    #[test]
    fn builds_the_socket_url() {
        assert_eq!(
            websocket_url("https://chat.example/"),
            "wss://chat.example/socket.io/?EIO=4&transport=websocket"
        );
        assert_eq!(
            websocket_url("http://a:3000"),
            "ws://a:3000/socket.io/?EIO=4&transport=websocket"
        );
    }
}
