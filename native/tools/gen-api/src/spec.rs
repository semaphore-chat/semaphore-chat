//! The OpenAPI contract, read and normalised for progenitor.

use std::path::Path;

use anyhow::Context;

/// Loads `openapi.json`, then removes what progenitor cannot express or should not own.
///
/// 1. `multipart/form-data` request bodies. Progenitor rejects them; `POST /api/file-upload`
///    is hand-written in `semaphore-api/src/upload.rs`.
/// 2. Every `default` response, and every non-2xx response that carries content. Progenitor
///    turns those into one error type per operation, so `Error<T>` would differ between
///    methods for no gain: the client reads `ErrorResponseDto` out of the body itself (see
///    `semaphore_api::error`). After this, every operation returns `Error<()>`.
pub fn load(path: &Path) -> anyhow::Result<serde_json::Value> {
    let raw =
        std::fs::read_to_string(path).with_context(|| format!("reading {}", path.display()))?;
    let mut spec: serde_json::Value = serde_json::from_str(&raw).context("parsing openapi.json")?;

    let paths = spec
        .get_mut("paths")
        .and_then(|paths| paths.as_object_mut())
        .context("openapi.json has no paths object")?;

    for path_item in paths.values_mut() {
        let Some(path_item) = path_item.as_object_mut() else {
            continue;
        };
        for operation in path_item.values_mut() {
            let Some(operation) = operation.as_object_mut() else {
                continue;
            };
            // Only operations carry a `requestBody`; parameters and extensions don't.
            if operation.get("requestBody").is_some() {
                let multipart = operation
                    .get("requestBody")
                    .and_then(|body| body.get("content"))
                    .and_then(|content| content.as_object())
                    .map(|content| content.contains_key("multipart/form-data"))
                    .unwrap_or(false);
                if multipart {
                    operation.remove("requestBody");
                }
            }

            let Some(responses) = operation
                .get_mut("responses")
                .and_then(|r| r.as_object_mut())
            else {
                continue;
            };
            responses.retain(|status, response| {
                let has_content = response
                    .get("content")
                    .and_then(|content| content.as_object())
                    .map(|content| !content.is_empty())
                    .unwrap_or(false);
                if status == "default" {
                    return false;
                }
                if has_content {
                    // Non-2xx only: these are the declared errors.
                    if let Ok(code) = status.parse::<u16>() {
                        return (200..300).contains(&code);
                    }
                }
                true
            });
        }
    }

    Ok(spec)
}

/// One named enum in the contract.
pub struct EnumDef {
    pub name: String,
    pub description: Option<String>,
    pub kind: EnumKind,
}

pub enum EnumKind {
    /// Wire values are strings, matched exactly.
    String(Vec<String>),
    /// Wire values are integers.
    Integer(Vec<i64>),
}

/// Every `components.schemas` entry that declares `enum`, sorted by name.
pub fn enums(spec: &serde_json::Value) -> anyhow::Result<Vec<EnumDef>> {
    let schemas = spec
        .get("components")
        .and_then(|components| components.get("schemas"))
        .and_then(|schemas| schemas.as_object())
        .context("openapi.json has no components.schemas object")?;

    let mut enums = Vec::new();
    for (name, schema) in schemas {
        let Some(values) = schema.get("enum").and_then(|values| values.as_array()) else {
            continue;
        };
        let kind = match schema.get("type").and_then(|kind| kind.as_str()) {
            Some("string") => EnumKind::String(
                values
                    .iter()
                    .map(|value| {
                        value.as_str().map(str::to_owned).with_context(|| {
                            format!("{name}: a string enum has a non-string value")
                        })
                    })
                    .collect::<anyhow::Result<_>>()?,
            ),
            Some("integer") => EnumKind::Integer(
                values
                    .iter()
                    .map(|value| {
                        value.as_i64().with_context(|| {
                            format!("{name}: an integer enum has a non-integer value")
                        })
                    })
                    .collect::<anyhow::Result<_>>()?,
            ),
            other => anyhow::bail!("{name}: unsupported enum type {other:?}"),
        };
        enums.push(EnumDef {
            name: name.clone(),
            description: schema
                .get("description")
                .and_then(|description| description.as_str())
                .map(str::to_owned),
            kind,
        });
    }
    enums.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(enums)
}

/// The component a `$ref` in `socket-events.json` points at.
pub fn ref_name(value: &serde_json::Value) -> anyhow::Result<String> {
    let reference = value
        .get("$ref")
        .and_then(|reference| reference.as_str())
        .context("expected a $ref")?;
    reference
        .rsplit('/')
        .next()
        .map(str::to_owned)
        .context("a $ref has no component name")
}

/// `newDirectMessage` -> `NewDirectMessage`; `dmVoiceCallStarted` -> `DmVoiceCallStarted`;
/// `USER_MENTION` -> `UserMention`.
pub fn pascal_case(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    let mut word_start = true;
    let mut previous_lower_or_digit = false;
    for character in name.chars() {
        if !character.is_ascii_alphanumeric() {
            word_start = true;
            previous_lower_or_digit = false;
            continue;
        }
        if word_start || (character.is_ascii_uppercase() && previous_lower_or_digit) {
            out.extend(character.to_uppercase());
            word_start = false;
        } else {
            out.extend(character.to_lowercase());
        }
        previous_lower_or_digit = !character.is_ascii_uppercase();
    }
    out
}

/// `newDirectMessage` -> `new_direct_message`.
pub fn snake_case(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    for (index, character) in name.chars().enumerate() {
        if character.is_ascii_uppercase() {
            if index != 0 {
                out.push('_');
            }
            out.push(character.to_ascii_lowercase());
        } else if character.is_ascii_alphanumeric() {
            out.push(character);
        } else {
            out.push('_');
        }
    }
    out
}
