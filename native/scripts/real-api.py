#!/usr/bin/env python3
"""The other side of slice-real.sh: what the seeded users do to a real backend while the app runs.

    python3 scripts/real-api.py <server> ids                      shell lines: COMMUNITY=... CH_GENERAL=...
    python3 scripts/real-api.py <server> post-as <user> <channel-id> <text> [<mention-user>]
    python3 scripts/real-api.py <server> expect-device <user> <device-name>
    python3 scripts/real-api.py <server> revoke <user> <device-name>

Each signs in as a web client (no X-Client-Type), so its own session never looks like the app's.
The users and passwords are backend/prisma/seed-e2e.ts's. Standard library only: it runs in the
native build image, which has Python and no curl. Any answer other than the one expected fails
with the request and the response printed (tokens left out).
"""

import json
import sys
import urllib.error
import urllib.request

PASSWORDS = {
    "testuser": "Test123!@#",
    "testuser2": "Test123!@#",
    "testuser3": "Test123!@#",
    "admin": "Admin123!@#",
}


def call(server, method, path, body=None, token=None, expect=(200, 201)):
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(server.rstrip("/") + path, data=data, method=method)
    request.add_header("Content-Type", "application/json")
    request.add_header("User-Agent", "semaphore-real-smoke")
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            status, text = response.status, response.read().decode()
    except urllib.error.HTTPError as error:
        status, text = error.code, error.read().decode()
    if status not in expect:
        shown = dict(body or {})
        if "password" in shown:
            shown["password"] = "<redacted>"
        sys.exit(f"real-api: {method} {path} {json.dumps(shown)} answered {status}: {text}")
    return json.loads(text) if text else None


def sign_in(server, user):
    answer = call(server, "POST", "/api/auth/login", {"username": user, "password": PASSWORDS[user]})
    return answer["accessToken"]


def profile(server, token):
    return call(server, "GET", "/api/users/profile", token=token)


def user_id(server, token, username):
    return call(server, "GET", f"/api/users/username/{username}", token=token)["id"]


def ids(server):
    token = sign_in(server, "testuser")
    me = profile(server, token)
    communities = call(server, "GET", "/api/community/mine", token=token)
    lines = {"ME": me["id"], "ME_NAME": me["username"]}
    for community in communities:
        key = {"Test Community": "COMMUNITY", "Second Community": "SECOND_COMMUNITY"}.get(community["name"])
        if not key:
            continue
        lines[key] = community["id"]
        channels = call(server, "GET", f"/api/channels/community/{community['id']}", token=token)
        for channel in channels:
            if key == "COMMUNITY" and channel["name"] in ("general", "random"):
                lines[f"CH_{channel['name'].upper()}"] = channel["id"]
    lines["U2"] = user_id(server, token, "testuser2")
    for name in ("COMMUNITY", "SECOND_COMMUNITY", "CH_GENERAL", "CH_RANDOM"):
        if name not in lines:
            sys.exit(f"real-api: the seed has no {name}: {json.dumps(lines)}")
    for key, value in lines.items():
        print(f"{key}={value}")


def post_as(server, user, channel, text, mention=None):
    token = sign_in(server, user)
    spans = [{"type": "PLAINTEXT", "text": text}]
    if mention:
        mentioned = user_id(server, token, mention)
        spans.append({"type": "PLAINTEXT", "text": " "})
        spans.append({"type": "USER_MENTION", "userId": mentioned, "text": f"@{mention}"})
    call(server, "POST", "/api/messages", {"channelId": channel, "spans": spans, "attachments": []}, token)


def sessions_named(server, token, name):
    sessions = call(server, "GET", "/api/auth/sessions", token=token)
    return [s for s in sessions if s.get("deviceName") == name and not s.get("isCurrent")], sessions


def expect_device(server, user, name):
    named, sessions = sessions_named(server, sign_in(server, user), name)
    if not named:
        sys.exit(f"real-api: no session named {name!r} in GET /api/auth/sessions: {json.dumps(sessions)}")
    print(f"real-api: {user} has {len(named)} session(s) named {name!r}")


def revoke(server, user, name):
    token = sign_in(server, user)
    named, sessions = sessions_named(server, token, name)
    if len(named) != 1:
        sys.exit(f"real-api: expected one session named {name!r}, got: {json.dumps(sessions)}")
    call(server, "DELETE", f"/api/auth/sessions/{named[0]['id']}", token=token)
    print(f"real-api: revoked {user}'s session {named[0]['id']} ({name})")


def main(argv):
    if len(argv) < 2:
        sys.exit(__doc__)
    server, command, rest = argv[0], argv[1], argv[2:]
    if command == "ids" and not rest:
        ids(server)
    elif command == "post-as" and len(rest) in (3, 4):
        post_as(server, *rest)
    elif command == "expect-device" and len(rest) == 2:
        expect_device(server, *rest)
    elif command == "revoke" and len(rest) == 2:
        revoke(server, *rest)
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
