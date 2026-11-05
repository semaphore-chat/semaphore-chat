//! The generated tokens and icons, checked against what the web client exported.
//!
//! `data/tokens.json` is the exporter's own JSON (`tools/web-export/out/theme/tokens.json`) and
//! `assets/icons/manifest.json` its icon manifest, so these tests compare the Rust the generator
//! wrote with the web's values, not with the generator's own intermediate state.

use crate::{Accent, Icon, Intensity, Mode, Rgba, Tokens, tokens};

const TOKENS_JSON: &str = include_str!("../data/tokens.json");
const ICON_MANIFEST: &str = include_str!("../assets/icons/manifest.json");

/// Palette leaves that are not colours (see `tools/gen-design/gen_design.py`).
const NON_COLOUR_LEAVES: [&str; 3] = ["mode", "background.ground", "background.canvas"];

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

fn member<'a>(value: &'a Json, key: &str) -> &'a Json {
    match value {
        Json::Object(members) => {
            &members
                .iter()
                .find(|(member, _)| member == key)
                .unwrap_or_else(|| panic!("no {key:?} in the JSON"))
                .1
        }
        other => panic!("expected an object, found {other:?}"),
    }
}

// ------------------------------------------------------------------------ colours

/// `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb(...)` and `rgba(...)` as `0xRRGGBBAA`, exactly as
/// `tools/gen-design/gen_design.py` parses them.
fn parse_color(value: &str) -> Option<u32> {
    let value = value.trim();
    if let Some(hex) = value.strip_prefix('#') {
        let digits: Vec<u32> = hex
            .chars()
            .map(|digit| digit.to_digit(16))
            .collect::<Option<_>>()?;
        let (r, g, b, a) = match digits.len() {
            3 => (digits[0] * 17, digits[1] * 17, digits[2] * 17, 255),
            6 | 8 => (
                digits[0] * 16 + digits[1],
                digits[2] * 16 + digits[3],
                digits[4] * 16 + digits[5],
                if digits.len() == 8 {
                    digits[6] * 16 + digits[7]
                } else {
                    255
                },
            ),
            _ => return None,
        };
        return Some((r << 24) | (g << 16) | (b << 8) | a);
    }
    let inner = value
        .strip_prefix("rgba(")
        .or_else(|| value.strip_prefix("rgb("))?;
    let inner = inner.strip_suffix(')')?;
    let parts: Vec<&str> = inner.split(',').map(str::trim).collect();
    if parts.len() != 3 && parts.len() != 4 {
        return None;
    }
    let channel = |part: &str| part.parse::<u32>().ok().filter(|channel| *channel <= 255);
    let r = channel(parts[0])?;
    let g = channel(parts[1])?;
    let b = channel(parts[2])?;
    let a = match parts.get(3) {
        // The same rounding as the generator: the nearest of 256 steps.
        Some(alpha) => (alpha.parse::<f64>().ok()? * 255.0 + 0.5)
            .floor()
            .clamp(0.0, 255.0) as u32,
        None => 255,
    };
    Some((r << 24) | (g << 16) | (b << 8) | a)
}

// ------------------------------------------------------------------------- themes

fn web_name(value: impl std::fmt::Debug) -> String {
    format!("{value:?}").to_lowercase()
}

/// Every palette colour of one exported theme as `(palette path, colour)`, sorted.
fn exported_palette(theme: &Json) -> Vec<(String, u32)> {
    let mut leaves = Vec::new();
    flatten("", theme, &mut leaves);
    let mut colours: Vec<(String, u32)> = leaves
        .into_iter()
        .filter(|(path, _)| !NON_COLOUR_LEAVES.contains(&path.as_str()))
        .map(|(path, value)| {
            let colour = parse_color(&value).unwrap_or_else(|| {
                panic!("{path}: {value:?} is not a colour, so the crate disagrees with the export")
            });
            (path, colour)
        })
        .collect();
    colours.sort();
    colours
}

fn flatten(path: &str, value: &Json, out: &mut Vec<(String, String)>) {
    match value {
        Json::Object(members) => {
            for (key, member) in members {
                let child = if path.is_empty() {
                    key.clone()
                } else {
                    format!("{path}.{key}")
                };
                flatten(&child, member, out);
            }
        }
        Json::String(text) => out.push((path.to_string(), text.clone())),
        // Numbers (opacities, thresholds) are not colours; nothing else is expected.
        Json::Number(_) | Json::Bool(_) | Json::Null => {}
        Json::Array(_) => panic!("{path} is an array; palettes are flat leaves"),
    }
}

/// One theme's [`Tokens`] as `(palette path, colour)`, sorted, the same shape as
/// [`exported_palette`].
fn generated_palette(tokens: &Tokens) -> Vec<(String, u32)> {
    tokens
        .fields()
        .iter()
        .filter_map(|(path, value)| value.map(|Rgba(colour)| (path.to_string(), colour)))
        .collect()
}

fn combos() -> Vec<(Mode, Accent, Intensity, String)> {
    let mut all = Vec::new();
    for &mode in Mode::ALL {
        for &accent in Accent::ALL {
            for &intensity in Intensity::ALL {
                let key = format!(
                    "{}-{}-{}",
                    web_name(mode),
                    web_name(accent),
                    web_name(intensity)
                );
                all.push((mode, accent, intensity, key));
            }
        }
    }
    all
}

#[test]
fn every_theme_matches_the_web_export() {
    let json = Parser::parse(TOKENS_JSON);
    let themes = member(&json, "themes");
    let Json::Object(exported) = themes else {
        panic!("themes is not an object")
    };
    assert_eq!(exported.len(), 72, "the export does not hold 72 themes");

    let combos = combos();
    assert_eq!(combos.len(), 72);

    let mut resolved = Vec::with_capacity(combos.len());
    for (mode, accent, intensity, key) in &combos {
        let expected = exported_palette(member(themes, key));
        let theme = tokens(*mode, *accent, *intensity);
        assert_eq!(
            generated_palette(theme),
            expected,
            "{key}: crates/semaphore-design disagrees with the web export"
        );
        resolved.push((*theme, expected));
    }

    // Distinct exactly where the web's own palettes are: no two combinations collapse in Rust
    // that the web keeps apart, and none differ in Rust where the web's output is identical.
    for (index, (theme, palette)) in resolved.iter().enumerate() {
        for (other, (other_theme, other_palette)) in resolved.iter().enumerate().skip(index + 1) {
            assert_eq!(
                palette == other_palette,
                theme == other_theme,
                "{} and {} are {} in the export but {} in Rust",
                combos[index].3,
                combos[other].3,
                if palette == other_palette {
                    "identical"
                } else {
                    "different"
                },
                if theme == other_theme {
                    "identical"
                } else {
                    "different"
                },
            );
        }
    }
}

#[test]
fn spot_checks_the_dark_and_light_palettes() {
    let json = Parser::parse(TOKENS_JSON);
    let themes = member(&json, "themes");
    let colour = |theme: &str, path: &str| {
        exported_palette(member(themes, theme))
            .into_iter()
            .find(|(leaf, _)| leaf == path)
            .unwrap_or_else(|| panic!("{theme} has no {path}"))
            .1
    };

    let dark_teal = tokens(Mode::Dark, Accent::Teal, Intensity::Balanced);
    assert_eq!(
        dark_teal.primary_main.0,
        colour("dark-teal-balanced", "primary.main")
    );
    assert_eq!(
        dark_teal.background_default.0,
        colour("dark-teal-balanced", "background.default")
    );

    let light_blue = tokens(Mode::Light, Accent::Blue, Intensity::Vibrant);
    assert_eq!(
        light_blue.primary_main.0,
        colour("light-blue-vibrant", "primary.main")
    );
    assert_eq!(
        light_blue.background_default.0,
        colour("light-blue-vibrant", "background.default")
    );
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
