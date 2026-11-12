//! The owner's third-party media decision: one setting ("Load images from other sites: link
//! previews, GIFs"), off by default, which the host stores and core only remembers. Views say what
//! waits for consent, and the GIF picker reads nothing meanwhile.

mod common;

use common::*;
use semaphore_core::model::{Conversation, GifResultsView, MessageRow, SessionState};
use semaphore_core::text::gif::url_host;
use semaphore_wire::types::MessageDto;
use serde_json::{Value, json};

fn public_settings(gifs: bool) -> Value {
    json!({
        "name": "Test", "registrationMode": "INVITE_ONLY", "maxFileSizeBytes": 1000,
        "gifSearchEnabled": gifs, "passwordResetEnabled": true, "desktopBrowserLogin": false,
    })
}

fn gif_page(ids: &[&str]) -> Value {
    json!({
        "results": ids.iter().map(|id| json!({
            "id": id, "title": format!("GIF {id}"),
            "url": format!("https://media.giphy.com/media/{id}/giphy.gif"),
            "previewUrl": format!("https://media.giphy.com/media/{id}/preview.gif"),
            "width": 200, "height": 150,
        })).collect::<Vec<_>>(),
    })
}

async fn gif_rig(gifs: bool) -> Rig {
    let rig = Rig::new();
    rig.backend
        .w3
        .answer("public_settings", public_settings(gifs));
    rig.core.probe_server("http://server".into()).await.unwrap();
    rig.signed_in().await
}

fn results(view: &GifResultsView) -> Vec<String> {
    view.results.iter().map(|gif| gif.id.clone()).collect()
}

#[tokio::test]
async fn the_picker_asks_first_and_reads_nothing_while_third_party_images_are_off() {
    let rig = gif_rig(true).await;
    rig.backend.w4.answer("w7a_featured", gif_page(&["gif-1"]));
    assert!(!rig.core.third_party_media(), "off by default");

    let view = rig.core.gifs(String::new());
    assert!(view.enabled, "the server offers GIFs");
    assert!(view.needs_permission);
    assert!(view.results.is_empty());
    assert!(!view.more);
    rig.core.run_until_idle().await;
    assert_eq!(
        rig.backend.w4.count("w7a_featured"),
        0,
        "no list is read while the setting is off"
    );
    // Nor does a search read.
    rig.core.gifs("cats".into());
    rig.core.run_until_idle().await;
    assert_eq!(rig.backend.w4.count("w7a_search"), 0);

    // Enabling it is one call: the same view now reads and shows the results.
    rig.events.take();
    rig.core.set_third_party_media(true);
    assert!(rig.core.third_party_media());
    assert!(
        rig.events.take().iter().any(|event| matches!(
            event,
            semaphore_core::platform::CoreEvent::ViewChanged {
                view: semaphore_core::model::ViewKey::Gifs { query }
            } if query.is_empty()
        )),
        "the picker is told to read again"
    );
    let view = rig.core.gifs(String::new());
    assert!(!view.needs_permission);
    rig.core.run_until_idle().await;
    let view = rig.core.gifs(String::new());
    assert_eq!(results(&view), vec!["gif-1"]);
    assert!(rig.backend.w4.count("w7a_featured") > 0);
}

#[tokio::test]
async fn turning_it_off_again_hides_the_results_and_reads_no_more() {
    let rig = gif_rig(true).await;
    rig.core.set_third_party_media(true);
    rig.backend
        .w4
        .answer("w7a_featured", gif_page(&["gif-1", "gif-2"]));
    rig.core.gifs(String::new());
    rig.core.run_until_idle().await;
    assert_eq!(results(&rig.core.gifs(String::new())).len(), 2);
    let reads = rig.backend.w4.count("w7a_featured");

    rig.core.set_third_party_media(false);
    let view = rig.core.gifs(String::new());
    assert!(view.needs_permission);
    assert!(view.results.is_empty(), "a blocked picker shows no grid");
    rig.core.run_until_idle().await;
    assert_eq!(rig.backend.w4.count("w7a_featured"), reads);

    // Setting the value it already has says nothing and reads nothing.
    rig.events.take();
    rig.core.set_third_party_media(false);
    assert!(rig.events.take().is_empty());
}

#[tokio::test]
async fn a_server_without_gifs_stays_hidden_whatever_the_setting() {
    let rig = gif_rig(false).await;
    for allowed in [false, true] {
        rig.core.set_third_party_media(allowed);
        let view = rig.core.gifs(String::new());
        assert!(!view.enabled);
        assert!(!view.needs_permission, "nothing to ask about");
    }
    rig.core.run_until_idle().await;
    assert_eq!(rig.backend.w4.count("w7a_featured"), 0);
}

#[tokio::test]
async fn the_setting_outlives_a_session() {
    let rig = gif_rig(true).await;
    rig.core.set_third_party_media(true);
    rig.core.sign_out().await.unwrap();
    assert_eq!(rig.core.session(), SessionState::SignedOut);
    assert!(
        rig.core.third_party_media(),
        "this install's choice, not the session's"
    );
    rig.core.set_third_party_media(false);
    assert!(!rig.core.third_party_media());
}

// --- A link preview's picture names its host ------------------------------------------------

async fn row_with_preview(preview: Value) -> MessageRow {
    let mut value = message_json("m1", ME, "look");
    value["linkPreviews"] = json!([preview]);
    let dto: MessageDto = serde_json::from_value(value).expect("a message of the contract");
    let mut rig = Rig::new();
    rig = rig.open_channel(vec![dto]).await.signed_in().await;
    rig.core.open_conversation(channel()).await.unwrap();
    rig.core.run_until_idle().await;
    rig.sync();
    rig.rows.remove(0)
}

#[tokio::test]
async fn a_link_previews_picture_carries_the_host_it_would_load_from() {
    let row = row_with_preview(json!({
        "url": "https://example.com/post",
        "title": "A post",
        "imageUrl": "https://cdn.Example.COM/a.png",
    }))
    .await;
    let preview = &row.link_previews[0];
    assert_eq!(
        preview.image_url.as_deref(),
        Some("https://cdn.Example.COM/a.png")
    );
    assert_eq!(preview.image_host.as_deref(), Some("cdn.example.com"));

    // No picture, and a picture that isn't a URL: nothing to load, so no host.
    for preview in [
        json!({ "url": "https://example.com/post" }),
        json!({ "url": "https://example.com/post", "imageUrl": "/local/a.png" }),
        json!({ "url": "https://example.com/post", "imageUrl": "ftp://example.com/a.png" }),
    ] {
        let row = row_with_preview(preview.clone()).await;
        assert_eq!(row.link_previews[0].image_host, None, "{preview}");
        assert_eq!(
            row.link_previews[0].image_url.is_some(),
            preview.get("imageUrl").is_some()
        );
    }
}

#[test]
fn the_url_host_table() {
    let table: &[(&str, Option<&str>)] = &[
        ("https://example.com/a.png", Some("example.com")),
        ("http://example.com/a.png", Some("example.com")),
        ("HTTPS://EXAMPLE.COM/a.png", Some("example.com")),
        ("https://example.com:8443/a.png", Some("example.com")),
        ("https://example.com", Some("example.com")),
        ("https://example.com?x=1", Some("example.com")),
        ("https://example.com#top", Some("example.com")),
        ("  https://example.com/a.png  ", Some("example.com")),
        ("example.com/a.png", None),
        ("ftp://example.com/a.png", None),
        ("https://", None),
        ("https:///a.png", None),
        ("", None),
        ("not a url", None),
    ];
    for (url, expected) in table {
        assert_eq!(url_host(url).as_deref(), *expected, "{url}");
    }
}

#[tokio::test]
async fn a_conversation_keeps_its_rows_when_the_setting_changes() {
    // Nothing about a row changes: the setting is read once by the screen, so rows stay as they
    // are and no list is rebuilt.
    let mut rig = Rig::new();
    rig = rig
        .open_channel(vec![message("m1", "me", "hi")])
        .await
        .signed_in()
        .await;
    rig.core.open_conversation(channel()).await.unwrap();
    rig.core.run_until_idle().await;
    rig.events.take();
    rig.core.set_third_party_media(true);
    rig.core.run_until_idle().await;
    let changed = rig.events.take().into_iter().any(|event| {
        matches!(
            event,
            semaphore_core::platform::CoreEvent::MessagesChanged {
                conversation,
                ..
            } if conversation == Conversation::Channel { id: CHANNEL.into() }
        )
    });
    assert!(!changed, "the rows themselves are unchanged");
}
