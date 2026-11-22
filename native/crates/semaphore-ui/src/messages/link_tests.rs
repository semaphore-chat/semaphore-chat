//! No message link reaches the app except through `MessageText`'s `on_link` or `check_link`.
//!
//! A source check, like `media_tests::only_third_party_rs_calls_gif_or_link_image`: every file that
//! draws messages (the list, its rows, threads, pins and search, the composer) is read, and
//! `MessageListEvent::OpenLink` may be built in exactly two places in `row.rs`, both with a
//! checked address. Nothing here opens a URL itself.

use std::prelude::rust_2024::test;

const SOURCES: &[(&str, &str)] = &[
    ("messages/actions.rs", include_str!("actions.rs")),
    ("messages/announce.rs", include_str!("announce.rs")),
    ("messages/format.rs", include_str!("format.rs")),
    ("messages/icons.rs", include_str!("icons.rs")),
    ("messages/media.rs", include_str!("media.rs")),
    ("messages/palette.rs", include_str!("palette.rs")),
    ("messages/row.rs", include_str!("row.rs")),
    ("messages/seen.rs", include_str!("seen.rs")),
    ("messages/segments.rs", include_str!("segments.rs")),
    ("messages/selection.rs", include_str!("selection.rs")),
    ("messages/store.rs", include_str!("store.rs")),
    ("messages/text.rs", include_str!("text.rs")),
    ("messages/third_party.rs", include_str!("third_party.rs")),
    ("messages/view.rs", include_str!("view.rs")),
    ("thread/mod.rs", include_str!("../thread/mod.rs")),
    ("panel/mod.rs", include_str!("../panel/mod.rs")),
    ("panel/common.rs", include_str!("../panel/common.rs")),
    ("panel/pins.rs", include_str!("../panel/pins.rs")),
    ("panel/search.rs", include_str!("../panel/search.rs")),
    ("composer/view.rs", include_str!("../composer/view.rs")),
    ("composer/menu.rs", include_str!("../composer/menu.rs")),
    ("kit/chat/text.rs", include_str!("../kit/chat/text.rs")),
    (
        "kit/chat/link_card.rs",
        include_str!("../kit/chat/link_card.rs"),
    ),
    ("kit/chat/row.rs", include_str!("../kit/chat/row.rs")),
];

/// The source without `//` comments, so prose about these calls doesn't count.
fn code(source: &str) -> String {
    source
        .lines()
        .map(|line| line.split("//").next().unwrap_or_default())
        .collect::<Vec<_>>()
        .join("\n")
}

#[test]
fn nothing_that_draws_messages_opens_a_url_itself() {
    for (name, source) in SOURCES {
        let code = code(source);
        for call in ["open_url(", "is_web_url(", "link_parts(", "extract_urls("] {
            assert!(
                !code.contains(call),
                "{name} calls `{call}`: message links open only through on_link and check_link"
            );
        }
    }
}

#[test]
fn open_link_is_built_only_from_a_checked_address() {
    let mut built = Vec::new();
    for (name, source) in SOURCES {
        let code = code(source);
        for (at, _) in code.match_indices("OpenLink {") {
            // The struct literal up to its close, on one line whatever rustfmt did with it.
            let literal = code[at..].split('}').next().unwrap_or_default();
            let literal = literal.split_whitespace().collect::<Vec<_>>().join(" ");
            built.push((*name, literal));
        }
    }
    // The event's own definition, and the two places a row emits it.
    let emitted: Vec<_> = built
        .iter()
        .filter(|(name, _)| *name != "messages/view.rs")
        .collect();
    assert_eq!(
        emitted.len(),
        2,
        "OpenLink is built only in row.rs's on_link handler and open_checked: {built:?}"
    );
    for (name, line) in emitted {
        assert_eq!(*name, "messages/row.rs", "{line}");
        assert!(
            line.contains("url: link.href") || line.contains("url: href.to_owned()"),
            "OpenLink must carry check_link's address: {line}"
        );
    }
    let view = code(include_str!("view.rs"));
    assert_eq!(
        view.matches("OpenLink {").count(),
        1,
        "view.rs only defines OpenLink"
    );
    // The two sources of that address: MessageText's on_link (its checked href) and check_link.
    let row = code(include_str!("row.rs"));
    assert!(row.contains(".on_link(move |href, _, cx|"));
    assert!(row.contains("if let Some(link) = check_link(url)"));
    let text = code(include_str!("../kit/chat/text.rs"));
    assert!(text.contains("match check_link(href)"));
    // A link piece carries the checked address, and that is what on_link is handed.
    assert!(text.contains("href: link.href"));
}
