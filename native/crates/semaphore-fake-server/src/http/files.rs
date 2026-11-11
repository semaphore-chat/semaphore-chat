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
        .route("/api/file/{id}/thumbnail", get(get_file_thumbnail))
}

pub(super) fn operation_id(method: &Method, route: &str) -> Option<&'static str> {
    Some(match (method.as_str(), route) {
        ("POST", "/api/file-upload") => "FileUploadController_uploadFile",
        ("POST", "/api/messages/{id}/attachments") => "MessagesController_addAttachment",
        // Not the backend's: a stand-in third-party site, recorded so a test can see it was asked.
        ("GET", "/__fixtures/{name}") => "Fixture_image",
        ("GET", "/api/file/{id}") => "FileController_getFile",
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

async fn get_file(State(inner): State<Arc<Inner>>, Path(id): Path<String>) -> Response {
    stored_or_image(&inner, &id, "file")
}

async fn get_file_thumbnail(State(inner): State<Arc<Inner>>, Path(id): Path<String>) -> Response {
    stored_or_image(&inner, &id, "thumbnail")
}

/// Unauthenticated images at a plain URL, standing in for a third-party site's link-preview image.
async fn fixture_image(Path(name): Path<String>) -> Response {
    image_response(&name, "fixture")
}

/// `POST /api/file-upload`: keeps the file and answers with its record. The id is a UUID, as the
/// attach call's DTO requires.
async fn upload_file(
    State(inner): State<Arc<Inner>>,
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
                            filename,
                            mime_type,
                            bytes: bytes.to_vec(),
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
    let (Some(file), Some(resource_type)) = (file, resource_type) else {
        return invalid("file and resourceType are required");
    };
    // Deterministic, so a run's screenshots and logs repeat: the nth upload's id is always the same.
    let next = lock(&inner.data).files.len() as u128 + 1;
    let id = uuid::Uuid::from_u128(0x0000_f11e_0000_4000_8000_0000_0000_0000 | next).to_string();
    let file_type = if file.mime_type.starts_with("image/") {
        "IMAGE"
    } else {
        "DOCUMENT"
    };
    let record = json!({
        "id": id, "checksum": "fake", "deletedAt": null, "fileCommunityId": null,
        "fileMessageId": resource_id, "fileType": file_type, "fileUserId": null,
        "filename": file.filename, "mimeType": file.mime_type, "resourceType": resource_type,
        "size": file.bytes.len(), "storagePath": format!("fake/{id}"), "storageType": "LOCAL",
        "thumbnailPath": null, "uploadedAt": inner.now(), "uploadedById": inner.scenario.me.id,
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
