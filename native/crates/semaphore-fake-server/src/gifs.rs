//! W7-A's state: the fixture GIFs, seeded from the scenario's `gifs` key (`Scenario::extra`), with
//! URLs on the fake server's own `/__fixtures/` so nothing leaves the machine. Its own lock
//! (`Inner::gifs`).

use crate::{Inner, lock};
use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use semaphore_wire::types::{GifResultDto, GifSearchResponseDto};
use serde_json::{Value, json};

/// The built-in set's size.
const FIXTURES: usize = 30;
/// `MAX_QUERY_LENGTH` in the backend's `giphy.provider.ts`.
const MAX_QUERY_CHARS: usize = 50;

#[derive(Debug, Default)]
pub(crate) struct Gifs {
    seeded: bool,
    fixtures: Vec<GifResultDto>,
    /// Set by the `gifs_unavailable` control: both routes answer 503.
    pub(crate) unavailable: bool,
}

impl Gifs {
    /// The scenario's `gifs` list once, else the built-in set: `gif-1`..`gif-30`.
    pub(crate) fn seed(&mut self, inner: &Inner) {
        if std::mem::replace(&mut self.seeded, true) {
            return;
        }
        if let Some(Value::Array(items)) = inner.scenario.extra.get("gifs") {
            self.fixtures = items
                .iter()
                .filter_map(|item| serde_json::from_value(item.clone()).ok())
                .collect();
            return;
        }
        let base = &inner.base_url;
        self.fixtures = (1..=FIXTURES)
            .map(|number| GifResultDto {
                id: format!("gif-{number}"),
                title: format!("Fixture GIF {number}"),
                url: format!("{base}/__fixtures/gif-{number}.gif"),
                preview_url: format!("{base}/__fixtures/gif-{number}-preview.gif"),
                width: 200,
                height: 150,
            })
            .collect();
    }

    /// One page: the featured list when `q` is `None`, else the fixtures whose title contains it.
    /// `pos` is an opaque offset ("20"); an unparsable one is 0.
    pub(crate) fn page(
        &mut self,
        inner: &Inner,
        q: Option<&str>,
        limit: usize,
        pos: Option<&str>,
    ) -> GifSearchResponseDto {
        self.seed(inner);
        let offset = pos.and_then(|pos| pos.parse::<usize>().ok()).unwrap_or(0);
        let matched: Vec<&GifResultDto> = match q {
            Some(q) => {
                let q = q.chars().take(MAX_QUERY_CHARS).collect::<String>();
                let q = q.to_lowercase();
                self.fixtures
                    .iter()
                    .filter(|gif| gif.title.to_lowercase().contains(&q))
                    .collect()
            }
            None => self.fixtures.iter().collect(),
        };
        let start = offset.min(matched.len());
        let end = start.saturating_add(limit).min(matched.len());
        GifSearchResponseDto {
            results: matched[start..end]
                .iter()
                .map(|gif| (*gif).clone())
                .collect(),
            next: (end < matched.len()).then(|| end.to_string()),
        }
    }
}

/// A W7-A control, or `None` when the name isn't W7-A's.
pub(crate) fn control(inner: &Inner, name: &str, request: &Value) -> Option<Response> {
    match name {
        "gifs_unavailable" => {
            let on = request.get("on").and_then(Value::as_bool).unwrap_or(true);
            lock(&inner.gifs).unavailable = on;
        }
        _ => return None,
    }
    Some(json_response(json!({ "ok": true })))
}

/// `200` with a JSON body, as the fake's routes answer.
fn json_response(body: Value) -> Response {
    (StatusCode::OK, Json(body)).into_response()
}
