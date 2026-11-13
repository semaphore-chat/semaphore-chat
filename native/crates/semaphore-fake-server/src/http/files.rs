//! Files: downloads, thumbnails, uploads, attachments and the stand-in link-preview images.

use super::{invalid, json_response};
use crate::messages;
use crate::{Inner, lock, png};
use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{HeaderValue, Method, StatusCode, header};
use axum::response::Response;
use axum::routing::{get, post};
use serde_json::{Value, json};
use std::sync::Arc;

pub(super) fn routes() -> Router<Arc<Inner>> {
    Router::new()
        .route("/api/file-upload", post(upload_file))
        .route("/api/messages/{id}/attachments", post(add_attachment))
        .route("/__fixtures/{name}", get(fixture_image))
        .route("/api/file/{id}", get(get_file))
        .route("/api/file/{id}/metadata", get(get_file_metadata))
        .route("/api/file/{id}/thumbnail", get(get_file_thumbnail))
}

pub(super) fn operation_id(method: &Method, route: &str) -> Option<&'static str> {
    Some(match (method.as_str(), route) {
        ("POST", "/api/file-upload") => "FileUploadController_uploadFile",
        ("POST", "/api/messages/{id}/attachments") => "MessagesController_addAttachment",
        // Not the backend's: a stand-in third-party site, recorded so a test can see it was asked.
        ("GET", "/__fixtures/{name}") => "Fixture_image",
        ("GET", "/api/file/{id}") => "FileController_getFile",
        ("GET", "/api/file/{id}/metadata") => "FileController_getFileMetadata",
        ("GET", "/api/file/{id}/thumbnail") => "FileController_getFileThumbnail",
        _ => return None,
    })
}

fn image_response(id: &str, variant: &str) -> Response {
    let bytes = png::png_for(&format!("{variant}:{id}"));
    let mut response = Response::new(axum::body::Body::from(bytes));
    response
        .headers_mut()
        .insert(header::CONTENT_TYPE, HeaderValue::from_static("image/png"));
    response
}

/// An uploaded file as it was sent, or the generated image every other id gets.
fn stored_or_image(inner: &Inner, id: &str, variant: &str) -> Response {
    let stored = lock(&inner.data).files.get(id).cloned();
    match stored {
        Some(file) => {
            let mut response = Response::new(axum::body::Body::from(file.bytes));
            if let Ok(value) = HeaderValue::from_str(&file.mime_type) {
                response.headers_mut().insert(header::CONTENT_TYPE, value);
            }
            response
        }
        None => image_response(id, variant),
    }
}

/// `GET /api/file/{id}`, with `Range` as the backend's `FileController.getFile` serves it:
/// `bytes=start-end` or `bytes=start-` answers 206 with `Content-Range` (the end clamped to the
/// file), a start past the end or after the end answers 416 with `Content-Range: bytes */size`,
/// and anything else in `Range` is ignored (the whole file, 200). Every answer says
/// `Accept-Ranges: bytes`.
async fn get_file(
    State(inner): State<Arc<Inner>>,
    Path(id): Path<String>,
    headers: axum::http::HeaderMap,
) -> Response {
    let mut response = stored_or_image(&inner, &id, "file");
    response
        .headers_mut()
        .insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    let Some(range) = headers
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .and_then(parse_range)
    else {
        return response;
    };
    let (parts, body) = response.into_parts();
    let Ok(bytes) = axum::body::to_bytes(body, usize::MAX).await else {
        return Response::from_parts(parts, axum::body::Body::empty());
    };
    let size = bytes.len() as u64;
    let (start, end) = range;
    let mut response = Response::from_parts(parts, axum::body::Body::empty());
    if start >= size || end.is_some_and(|end| start > end) {
        *response.status_mut() = StatusCode::RANGE_NOT_SATISFIABLE;
        if let Ok(value) = HeaderValue::from_str(&format!("bytes */{size}")) {
            response.headers_mut().insert(header::CONTENT_RANGE, value);
        }
        return response;
    }
    let end = end.unwrap_or(size - 1).min(size - 1);
    let slice = bytes.slice(start as usize..=end as usize);
    *response.status_mut() = StatusCode::PARTIAL_CONTENT;
    if let Ok(value) = HeaderValue::from_str(&format!("bytes {start}-{end}/{size}")) {
        response.headers_mut().insert(header::CONTENT_RANGE, value);
    }
    *response.body_mut() = axum::body::Body::from(slice);
    response
}

/// `bytes=start-end` or `bytes=start-`, as the backend's regex `bytes=(\d+)-(\d*)` reads it.
fn parse_range(value: &str) -> Option<(u64, Option<u64>)> {
    let spec = value.trim().strip_prefix("bytes=")?;
    let (start, end) = spec.split_once('-')?;
    let start = start.parse().ok()?;
    let end = if end.is_empty() {
        None
    } else {
        Some(end.parse().ok()?)
    };
    Some((start, end))
}

async fn get_file_thumbnail(State(inner): State<Arc<Inner>>, Path(id): Path<String>) -> Response {
    let (stored, thumbnail) = {
        let data = lock(&inner.data);
        match data.files.get(&id) {
            Some(file) => (true, file.thumbnail.clone()),
            None => (false, None),
        }
    };
    if !stored {
        // Every id the fake never stored gets the generated image the file route stands in with.
        return image_response(&id, "thumbnail");
    }
    let Some(thumbnail) = thumbnail else {
        return inner.error(
            404,
            "NOT_FOUND",
            "No thumbnail available for this file",
            false,
        );
    };
    let mut response = Response::new(axum::body::Body::from(thumbnail));
    // The backend's thumbnail is a JPEG. This build has only the PNG codec, so the fake
    // produces PNGs and says so.
    response
        .headers_mut()
        .insert(header::CONTENT_TYPE, HeaderValue::from_static("image/png"));
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, max-age=86400"),
    );
    response.headers_mut().insert(
        header::HeaderName::from_static("cross-origin-resource-policy"),
        HeaderValue::from_static("cross-origin"),
    );
    response
}

/// `GET /api/file/{id}/metadata`: the `FileMetadataResponseDto` the backend builds.
async fn get_file_metadata(State(inner): State<Arc<Inner>>, Path(id): Path<String>) -> Response {
    let stored = {
        let data = lock(&inner.data);
        data.files.get(&id).map(|file| {
            (
                file.filename.clone(),
                file.mime_type.clone(),
                file.bytes.len(),
                file.width,
                file.height,
                file.has_thumbnail(),
            )
        })
    };
    let Some((filename, mime_type, size, width, height, has_thumbnail)) = stored else {
        return inner.error(404, "NOT_FOUND", "File not found", false);
    };
    json_response(
        StatusCode::OK,
        json!({
            "id": id,
            "filename": filename,
            "mimeType": mime_type,
            "fileType": messages::file_type_for(&mime_type).as_str(),
            "size": size,
            "hasThumbnail": has_thumbnail,
            "width": width,
            "height": height,
        }),
    )
}

/// Unauthenticated images at a plain URL, standing in for a third-party site's link-preview image.
async fn fixture_image(Path(name): Path<String>) -> Response {
    image_response(&name, "fixture")
}

/// `POST /api/file-upload`: keeps the file and answers with its record. The id is a UUID, as the
/// attach call's DTO requires.
async fn upload_file(
    State(inner): State<Arc<Inner>>,
    headers: axum::http::HeaderMap,
    mut multipart: axum::extract::Multipart,
) -> Response {
    let (mut file, mut resource_type, mut resource_id) = (None, None, None);
    while let Ok(Some(field)) = multipart.next_field().await {
        match field.name().unwrap_or_default() {
            "file" => {
                let filename = field.file_name().unwrap_or("file").to_owned();
                let mime_type = field
                    .content_type()
                    .unwrap_or("application/octet-stream")
                    .to_owned();
                match field.bytes().await {
                    Ok(bytes) => {
                        file = Some(crate::StoredFile {
                            uploaded_by: String::new(),
                            resource_type: String::new(),
                            community_id: None,
                            filename,
                            mime_type,
                            bytes: bytes.to_vec(),
                            width: None,
                            height: None,
                            thumbnail: None,
                        });
                    }
                    Err(_) => return invalid("the file didn't arrive whole"),
                }
            }
            "resourceType" => resource_type = field.text().await.ok(),
            "resourceId" => resource_id = field.text().await.ok(),
            _ => {}
        }
    }
    let (Some(mut file), Some(resource_type)) = (file, resource_type) else {
        return invalid("file and resourceType are required");
    };
    let uploader = inner.user_of(super::bearer_token(&headers));
    file.uploaded_by = uploader.clone();
    file.resource_type = resource_type.clone();
    // `FileUploadService.mapResourceIdToTypedColumn`: the typed FK a resource id lands in.
    let resource_id = resource_id.filter(|id| !id.is_empty());
    let (file_user_id, file_community_id, file_message_id) = match resource_type.as_str() {
        "USER_AVATAR" | "USER_BANNER" | "REPLAY_CLIP" => (resource_id.clone(), None, None),
        "COMMUNITY_AVATAR" | "COMMUNITY_BANNER" | "CUSTOM_EMOJI" | "SOUNDBOARD_SOUND" => {
            (None, resource_id.clone(), None)
        }
        "MESSAGE_ATTACHMENT" => (None, None, resource_id.clone()),
        _ => (None, None, None),
    };
    file.community_id = file_community_id.clone();
    // `MediaDimensionsService.read` then `ThumbnailService.generateImageThumbnail`: best-effort,
    // and only raster images are measured (videos keep the nulls the fake always gave them).
    let dimensions = crate::media::dimensions(&file.mime_type, &file.bytes);
    file.width = dimensions.map(|(width, _)| i64::from(width));
    file.height = dimensions.map(|(_, height)| i64::from(height));
    file.thumbnail = dimensions
        .filter(|dimensions| crate::media::wants_thumbnail(&file.mime_type, Some(*dimensions)))
        .and_then(|dimensions| crate::media::thumbnail(&file.bytes, dimensions));
    // Deterministic, so a run's screenshots and logs repeat: the nth upload's id is always the same.
    let next = lock(&inner.data).files.len() as u128 + 1;
    let id = uuid::Uuid::from_u128(0x0000_f11e_0000_4000_8000_0000_0000_0000 | next).to_string();
    let file_type = messages::file_type_for(&file.mime_type)
        .as_str()
        .into_owned();
    let thumbnail_path = file
        .has_thumbnail()
        .then(|| format!("fake/{id}/thumbnail.jpg"));
    let record = json!({
        "id": id, "checksum": "fake", "deletedAt": null, "fileCommunityId": file_community_id,
        "fileMessageId": file_message_id, "fileType": file_type, "fileUserId": file_user_id,
        "filename": file.filename, "mimeType": file.mime_type, "resourceType": resource_type,
        "size": file.bytes.len(), "storagePath": format!("fake/{id}"), "storageType": "LOCAL",
        "hasThumbnail": file.has_thumbnail(), "height": file.height, "width": file.width,
        "thumbnailPath": thumbnail_path, "uploadedAt": inner.now(), "uploadedById": uploader,
    });
    lock(&inner.data).files.insert(id, file);
    json_response(StatusCode::CREATED, record)
}

/// `POST /api/messages/{id}/attachments`: attaches an uploaded file, or with none releases a
/// pending slot, then tells the room, as the real controller does.
async fn add_attachment(
    State(inner): State<Arc<Inner>>,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    let request: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
    let file_id = request
        .get("fileId")
        .and_then(Value::as_str)
        .map(str::to_owned);
    match messages::add_attachment(&inner, &id, file_id.as_deref()) {
        Some(message) => json_response(
            StatusCode::CREATED,
            serde_json::to_value(message).expect("a message serializes"),
        ),
        None => inner.error(404, "NOT_FOUND", "No such message or file", false),
    }
}
