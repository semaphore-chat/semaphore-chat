//! Files: what an upload reports about its picture, what its message carries, and the thumbnail
//! and metadata routes, as `backend/src/file` and `backend/src/file-upload` answer them.

mod common;

use common::*;
use image::codecs::png::PngEncoder;
use image::{ExtendedColorType, ImageEncoder, Rgba, RgbaImage};
use semaphore_fake_server::FakeServer;
use serde_json::{Value, json};

const BOUNDARY: &str = "file-test-boundary";

fn png(width: u32, height: u32) -> Vec<u8> {
    let mut image = RgbaImage::new(width, height);
    for (x, y, pixel) in image.enumerate_pixels_mut() {
        *pixel = Rgba([(x % 256) as u8, (y % 256) as u8, 96, 255]);
    }
    let mut out = Vec::new();
    PngEncoder::new(&mut out)
        .write_image(image.as_raw(), width, height, ExtendedColorType::Rgba8)
        .expect("a PNG in memory");
    out
}

struct Upload<'a> {
    filename: &'a str,
    mime_type: &'a str,
    bytes: &'a [u8],
    /// The message the file is for (`resourceId`), as the app names it when it uploads an
    /// attachment: the file's `fileMessageId`, which its download's access check reads.
    resource_id: Option<&'a str>,
}

/// `POST /api/file-upload` with one file, answering its status and record.
async fn upload(server: &FakeServer, file: Upload<'_>) -> (u16, Value) {
    let mut body = Vec::new();
    body.extend_from_slice(
        format!(
            "--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"resourceType\"\r\n\r\nMESSAGE_ATTACHMENT\r\n"
        )
        .as_bytes(),
    );
    if let Some(resource_id) = file.resource_id {
        body.extend_from_slice(
            format!(
                "--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"resourceId\"\r\n\r\n{resource_id}\r\n"
            )
            .as_bytes(),
        );
    }
    body.extend_from_slice(
        format!(
            "--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{}\"\r\nContent-Type: {}\r\n\r\n",
            file.filename, file.mime_type
        )
        .as_bytes(),
    );
    body.extend_from_slice(file.bytes);
    body.extend_from_slice(format!("\r\n--{BOUNDARY}--\r\n").as_bytes());
    let response = http()
        .post(format!("{}/api/file-upload", server.base_url()))
        .header("Authorization", TOKEN)
        .header(
            "Content-Type",
            format!("multipart/form-data; boundary={BOUNDARY}"),
        )
        .body(body)
        .send()
        .await
        .expect("the fake answers");
    let status = response.status().as_u16();
    (status, response.json().await.expect("a JSON record"))
}

async fn bytes_at(server: &FakeServer, path: &str, auth: bool) -> (u16, Option<String>, Vec<u8>) {
    let mut request = http().get(format!("{}{path}", server.base_url()));
    if auth {
        request = request.header("Authorization", TOKEN);
    }
    let response = request.send().await.expect("the fake answers");
    let status = response.status().as_u16();
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    (
        status,
        content_type,
        response.bytes().await.expect("a body").to_vec(),
    )
}

#[tokio::test]
async fn an_upload_reports_the_size_of_a_large_image_and_makes_a_thumbnail() {
    let server = start("big-community").await;
    let picture = png(600, 1200);
    let (status, record) = upload(
        &server,
        Upload {
            filename: "portrait.png",
            mime_type: "image/png",
            bytes: &picture,
            resource_id: Some("msg-14"),
        },
    )
    .await;
    assert_eq!(status, 201, "{record}");
    assert_eq!(record["width"], 600);
    assert_eq!(record["height"], 1200);
    assert_eq!(record["hasThumbnail"], true);
    assert!(
        record["thumbnailPath"]
            .as_str()
            .is_some_and(|path| !path.is_empty()),
        "{record}"
    );
    assert_eq!(record["fileType"], "IMAGE");
}

#[tokio::test]
async fn a_small_image_reports_its_size_and_has_no_thumbnail() {
    let server = start("big-community").await;
    let picture = png(64, 64);
    let (status, record) = upload(
        &server,
        Upload {
            filename: "tiny.png",
            mime_type: "image/png",
            bytes: &picture,
            resource_id: Some("msg-14"),
        },
    )
    .await;
    assert_eq!(status, 201, "{record}");
    assert_eq!(record["width"], 64);
    assert_eq!(record["height"], 64);
    assert_eq!(record["hasThumbnail"], false);
    assert!(record["thumbnailPath"].is_null(), "{record}");
}

#[tokio::test]
async fn a_non_image_has_no_dimensions_and_no_thumbnail() {
    let server = start("big-community").await;
    let (status, record) = upload(
        &server,
        Upload {
            filename: "notes.txt",
            mime_type: "text/plain",
            bytes: b"plain words",
            resource_id: Some("msg-14"),
        },
    )
    .await;
    assert_eq!(status, 201, "{record}");
    assert!(record["width"].is_null(), "{record}");
    assert!(record["height"].is_null(), "{record}");
    assert_eq!(record["hasThumbnail"], false);
    assert!(record["thumbnailPath"].is_null(), "{record}");
}

#[tokio::test]
async fn a_message_attachment_carries_the_stored_dimensions() {
    let server = start("big-community").await;
    let client = http();
    let base = server.base_url();
    let picture = png(1600, 300);
    let (status, record) = upload(
        &server,
        Upload {
            filename: "panorama.png",
            mime_type: "image/png",
            bytes: &picture,
            resource_id: None,
        },
    )
    .await;
    assert_eq!(status, 201);
    let file_id = record["id"].as_str().expect("an id").to_owned();

    let (status, message) = post(
        &client,
        &base,
        "/api/messages",
        json!({
            "channelId": "channel-13",
            "spans": [{ "type": "PLAIN", "text": "a panorama" }],
            "pendingAttachments": 1,
        }),
    )
    .await;
    assert_eq!(status, 201, "{message}");
    let message_id = message["id"].as_str().expect("an id").to_owned();

    let (status, attached) = post(
        &client,
        &base,
        &format!("/api/messages/{message_id}/attachments"),
        json!({ "fileId": file_id }),
    )
    .await;
    assert_eq!(status, 201, "{attached}");
    let attachment = &attached["attachments"][0];
    assert_eq!(attachment["width"], 1600, "{attached}");
    assert_eq!(attachment["height"], 300, "{attached}");
    assert_eq!(attachment["hasThumbnail"], true, "{attached}");

    // And the page the list reads carries the same fields.
    let (status, page) = get(&client, &base, "/api/messages/channel/channel-13?limit=100").await;
    assert_eq!(status, 200);
    let listed = page["messages"]
        .as_array()
        .expect("a page")
        .iter()
        .find(|message| message["id"] == message_id.as_str())
        .expect("the new message");
    assert_eq!(listed["attachments"][0]["width"], 1600);
    assert_eq!(listed["attachments"][0]["height"], 300);
    assert_eq!(listed["attachments"][0]["hasThumbnail"], true);
}

#[tokio::test]
async fn file_metadata_reports_the_size_and_whether_a_thumbnail_exists() {
    let server = start("big-community").await;
    let client = http();
    let base = server.base_url();
    let (_, record) = upload(
        &server,
        Upload {
            filename: "portrait.png",
            mime_type: "image/png",
            bytes: &png(600, 1200),
            resource_id: Some("msg-14"),
        },
    )
    .await;
    let file_id = record["id"].as_str().expect("an id");
    let (status, metadata) = get(&client, &base, &format!("/api/file/{file_id}/metadata")).await;
    assert_eq!(status, 200, "{metadata}");
    assert_eq!(metadata["width"], 600);
    assert_eq!(metadata["height"], 1200);
    assert_eq!(metadata["hasThumbnail"], true);
    assert_eq!(metadata["fileType"], "IMAGE");
    assert_eq!(metadata["mimeType"], "image/png");
    assert_eq!(metadata["size"], png(600, 1200).len());

    let (status, missing) = get(&client, &base, "/api/file/nothing/metadata").await;
    assert_eq!(status, 404, "{missing}");
    assert_eq!(missing["message"], "File not found");
}

#[tokio::test]
async fn the_thumbnail_route_fits_the_box_and_keeps_the_aspect() {
    let server = start("big-community").await;
    let (_, record) = upload(
        &server,
        Upload {
            filename: "portrait.png",
            mime_type: "image/png",
            bytes: &png(600, 1200),
            resource_id: Some("msg-14"),
        },
    )
    .await;
    let file_id = record["id"].as_str().expect("an id");
    let (status, content_type, bytes) =
        bytes_at(&server, &format!("/api/file/{file_id}/thumbnail"), true).await;
    assert_eq!(status, 200);
    // The backend serves JPEG; this build has no JPEG encoder, so the fake serves its PNG.
    assert_eq!(content_type.as_deref(), Some("image/png"));
    let decoded = image::load_from_memory_with_format(&bytes, image::ImageFormat::Png)
        .expect("the client can decode it");
    assert_eq!((decoded.width(), decoded.height()), (240, 480));
    assert!(decoded.width().max(decoded.height()) <= 480);
    assert!(((decoded.width() as f32 / decoded.height() as f32) - 0.5).abs() < 0.01);
}

#[tokio::test]
async fn a_file_without_a_thumbnail_answers_the_backends_404() {
    let server = start("big-community").await;
    let (_, record) = upload(
        &server,
        Upload {
            filename: "tiny.png",
            mime_type: "image/png",
            bytes: &png(64, 64),
            resource_id: Some("msg-14"),
        },
    )
    .await;
    let file_id = record["id"].as_str().expect("an id");
    let (status, _, bytes) =
        bytes_at(&server, &format!("/api/file/{file_id}/thumbnail"), true).await;
    assert_eq!(status, 404);
    let body: Value = serde_json::from_slice(&bytes).expect("a JSON error");
    assert_eq!(body["errorCode"], "NOT_FOUND");
    assert_eq!(body["message"], "No thumbnail available for this file");
}

#[tokio::test]
async fn the_thumbnail_route_refuses_what_the_file_route_refuses() {
    let server = start("big-community").await;
    let (_, record) = upload(
        &server,
        Upload {
            filename: "portrait.png",
            mime_type: "image/png",
            bytes: &png(600, 1200),
            resource_id: Some("msg-14"),
        },
    )
    .await;
    let file_id = record["id"].as_str().expect("an id");
    let file = bytes_at(&server, &format!("/api/file/{file_id}"), false).await;
    let thumbnail = bytes_at(&server, &format!("/api/file/{file_id}/thumbnail"), false).await;
    assert_eq!(file.0, 401);
    assert_eq!(thumbnail.0, file.0);
    assert_eq!(thumbnail.2, file.2, "the same refusal body");
    let body: Value = serde_json::from_slice(&file.2).expect("a JSON error");
    assert_eq!(body["errorCode"], "UNAUTHENTICATED");
}
