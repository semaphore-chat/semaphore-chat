//! Fields an older server doesn't send: required in the contract, absent from the floor.
//!
//! The floor (`contract/floor-openapi.json`, pinned by `scripts/pin-contract.sh --floor`) is the
//! oldest server release the client still reads. A field the contract requires but the floor's
//! schema doesn't have is missing on those servers, and a required field that's missing fails
//! the whole response (wire-contract rule 4). So such a field is made optional before progenitor
//! sees it: it generates as `Option<T>` with `#[serde(default)]`, and a missing one is `None`.
//!
//! Only non-nullable fields of schemas the floor has are touched. A nullable one already
//! generates as `Option` with `default` (`tolerate_missing_optionals`), and a schema the floor
//! doesn't have belongs to a route that server doesn't serve.

use anyhow::Context;
use serde_json::Value;

/// A note added to each relaxed field's description, so the generated doc says why it's optional.
pub const NOTE: &str =
    "Missing on a server older than this field (below the contract's floor): None.";

/// Makes every required field absent from the floor optional. Returns them as
/// `(schema, field)`, sorted.
pub fn relax(spec: &mut Value, floor: &Value) -> anyhow::Result<Vec<(String, String)>> {
    let floor_schemas = floor
        .pointer("/components/schemas")
        .and_then(Value::as_object)
        .context("the floor has no components.schemas")?;
    let schemas = spec
        .pointer_mut("/components/schemas")
        .and_then(Value::as_object_mut)
        .context("openapi.json has no components.schemas")?;

    let mut relaxed = Vec::new();
    for (name, schema) in schemas.iter_mut() {
        let Some(floor_schema) = floor_schemas.get(name) else {
            continue;
        };
        let floor_properties = floor_schema.get("properties").and_then(Value::as_object);
        let has_in_floor =
            |field: &str| floor_properties.is_some_and(|properties| properties.contains_key(field));
        let Some(schema) = schema.as_object_mut() else {
            continue;
        };
        let Some(required) = schema.get("required").and_then(Value::as_array) else {
            continue;
        };
        let properties = schema.get("properties").and_then(Value::as_object);
        let nullable = |field: &str| {
            properties
                .and_then(|properties| properties.get(field))
                .and_then(|property| property.get("nullable"))
                .and_then(Value::as_bool)
                .unwrap_or(false)
        };
        let missing: Vec<String> = required
            .iter()
            .filter_map(Value::as_str)
            .filter(|field| !has_in_floor(field) && !nullable(field))
            .map(str::to_owned)
            .collect();
        if missing.is_empty() {
            continue;
        }
        if let Some(required) = schema.get_mut("required").and_then(Value::as_array_mut) {
            required.retain(|field| {
                field
                    .as_str()
                    .is_none_or(|field| !missing.iter().any(|m| m == field))
            });
        }
        if let Some(properties) = schema.get_mut("properties").and_then(Value::as_object_mut) {
            for field in &missing {
                if let Some(property) = properties.get_mut(field).and_then(Value::as_object_mut) {
                    note(property);
                }
            }
        }
        relaxed.extend(missing.into_iter().map(|field| (name.clone(), field)));
    }
    relaxed.sort();
    Ok(relaxed)
}

/// Appends [`NOTE`] to a property's description, in the same paragraph: an indented paragraph
/// of its own would be a code block to rustdoc, and so a doctest. A `$ref` property has its siblings ignored by
/// OpenAPI 3.0, so it's left alone.
fn note(property: &mut serde_json::Map<String, Value>) {
    if property.contains_key("$ref") {
        return;
    }
    let description = match property.get("description").and_then(Value::as_str) {
        Some(description) if !description.is_empty() => format!("{description} {NOTE}"),
        _ => NOTE.to_owned(),
    };
    property.insert("description".into(), Value::String(description));
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn spec(schemas: Value) -> Value {
        json!({ "components": { "schemas": schemas } })
    }

    #[test]
    fn a_required_field_the_floor_lacks_becomes_optional_with_a_note() {
        let mut current = spec(json!({
            "Caps": {
                "type": "object",
                "properties": {
                    "view": { "type": "boolean" },
                    "pin": { "type": "boolean", "description": "Pin messages here." },
                    "seeRemoved": { "type": "boolean" },
                },
                "required": ["view", "pin", "seeRemoved"],
            }
        }));
        let floor = spec(json!({
            "Caps": { "type": "object", "properties": { "view": { "type": "boolean" } }, "required": ["view"] }
        }));
        let relaxed = relax(&mut current, &floor).unwrap();
        assert_eq!(
            relaxed,
            vec![
                ("Caps".to_owned(), "pin".to_owned()),
                ("Caps".to_owned(), "seeRemoved".to_owned())
            ]
        );
        let caps = &current["components"]["schemas"]["Caps"];
        assert_eq!(caps["required"], json!(["view"]));
        assert_eq!(
            caps["properties"]["pin"]["description"],
            json!(format!("Pin messages here. {NOTE}"))
        );
        assert_eq!(caps["properties"]["seeRemoved"]["description"], json!(NOTE));
        assert!(caps["properties"]["view"].get("description").is_none());
    }

    #[test]
    fn nullable_fields_new_schemas_and_fields_the_floor_has_are_left_alone() {
        let mut current = spec(json!({
            "Message": {
                "type": "object",
                "properties": {
                    "id": { "type": "string" },
                    "replyTo": { "type": "string", "nullable": true },
                },
                "required": ["id", "replyTo"],
            },
            "BrandNew": {
                "type": "object",
                "properties": { "x": { "type": "string" } },
                "required": ["x"],
            },
        }));
        let floor = spec(json!({
            "Message": { "type": "object", "properties": { "id": { "type": "string" } }, "required": ["id"] }
        }));
        let before = current.clone();
        assert!(relax(&mut current, &floor).unwrap().is_empty());
        assert_eq!(current, before);
    }

    #[test]
    fn a_ref_field_is_relaxed_without_a_description_sibling() {
        let mut current = spec(json!({
            "Upload": {
                "type": "object",
                "properties": { "id": { "type": "string" }, "meta": { "$ref": "#/components/schemas/Meta" } },
                "required": ["id", "meta"],
            }
        }));
        let floor = spec(
            json!({ "Upload": { "type": "object", "properties": { "id": { "type": "string" } } } }),
        );
        let relaxed = relax(&mut current, &floor).unwrap();
        assert_eq!(relaxed, vec![("Upload".to_owned(), "meta".to_owned())]);
        let upload = &current["components"]["schemas"]["Upload"];
        assert_eq!(upload["required"], json!(["id"]));
        assert_eq!(
            upload["properties"]["meta"],
            json!({ "$ref": "#/components/schemas/Meta" })
        );
    }

    #[test]
    fn a_floor_without_schemas_is_an_error() {
        let mut current = spec(json!({}));
        assert!(relax(&mut current, &json!({})).is_err());
    }
}
