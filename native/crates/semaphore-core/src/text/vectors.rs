//! Runs every vector in `fixtures/text/*.json`, exported from the web client by
//! `tools/web-export/text.test.ts`. A vector is `{name, input, expected}`; the test fails on the
//! first mismatch of each file naming the vector, and on a file with no vectors. Nothing here
//! skips or rewrites a vector: to change one, change the exporter and re-export.

use super::*;
use serde_json::{Value, json};
use std::path::PathBuf;

fn load(file: &str) -> Vec<Value> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/text")
        .join(file);
    let raw = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    let vectors: Vec<Value> = serde_json::from_str(&raw).unwrap();
    assert!(!vectors.is_empty(), "{file} has no vectors");
    vectors
}

/// Runs `f(input)` for each vector and compares with `expected`; collects every mismatch.
fn check(file: &str, f: impl Fn(&Value) -> Value) {
    let mut failures = Vec::new();
    let vectors = load(file);
    for v in &vectors {
        let got = f(&v["input"]);
        if got != v["expected"] {
            failures.push(format!(
                "  {:?}\n    input    {}\n    expected {}\n    got      {}",
                v["name"], v["input"], v["expected"], got
            ));
        }
    }
    assert!(
        failures.is_empty(),
        "{file}: {} of {} vectors fail\n{}",
        failures.len(),
        vectors.len(),
        failures.join("\n")
    );
}

fn s(v: &Value, key: &str) -> String {
    v[key].as_str().unwrap_or_default().to_owned()
}
fn opt(v: &Value, key: &str) -> Option<String> {
    v[key].as_str().map(str::to_owned)
}
fn n(v: &Value, key: &str) -> usize {
    v[key].as_u64().unwrap() as usize
}

fn users(v: &Value) -> Vec<UserRef> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|u| UserRef {
            id: s(u, "id"),
            username: s(u, "username"),
            display_name: opt(u, "displayName"),
        })
        .collect()
}
fn named(v: &Value) -> Vec<NamedRef> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|c| NamedRef {
            id: s(c, "id"),
            name: s(c, "name"),
        })
        .collect()
}

fn span_in(v: &Value) -> SpanInput {
    SpanInput {
        kind: s(v, "type"),
        text: opt(v, "text"),
        user_id: opt(v, "userId"),
        special_kind: opt(v, "specialKind"),
        alias_id: opt(v, "aliasId"),
        channel_id: opt(v, "channelId"),
        emoji_id: opt(v, "emojiId"),
        community_id: opt(v, "communityId"),
        style: TextStyle {
            bold: v["bold"].as_bool().unwrap_or(false),
            italic: v["italic"].as_bool().unwrap_or(false),
            strikethrough: v["strikethrough"].as_bool().unwrap_or(false),
            code: v["code"].as_bool().unwrap_or(false),
        },
    }
}

/// The web's span JSON: absent fields are absent, flags only when true.
fn span_out(sp: &SpanInput) -> Value {
    let mut o = serde_json::Map::new();
    o.insert("type".into(), json!(sp.kind));
    for (key, val) in [
        ("text", &sp.text),
        ("userId", &sp.user_id),
        ("specialKind", &sp.special_kind),
        ("aliasId", &sp.alias_id),
        ("channelId", &sp.channel_id),
        ("emojiId", &sp.emoji_id),
        ("communityId", &sp.community_id),
    ] {
        if let Some(val) = val {
            o.insert(key.into(), json!(val));
        }
    }
    for (key, on) in [
        ("bold", sp.style.bold),
        ("italic", sp.style.italic),
        ("strikethrough", sp.style.strikethrough),
        ("code", sp.style.code),
    ] {
        if on {
            o.insert(key.into(), json!(true));
        }
    }
    Value::Object(o)
}

#[test]
fn parse() {
    check("parse.json", |i| {
        let (u, c, a, e) = (
            users(&i["users"]),
            named(&i["channels"]),
            named(&i["aliases"]),
            named(&i["emojis"]),
        );
        let r = Resolvers {
            users: &u,
            channels: &c,
            aliases: &a,
            emojis: &e,
        };
        Value::Array(
            parse_message(&s(i, "text"), &r)
                .iter()
                .map(span_out)
                .collect(),
        )
    });
}

#[test]
fn find_mentions_vectors() {
    check("find_mentions.json", |i| {
        Value::Array(
            find_mentions(&s(i, "text"))
                .iter()
                .map(|m| {
                    json!({
                        "type": match m.kind {
                            FoundKind::User => "user",
                            FoundKind::Special => "special",
                            FoundKind::Channel => "channel",
                        },
                        "start": m.start, "end": m.end, "text": m.text, "query": m.query,
                    })
                })
                .collect(),
        )
    });
}

#[test]
fn code_regions_vectors() {
    check("code_regions.json", |i| {
        Value::Array(
            code_regions(&s(i, "text"))
                .iter()
                .map(|(a, b)| json!([a, b]))
                .collect(),
        )
    });
}

#[test]
fn spans_to_text_vectors() {
    check("spans_to_text.json", |i| {
        let spans: Vec<SpanInput> = i["spans"].as_array().unwrap().iter().map(span_in).collect();
        let names = i["channels"].as_object().cloned();
        let lookup = |id: &str| {
            names
                .as_ref()
                .and_then(|m| m.get(id))
                .map(|v| v.as_str().unwrap().to_owned())
        };
        let lookup: Option<&ChannelNames<'_>> = if names.is_some() { Some(&lookup) } else { None };
        json!(spans_to_text(&spans, lookup))
    });
}

#[test]
fn current_mention_vectors() {
    check("current_mention.json", |i| {
        match get_current_mention(&s(i, "text"), n(i, "cursor")) {
            None => Value::Null,
            Some(m) => json!({
                "type": match m.kind {
                    Trigger::User => "user",
                    Trigger::Special => "special",
                    Trigger::Channel => "channel",
                },
                "query": m.query, "start": m.start, "end": m.end,
            }),
        }
    });
}

#[test]
fn insert_mention_vectors() {
    check("insert_mention.json", |i| {
        let m = &i["mention"];
        let target = match m["type"].as_str().unwrap() {
            "user" => MentionTarget::User(s(m, "username")),
            "special" => MentionTarget::Special(s(m, "specialKind")),
            "channel" => MentionTarget::Channel(s(m, "channelName")),
            _ => MentionTarget::Alias(s(m, "aliasName")),
        };
        let (text, cursor) = insert_mention(&s(i, "text"), n(i, "cursor"), &target);
        json!({"newText": text, "newCursorPosition": cursor})
    });
}

#[test]
fn resolve_mention_text_vectors() {
    check("resolve_mention_text.json", |i| {
        json!(resolve_mention_text(
            &span_in(&i["span"]),
            &users(&i["users"])
        ))
    });
}

#[test]
fn wrap_selection_vectors() {
    check("wrap_selection.json", |i| {
        let r = wrap_selection(&s(i, "text"), n(i, "start"), n(i, "end"), &s(i, "marker"));
        json!({"newText": r.new_text, "selectionStart": r.selection_start, "selectionEnd": r.selection_end})
    });
}

#[test]
fn marker_for_shortcut_vectors() {
    check("marker_for_shortcut.json", |i| {
        json!(marker_for_shortcut(&s(i, "key")))
    });
}

#[test]
fn link_parts_vectors() {
    check("link_parts.json", |i| {
        Value::Array(
            link_parts(&s(i, "text"))
                .iter()
                .map(|p| json!({"text": p.text, "link": p.link}))
                .collect(),
        )
    });
}

#[test]
fn extract_urls_vectors() {
    check("extract_urls.json", |i| json!(extract_urls(&s(i, "text"))));
}
