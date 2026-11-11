//! Properties of the text code over any input: nothing panics on any text or offset, links cover
//! the text they come from, and a shortcut applied twice gives the text back.

use super::*;
use proptest::prelude::*;
use proptest::test_runner::{Config, RngSeed};

fn config() -> Config {
    Config {
        cases: 512,
        rng_seed: RngSeed::Fixed(0x7e47_0001),
        ..Config::default()
    }
}

/// Text made mostly of what the parsers look for, plus any characters at all.
fn text() -> impl Strategy<Value = String> {
    let piece = prop_oneof![
        Just("http://".to_owned()),
        Just("https://a.b/c".to_owned()),
        Just("**".to_owned()),
        Just("*".to_owned()),
        Just("_".to_owned()),
        Just("~~".to_owned()),
        Just("`".to_owned()),
        Just("```".to_owned()),
        Just("@".to_owned()),
        Just("#".to_owned()),
        Just(":".to_owned()),
        Just("\n".to_owned()),
        Just(" ".to_owned()),
        Just("e\u{301}".to_owned()),
        Just("\u{1F469}\u{200D}\u{1F4BB}".to_owned()),
        "[a-z]{1,5}",
        ".",
    ];
    prop_oneof![
        prop::collection::vec(piece, 0..16).prop_map(|pieces| pieces.concat()),
        ".{0,40}",
    ]
}

proptest! {
    #![proptest_config(config())]

    #[test]
    fn no_text_panics_the_parsers(text in text()) {
        let users = [UserRef { id: "u".into(), username: "ava".into(), display_name: None }];
        let resolvers = Resolvers { users: &users, ..Resolvers::default() };
        let spans = parse_message(&text, &resolvers);
        let _ = spans_to_text(&spans, None);
        let _ = layout_spans(&spans);
        let _ = find_mentions(&text);
        let _ = code_regions(&text);
        let _ = extract_urls(&text);
    }

    #[test]
    fn link_parts_put_together_are_the_text(text in text()) {
        let parts = link_parts(&text);
        let joined: String = parts.iter().map(|part| part.text.as_str()).collect();
        prop_assert_eq!(joined, text);
        for part in parts.iter().filter(|part| part.link) {
            prop_assert!(part.text.starts_with("http://") || part.text.starts_with("https://"));
        }
    }

    #[test]
    fn found_urls_are_in_the_text_and_few(text in text()) {
        let urls = extract_urls(&text);
        prop_assert!(urls.len() <= MAX_URLS_PER_MESSAGE);
        for url in urls {
            prop_assert!(text.contains(&url));
            prop_assert!(url.starts_with("http://") || url.starts_with("https://"));
        }
    }

    #[test]
    fn composer_edits_take_any_offset(text in text(), a in 0usize..80, b in 0usize..80) {
        let _ = get_current_mention(&text, a);
        let (new_text, cursor) = insert_mention(&text, a, &MentionTarget::User("ava".into()));
        prop_assert!(new_text.is_char_boundary(cursor));
        let wrapped = wrap_selection(&text, a.min(b), a.max(b), "**");
        prop_assert!(wrapped.selection_start <= wrapped.selection_end);
        prop_assert!(wrapped.new_text.is_char_boundary(wrapped.selection_start));
        prop_assert!(wrapped.new_text.is_char_boundary(wrapped.selection_end));
    }

    #[test]
    fn a_shortcut_applied_twice_gives_the_text_back(
        text in text(),
        a in 0usize..80,
        b in 0usize..80,
        marker in prop_oneof![Just("**"), Just("*")],
    ) {
        // Markers already beside the selection make the toggle ambiguous (`****` can be read as
        // a pair or as nothing), as on the web: the round trip holds for text without them.
        let text = text.replace('*', "");
        let once = wrap_selection(&text, a.min(b), a.max(b), marker);
        let twice = wrap_selection(&once.new_text, once.selection_start, once.selection_end, marker);
        prop_assert_eq!(twice.new_text, text);
    }
}
