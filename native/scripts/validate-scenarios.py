#!/usr/bin/env python3
"""Validate the exported Ladle scenarios against the pinned API contract.

    scripts/validate-scenarios.py [--dir DIR]

`DIR` defaults to `fixtures/scenarios`. Every message, channel, user, membership and voice-
presence entry is checked against `contract/openapi.json`: `MessageDto` (and `PinnedMessageDto`
for the pinned lists, which is a message with its author), `ChannelDto`, `UserEntity`,
`MembershipResponseDto` and `VoicePresenceUserDto`. Nested values come along with their parent.

Like `backend/test/message-wire-contract.e2e-spec.ts` at the commit in `contract/PIN`, every
`$ref` is resolved and every object is closed (`additionalProperties: false`), so a field the
contract doesn't declare fails rather than passing unnoticed.
"""
import argparse
import json
import sys
from pathlib import Path

from jsonschema import FormatChecker
from jsonschema.validators import validator_for

NATIVE = Path(__file__).resolve().parent.parent
SPEC = NATIVE / "contract" / "openapi.json"
DEFAULT_DIR = NATIVE / "fixtures" / "scenarios"


def strict_schemas() -> dict:
    """`components.schemas` with every `$ref` resolved, nullable widened and objects closed."""
    spec = json.loads(SPEC.read_text())
    schemas = spec["components"]["schemas"]
    resolved: dict = {}

    def resolve(node):
        if isinstance(node, list):
            return [resolve(item) for item in node]
        if not isinstance(node, dict):
            return node
        reference = node.get("$ref")
        if reference is not None:
            return resolve_component(reference.rsplit("/", 1)[-1])

        schema = {}
        nullable = node.get("nullable", False)
        for key, value in node.items():
            if key == "nullable":
                continue
            # An enum's values are data, not schemas.
            schema[key] = value if key == "enum" else resolve(value)
        if "properties" in schema and "additionalProperties" not in schema:
            schema["additionalProperties"] = False
        if not nullable:
            return schema
        if "allOf" in schema:
            # @nestjs/swagger adds `type: object` beside the reference; a null is not an object.
            others = {key: value for key, value in schema.items() if key != "allOf"}
            others.pop("type", None)
            return {**others, "anyOf": [{"type": "null"}, *schema["allOf"]]}
        return {"anyOf": [{"type": "null"}, schema]}

    def resolve_component(name: str):
        if name not in resolved:
            resolved[name] = resolve(schemas[name])
        return resolved[name]

    return {name: resolve_component(name) for name in schemas}


def failures(validator, value, path: str) -> list:
    if validator.is_valid(value):
        return []
    errors = []
    for error in validator.iter_errors(value):
        suffix = "".join(
            f"[{part}]" if isinstance(part, int) else f".{part}"
            for part in error.absolute_path
        )
        errors.append(f"{path}{suffix}: {error.message}")
    return errors


def checked_entries(scenario: dict):
    """Every value the contract covers, with where it came from."""
    yield "me", "UserEntity", scenario.get("me")
    for index, user in enumerate(scenario.get("users") or []):
        yield f"users[{index}]", "UserEntity", user
    for community in scenario.get("communities") or []:
        community_id = community.get("id", "?")
        for index, channel in enumerate(community.get("channels") or []):
            yield f"communities[{community_id}].channels[{index}]", "ChannelDto", channel
    for section, component in (
        ("messagesByChannel", "MessageDto"),
        ("threadRepliesByParent", "MessageDto"),
        ("messagesByDmGroup", "MessageDto"),
        ("pinnedByChannel", "PinnedMessageDto"),
    ):
        for context_id, messages in (scenario.get(section) or {}).items():
            for index, message in enumerate(messages or []):
                yield f"{section}[{context_id}][{index}]", component, message
    for community_id, memberships in (scenario.get("membershipsByCommunity") or {}).items():
        for index, membership in enumerate(memberships or []):
            yield (
                f"membershipsByCommunity[{community_id}][{index}]",
                "MembershipResponseDto",
                membership,
            )
    for channel_id, presence in (scenario.get("voicePresenceByChannel") or {}).items():
        for index, user in enumerate(presence or []):
            yield f"voicePresenceByChannel[{channel_id}][{index}]", "VoicePresenceUserDto", user


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dir", type=Path, default=DEFAULT_DIR)
    args = parser.parse_args()

    validators = {
        name: validator_for(schema)(schema, format_checker=FormatChecker())
        for name, schema in strict_schemas().items()
    }
    files = sorted(args.dir.glob("*.json"))
    if not files:
        print(f"no scenario JSON under {args.dir}", file=sys.stderr)
        return 1

    total_errors = 0
    for file in files:
        try:
            scenario = json.loads(file.read_text())
        except json.JSONDecodeError as error:
            print(f"{file.name}: {error}", file=sys.stderr)
            total_errors += 1
            continue
        errors = []
        checked = 0
        for path, component, value in checked_entries(scenario):
            checked += 1
            errors.extend(failures(validators[component], value, path))
        print(f"{file.name}: {checked} entries checked, {len(errors)} violation(s)")
        for error in errors:
            print(f"  {error}", file=sys.stderr)
        total_errors += len(errors)

    if total_errors:
        print(f"{total_errors} contract violation(s)", file=sys.stderr)
        return 1
    print("all scenarios match the contract")
    return 0


if __name__ == "__main__":
    sys.exit(main())
