//! The generated icons, checked against what the web client exported.
//!
//! `assets/icons/manifest.json` is the exporter's icon manifest, so these tests compare the Rust
//! the generator wrote with the web's own list, not with the generator's intermediate state.

use crate::Icon;

const ICON_MANIFEST: &str = include_str!("../assets/icons/manifest.json");

// --------------------------------------------------------------------------- JSON

// No dependencies in this crate, so the two committed exports are read with this.
#[derive(Debug, Clone, PartialEq)]
enum Json {
    Null,
    Bool(bool),
    Number(f64),
    String(String),
    Array(Vec<Json>),
    Object(Vec<(String, Json)>),
}

struct Parser<'a> {
    bytes: &'a [u8],
    position: usize,
}

impl<'a> Parser<'a> {
    fn parse(text: &'a str) -> Json {
        let mut parser = Parser {
            bytes: text.as_bytes(),
            position: 0,
        };
        let value = parser.value();
        parser.whitespace();
        assert_eq!(
            parser.position,
            parser.bytes.len(),
            "trailing bytes after the JSON value"
        );
        value
    }

    fn whitespace(&mut self) {
        while matches!(
            self.bytes.get(self.position),
            Some(b' ' | b'\t' | b'\n' | b'\r')
        ) {
            self.position += 1;
        }
    }

    fn peek(&self) -> u8 {
        *self
            .bytes
            .get(self.position)
            .expect("unexpected end of JSON")
    }

    fn expect(&mut self, literal: &str) {
        assert!(
            self.bytes[self.position..].starts_with(literal.as_bytes()),
            "expected {literal} at byte {}",
            self.position
        );
        self.position += literal.len();
    }

    fn value(&mut self) -> Json {
        self.whitespace();
        match self.peek() {
            b'{' => self.object(),
            b'[' => self.array(),
            b'"' => Json::String(self.string()),
            b't' => {
                self.expect("true");
                Json::Bool(true)
            }
            b'f' => {
                self.expect("false");
                Json::Bool(false)
            }
            b'n' => {
                self.expect("null");
                Json::Null
            }
            _ => self.number(),
        }
    }

    fn object(&mut self) -> Json {
        self.expect("{");
        let mut members = Vec::new();
        self.whitespace();
        if self.peek() == b'}' {
            self.position += 1;
            return Json::Object(members);
        }
        loop {
            self.whitespace();
            let key = self.string();
            self.whitespace();
            self.expect(":");
            let value = self.value();
            members.push((key, value));
            self.whitespace();
            match self.peek() {
                b',' => self.position += 1,
                b'}' => {
                    self.position += 1;
                    return Json::Object(members);
                }
                other => panic!(
                    "expected ',' or '}}' at byte {}, found {}",
                    self.position, other as char
                ),
            }
        }
    }

    fn array(&mut self) -> Json {
        self.expect("[");
        let mut items = Vec::new();
        self.whitespace();
        if self.peek() == b']' {
            self.position += 1;
            return Json::Array(items);
        }
        loop {
            items.push(self.value());
            self.whitespace();
            match self.peek() {
                b',' => self.position += 1,
                b']' => {
                    self.position += 1;
                    return Json::Array(items);
                }
                other => panic!(
                    "expected ',' or ']' at byte {}, found {}",
                    self.position, other as char
                ),
            }
        }
    }

    fn string(&mut self) -> String {
        self.expect("\"");
        let mut text = String::new();
        loop {
            let byte = self.peek();
            self.position += 1;
            match byte {
                b'"' => return text,
                b'\\' => {
                    let escape = self.peek();
                    self.position += 1;
                    match escape {
                        b'"' => text.push('"'),
                        b'\\' => text.push('\\'),
                        b'/' => text.push('/'),
                        b'b' => text.push('\u{8}'),
                        b'f' => text.push('\u{c}'),
                        b'n' => text.push('\n'),
                        b'r' => text.push('\r'),
                        b't' => text.push('\t'),
                        b'u' => {
                            let hex =
                                std::str::from_utf8(&self.bytes[self.position..self.position + 4])
                                    .expect("four hex digits");
                            self.position += 4;
                            let code = u32::from_str_radix(hex, 16).expect("hex escape");
                            text.push(char::from_u32(code).expect("a BMP scalar"));
                        }
                        other => panic!("bad escape \\{}", other as char),
                    }
                }
                _ => {
                    // The exports are UTF-8; step back over the byte and copy the character.
                    self.position -= 1;
                    let rest = std::str::from_utf8(&self.bytes[self.position..]).expect("UTF-8");
                    let character = rest.chars().next().expect("a character");
                    self.position += character.len_utf8();
                    text.push(character);
                }
            }
        }
    }

    fn number(&mut self) -> Json {
        let start = self.position;
        while matches!(
            self.bytes.get(self.position),
            Some(b'-' | b'+' | b'.' | b'e' | b'E' | b'0'..=b'9')
        ) {
            self.position += 1;
        }
        let text = std::str::from_utf8(&self.bytes[start..self.position]).expect("UTF-8");
        Json::Number(
            text.parse()
                .unwrap_or_else(|_| panic!("bad number {text:?}")),
        )
    }
}

// -------------------------------------------------------------------------- icons

#[test]
fn every_icon_has_its_svg() {
    for &icon in Icon::ALL {
        let svg = icon.svg();
        assert!(!svg.is_empty(), "{icon:?} has no SVG");
        assert!(
            svg.starts_with(b"<svg"),
            "{icon:?} does not begin with <svg: {:?}",
            String::from_utf8_lossy(&svg[..svg.len().min(32)])
        );
    }
}

#[test]
fn icons_match_the_web_manifest() {
    let json = Parser::parse(ICON_MANIFEST);
    let Json::Object(manifest) = &json else {
        panic!("the manifest is not an object")
    };
    assert_eq!(
        Icon::ALL.len(),
        manifest.len(),
        "Icon::ALL and the manifest disagree on the count"
    );

    for (file, name) in manifest {
        let Json::String(name) = name else {
            panic!("{file} does not map to a name")
        };
        let icon = Icon::ALL
            .iter()
            .find(|icon| format!("{icon:?}") == *name)
            .unwrap_or_else(|| panic!("no Icon::{name}"));
        assert_eq!(icon.asset_path(), format!("icons/{file}"));
    }
}
