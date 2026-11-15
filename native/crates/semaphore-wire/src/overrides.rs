//! Wire types written by hand, in place of what `tools/gen-api` would generate (its `OVERRIDDEN`
//! list). Each keeps the contract's field names and types; only what the generated shape gets
//! wrong for the server is different.

use crate::types::CreateMessageSpanDto;

/// `AppearanceSettingsResponseDto`, `GET` and `PATCH /api/appearance-settings`.
///
/// `baseColor`, `matchSystem` and `newDesign` came with the base-colour settings, and a server
/// older than them sends none of the three (wire-contract rule 4). The generated shape makes
/// them required, which would lose the whole read on such a server; defaults here let core fall
/// back to the accent's primary colour and to "off".
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
pub struct AppearanceSettingsResponseDto {
    #[serde(rename = "accentColor")]
    pub accent_color: ::std::string::String,
    #[serde(rename = "baseColor", default)]
    pub base_color: ::std::string::String,
    #[serde(rename = "createdAt")]
    pub created_at: ::chrono::DateTime<::chrono::offset::Utc>,
    pub id: ::std::string::String,
    pub intensity: ::std::string::String,
    #[serde(rename = "matchSystem", default)]
    pub match_system: bool,
    #[serde(rename = "newDesign", default)]
    pub new_design: bool,
    #[serde(rename = "themeMode")]
    pub theme_mode: ::std::string::String,
    #[serde(rename = "updatedAt")]
    pub updated_at: ::chrono::DateTime<::chrono::offset::Utc>,
    #[serde(rename = "userId")]
    pub user_id: ::std::string::String,
}

/// `OnboardingStatusDto`, `GET /api/onboarding/status`.
///
/// `setupTokenRequired` came with the setup-token switch, and a server older than it sends the
/// status without it (wire-contract rule 4: a field may be missing on a server older than the
/// schema). The generated shape makes it required, so the whole read failed on such a server, and
/// `probe_server` then took a fresh instance for a set-up one. The app only reads `needsSetup`, so
/// the default exists to keep the rest of the status; `false` is what those servers did, as they
/// handed the wizard its token rather than asking the operator for one.
#[derive(::serde::Deserialize, ::serde::Serialize, Clone, Debug)]
pub struct OnboardingStatusDto {
    #[serde(rename = "hasUsers")]
    pub has_users: bool,
    #[serde(rename = "needsSetup")]
    pub needs_setup: bool,
    #[serde(
        rename = "setupToken",
        skip_serializing_if = "::std::option::Option::is_none",
        default
    )]
    pub setup_token: ::std::option::Option<::std::string::String>,
    #[serde(rename = "setupTokenRequired", default)]
    pub setup_token_required: bool,
}

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

    /// The pinned contract, read as text: a property added to an overridden schema has to show up
    /// in its override, and only a test can say so.
    const CONTRACT: &str = include_str!("../../../contract/openapi.json");

    /// `tools/gen-api`'s `OVERRIDDEN` list, read from its source, so the test below cannot quietly
    /// stop covering a type the generator no longer makes.
    const GENERATOR: &str = include_str!("../../../tools/gen-api/src/main.rs");

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

    /// What `gen-api` says it leaves to this module.
    fn overridden_in_generator() -> Vec<&'static str> {
        let list = GENERATOR
            .split_once("const OVERRIDDEN")
            .expect("gen-api names the schemas it leaves to overrides.rs")
            .1;
        let list = list
            .split_once("&[")
            .expect("OVERRIDDEN is a list")
            .1
            .split_once("];")
            .expect("OVERRIDDEN is closed")
            .0;
        list.split('"').skip(1).step_by(2).collect()
    }

    /// One instance of each overridden type with every field set: serialized, its keys are the
    /// names its serde attributes give it, which is what the contract's properties must be.
    fn overridden_values() -> Vec<(&'static str, serde_json::Value)> {
        let at = ::chrono::DateTime::parse_from_rfc3339("2026-11-01T00:00:00Z")
            .unwrap()
            .with_timezone(&::chrono::offset::Utc);
        let appearance = AppearanceSettingsResponseDto {
            accent_color: "teal".to_owned(),
            base_color: "#0d9488".to_owned(),
            created_at: at,
            id: "id".to_owned(),
            intensity: "minimal".to_owned(),
            match_system: true,
            new_design: true,
            theme_mode: "dark".to_owned(),
            updated_at: at,
            user_id: "user".to_owned(),
        };
        let onboarding = OnboardingStatusDto {
            has_users: false,
            needs_setup: true,
            setup_token: Some("token".to_owned()),
            setup_token_required: true,
        };
        // `spans` is skipped when empty, so this one is a list with a span in it.
        let span: CreateMessageSpanDto =
            serde_json::from_value(serde_json::json!({ "type": "PLAINTEXT" })).unwrap();
        let update = UpdateMessageDto {
            attachments: Some(vec!["file".to_owned()]),
            channel_id: Some(::uuid::Uuid::nil()),
            direct_message_group_id: Some(::uuid::Uuid::nil()),
            pending_attachments: Some(1),
            reply_to_id: Some(::uuid::Uuid::nil()),
            spans: vec![span],
        };
        vec![
            (
                "AppearanceSettingsResponseDto",
                serde_json::to_value(appearance).unwrap(),
            ),
            (
                "OnboardingStatusDto",
                serde_json::to_value(onboarding).unwrap(),
            ),
            ("UpdateMessageDto", serde_json::to_value(update).unwrap()),
        ]
    }

    #[test]
    fn every_override_carries_exactly_the_contracts_properties() {
        let contract: serde_json::Value =
            serde_json::from_str(CONTRACT).expect("the pinned contract is JSON");
        let values = overridden_values();

        let mut checked: Vec<&str> = values.iter().map(|(name, _)| *name).collect();
        checked.sort_unstable();
        let mut declared = overridden_in_generator();
        declared.sort_unstable();
        assert_eq!(
            checked, declared,
            "give every OVERRIDDEN type in tools/gen-api an instance here, so its fields are checked"
        );

        for (name, value) in values {
            let properties = contract
                .pointer(&format!("/components/schemas/{name}/properties"))
                .unwrap_or_else(|| panic!("{name} is a schema in the pinned contract"));
            let mut contract_keys: Vec<&str> = properties
                .as_object()
                .expect("a schema's properties")
                .keys()
                .map(String::as_str)
                .collect();
            contract_keys.sort_unstable();
            let mut override_keys: Vec<&str> = value
                .as_object()
                .expect("an override serializes as an object")
                .keys()
                .map(String::as_str)
                .collect();
            override_keys.sort_unstable();
            assert_eq!(
                override_keys, contract_keys,
                "{name} in overrides.rs must carry every property the contract declares: \
                 add the field (with its serde name) or remove the one the contract dropped"
            );
        }
    }
}
