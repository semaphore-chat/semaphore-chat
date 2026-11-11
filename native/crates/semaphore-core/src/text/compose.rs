//! Composer text to outgoing spans, and spans back to editable text. A port of `mentionParser.ts`:
//! `findMentions`, `getCodeRegions`, `parseMessageWithMentions` and `spansToText`, proved against
//! vectors exported from the web client. Offsets are bytes into the text.

use super::SpanInput;
use super::js::{char_before, find_from, is_name, is_word, trim};
use crate::model::TextStyle;

/// A user the composer can resolve `@name` to.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct UserRef {
    pub id: String,
    pub username: String,
    pub display_name: Option<String>,
}

/// A channel, alias group or custom emoji, resolved by name.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct NamedRef {
    pub id: String,
    pub name: String,
}

/// What the composer can resolve names against.
#[derive(Debug, Clone, Copy, Default)]
pub struct Resolvers<'a> {
    pub users: &'a [UserRef],
    pub channels: &'a [NamedRef],
    pub aliases: &'a [NamedRef],
    pub emojis: &'a [NamedRef],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FoundKind {
    User,
    Special,
    Channel,
}

/// A `@word`, `@here`, `@channel` or `#word` found in text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MentionMatch {
    pub kind: FoundKind,
    pub start: usize,
    pub end: usize,
    pub text: String,
    pub query: String,
}

/// Ranges of fenced and inline code, where nothing is parsed (`getCodeRegions`).
pub fn code_regions(text: &str) -> Vec<(usize, usize)> {
    let mut regions = Vec::new();
    let mut i = 0;
    while i < text.len() {
        if text.as_bytes()[i] == b'`' {
            if text[i..].starts_with("```")
                && let Some(close) = find_from(text, "```", i + 3)
            {
                regions.push((i, close + 3));
                i = close + 3;
                continue;
            }
            // `[^`]+` : at least one non-backtick, then a backtick.
            if let Some(close) = find_from(text, "`", i + 1)
                && close > i + 1
            {
                regions.push((i, close + 1));
                i = close + 1;
                continue;
            }
        }
        i += text[i..].chars().next().map_or(1, char::len_utf8);
    }
    regions
}

fn name_at(text: &str, from: usize) -> usize {
    text[from..]
        .chars()
        .take_while(|c| is_name(*c))
        .map(char::len_utf8)
        .sum()
}

/// `@word` runs: `@` then `\w` then `[\w-]*`, scanned like a global regex.
fn scan(text: &str, sigil: u8, regions: &[(usize, usize)], out: &mut Vec<MentionMatch>) {
    let mut i = 0;
    while i < text.len() {
        if text.as_bytes()[i] == sigil && text[i + 1..].chars().next().is_some_and(is_word) {
            let end = i + 1 + name_at(text, i + 1);
            let inside = regions.iter().any(|&(s, e)| i >= s && end <= e);
            if !inside {
                let query = &text[i + 1..end];
                let kind = if sigil == b'#' {
                    FoundKind::Channel
                } else if query == "here" || query == "channel" {
                    FoundKind::Special
                } else {
                    FoundKind::User
                };
                out.push(MentionMatch {
                    kind,
                    start: i,
                    end,
                    text: text[i..end].to_owned(),
                    query: query.to_owned(),
                });
            }
            i = end;
        } else {
            i += text[i..].chars().next().map_or(1, char::len_utf8);
        }
    }
}

/// Mentions outside code, in text order (`findMentions`).
pub fn find_mentions(text: &str) -> Vec<MentionMatch> {
    let regions = code_regions(text);
    let mut found = Vec::new();
    scan(text, b'@', &regions, &mut found);
    scan(text, b'#', &regions, &mut found);
    found.sort_by_key(|m| m.start);
    found
}

fn span(kind: &str, text: Option<String>) -> SpanInput {
    SpanInput {
        kind: kind.into(),
        text,
        ..SpanInput::default()
    }
}

fn plain(text: &str) -> SpanInput {
    span("PLAINTEXT", Some(text.to_owned()))
}

fn eq_ci(a: &str, b: &str) -> bool {
    a.to_lowercase() == b.to_lowercase()
}

/// A `:shortcode:` that names a known emoji: `[a-z0-9_]{2,32}` between colons.
fn emoji_tokens<'a>(text: &str, emojis: &'a [NamedRef]) -> Vec<(usize, usize, &'a NamedRef)> {
    let mut tokens = Vec::new();
    let mut i = 0;
    while i < text.len() {
        if text.as_bytes()[i] == b':' {
            let run = text[i + 1..]
                .bytes()
                .take_while(|b| matches!(b, b'a'..=b'z' | b'0'..=b'9' | b'_'))
                .count();
            if (2..=32).contains(&run) && text.as_bytes().get(i + 1 + run) == Some(&b':') {
                let end = i + run + 2;
                // The web's `Map` keeps the last of two emojis with one name.
                if let Some(e) = emojis.iter().rev().find(|e| e.name == text[i + 1..end - 1]) {
                    tokens.push((i, end, e));
                }
                i = end;
                continue;
            }
        }
        i += text[i..].chars().next().map_or(1, char::len_utf8);
    }
    tokens
}

enum Token<'a> {
    Mention(MentionMatch),
    Emoji(&'a NamedRef, String),
}

fn parse_mention_run(text: &str, r: &Resolvers) -> Vec<SpanInput> {
    let mut tokens: Vec<(usize, usize, Token)> = find_mentions(text)
        .into_iter()
        .map(|m| (m.start, m.end, Token::Mention(m)))
        .collect();
    if !r.emojis.is_empty() {
        for (s, e, emoji) in emoji_tokens(text, r.emojis) {
            tokens.push((s, e, Token::Emoji(emoji, text[s..e].to_owned())));
        }
    }
    tokens.sort_by_key(|t| t.0);

    let mut spans = Vec::new();
    let mut last = 0;
    for (start, end, token) in tokens {
        if start < last {
            continue;
        }
        if start > last {
            spans.push(plain(&text[last..start]));
        }
        match token {
            Token::Emoji(emoji, literal) => spans.push(SpanInput {
                emoji_id: Some(emoji.id.clone()),
                ..span("EMOJI", Some(literal))
            }),
            Token::Mention(m) => match m.kind {
                FoundKind::User => {
                    if let Some(alias) = r.aliases.iter().find(|a| eq_ci(&a.name, &m.query)) {
                        spans.push(SpanInput {
                            alias_id: Some(alias.id.clone()),
                            ..span("ALIAS_MENTION", Some(format!("@{}", alias.name)))
                        });
                    } else if let Some(user) = r.users.iter().find(|u| eq_ci(&u.username, &m.query))
                    {
                        spans.push(SpanInput {
                            user_id: Some(user.id.clone()),
                            ..span("USER_MENTION", Some(format!("@{}", user.username)))
                        });
                    } else {
                        spans.push(plain(&m.text));
                    }
                }
                FoundKind::Special => spans.push(SpanInput {
                    special_kind: Some(m.query.clone()),
                    ..span("SPECIAL_MENTION", Some(m.text.clone()))
                }),
                FoundKind::Channel => {
                    if let Some(channel) = r.channels.iter().find(|c| eq_ci(&c.name, &m.query)) {
                        // Only the id: the server stores no channel name.
                        spans.push(SpanInput {
                            channel_id: Some(channel.id.clone()),
                            ..span("CHANNEL_MENTION", None)
                        });
                    } else {
                        spans.push(plain(&m.text));
                    }
                }
            },
        }
        last = end;
    }
    if last < text.len() {
        spans.push(plain(&text[last..]));
    }
    spans
}

#[derive(Clone, Copy, Default)]
struct Flags {
    bold: bool,
    italic: bool,
    strikethrough: bool,
}

impl Flags {
    fn style(self, code: bool) -> TextStyle {
        TextStyle {
            bold: self.bold,
            italic: self.italic,
            strikethrough: self.strikethrough,
            code,
        }
    }
    fn get(self, which: usize) -> bool {
        [self.bold, self.strikethrough, self.italic, self.italic][which]
    }
    fn with(mut self, which: usize) -> Self {
        match which {
            0 => self.bold = true,
            1 => self.strikethrough = true,
            _ => self.italic = true,
        }
        self
    }
}

/// Longest first, so `**` is tried before `*`. The index is the flag `Flags::get` reads.
const DELIMITERS: [&str; 4] = ["**", "~~", "*", "_"];

/// The closing marker at or after `from`, skipping empty pairs and, for `_`, intraword ones.
fn find_closing(text: &str, from: usize, marker: &str) -> Option<usize> {
    let mut idx = from;
    while idx + marker.len() <= text.len() {
        let found = find_from(text, marker, idx)?;
        if found == from {
            idx = found + marker.len();
            continue;
        }
        if marker == "_" && text[found + 1..].chars().next().is_some_and(is_word) {
            idx = found + 1;
            continue;
        }
        return Some(found);
    }
    None
}

fn parse_inline(text: &str, flags: Flags, r: &Resolvers, out: &mut Vec<SpanInput>) {
    let mut buffer = String::new();
    let mut i = 0;
    let flush = |buffer: &mut String, out: &mut Vec<SpanInput>| {
        if buffer.is_empty() {
            return;
        }
        for mut s in parse_mention_run(buffer, r) {
            if s.kind == "PLAINTEXT" {
                s.style = flags.style(false);
            }
            out.push(s);
        }
        buffer.clear();
    };

    'scan: while i < text.len() {
        let ch = text[i..].chars().next().expect("i is on a boundary");

        if ch == '`'
            && let Some(close) = find_from(text, "`", i + 1)
            && close > i + 1
        {
            flush(&mut buffer, out);
            let mut code = plain(&text[i + 1..close]);
            code.style = flags.style(true);
            out.push(code);
            i = close + 1;
            continue;
        }

        for (which, marker) in DELIMITERS.iter().enumerate() {
            if flags.get(which) || !text[i..].starts_with(marker) {
                continue;
            }
            if *marker == "_" && char_before(text, i).is_some_and(is_word) {
                continue;
            }
            let Some(close) = find_closing(text, i + marker.len(), marker) else {
                continue;
            };
            flush(&mut buffer, out);
            parse_inline(&text[i + marker.len()..close], flags.with(which), r, out);
            i = close + marker.len();
            continue 'scan;
        }

        buffer.push(ch);
        i += ch.len_utf8();
    }
    flush(&mut buffer, out);
}

/// Drop a fence's blank or bare-language first line and one trailing newline.
fn code_block_content(raw: &str) -> String {
    let mut content = raw;
    if let Some(nl) = raw.find('\n') {
        let first = trim(&raw[..nl]);
        if first.is_empty()
            || first
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '+' | '-'))
        {
            content = &raw[nl + 1..];
        }
    }
    content.strip_suffix('\n').unwrap_or(content).to_owned()
}

/// Composer text with resolved mentions and markdown-style formatting to spans
/// (`parseMessageWithMentions`): `**bold**`, `*italic*` / `_italic_`, `~~strike~~`, inline code and
/// fenced code blocks. Nothing is parsed inside code. Never fails.
pub fn parse_message(text: &str, resolvers: &Resolvers) -> Vec<SpanInput> {
    let mut spans = Vec::new();
    let mut last = 0;
    while let Some(open) = find_from(text, "```", last) {
        let Some(close) = find_from(text, "```", open + 3) else {
            break;
        };
        if open > last {
            parse_inline(&text[last..open], Flags::default(), resolvers, &mut spans);
        }
        spans.push(span(
            "CODE_BLOCK",
            Some(code_block_content(&text[open + 3..close])),
        ));
        last = close + 3;
    }
    if last < text.len() {
        parse_inline(&text[last..], Flags::default(), resolvers, &mut spans);
    }
    spans
}

/// Names a channel id from the channels the reader can see.
pub type ChannelNames<'a> = dyn Fn(&str) -> Option<String> + 'a;

/// Spans back to editable text (`spansToText`). `channel_name` names a `#channel` mention from the
/// channels the reader can see; a channel it doesn't know is `#private-channel`.
pub fn spans_to_text(spans: &[SpanInput], channel_name: Option<&ChannelNames<'_>>) -> String {
    let mut out = String::new();
    for s in spans {
        let text = s.text.as_deref().filter(|t| !t.is_empty());
        match s.kind.as_str() {
            "CHANNEL_MENTION" => {
                let name = s
                    .channel_id
                    .as_deref()
                    .and_then(|id| channel_name.and_then(|f| f(id)))
                    .filter(|n| !n.is_empty());
                out.push('#');
                out.push_str(name.as_deref().unwrap_or("private-channel"));
            }
            "USER_MENTION" => out.push_str(text.unwrap_or("@user")),
            "SPECIAL_MENTION" => match text {
                Some(t) => out.push_str(t),
                None => {
                    out.push('@');
                    out.push_str(s.special_kind.as_deref().unwrap_or_default());
                }
            },
            "COMMUNITY_MENTION" | "ALIAS_MENTION" | "EMOJI" => out.push_str(text.unwrap_or("")),
            "CODE_BLOCK" => {
                out.push_str("```\n");
                out.push_str(s.text.as_deref().unwrap_or(""));
                out.push_str("\n```");
            }
            _ => {
                let t = s.text.as_deref().unwrap_or("");
                if s.style.code {
                    out.push('`');
                    out.push_str(t);
                    out.push('`');
                    continue;
                }
                let mut t = t.to_owned();
                if s.style.strikethrough {
                    t = format!("~~{t}~~");
                }
                if s.style.italic {
                    t = format!("_{t}_");
                }
                if s.style.bold {
                    t = format!("**{t}**");
                }
                out.push_str(&t);
            }
        }
    }
    out
}
