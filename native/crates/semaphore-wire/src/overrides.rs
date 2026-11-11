//! Wire types written by hand, in place of what `tools/gen-api` would generate (its `OVERRIDDEN`
//! list). Each keeps the contract's field names and types; only what the generated shape gets
//! wrong for the server is different.

use crate::types::CreateMessageSpanDto;

/// `UpdateMessageDto`, the body of `PATCH /api/messages/{id}`.
///
/// The generated type made `attachments` a plain list skipped when empty, so "leave them alone"
/// and "remove them all" were the same request (none). The server tells them apart
/// (`MessagesService.update`: `if (updateMessageDto.attachments)`, and `[]` is truthy): absent
/// leaves the message's attachments untouched, a list keeps only the files it names.
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug, Default)]
pub struct UpdateMessageDto {
    /// `None` leaves the attachments as they are; `Some(vec![])` removes them all.
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub attachments: ::std::option::Option<::std::vec::Vec<::std::string::String>>,
    #[serde(
        rename = "channelId",
        skip_serializing_if = "::std::option::Option::is_none",
        default
    )]
    pub channel_id: ::std::option::Option<::uuid::Uuid>,
    #[serde(
        rename = "directMessageGroupId",
        skip_serializing_if = "::std::option::Option::is_none",
        default
    )]
    pub direct_message_group_id: ::std::option::Option<::uuid::Uuid>,
    #[serde(
        rename = "pendingAttachments",
        skip_serializing_if = "::std::option::Option::is_none",
        default
    )]
    pub pending_attachments: ::std::option::Option<u64>,
    #[serde(
        rename = "replyToId",
        skip_serializing_if = "::std::option::Option::is_none",
        default
    )]
    pub reply_to_id: ::std::option::Option<::uuid::Uuid>,
    #[serde(default, skip_serializing_if = "::std::vec::Vec::is_empty")]
    pub spans: ::std::vec::Vec<CreateMessageSpanDto>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn absent_and_empty_attachments_are_different_requests() {
        let absent = serde_json::to_value(UpdateMessageDto::default()).unwrap();
        assert!(absent.get("attachments").is_none(), "{absent}");
        let empty = serde_json::to_value(UpdateMessageDto {
            attachments: Some(Vec::new()),
            ..UpdateMessageDto::default()
        })
        .unwrap();
        assert_eq!(empty["attachments"], serde_json::json!([]));
    }
}
