#!/usr/bin/env python3
"""Validate result JSON against the Electron baseline's schema, so the two compare 1:1.

    validate-result.py <result.json> [...]

The schema path comes from RESULT_SCHEMA, defaulting to the file the baseline harness owns.
"""
import json
import os
import sys
from pathlib import Path

from jsonschema import Draft202012Validator

DEFAULT_SCHEMA = Path(__file__).resolve().parents[2] / "scripts/native-baseline/result.schema.json"


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    schema_path = Path(os.environ.get("RESULT_SCHEMA") or DEFAULT_SCHEMA)
    if not schema_path.is_file():
        sys.exit(f"schema not found: {schema_path}")
    schema = json.loads(schema_path.read_text())
    Draft202012Validator.check_schema(schema)
    validator = Draft202012Validator(schema)

    invalid = 0
    for name in sys.argv[1:]:
        errors = sorted(validator.iter_errors(json.loads(Path(name).read_text())), key=lambda e: list(e.path))
        if errors:
            invalid += 1
            print(f"INVALID {name}")
            for error in errors:
                print(f"  /{'/'.join(map(str, error.path))}: {error.message}")
        else:
            print(f"VALID {name} against {schema.get('$id', schema_path)}")
    sys.exit(1 if invalid else 0)


if __name__ == "__main__":
    main()
