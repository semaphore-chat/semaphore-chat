//! W7-A over real HTTP: the featured list and the search, their limits, paging and the control.
//! Each answer decodes as its wire type (the contract's shape).

mod common;

use common::*;
use semaphore_fake_server::FakeServer;
use semaphore_wire::types as wire;
use serde_json::Value;

fn decode<T: serde::de::DeserializeOwned>(value: &Value) -> T {
    serde_json::from_value(value.clone()).unwrap_or_else(|error| panic!("{error}: {value}"))
}

fn ids(page: &wire::GifSearchResponseDto) -> Vec<&str> {
    page.results.iter().map(|gif| gif.id.as_str()).collect()
}

async fn showcase() -> (FakeServer, reqwest::Client, String) {
    let server = start("showcase").await;
    let base = server.base_url();
    (server, http(), base)
}

/// Turns the fake's "GIF service is down" control on or off.
async fn set_unavailable(client: &reqwest::Client, base: &str, on: bool) -> (u16, Value) {
    post(
        client,
        base,
        "/__control/gifs_unavailable",
        serde_json::json!({ "on": on }),
    )
    .await
}

#[tokio::test]
async fn every_route_answers_the_contracts_shape() {
    let (_server, client, base) = showcase().await;

    // Featured: thirty fixture GIFs, the default page of twenty, with a cursor.
    let (status, body) = get(&client, &base, "/api/gifs/featured").await;
    assert_eq!(status, 200, "{body}");
    let page: wire::GifSearchResponseDto = decode(&body);
    assert_eq!(page.results.len(), 20);
    assert_eq!(page.next.as_deref(), Some("20"));
    let first = &page.results[0];
    assert_eq!(first.id, "gif-1");
    assert_eq!(first.title, "Fixture GIF 1");
    // On the fake's own address: nothing leaves the machine.
    assert_eq!(first.url, format!("{base}/__fixtures/gif-1.gif"));
    assert_eq!(
        first.preview_url,
        format!("{base}/__fixtures/gif-1-preview.gif")
    );
    assert_eq!((first.width, first.height), (200, 150));

    // Search: the same shape, and a title match.
    let (status, body) = get(&client, &base, "/api/gifs/search?q=Fixture%20GIF%207").await;
    assert_eq!(status, 200, "{body}");
    let page: wire::GifSearchResponseDto = decode(&body);
    assert_eq!(ids(&page), ["gif-7"]);
    assert_eq!(page.next, None);

    // A route without a session is refused, as every guarded route is.
    let (status, body) = request(
        &client,
        reqwest::Method::GET,
        &base,
        "/api/gifs/featured",
        None,
        false,
    )
    .await;
    assert_eq!(status, 401, "{body}");
    assert_eq!(body["errorCode"], "UNAUTHENTICATED");
}

#[tokio::test]
async fn the_limit_is_the_query_dtos() {
    let (_server, client, base) = showcase().await;

    let (status, body) = get(&client, &base, "/api/gifs/featured?limit=5").await;
    assert_eq!(status, 200, "{body}");
    let page: wire::GifSearchResponseDto = decode(&body);
    assert_eq!(page.results.len(), 5);
    assert_eq!(page.next.as_deref(), Some("5"));

    let (status, body) = get(&client, &base, "/api/gifs/featured?limit=50").await;
    assert_eq!(status, 200, "{body}");
    let page: wire::GifSearchResponseDto = decode(&body);
    assert_eq!(page.results.len(), 30, "everything there is");
    assert_eq!(page.next, None);

    for (limit, message) in [
        ("0", "limit must not be less than 1"),
        ("51", "limit must not be greater than 50"),
        ("abc", "limit must be an integer number"),
    ] {
        let (status, body) =
            get(&client, &base, &format!("/api/gifs/featured?limit={limit}")).await;
        assert_eq!(status, 400, "limit {limit}: {body}");
        assert_eq!(body["errorCode"], "VALIDATION_FAILED");
        assert_eq!(body["message"], message);
    }
}

#[tokio::test]
async fn pos_pages_through_the_fixtures() {
    let (_server, client, base) = showcase().await;

    let (status, body) = get(&client, &base, "/api/gifs/featured?limit=10&pos=10").await;
    assert_eq!(status, 200, "{body}");
    let page: wire::GifSearchResponseDto = decode(&body);
    assert_eq!(
        ids(&page),
        [
            "gif-11", "gif-12", "gif-13", "gif-14", "gif-15", "gif-16", "gif-17", "gif-18",
            "gif-19", "gif-20"
        ]
    );
    assert_eq!(page.next.as_deref(), Some("20"));

    // The last page: what is left, and no cursor.
    let (status, body) = get(&client, &base, "/api/gifs/featured?limit=10&pos=25").await;
    assert_eq!(status, 200, "{body}");
    let page: wire::GifSearchResponseDto = decode(&body);
    assert_eq!(
        ids(&page),
        ["gif-26", "gif-27", "gif-28", "gif-29", "gif-30"]
    );
    assert_eq!(page.next, None);

    // An unparsable cursor is the first page.
    let (status, body) = get(&client, &base, "/api/gifs/featured?limit=2&pos=nonsense").await;
    assert_eq!(status, 200, "{body}");
    let page: wire::GifSearchResponseDto = decode(&body);
    assert_eq!(ids(&page), ["gif-1", "gif-2"]);

    // Past the end: nothing, and no cursor.
    let (status, body) = get(&client, &base, "/api/gifs/featured?pos=30").await;
    assert_eq!(status, 200, "{body}");
    let page: wire::GifSearchResponseDto = decode(&body);
    assert!(page.results.is_empty());
    assert_eq!(page.next, None);
}

#[tokio::test]
async fn search_matches_titles_in_any_case() {
    let (_server, client, base) = showcase().await;

    let (status, body) = get(&client, &base, "/api/gifs/search?q=GIF%201").await;
    assert_eq!(status, 200, "{body}");
    let page: wire::GifSearchResponseDto = decode(&body);
    assert_eq!(
        ids(&page),
        [
            "gif-1", "gif-10", "gif-11", "gif-12", "gif-13", "gif-14", "gif-15", "gif-16",
            "gif-17", "gif-18", "gif-19"
        ]
    );
    assert_eq!(page.next, None);

    let (status, body) = get(&client, &base, "/api/gifs/search?q=fixture%20gif%203").await;
    assert_eq!(status, 200, "{body}");
    let page: wire::GifSearchResponseDto = decode(&body);
    assert_eq!(ids(&page), ["gif-3", "gif-30"]);

    // Search pages too.
    let (status, body) = get(&client, &base, "/api/gifs/search?q=GIF%201&limit=4").await;
    assert_eq!(status, 200, "{body}");
    let page: wire::GifSearchResponseDto = decode(&body);
    assert_eq!(ids(&page), ["gif-1", "gif-10", "gif-11", "gif-12"]);
    assert_eq!(page.next.as_deref(), Some("4"));

    // A query longer than the provider allows is cut, not refused: nothing matches it.
    let long = "a".repeat(60);
    let (status, body) = get(&client, &base, &format!("/api/gifs/search?q={long}")).await;
    assert_eq!(status, 200, "{body}");
    let page: wire::GifSearchResponseDto = decode(&body);
    assert!(page.results.is_empty());
    assert_eq!(page.next, None);
}

#[tokio::test]
async fn the_control_makes_both_routes_unavailable() {
    let (_server, client, base) = showcase().await;

    let (status, body) = set_unavailable(&client, &base, true).await;
    assert_eq!(status, 200, "{body}");
    for path in ["/api/gifs/featured", "/api/gifs/search?q=cat"] {
        let (status, body) = get(&client, &base, path).await;
        assert_eq!(status, 503, "{path}: {body}");
        assert_eq!(body["errorCode"], "UNAVAILABLE");
        assert_eq!(
            body["message"],
            "GIF search is not configured on this instance. Set GIPHY_API_KEY in .env"
        );
    }

    let (status, body) = set_unavailable(&client, &base, false).await;
    assert_eq!(status, 200, "{body}");
    let (status, body) = get(&client, &base, "/api/gifs/featured").await;
    assert_eq!(status, 200, "{body}");
    let page: wire::GifSearchResponseDto = decode(&body);
    assert_eq!(page.results.len(), 20);
}
