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
/// Whether `url` is clearly an http or https link with a host: the only kind a server-supplied
/// link (a preview card, a message link) may be handed to the OS's opener as. Strict on purpose,
/// so that what is checked is what the OS reads: the URL standard (and the OS handlers that follow
/// it) strips leading control characters and spaces, drops tabs and newlines anywhere, reads `\`
/// as `/` and `http:host` as `http://host`, so any of those is refused rather than normalised.
pub fn is_web_url(url: &str) -> bool {
    if url
        .chars()
        .any(|c| c.is_control() || c.is_whitespace() || c == '\\' || c == '\u{FEFF}')
    {
        return false;
    }
    let rest = ["https://", "http://"].iter().find_map(|scheme| {
        url.get(..scheme.len())
            .filter(|head| head.eq_ignore_ascii_case(scheme))
            .map(|_| &url[scheme.len()..])
    });
    let Some(rest) = rest else {
        return false;
    };
    // The authority ends at the path, query or fragment; the host follows any user info and
    // comes before any port.
    let authority = rest.split(['/', '?', '#']).next().unwrap_or_default();
    let host = authority.rsplit('@').next().unwrap_or_default();
    let host = if host.starts_with('[') {
        host.split_inclusive(']').next().unwrap_or_default()
    } else {
        host.split(':').next().unwrap_or_default()
    };
    !host.is_empty() && host != "[]"
}

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

#[cfg(test)]
mod tests {
    use super::*;

    const SERVER: &str = "https://chat.example";

    fn channel(community: &str, channel: &str, message: Option<&str>) -> Option<MessageLink> {
        Some(MessageLink {
            community_id: Some(community.into()),
            conversation: Conversation::Channel { id: channel.into() },
            message_id: message.map(Into::into),
        })
    }

    fn dm(group: &str, message: Option<&str>) -> Option<MessageLink> {
        Some(MessageLink {
            community_id: None,
            conversation: Conversation::DirectMessage { id: group.into() },
            message_id: message.map(Into::into),
        })
    }

    #[test]
    fn the_web_path_and_hash_forms_are_read() {
        for link in [
            "https://chat.example/community/c1/channel/x1?highlight=m1",
            "https://chat.example/#/community/c1/channel/x1?highlight=m1",
            "HTTPS://CHAT.EXAMPLE:443/community/c1/channel/x1/?highlight=m1",
            "https://chat.example./community/c1/channel/x1?other=1&highlight=m1",
            "  https://chat.example/community/c1/channel/x1?highlight=m1  ",
        ] {
            assert_eq!(
                parse_message_link(SERVER, link),
                channel("c1", "x1", Some("m1")),
                "{link}"
            );
        }
        assert_eq!(
            parse_message_link(SERVER, "https://chat.example/direct-messages/g1"),
            dm("g1", None)
        );
        assert_eq!(
            parse_message_link(
                SERVER,
                "https://chat.example/#/direct-messages?group=g1&highlight=m2"
            ),
            dm("g1", Some("m2"))
        );
    }

    #[test]
    fn another_server_or_a_lookalike_is_not_this_one() {
        for link in [
            "https://chat.example.evil.com/community/c1/channel/x1",
            "https://evil.com/chat.example/community/c1/channel/x1",
            "https://chat.example@evil.com/community/c1/channel/x1",
            "https://evil.com@chat.example/community/c1/channel/x1",
            "http://chat.example/community/c1/channel/x1",
            "https://chat.example:8443/community/c1/channel/x1",
            "https://chat.example:99999/community/c1/channel/x1",
            "https://chat.example:44a/community/c1/channel/x1",
            "javascript://chat.example/community/c1/channel/x1",
            "https:///community/c1/channel/x1",
            "https://chat_example/community/c1/channel/x1",
            "https://ch\u{e2}t.example/community/c1/channel/x1",
            "chat.example/community/c1/channel/x1",
            "",
        ] {
            assert_eq!(parse_message_link(SERVER, link), None, "{link}");
        }
    }

    #[test]
    fn ids_must_be_plain_tokens() {
        for link in [
            "https://chat.example/community/c1/channel/..",
            "https://chat.example/community/c%2F1/channel/x1",
            "https://chat.example/community/c1/channel/x.1",
            "https://chat.example/community/c1/channel/x1?highlight=m%201",
            "https://chat.example/community/c1/channel/x1?highlight=",
            "https://chat.example/direct-messages?group=",
            "https://chat.example/direct-messages?group=../x",
        ] {
            assert_eq!(parse_message_link(SERVER, link), None, "{link}");
        }
        let long = "a".repeat(129);
        assert_eq!(
            parse_message_link(
                SERVER,
                &format!("https://chat.example/direct-messages/{long}")
            ),
            None
        );
        let longest = "a".repeat(128);
        assert!(
            parse_message_link(
                SERVER,
                &format!("https://chat.example/direct-messages/{longest}")
            )
            .is_some()
        );
    }

    #[test]
    fn only_the_known_routes_are_links() {
        for link in [
            "https://chat.example/",
            "https://chat.example/community/c1",
            "https://chat.example/community/c1/channel",
            "https://chat.example/community/c1/channel/x1/extra",
            "https://chat.example/settings",
            "https://chat.example/#/settings",
            "https://chat.example/#community/c1/channel/x1",
        ] {
            assert_eq!(parse_message_link(SERVER, link), None, "{link}");
        }
    }

    #[test]
    fn a_server_under_a_path_keeps_its_links_under_it() {
        let server = "https://host.example/chat/";
        assert_eq!(
            parse_message_link(server, "https://host.example/chat/direct-messages/g1"),
            dm("g1", None)
        );
        assert_eq!(
            parse_message_link(server, "https://host.example/chat/#/direct-messages/g1"),
            dm("g1", None)
        );
        for link in [
            "https://host.example/direct-messages/g1",
            "https://host.example/chatroom/direct-messages/g1",
        ] {
            assert_eq!(parse_message_link(server, link), None, "{link}");
        }
    }

    #[test]
    fn ipv6_servers_compare_by_address_and_port() {
        let server = "http://[::1]:3000";
        assert_eq!(
            parse_message_link(server, "http://[::1]:3000/direct-messages/g1"),
            dm("g1", None)
        );
        assert_eq!(
            parse_message_link(server, "http://[::1]/direct-messages/g1"),
            None
        );
        assert_eq!(
            parse_message_link(server, "http://[::1]x/direct-messages/g1"),
            None
        );
        assert_eq!(parse_message_link("not a url", "http://[::1]:3000/"), None);
    }
}

#[cfg(test)]
mod web_url_tests {
    use super::is_web_url;

    #[test]
    fn plain_http_and_https_links_are_web_links() {
        for url in [
            "https://example.com",
            "http://example.com",
            "HTTPS://EXAMPLE.COM/",
            "hTtP://example.com/a?b=c#d",
            "https://example.com:8443/path",
            "https://user@example.com/",
            "https://[2001:db8::1]/",
            "https://203.0.113.5/x",
            "https://example.com/a%20b",
            "https://例え.jp/",
        ] {
            assert!(is_web_url(url), "{url:?} refused");
        }
    }

    #[test]
    fn anything_not_clearly_http_is_refused() {
        for url in [
            "",
            "https",
            "https:",
            "https:/",
            "https://",
            "http://",
            "http:///etc/passwd",
            "https:///example.com",
            // No `//`: browsers would still read these as http.
            "http:example.com",
            "https:example.com/x",
            "http:/example.com",
            // Other schemes.
            "file:///etc/passwd",
            "file://attacker/share/x.exe",
            "javascript:alert(1)",
            "data:text/html,x",
            "search-ms:query=x",
            "ms-msdt:/id x",
            "smb://host/share",
            "httpx://example.com",
            "https+x://example.com",
            "xhttps://example.com",
            // Windows paths and shares.
            "\\\\attacker\\share\\x.exe",
            "C:\\Windows\\calc.exe",
            "/etc/passwd",
            // Backslashes anywhere: the URL standard reads them as slashes.
            "https:\\\\example.com",
            "http:/\\example.com",
            "https://example.com\\@evil.example",
            "https://example.com/\\x",
            // Leading or trailing whitespace and control characters.
            " https://example.com",
            "\thttps://example.com",
            "\nhttps://example.com",
            "\u{0}https://example.com",
            "\u{1F}https://example.com",
            "\u{7F}https://example.com",
            "https://example.com ",
            "https://example.com\n",
            "\u{FEFF}https://example.com",
            "\u{3000}https://example.com",
            // Tabs and newlines inside the scheme or anywhere else: the URL standard strips them.
            "ht\ttps://example.com",
            "ht\ntp://example.com",
            "jav\tascript:alert(1)",
            "https://exa\tmple.com",
            "https://example.com/a b",
            "https://example.com/\u{85}",
            // No host.
            "https://@",
            "https://user@/x",
            "https://:443/",
            "https://?q",
            "https://#f",
        ] {
            assert!(!is_web_url(url), "{url:?} accepted");
        }
    }
}
