#!/usr/bin/env python3
"""The error type both design generators raise.

It lives here rather than in `gen_tokens.py` because `gen_icons.py` raises it
too: one shared class keeps `except TokenError` working when `gen_tokens.py`
runs as a script, where an import of `gen_tokens` would build a second copy of
the class (the running module is `__main__`, not `gen_tokens`).
"""

from __future__ import annotations


class TokenError(ValueError):
    """A source document does not match its schema; the message starts with the dotted path."""
