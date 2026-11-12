//! W7-A: the GIF picker's featured list and search, a page at a time, and a message whose whole
//! text is one GIF URL. Against `FakeBackend` (`common/w7_gifs.rs`), plus the URL table.

mod common;

use common::w7_gifs::*;
use common::*;
use semaphore_core::backend::BackendError;
use semaphore_core::model::{GifEmbed, GifResultsView, LoadState, SessionState};
use semaphore_core::text::gif::lone_gif_url;
use semaphore_wire::enums::ErrorCode;
use semaphore_wire::types::MessageDto;
use serde_json::{Value, json};

/// The backend's public settings, with the GIF picker on or off.
fn public_settings(gifs: bool) -> Value {
    json!({
        "name": "Test", "registrationMode": "INVITE_ONLY", "maxFileSizeBytes": 1000,
        "gifSearchEnabled": gifs, "passwordResetEnabled": true, "desktopBrowserLogin": false,
    })
}

/// Signed in to a probed server that offers GIF search.
async fn gifs_rig() -> Rig {
    signed_in_with(true).await
}

/// Signed in to a probed server, with the GIF picker on or off.
async fn signed_in_with(gifs: bool) -> Rig {
    let rig = Rig::new();
    rig.backend
        .w3
        .answer("public_settings", public_settings(gifs));
    rig.core
        .probe_server("http://server".into())
        .await
        .expect("the server answers");
    rig.signed_in().await
}

/// A server that refuses to reach the GIF service.
fn unavailable(message: &str) -> BackendError {
    BackendError {
        status: 503,
        code: ErrorCode::Unavailable,
        message: message.into(),
        retryable: false,
        retry_after_ms: None,
    }
}

fn ids(view: &GifResultsView) -> Vec<String> {
    view.results.iter().map(|gif| gif.id.clone()).collect()
}

fn row(value: Value) -> MessageDto {
    serde_json::from_value(value).expect("a message of the contract")
}

#[test]
fn lone_gif_url_table() {
    // (text, expected URL and lowercased host)
    let table: &[(&str, Option<(&str, &str)>)] = &[
        (
            "https://media.giphy.com/media/abc123/giphy.gif",
            Some((
                "https://media.giphy.com/media/abc123/giphy.gif",
                "media.giphy.com",
            )),
        ),
        (
            "https://media4.giphy.com/media/abc123/giphy.gif",
            Some((
                "https://media4.giphy.com/media/abc123/giphy.gif",
                "media4.giphy.com",
            )),
        ),
        (
            "https://media.tenor.com/abc123/cat.gif",
            Some(("https://media.tenor.com/abc123/cat.gif", "media.tenor.com")),
        ),
        (
            "https://media3.tenor.com/abc123/cat.gif",
            Some((
                "https://media3.tenor.com/abc123/cat.gif",
                "media3.tenor.com",
            )),
        ),
        (
            "https://example.com/images/cat.gif",
            Some(("https://example.com/images/cat.gif", "example.com")),
        ),
        (
            "https://example.com/images/cat.GIF",
            Some(("https://example.com/images/cat.GIF", "example.com")),
        ),
        (
            "https://example.com/images/cat.gif?width=200&quality=80",
            Some((
                "https://example.com/images/cat.gif?width=200&quality=80",
                "example.com",
            )),
        ),
        (
            "check this out https://media.giphy.com/media/abc/giphy.gif",
            None,
        ),
        (
            "https://media.giphy.com/media/abc/giphy.gif look at this",
            None,
        ),
        (
            "https://media.giphy.com/media/abc/giphy.gif https://media.tenor.com/xyz/cat.gif",
            None,
        ),
        ("https://example.com/page.html", None),
        (
            "https://notgiphy.com/media/abc/giphy.gif",
            Some(("https://notgiphy.com/media/abc/giphy.gif", "notgiphy.com")),
        ),
        ("https://notgiphy.com/media/abc/giphy.png", None),
        ("", None),
        ("not a url at all", None),
        ("   \n\t  ", None),
        (
            "  https://media.giphy.com/media/abc/giphy.gif  ",
            Some((
                "https://media.giphy.com/media/abc/giphy.gif",
                "media.giphy.com",
            )),
        ),
        // Two schemes glued together: `new URL()` would take it as one long path.
        (
            "https://media.giphy.com/media/abc/giphy.gifhttps://x.gif",
            None,
        ),
        ("ftp://example.com/cat.gif", None),
        ("https://", None),
        (
            "HTTPS://MEDIA.GIPHY.COM/x",
            Some(("HTTPS://MEDIA.GIPHY.COM/x", "media.giphy.com")),
        ),
        (
            "https://example.com/cat.gif#frag",
            Some(("https://example.com/cat.gif#frag", "example.com")),
        ),
        (
            "https://example.com:8443/a.gif",
            Some(("https://example.com:8443/a.gif", "example.com")),
        ),
        ("https://media.giphy.com.evil.example/x", None),
    ];
    for (text, expected) in table {
        let expected = expected.map(|(url, host)| GifEmbed {
            url: (*url).into(),
            host: (*host).into(),
        });
        assert_eq!(lone_gif_url(text), expected, "{text:?}");
    }
    // Long input is refused at once: no scheme, no URL.
    assert_eq!(lone_gif_url(&"a".repeat(10_000)), None);
}

#[tokio::test]
async fn featured_and_search_are_separate_lists() {
    let rig = gifs_rig().await;
    rig.backend.w4.answer(
        "w7a_featured",
        page_json(&[gif_json("f1", "Featured")], None),
    );
    rig.backend
        .w4
        .answer("w7a_search", page_json(&[gif_json("s1", "Searched")], None));

    rig.core.gifs(String::new());
    rig.core.run_until_idle().await;
    let featured = rig.core.gifs(String::new());
    assert!(featured.enabled);
    assert_eq!(featured.state, LoadState::Ready);
    assert_eq!(ids(&featured), vec!["f1"]);
    assert!(!featured.more);
    let gif = &featured.results[0];
    assert_eq!(gif.title, "Featured");
    assert_eq!(gif.width, 200);
    assert_eq!(gif.height, 150);
    assert!(gif.url.ends_with("/giphy.gif"));

    rig.core.gifs("  cats  ".into());
    rig.core.run_until_idle().await;
    let search = rig.core.gifs("cats".into());
    assert_eq!(search.query, "cats");
    assert_eq!(ids(&search), vec!["s1"]);

    // The featured list is still the featured list, and neither read happened twice.
    assert_eq!(ids(&rig.core.gifs(String::new())), vec!["f1"]);
    assert_eq!(rig.backend.w4.count("w7a_featured"), 1);
    assert_eq!(rig.backend.w4.count("w7a_search"), 1);
    // The query went out trimmed, with the first page's limit and no cursor.
    assert!(
        rig.backend
            .w4
            .calls()
            .iter()
            .any(|call| call == "w7a_search 20  cats"),
        "{:?}",
        rig.backend.w4.calls()
    );
}

#[tokio::test]
async fn a_new_connection_reads_the_gif_lists_again() {
    let rig = gifs_rig().await;
    rig.backend.w4.answer(
        "w7a_featured",
        page_json(&[gif_json("f1", "Featured")], None),
    );
    rig.core.gifs(String::new());
    rig.core.run_until_idle().await;
    assert_eq!(rig.backend.w4.count("w7a_featured"), 1);

    rig.backend
        .w4
        .answer("w7a_featured", page_json(&[gif_json("f2", "Newer")], None));
    rig.core.ingest(dropped());
    rig.core.ingest(connected());
    rig.core.run_until_idle().await;
    // The list reads again when it is next asked for, and shows what the server has now.
    rig.core.gifs(String::new());
    rig.core.run_until_idle().await;

    assert_eq!(rig.backend.w4.count("w7a_featured"), 2);
    assert_eq!(ids(&rig.core.gifs(String::new())), vec!["f2"]);
}

#[tokio::test]
async fn paging_table() {
    // No next: nothing more to read.
    let rig = gifs_rig().await;
    rig.backend
        .w4
        .answer("w7a_featured", page_json(&[gif_json("a", "A")], None));
    rig.core.gifs(String::new());
    rig.core.run_until_idle().await;
    let calls = rig.backend.w4.calls().len();
    rig.core.load_more_gifs(String::new()).await.unwrap();
    assert_eq!(rig.backend.w4.calls().len(), calls, "no second page read");
    assert!(!rig.core.gifs(String::new()).more);

    // Two pages, one result repeated at the seam: it keeps its place once.
    let rig = gifs_rig().await;
    rig.backend.w4.answer(
        "w7a_featured",
        page_json(&[gif_json("a", "A"), gif_json("b", "B")], Some("2")),
    );
    rig.core.gifs(String::new());
    rig.core.run_until_idle().await;
    assert!(rig.core.gifs(String::new()).more);
    rig.backend.w4.answer(
        "w7a_featured",
        page_json(&[gif_json("b", "B"), gif_json("c", "C")], None),
    );
    rig.core.load_more_gifs(String::new()).await.unwrap();
    let view = rig.core.gifs(String::new());
    assert_eq!(ids(&view), vec!["a", "b", "c"]);
    assert!(!view.more);
    assert!(!view.loading_more);
    // The page went out from the cursor the first page gave.
    assert_eq!(
        rig.backend.w4.calls().last().map(String::as_str),
        Some("w7a_featured 20 2")
    );

    // A second load_more while one runs reads nothing more.
    let rig = gifs_rig().await;
    rig.backend
        .w4
        .answer("w7a_featured", page_json(&[gif_json("a", "A")], Some("1")));
    rig.core.gifs(String::new());
    rig.core.run_until_idle().await;
    let hold = rig.backend.w4.hold("w7a_featured");
    rig.backend
        .w4
        .answer("w7a_featured", page_json(&[gif_json("b", "B")], None));
    let first = rig.core.load_more_gifs(String::new());
    let second = rig.core.load_more_gifs(String::new());
    let release = async {
        tokio::task::yield_now().await;
        assert!(
            rig.core.gifs(String::new()).loading_more,
            "the first is running"
        );
        hold.send(()).unwrap();
    };
    let (first, second, ()) = tokio::join!(first, second, release);
    first.unwrap();
    second.unwrap();
    assert_eq!(ids(&rig.core.gifs(String::new())), vec!["a", "b"]);
    assert_eq!(rig.backend.w4.count("w7a_featured"), 2);

    // A failed page keeps what is shown, the cursor, and stops loading.
    let rig = gifs_rig().await;
    rig.backend
        .w4
        .answer("w7a_featured", page_json(&[gif_json("a", "A")], Some("1")));
    rig.core.gifs(String::new());
    rig.core.run_until_idle().await;
    rig.backend.w4.fail_next(
        "w7a_featured",
        unavailable("Failed to reach the GIF service"),
    );
    let error = rig.core.load_more_gifs(String::new()).await.unwrap_err();
    assert!(
        error
            .to_string()
            .contains("Failed to reach the GIF service")
    );
    let view = rig.core.gifs(String::new());
    assert_eq!(ids(&view), vec!["a"]);
    assert!(view.more, "the cursor stays for another try");
    assert!(!view.loading_more);
}

#[tokio::test]
async fn nothing_is_read_when_the_server_offers_no_gifs() {
    let rig = signed_in_with(false).await;
    let mut view = rig.core.gifs("cats".into());
    assert!(!view.enabled);
    assert_eq!(view.state, LoadState::Ready);
    assert!(view.results.is_empty());
    // Even the featured list reads nothing.
    view = rig.core.gifs("   ".into());
    assert!(!view.enabled);
    assert!(
        rig.backend
            .w4
            .calls()
            .iter()
            .all(|call| !call.starts_with("w7a_"))
    );

    // A server this core never probed offers no GIFs either.
    let rig = Rig::new().signed_in().await;
    assert!(!rig.core.gifs(String::new()).enabled);
    assert!(
        rig.backend
            .w4
            .calls()
            .iter()
            .all(|call| !call.starts_with("w7a_"))
    );
}

#[tokio::test]
async fn a_long_query_is_cut_to_fifty() {
    let rig = gifs_rig().await;
    rig.backend.w4.answer("w7a_search", page_json(&[], None));
    let long = "a".repeat(60);
    rig.core.gifs(long.clone());
    rig.core.run_until_idle().await;
    let view = rig.core.gifs(long.clone());
    assert_eq!(view.query, long, "the view keeps the query as given");
    assert_eq!(view.state, LoadState::Ready);
    let call = rig
        .backend
        .w4
        .calls()
        .into_iter()
        .find(|call| call.starts_with("w7a_search"))
        .expect("the search went out");
    let fifty = "a".repeat(50);
    assert_eq!(call.split(' ').nth(3), Some(fifty.as_str()));
    // The key keeps the whole query: the same read isn't sent again.
    rig.core.gifs(long);
    rig.core.run_until_idle().await;
    assert_eq!(rig.backend.w4.count("w7a_search"), 1);
}

#[tokio::test]
async fn an_unavailable_service_fails_the_read_with_its_message() {
    const MESSAGE: &str =
        "GIF search is not configured on this instance. Set GIPHY_API_KEY in .env";
    let rig = gifs_rig().await;
    rig.backend
        .w4
        .fail_next("w7a_featured", unavailable(MESSAGE));
    rig.core.gifs(String::new());
    rig.core.run_until_idle().await;
    match rig.core.gifs(String::new()).state {
        LoadState::Failed { error } => {
            assert!(
                error.message.contains(MESSAGE),
                "the server's message shows: {}",
                error.message
            );
        }
        other => panic!("expected a failed read, got {other:?}"),
    }
}

#[tokio::test]
async fn an_answer_after_sign_out_changes_nothing() {
    let rig = gifs_rig().await;
    rig.backend
        .w4
        .answer("w7a_featured", page_json(&[gif_json("a", "A")], Some("1")));
    rig.core.gifs(String::new());
    rig.core.run_until_idle().await;
    let hold = rig.backend.w4.hold("w7a_featured");
    rig.backend
        .w4
        .answer("w7a_featured", page_json(&[gif_json("late", "Late")], None));
    let more = rig.core.load_more_gifs(String::new());
    let (result, ()) = tokio::join!(more, async {
        tokio::task::yield_now().await;
        rig.core.sign_out().await.unwrap();
        hold.send(()).unwrap();
    });
    assert!(result.is_err(), "an answer for an ended session fails");
    assert!(matches!(rig.core.session(), SessionState::SignedOut));
    assert!(
        rig.core.gifs(String::new()).results.is_empty(),
        "none of the answer landed"
    );
}

#[tokio::test]
async fn a_message_that_is_one_gif_url_carries_it() {
    const GIF: &str = "https://media.giphy.com/media/abc/giphy.gif";
    let mut removed = message_json("g3", "ava", GIF);
    removed["deletedAt"] = json!("2026-09-22T19:00:00.000Z");
    let rows = vec![
        row(message_json("g1", "ava", GIF)),
        row(message_json("g2", "ava", &format!("look at {GIF}"))),
        row(removed),
    ];
    let rig = Rig::new().signed_in().await;
    let rig = rig.open_channel(rows).await;
    assert_eq!(
        rig.row("g1").gif,
        Some(GifEmbed {
            url: GIF.into(),
            host: "media.giphy.com".into(),
        })
    );
    assert_eq!(rig.row("g2").gif, None);
    assert_eq!(rig.row("g3").gif, None, "a removed message carries none");
}
