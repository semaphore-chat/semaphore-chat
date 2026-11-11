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
    // Schemes are case-insensitive: `HTTPS://host` is a server URL too.
    let rest_after = |scheme: &str| {
        base.get(..scheme.len())
            .filter(|prefix| prefix.eq_ignore_ascii_case(scheme))
            .map(|_| &base[scheme.len()..])
    };
    let base = rest_after("https://")
        .map(|rest| format!("wss://{rest}"))
        .or_else(|| rest_after("http://").map(|rest| format!("ws://{rest}")))
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

    fn malformed_frame(text: &str) -> bool {
        matches!(parse_frame(text), Err(FrameError::Malformed { .. }))
    }

    #[test]
    fn a_bad_open_packet_is_malformed() {
        for text in [
            "0",
            "0{",
            "0[]",
            r#"0{"pingInterval":1,"pingTimeout":1}"#,
            r#"0{"sid":"a","pingTimeout":1}"#,
            r#"0{"sid":"a","pingInterval":1}"#,
            r#"0{"sid":7,"pingInterval":1,"pingTimeout":1}"#,
            r#"0{"sid":"a","pingInterval":-1,"pingTimeout":1}"#,
            r#"0{"sid":"a","pingInterval":"25000","pingTimeout":1}"#,
        ] {
            assert!(malformed_frame(text), "{text:?}");
        }
    }

    #[test]
    fn socket_packets_with_missing_or_wrong_parts_are_malformed() {
        for text in [
            "4",
            "40",
            "40{}",
            r#"40{"sid":1}"#,
            "42",
            "42[]",
            r#"42{"a":1}"#,
            "42[1]",
            "42[null]",
            r#"42[["x"]]"#,
            "4217",
            "43",
            r#"43["ACK"]"#,
            "439",
            r#"439{"a":1}"#,
            "44",
            "44not json",
            r#"4299999999999999999999999["x"]"#,
        ] {
            assert!(malformed_frame(text), "{text:?}");
        }
    }

    #[test]
    fn a_refusal_without_a_message_is_still_a_refusal() {
        assert_eq!(
            parse_frame("44{}"),
            Ok(Frame::ConnectRefused {
                message: String::new()
            })
        );
        assert_eq!(
            parse_frame(r#"44{"message":5}"#),
            Ok(Frame::ConnectRefused {
                message: String::new()
            })
        );
    }

    #[test]
    fn unknown_socket_packet_types_and_namespaces_are_refused() {
        assert!(matches!(
            parse_frame("47[]"),
            Err(FrameError::UnknownType(_))
        ));
        assert!(matches!(parse_frame("4x"), Err(FrameError::UnknownType(_))));
        assert_eq!(parse_frame("46"), Err(FrameError::Binary));
        assert!(matches!(
            parse_frame("40/admin,{}"),
            Err(FrameError::Namespace(_))
        ));
        assert!(matches!(
            parse_frame("41/admin,"),
            Err(FrameError::Namespace(_))
        ));
        for text in ["7", "a", "\u{e9}", " 2", "\u{0}"] {
            assert!(
                matches!(parse_frame(text), Err(FrameError::UnknownType(_))),
                "{text:?}"
            );
        }
    }

    #[test]
    fn engine_packets_ignore_what_follows_their_type() {
        assert_eq!(parse_frame("2probe"), Ok(Frame::Ping));
        assert_eq!(parse_frame("3probe"), Ok(Frame::Pong));
        assert_eq!(parse_frame("5"), Ok(Frame::Noop));
        assert_eq!(parse_frame("41anything"), Ok(Frame::ServerDisconnect));
    }

    #[test]
    fn an_event_with_one_null_argument_reads_as_no_payload() {
        assert_eq!(
            parse_frame(r#"42["x",null]"#),
            Ok(Frame::Event {
                name: "x".into(),
                payload: Value::Null,
                ack_id: None
            })
        );
    }

    #[test]
    fn an_ack_id_of_zero_and_the_largest_id_parse() {
        assert_eq!(
            parse_frame(r#"430[]"#),
            Ok(Frame::Ack {
                id: 0,
                args: vec![]
            })
        );
        assert_eq!(
            parse_frame(&format!("43{}[]", u64::MAX)),
            Ok(Frame::Ack {
                id: u64::MAX,
                args: vec![]
            })
        );
    }

    #[test]
    fn a_long_malformed_frame_is_cut_in_the_error() {
        let text = format!("42{}", "x".repeat(10_000));
        let Err(FrameError::Malformed { frame, .. }) = parse_frame(&text) else {
            panic!("not malformed");
        };
        assert_eq!(frame.chars().count(), 120);
        // A cut never lands inside a character.
        let text = format!("42{}", "\u{1F600}".repeat(500));
        assert!(malformed_frame(&text));
    }

    #[test]
    fn the_socket_url_ignores_scheme_case() {
        assert_eq!(
            websocket_url("HTTPS://chat.example"),
            "wss://chat.example/socket.io/?EIO=4&transport=websocket"
        );
        assert_eq!(
            websocket_url("Http://a:3000///"),
            "ws://a:3000/socket.io/?EIO=4&transport=websocket"
        );
        assert_eq!(
            websocket_url("wss://a"),
            "wss://a/socket.io/?EIO=4&transport=websocket"
        );
        assert_eq!(
            websocket_url("https://a/chat/"),
            "wss://a/chat/socket.io/?EIO=4&transport=websocket"
        );
    }

    mod properties {
        use super::*;
        use proptest::prelude::*;
        use proptest::test_runner::{Config, RngSeed};

        fn config() -> Config {
            Config {
                cases: 512,
                rng_seed: RngSeed::Fixed(0x5e3a_7102),
                ..Config::default()
            }
        }

        fn json() -> impl Strategy<Value = Value> {
            let leaf = prop_oneof![
                Just(Value::Null),
                any::<bool>().prop_map(Value::Bool),
                any::<i64>().prop_map(Value::from),
                ".{0,12}".prop_map(Value::String),
            ];
            leaf.prop_recursive(3, 24, 4, |inner| {
                prop_oneof![
                    prop::collection::vec(inner.clone(), 0..4).prop_map(Value::Array),
                    prop::collection::btree_map("[a-z]{0,6}", inner, 0..4)
                        .prop_map(|map| Value::Object(map.into_iter().collect())),
                ]
            })
        }

        proptest! {
            #![proptest_config(config())]

            #[test]
            fn any_text_parses_or_errs_without_panicking(text in ".{0,64}") {
                let _ = parse_frame(&text);
            }

            #[test]
            fn any_text_after_a_socket_prefix_parses_or_errs(kind in "[0-9]", text in ".{0,64}") {
                let _ = parse_frame(&format!("4{kind}{text}"));
                let _ = parse_frame(&format!("0{text}"));
            }

            #[test]
            fn an_encoded_event_reads_back_as_itself(
                name in ".{0,16}",
                payload in json(),
                ack_id in proptest::option::of(any::<u64>()),
            ) {
                let frame = parse_frame(&encode_event(&name, &payload, ack_id));
                // Arrays are kept as one argument when there are more of them; a single array is
                // still the one payload.
                prop_assert_eq!(frame, Ok(Frame::Event { name, payload, ack_id }));
            }

            #[test]
            fn an_encoded_connect_carries_its_auth(auth in json()) {
                let packet = encode_connect(&auth);
                prop_assert!(packet.starts_with("40"));
                prop_assert_eq!(serde_json::from_str::<Value>(&packet[2..]).unwrap(), auth);
            }
        }
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
