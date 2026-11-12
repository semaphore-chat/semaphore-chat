//! [`FakeBackend`] for W7-A: the featured list and the search, scripted through `FakeBackend::w4`
//! as W5-A's are (answers decoded into the wire type, errors, gates, the calls made).

use super::FakeBackend;
use semaphore_core::backend::{BackendResult, GifsBackend};
use semaphore_wire::types as wire;
use serde_json::{Value, json};

/// One `GifResultDto`, with Giphy-shaped URLs on its own id.
pub fn gif_json(id: &str, title: &str) -> Value {
    json!({
        "id": id, "title": title,
        "url": format!("https://media.giphy.com/media/{id}/giphy.gif"),
        "previewUrl": format!("https://media.giphy.com/media/{id}/preview.gif"),
        "width": 200, "height": 150,
    })
}

/// A `GifSearchResponseDto`: `next` only when the server has more.
pub fn page_json(results: &[Value], next: Option<&str>) -> Value {
    let mut page = json!({ "results": results });
    if let Some(next) = next {
        page["next"] = json!(next);
    }
    page
}

#[async_trait::async_trait]
impl GifsBackend for FakeBackend {
    async fn gifs_controller_featured(
        &self,
        limit: Option<std::num::NonZeroU64>,
        pos: Option<String>,
    ) -> BackendResult<wire::GifSearchResponseDto> {
        let limit = limit.map(|limit| limit.to_string()).unwrap_or_default();
        let pos = pos.unwrap_or_default();
        self.w4.run("w7a_featured", &[&limit, &pos]).await
    }

    async fn gifs_controller_search(
        &self,
        limit: Option<std::num::NonZeroU64>,
        pos: Option<String>,
        q: String,
    ) -> BackendResult<wire::GifSearchResponseDto> {
        let limit = limit.map(|limit| limit.to_string()).unwrap_or_default();
        let pos = pos.unwrap_or_default();
        self.w4.run("w7a_search", &[&limit, &pos, &q]).await
    }
}
