//! A reader and writer for the canonical JSON form of the behaviour vectors.
//!
//! Test-only: the crate has no JSON dependency, and the generated vectors hold canonical JSON as
//! strings. The form (see `design/README.md`, "Behaviour") is: object keys sorted by code point,
//! no whitespace, whole numbers in plain decimal, strings with only `"` and `\` escaped, `null`,
//! `true`, `false`, list order kept.
//!
//! [`parse`] accepts exactly that restricted subset and nothing else, so it rejects `-0`, object
//! keys out of order or repeated, whitespace, other escapes, fractions and exponents;
//! [`to_canonical`] writes it. A port's tests build events and params out of these values and
//! serialise their own state and effects the same way, so both sides of the comparison are
//! strings.

use std::fmt::Write as _;

/// One JSON value of the restricted canonical form.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Value {
    Null,
    Bool(bool),
    Int(i64),
    Str(String),
    Array(Vec<Value>),
    Object(Vec<(String, Value)>),
}

impl Value {
    /// An object from its fields; [`to_canonical`] sorts the keys.
    pub(crate) fn object<const N: usize>(fields: [(&str, Value); N]) -> Self {
        Value::Object(
            fields
                .into_iter()
                .map(|(key, value)| (key.to_owned(), value))
                .collect(),
        )
    }

    pub(crate) fn string(text: &str) -> Self {
        Value::Str(text.to_owned())
    }

    pub(crate) fn int(number: i64) -> Self {
        Value::Int(number)
    }
}

/// The canonical JSON form of `value`: sorted keys, no whitespace, whole numbers only.
pub(crate) fn to_canonical(value: &Value) -> String {
    let mut out = String::new();
    write(&mut out, value);
    out
}

fn write(out: &mut String, value: &Value) {
    match value {
        Value::Null => out.push_str("null"),
        Value::Bool(true) => out.push_str("true"),
        Value::Bool(false) => out.push_str("false"),
        Value::Int(number) => {
            let _ = write!(out, "{number}");
        }
        Value::Str(text) => write_string(out, text),
        Value::Array(items) => {
            out.push('[');
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                write(out, item);
            }
            out.push(']');
        }
        Value::Object(fields) => {
            let mut fields: Vec<&(String, Value)> = fields.iter().collect();
            fields.sort_by(|a, b| a.0.cmp(&b.0));
            out.push('{');
            for (index, (key, value)) in fields.into_iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                write_string(out, key);
                out.push(':');
                write(out, value);
            }
            out.push('}');
        }
    }
}

/// Behaviour data has no control characters, so only `"` and `\` need escaping.
fn write_string(out: &mut String, text: &str) {
    out.push('"');
    for char in text.chars() {
        match char {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            char => out.push(char),
        }
    }
    out.push('"');
}

/// Parse one value of the restricted canonical form; anything else is an error.
pub(crate) fn parse(text: &str) -> Result<Value, String> {
    let mut parser = Parser {
        bytes: text.as_bytes(),
        at: 0,
    };
    let value = parser.value()?;
    if parser.at != parser.bytes.len() {
        return Err(format!("trailing input at byte {}", parser.at));
    }
    Ok(value)
}

struct Parser<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl Parser<'_> {
    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.at).copied()
    }

    fn expect(&mut self, byte: u8) -> Result<(), String> {
        if self.peek() == Some(byte) {
            self.at += 1;
            Ok(())
        } else {
            Err(format!("expected {:?} at byte {}", byte as char, self.at))
        }
    }

    fn literal(&mut self, text: &str, value: Value) -> Result<Value, String> {
        if self.bytes[self.at..].starts_with(text.as_bytes()) {
            self.at += text.len();
            Ok(value)
        } else {
            Err(format!("expected {text} at byte {}", self.at))
        }
    }

    fn value(&mut self) -> Result<Value, String> {
        match self.peek() {
            Some(b'{') => self.object(),
            Some(b'[') => self.array(),
            Some(b'"') => self.string().map(Value::Str),
            Some(b't') => self.literal("true", Value::Bool(true)),
            Some(b'f') => self.literal("false", Value::Bool(false)),
            Some(b'n') => self.literal("null", Value::Null),
            Some(b'-' | b'0'..=b'9') => self.int().map(Value::Int),
            Some(byte) => Err(format!("unexpected {:?} at byte {}", byte as char, self.at)),
            None => Err("unexpected end of input".to_owned()),
        }
    }

    fn object(&mut self) -> Result<Value, String> {
        self.expect(b'{')?;
        let mut fields: Vec<(String, Value)> = Vec::new();
        if self.peek() == Some(b'}') {
            self.at += 1;
            return Ok(Value::Object(fields));
        }
        loop {
            let key = self.string()?;
            if let Some((previous, _)) = fields.last() {
                if previous == &key {
                    return Err(format!("duplicate key {key:?}"));
                }
                // Canonical order is by code point, and UTF-8 byte order is code point order.
                if previous.as_str() > key.as_str() {
                    return Err(format!(
                        "key {key:?} is not in sorted order after {previous:?}"
                    ));
                }
            }
            self.expect(b':')?;
            let value = self.value()?;
            fields.push((key, value));
            match self.peek() {
                Some(b',') => self.at += 1,
                Some(b'}') => {
                    self.at += 1;
                    return Ok(Value::Object(fields));
                }
                _ => return Err(format!("expected ',' or '}}' at byte {}", self.at)),
            }
        }
    }

    fn array(&mut self) -> Result<Value, String> {
        self.expect(b'[')?;
        let mut items: Vec<Value> = Vec::new();
        if self.peek() == Some(b']') {
            self.at += 1;
            return Ok(Value::Array(items));
        }
        loop {
            items.push(self.value()?);
            match self.peek() {
                Some(b',') => self.at += 1,
                Some(b']') => {
                    self.at += 1;
                    return Ok(Value::Array(items));
                }
                _ => return Err(format!("expected ',' or ']' at byte {}", self.at)),
            }
        }
    }

    fn string(&mut self) -> Result<String, String> {
        self.expect(b'"')?;
        let mut out: Vec<u8> = Vec::new();
        loop {
            let Some(byte) = self.peek() else {
                return Err("unterminated string".to_owned());
            };
            self.at += 1;
            match byte {
                b'"' => return String::from_utf8(out).map_err(|_| "invalid UTF-8".to_owned()),
                b'\\' => {
                    let Some(escape) = self.peek() else {
                        return Err("unterminated escape".to_owned());
                    };
                    self.at += 1;
                    match escape {
                        b'"' => out.push(b'"'),
                        b'\\' => out.push(b'\\'),
                        _ => return Err(format!("unsupported escape at byte {}", self.at - 1)),
                    }
                }
                0..=0x1f => return Err(format!("control character at byte {}", self.at - 1)),
                byte => out.push(byte),
            }
        }
    }

    fn int(&mut self) -> Result<i64, String> {
        let start = self.at;
        let negative = self.peek() == Some(b'-');
        if negative {
            self.at += 1;
        }
        let digits = self.at;
        while matches!(self.peek(), Some(b'0'..=b'9')) {
            self.at += 1;
        }
        if self.at == digits {
            return Err(format!("expected digits at byte {digits}"));
        }
        if self.at - digits > 1 && self.bytes[digits] == b'0' {
            return Err(format!("leading zero at byte {digits}"));
        }
        if negative && self.bytes[digits] == b'0' {
            // Canonical zero is `0`; the sign is never written.
            return Err(format!("negative zero at byte {start}"));
        }
        let text = std::str::from_utf8(&self.bytes[start..self.at])
            .map_err(|_| "invalid number".to_owned())?;
        text.parse::<i64>()
            .map_err(|_| format!("number out of range: {text}"))
    }
}

/// The fields of an object value.
pub(crate) fn object<'a>(value: &'a Value, what: &str) -> Result<&'a [(String, Value)], String> {
    match value {
        Value::Object(fields) => Ok(fields),
        _ => Err(format!("{what}: expected an object")),
    }
}

/// Split an event, `{"name": {fields}}`, into its name and fields.
pub(crate) fn event(value: &Value) -> Result<(&str, &Value), String> {
    match value {
        Value::Object(fields) if fields.len() == 1 => Ok((fields[0].0.as_str(), &fields[0].1)),
        Value::Object(fields) => Err(format!(
            "an event is an object with one key, got {}",
            fields.len()
        )),
        _ => Err("an event is an object with one key".to_owned()),
    }
}

pub(crate) fn field<'a>(value: &'a Value, key: &str) -> Result<&'a Value, String> {
    match value {
        Value::Object(fields) => fields
            .iter()
            .find(|(name, _)| name.as_str() == key)
            .map(|(_, value)| value)
            .ok_or_else(|| format!("missing field {key}")),
        _ => Err(format!("expected an object with field {key}")),
    }
}

pub(crate) fn text<'a>(value: &'a Value, key: &str) -> Result<&'a str, String> {
    match field(value, key)? {
        Value::Str(text) => Ok(text),
        _ => Err(format!("{key}: expected a string")),
    }
}

pub(crate) fn optional_text<'a>(value: &'a Value, key: &str) -> Result<Option<&'a str>, String> {
    match field(value, key)? {
        Value::Null => Ok(None),
        Value::Str(text) => Ok(Some(text)),
        _ => Err(format!("{key}: expected a string or null")),
    }
}

pub(crate) fn number(value: &Value, key: &str) -> Result<u32, String> {
    match field(value, key)? {
        Value::Int(number) => {
            u32::try_from(*number).map_err(|_| format!("{key}: expected a u32, got {number}"))
        }
        _ => Err(format!("{key}: expected a number")),
    }
}

pub(crate) fn count(value: &Value, key: &str) -> Result<usize, String> {
    match field(value, key)? {
        Value::Int(number) => {
            usize::try_from(*number).map_err(|_| format!("{key}: expected a usize, got {number}"))
        }
        _ => Err(format!("{key}: expected a number")),
    }
}

pub(crate) fn flag(value: &Value, key: &str) -> Result<bool, String> {
    match field(value, key)? {
        Value::Bool(flag) => Ok(*flag),
        _ => Err(format!("{key}: expected a boolean")),
    }
}

pub(crate) fn items<'a>(value: &'a Value, key: &str) -> Result<&'a [Value], String> {
    match field(value, key)? {
        Value::Array(items) => Ok(items),
        _ => Err(format!("{key}: expected an array")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read(text: &str) -> Value {
        parse(text).unwrap_or_else(|error| panic!("{text}: {error}"))
    }

    #[test]
    fn parse_then_write_is_identity() {
        for text in [
            "null",
            "true",
            "false",
            "0",
            "-7",
            "42",
            "\"\"",
            "\"a\"",
            "\"a\\\"b\\\\c\"",
            "\"é ✓\"",
            "[]",
            "{}",
            "[1,[2,\"x\"],true,null]",
            "{\"a\":1,\"b\":[{\"c\":null}]}",
            "{\"action\":null,\"id\":\"a\",\"message\":\"Saved\",\"tone\":\"neutral\"}",
        ] {
            assert_eq!(to_canonical(&read(text)), text);
        }
    }

    #[test]
    fn parse_rejects_negative_zero() {
        assert!(parse("-0").is_err(), "-0 parsed");
        assert!(parse("[-0]").is_err(), "[-0] parsed");
        assert_eq!(to_canonical(&read("0")), "0");
    }

    #[test]
    fn parse_rejects_keys_out_of_sorted_order() {
        assert!(
            parse("{\"b\":1,\"a\":2}").is_err(),
            "keys out of order parsed"
        );
        assert!(parse("{\"a\":1,\"b\":2}").is_ok(), "sorted keys rejected");
    }

    #[test]
    fn parse_rejects_duplicate_keys() {
        assert!(
            parse("{\"a\":1,\"a\":2}").is_err(),
            "a duplicate key parsed"
        );
        assert!(
            parse("{\"a\":1,\"b\":2,\"b\":3}").is_err(),
            "a later duplicate key parsed"
        );
    }

    #[test]
    fn write_sorts_object_keys() {
        let value = Value::object([
            ("token", Value::int(1)),
            ("paused", Value::Bool(false)),
            ("ms", Value::int(4000)),
        ]);
        assert_eq!(
            to_canonical(&value),
            "{\"ms\":4000,\"paused\":false,\"token\":1}"
        );
    }

    #[test]
    fn parse_rejects_what_the_canonical_form_does_not_hold() {
        for (text, why) in [
            ("", "empty input"),
            (" ", "whitespace"),
            (" {} ", "whitespace"),
            ("{\"a\":1,}", "trailing comma"),
            ("[1,]", "trailing comma"),
            ("\"unterminated", "unterminated string"),
            ("\"a\\nb\"", "an escape the generator never emits"),
            ("\"a\nb\"", "a control character"),
            ("01", "a leading zero"),
            ("-", "a bare sign"),
            ("+1", "a plus sign"),
            ("1.5", "a fraction"),
            ("{}x", "trailing input"),
            ("{\"a\":1,\"a\":2}", "a duplicate key"),
            ("nul", "a bad literal"),
            ("99999999999999999999", "a number out of range"),
            ("{\"a\" 1}", "a missing colon"),
            ("[1 2]", "a missing comma"),
            ("{\"a\":}", "a missing value"),
        ] {
            assert!(parse(text).is_err(), "{text:?} ({why}) parsed");
        }
    }

    #[test]
    fn accessors_read_typed_fields() {
        let value = read(
            "{\"count\":3,\"flag\":true,\"id\":\"a\",\"maybe\":null,\"rows\":[1,2],\"text\":\"Saved\"}",
        );
        assert_eq!(count(&value, "count"), Ok(3));
        assert_eq!(number(&value, "count"), Ok(3));
        assert_eq!(flag(&value, "flag"), Ok(true));
        assert_eq!(text(&value, "id"), Ok("a"));
        assert_eq!(optional_text(&value, "maybe"), Ok(None));
        assert_eq!(optional_text(&value, "id"), Ok(Some("a")));
        assert_eq!(
            items(&value, "rows"),
            Ok(&[Value::Int(1), Value::Int(2)][..])
        );
        assert!(number(&value, "flag").is_err(), "a boolean is not a number");
        assert!(number(&value, "maybe").is_err(), "null is not a number");
        assert!(flag(&value, "id").is_err(), "a string is not a boolean");
        assert!(text(&value, "count").is_err(), "a number is not a string");
        assert!(items(&value, "id").is_err(), "a string is not an array");
        assert!(field(&value, "missing").is_err(), "a missing field");
        assert!(object(&value, "value").is_ok());
        assert!(object(&Value::Null, "value").is_err());
    }

    #[test]
    fn event_requires_exactly_one_key() {
        let value = read("{\"open\":{\"id\":\"a\"}}");
        let (name, fields) = event(&value).unwrap();
        assert_eq!(name, "open");
        assert_eq!(text(fields, "id"), Ok("a"));
        for text in ["{}", "{\"a\":1,\"b\":2}", "[]", "\"open\""] {
            assert!(event(&read(text)).is_err(), "{text} is not an event");
        }
    }

    #[test]
    fn strings_survive_multi_byte_characters() {
        let value = read("\"Café \\\"quoted\\\" ✓\"");
        assert_eq!(value, Value::Str("Café \"quoted\" ✓".to_owned()));
        assert_eq!(to_canonical(&value), "\"Café \\\"quoted\\\" ✓\"");
    }
}
