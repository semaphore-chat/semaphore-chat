//! Message links in the web's path forms, recognised only under the server this client uses.
//!
//! - `/community/C/channel/X?highlight=M`
//! - `/direct-messages/G?highlight=M`
//! - `/direct-messages?group=G&highlight=M`
//!
//! The web app uses a `HashRouter`, so the links it shows and copies carry that route in the
//! fragment, after the server's own path: `https://host/#/community/C/channel/X?highlight=M`
//! (`frontend/src/utils/voiceChannelLink.ts`, `utils/swPush.ts`). Both forms are read.
//!
//! The server is compared by scheme, host and port, parsed, never by string prefix: a link to
//! `https://good.example.evil.com` is not one to `https://good.example`. A link with user info
//! (`https://good.example@evil.com`) is refused outright, and ids are plain tokens, so nothing
//! percent-encoded or dotted gets through to a request path.

use crate::model::{Conversation, MessageLink};

/// Scheme, host and port, with defaults filled in, plus the path the server lives under.
#[derive(Debug, PartialEq, Eq)]
struct Origin {
    scheme: String,
    host: String,
    port: u16,
}

struct Parsed<'a> {
    origin: Origin,
    path: &'a str,
    query: &'a str,
    /// After the `#`, if there is one.
    fragment: Option<&'a str>,
}

fn parse_url(url: &str) -> Option<Parsed<'_>> {
    let url = url.trim();
    let (scheme, rest) = url.split_once("://")?;
    let scheme = scheme.to_ascii_lowercase();
    let default_port = match scheme.as_str() {
        "http" => 80,
        "https" => 443,
        _ => return None,
    };
    let authority_end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let (authority, rest) = rest.split_at(authority_end);
    if authority.contains('@') || authority.is_empty() {
        return None;
    }
    let (host, port) = if let Some(v6) = authority.strip_prefix('[') {
        let (host, after) = v6.split_once(']')?;
        let port = match after {
            "" => None,
            after => Some(after.strip_prefix(':')?),
        };
        (format!("[{}]", host.to_ascii_lowercase()), port)
    } else {
        match authority.rsplit_once(':') {
            Some((host, port)) => (host.to_ascii_lowercase(), Some(port)),
            None => (authority.to_ascii_lowercase(), None),
        }
    };
    let host = host.trim_end_matches('.').to_owned();
    let host_ok = !host.is_empty()
        && (host.starts_with('[')
            || host
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'.' || byte == b'-'));
    if !host_ok {
        return None;
    }
    let port = match port {
        None | Some("") => default_port,
        Some(port) if port.bytes().all(|byte| byte.is_ascii_digit()) => port.parse().ok()?,
        Some(_) => return None,
    };
    let (rest, fragment) = match rest.split_once('#') {
        Some((rest, fragment)) => (rest, Some(fragment)),
        None => (rest, None),
    };
    let (path, query) = rest.split_once('?').unwrap_or((rest, ""));
    Some(Parsed {
        origin: Origin { scheme, host, port },
        path,
        query,
        fragment,
    })
}

/// An id as the server makes them: no separators, escapes or dots.
fn id(value: &str) -> Option<String> {
    let ok = !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_');
    ok.then(|| value.to_owned())
}

fn query_value<'a>(query: &'a str, name: &str) -> Option<&'a str> {
    query
        .split('&')
        .filter_map(|pair| pair.split_once('='))
        .find(|(key, _)| *key == name)
        .map(|(_, value)| value)
}

/// The conversation, and the message if it names one, that `link` points to on the server at
/// `server_url`. `None` for anything else: another server, another kind of page, or garbage.
pub fn parse_message_link(server_url: &str, link: &str) -> Option<MessageLink> {
    let server = parse_url(server_url)?;
    let link = parse_url(link)?;
    if server.origin != link.origin {
        return None;
    }
    // A server under a path keeps its links under it too.
    let base = server.path.trim_end_matches('/');
    let route = link.path.strip_prefix(base)?;
    // The web's HashRouter form: the server's own page, then the route and its query after `#`.
    let (route, query) = match link.fragment {
        Some(fragment) if fragment.starts_with('/') && matches!(route, "" | "/") => {
            fragment.split_once('?').unwrap_or((fragment, ""))
        }
        _ => (route, link.query),
    };
    if !route.starts_with('/') {
        return None;
    }
    let segments: Vec<&str> = route
        .trim_start_matches('/')
        .trim_end_matches('/')
        .split('/')
        .collect();
    let message_id = match query_value(query, "highlight") {
        Some(value) => Some(id(value)?),
        None => None,
    };
    let (community_id, conversation) = match segments.as_slice() {
        ["community", community, "channel", channel] => (
            Some(id(community)?),
            Conversation::Channel { id: id(channel)? },
        ),
        ["direct-messages", group] => (None, Conversation::DirectMessage { id: id(group)? }),
        ["direct-messages"] => (
            None,
            Conversation::DirectMessage {
                id: id(query_value(query, "group")?)?,
            },
        ),
        _ => return None,
    };
    Some(MessageLink {
        community_id,
        conversation,
        message_id,
    })
}
