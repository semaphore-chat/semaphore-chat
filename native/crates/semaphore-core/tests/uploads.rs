//! Files sent with a message: the message first, with how many, then each upload against it.

mod common;

use common::*;
use semaphore_core::backend::BackendError;
use semaphore_core::model::{DraftFile, MessageDraft, SendState};
use semaphore_wire::enums::ErrorCode;

fn draft_with(files: &[(&str, usize)]) -> MessageDraft {
    MessageDraft {
        text: "with files".into(),
        files: files
            .iter()
            .map(|(name, size)| DraftFile {
                name: (*name).into(),
                mime_type: "application/octet-stream".into(),
                bytes: vec![7; *size],
            })
            .collect(),
        ..MessageDraft::default()
    }
}

async fn sent_with(files: &[(&str, usize)]) -> (Rig, String) {
    let mut rig = Rig::new()
        .signed_in()
        .await
        .open_channel(history("m", 1))
        .await;
    let nonce = rig
        .core
        .send_message(channel(), draft_with(files))
        .await
        .unwrap();
    rig.sync();
    (rig, nonce)
}

fn too_large() -> BackendError {
    BackendError {
        status: 413,
        code: ErrorCode::Unknown("PAYLOAD_TOO_LARGE".into()),
        message: "File too large".into(),
        retryable: false,
        retry_after_ms: None,
    }
}

#[tokio::test]
async fn the_message_goes_first_with_a_count_then_each_file_uploads_against_it() {
    let (mut rig, _) = sent_with(&[("a.txt", 10), ("b.png", 20)]).await;
    let row = rig.rows.last().unwrap();
    assert_eq!(row.pending_attachments, 2);
    let names: Vec<&str> = row.uploads.iter().map(|u| u.name.as_str()).collect();
    assert_eq!(names, ["a.txt", "b.png"]);
    assert_eq!(row.uploads[1].size_bytes, 20);

    rig.realtime.ack_ok("real");
    rig.settle().await;
    let sent = rig.realtime.sent.lock().unwrap().clone();
    let payload = &sent.last().unwrap().1;
    assert_eq!(payload["pendingAttachments"], 2);
    assert_eq!(payload["attachments"], serde_json::json!([]));

    let uploads = rig.backend.uploads.lock().unwrap().clone();
    assert_eq!(
        uploads,
        [
            ("a.txt".to_owned(), 10, Some("real".to_owned())),
            ("b.png".to_owned(), 20, Some("real".to_owned()))
        ]
    );
    let attaches = rig.backend.attaches.lock().unwrap().clone();
    assert_eq!(attaches.len(), 2);
    assert!(
        attaches
            .iter()
            .all(|(id, file)| id == "real" && file.is_some())
    );
    // Done: nothing of the files is left in core, and the row says so.
    assert!(rig.rows.last().unwrap().uploads.is_empty());
    assert_eq!(rig.row("real").send_state, SendState::Sent);
}

#[tokio::test]
async fn a_refused_upload_shows_why_and_a_retry_sends_it() {
    let (mut rig, nonce) = sent_with(&[("big.bin", 30)]).await;
    *rig.backend.upload_error.lock().unwrap() = Some(too_large());
    rig.realtime.ack_ok("real");
    rig.settle().await;
    let row = rig.row("real").clone();
    let failed = row.uploads[0].failed.clone().expect("failed");
    assert_eq!(failed.message, "File too large");
    assert!(rig.backend.attaches.lock().unwrap().is_empty());

    rig.core.retry_upload(nonce, 0).await.unwrap();
    rig.settle().await;
    assert_eq!(rig.backend.uploads.lock().unwrap().len(), 2);
    assert_eq!(rig.backend.attaches.lock().unwrap().len(), 1);
    assert!(rig.row("real").uploads.is_empty());
}

#[tokio::test]
async fn removing_a_failed_upload_releases_its_slot() {
    let (mut rig, nonce) = sent_with(&[("big.bin", 30)]).await;
    *rig.backend.upload_error.lock().unwrap() = Some(too_large());
    rig.realtime.ack_ok("real");
    rig.settle().await;
    rig.core.remove_upload(nonce, 0).await.unwrap();
    rig.settle().await;
    assert_eq!(
        rig.backend.attaches.lock().unwrap().clone(),
        [("real".to_owned(), None)]
    );
    assert!(rig.row("real").uploads.is_empty());
}

#[tokio::test]
async fn uploads_wait_for_the_message_and_go_with_a_discarded_send() {
    let (mut rig, nonce) = sent_with(&[("a.txt", 10)]).await;
    rig.realtime.ack(Ack::Now(Ok(vec![serde_json::json!({
        "ok": false,
        "error": { "errorCode": "RATE_LIMITED", "message": "slow down", "retryable": false }
    })])));
    rig.settle().await;
    // No message, so nothing to upload against.
    assert!(rig.backend.uploads.lock().unwrap().is_empty());
    rig.core.discard_failed_send(nonce.clone()).await.unwrap();
    rig.settle().await;
    assert!(
        rig.rows
            .iter()
            .all(|row| row.client_nonce.as_deref() != Some(&nonce))
    );
    rig.core.retry_upload(nonce, 0).await.unwrap();
    rig.settle().await;
    assert!(rig.backend.uploads.lock().unwrap().is_empty());
}

#[tokio::test]
async fn an_echo_before_the_ack_starts_the_uploads_too() {
    let (mut rig, nonce) = sent_with(&[("a.txt", 10)]).await;
    // The echo lands before the queued send has even gone: it settles the send by itself.
    let mut echoed = message("real", ME, "with files");
    echoed.client_nonce = Some(nonce.clone());
    rig.core.ingest(event(
        "newMessage",
        serde_json::json!({ "message": echoed }),
    ));
    rig.settle().await;
    assert_eq!(
        rig.backend.uploads.lock().unwrap().len(),
        1,
        "once, not twice"
    );
    assert_eq!(rig.backend.attaches.lock().unwrap().len(), 1);
}
