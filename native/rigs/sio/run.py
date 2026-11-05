#!/usr/bin/env python3
"""T8 orchestrator: the Rust session and the real socket.io-client against the real gateway.

    run.py setup                      seed users, community, channel; prints the state file
    run.py cycles --cycles 1000 --out results/t8/cycles
    run.py auth --out results/t8/auth
    run.py suspend --out results/t8/suspend
    run.py analyze results/t8/cycles

Runs on the host with docker and Python's standard library. No node, pnpm or cargo on the host:
rig-sio runs in the pinned build image, ref-client.js in the backend's image.

RIG ONLY, never in a real client: refresh replays the login's refresh cookie (no special
User-Agent), short-lived tokens are minted here with the test stack's JWT secret, and the backend
runs with WS_CONNECTION_RATE_LIMIT raised, because the default of 10 per minute per address would
refuse most of 1,000 reconnects.
"""
import argparse
import base64
import gzip
import hashlib
import hmac
import json
import os
import random
import re
import socket
import statistics
import subprocess
import threading
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

NATIVE = Path(__file__).resolve().parents[2]
ROOT = NATIVE.parent
TICKET = "native-sio"
LABEL = "org.semaphore-chat.test-stack"
JWT_SECRET = "test-stack-jwt-secret"
PASSWORD = "Password123!"
STATE = Path(os.environ.get("T8_STATE", "/tmp/claude-t8-state.json"))
SEQ = re.compile(r"S(\d+):(\d+)")


def sh(*args, check=True):
    return subprocess.run(args, check=check, capture_output=True, text=True)


def now_ms():
    return int(time.time() * 1000)


def loadavg():
    return Path("/proc/loadavg").read_text().strip()


def build_image():
    data = (NATIVE / "docker/Dockerfile.build").read_bytes() + (NATIVE / "rust-toolchain.toml").read_bytes()
    return "semaphore-native-build:" + hashlib.sha256(data + f"{os.getuid()}\n".encode()).hexdigest()[:12]


def target_volume():
    return "semaphore-native-target-" + hashlib.sha256(str(ROOT).encode()).hexdigest()[:8]


def backend_container():
    names = sh("docker", "ps", "--filter", f"label={LABEL}.ticket={TICKET}", "--filter", f"label={LABEL}.role=backend", "--format", "{{.Names}}").stdout.split()
    if not names:
        raise SystemExit("backend is not running: scripts/test-stack.sh native-sio run ...")
    return names[0]


def ip_of(container):
    return sh("docker", "inspect", "-f", '{{(index .NetworkSettings.Networks "semaphore-test").IPAddress}}', container).stdout.strip()


def api_url():
    return f"http://{ip_of(backend_container())}:3000"


def http(method, path, body=None, token=None, cookie=None, base=None, want=None):
    request = urllib.request.Request((base or api_url()) + path, method=method,
                                     data=None if body is None else json.dumps(body).encode())
    request.add_header("Content-Type", "application/json")
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    if cookie:
        request.add_header("Cookie", cookie)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw, status, headers = response.read(), response.status, response.headers
    except urllib.error.HTTPError as error:
        raw, status, headers = error.read(), error.code, error.headers
    if want and status != want:
        raise RuntimeError(f"{method} {path}: {status} {raw[:300]!r}")
    try:
        parsed = json.loads(raw) if raw else None
    except ValueError:
        parsed = raw.decode(errors="replace")
    return status, parsed, headers


def login(username):
    _, body, headers = http("POST", "/api/auth/login", {"username": username, "password": PASSWORD}, want=200)
    cookie = next(c.split(";")[0] for c in headers.get_all("set-cookie") if c.startswith("refresh_token="))
    return {"token": body["accessToken"], "cookie": cookie}


def b64(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=")


def decode_claims(token):
    part = token.split(".")[1]
    return json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))


def mint(real_token, ttl_s):
    """A real session's claims with a shorter life. Same secret, same shape, as backend e2e does."""
    claims = decode_claims(real_token)
    now = int(time.time())
    claims.update(iat=now, exp=now + ttl_s, jti=str(uuid.uuid4()))
    head = b64(b'{"alg":"HS256","typ":"JWT"}') + b"." + b64(json.dumps(claims).encode())
    return (head + b"." + b64(hmac.new(JWT_SECRET.encode(), head, hashlib.sha256).digest())).decode()


def spans(text):
    return [{"type": "PLAINTEXT", "text": text, "userId": None, "specialKind": None, "communityId": None, "aliasId": None}]


def setup():
    code = "t8-invite"
    sh("docker", "exec", f"{TICKET}-pg", "psql", "-U", "semaphore", "-d", "semaphore_test", "-c",
       f"""INSERT INTO "InstanceInvite"(id, code) VALUES ('{uuid.uuid4()}', '{code}') ON CONFLICT DO NOTHING""")
    suffix = uuid.uuid4().hex[:6]
    state = {"users": {}}
    for role in ("owner", "listener", "authuser"):
        name = f"t8{role}{suffix}"
        _, user, _ = http("POST", "/api/users", {"code": code, "username": name, "password": PASSWORD, "email": f"{name}@test.local"}, want=201)
        state["users"][role] = {"id": user["id"], "username": name}
    token = login(state["users"]["owner"]["username"])["token"]
    _, community, _ = http("POST", "/api/community", {"name": f"T8 {suffix}", "description": "t8"}, token, want=201)
    _, channel, _ = http("POST", "/api/channels", {"name": "t8", "communityId": community["id"], "type": "TEXT", "isPrivate": False}, token, want=201)
    for role in ("listener", "authuser"):
        http("POST", "/api/membership", {"userId": state["users"][role]["id"], "communityId": community["id"]}, token, want=201)
    _, dm, _ = http("POST", "/api/direct-messages", {"userIds": [state["users"]["listener"]["id"]]}, token)
    state.update(community=community["id"], channel=channel["id"], dm=dm["id"])
    STATE.write_text(json.dumps(state, indent=1))
    print(json.dumps(state))
    return state


def load_state():
    return json.loads(STATE.read_text())


class Client:
    """One client container, either implementation, behind the control port."""

    def __init__(self, kind, name=None):
        self.kind = kind
        self.name = name or f"t8-{kind}-{uuid.uuid4().hex[:6]}"
        base = ["docker", "run", "-d", "--rm", "--init", "--name", self.name, "--network", "semaphore-test", "--cap-add", "NET_ADMIN"]
        if kind == "rust":
            args = base + ["--user", f"{os.getuid()}:{os.getgid()}", "-v", f"{target_volume()}:/cache/target:ro", build_image(), "/cache/target/debug/rig-sio"]
        else:
            image = sh("docker", "inspect", "-f", "{{.Config.Image}}", backend_container()).stdout.strip()
            args = base + ["-v", f"{NATIVE}/rigs/sio:/rig:ro", "-e", "NODE_PATH=/app/node_modules", "--entrypoint", "node", image, "/rig/ref-client.js"]
        sh(*args)
        address = ip_of(self.name)
        deadline = time.monotonic() + 30
        while True:
            try:
                self.sock = socket.create_connection((address, 9000), timeout=1)
                break
            except OSError:
                if time.monotonic() > deadline:
                    raise RuntimeError(f"{self.name}: control port never opened: {sh('docker', 'logs', self.name, check=False).stdout[-400:]}")
                time.sleep(0.05)
        self.sock.settimeout(None)
        self.lines = []
        self.cond = threading.Condition()
        self.conn = 0
        self.next_id = 0
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        for raw in self.sock.makefile("r", encoding="utf-8"):
            line = json.loads(raw)
            with self.cond:
                self.lines.append(line)
                if line.get("k") == "connected":
                    self.conn = line["conn"]
                self.cond.notify_all()

    def send(self, **command):
        self.sock.sendall((json.dumps(command) + "\n").encode())

    def wait(self, predicate, timeout_s, what=""):
        deadline = time.monotonic() + timeout_s
        with self.cond:
            while True:
                found = next((line for line in reversed(self.lines) if predicate(line)), None)
                if found is not None:
                    return found
                left = deadline - time.monotonic()
                if left <= 0:
                    raise TimeoutError(f"{self.name}: {what}")
                self.cond.wait(left)

    def start(self, url, session, delay_ms=100, jitter_ms=30_000):
        self.send(cmd="start", url=url, token=session["token"], cookie=session.get("cookie", ""),
                  reconnectDelayMs=delay_ms, reconnectDelayMaxMs=30_000, refreshJitterMs=jitter_ms,
                  tokenExpiresAtMs=decode_claims(session["token"])["exp"] * 1000)

    def emit_ack(self, event, payload, timeout_s=6):
        self.next_id += 1
        request = f"{self.name}-{self.next_id}"
        self.send(cmd="emit", id=request, event=event, payload=payload, ack=True)
        return self.wait(lambda line: line.get("k") == "ack" and line.get("id") == request, timeout_s, f"ack for {event}")

    def stop(self):
        sh("docker", "rm", "-f", self.name, check=False)


class Senders:
    """Numbers messages. 4 connections at 4 msg/s stays under the 50 events per 10 s per connection
    guard. Each waits for its ack before the next, so one sender's order is defined."""

    def __init__(self, url, session, channel, count=4, rate=4.0):
        self.clients = [Client("rust") for _ in range(count)]
        self.channel, self.rate = channel, rate
        self.acked = []
        self.failed = []
        self.stop_flag = threading.Event()
        self.lock = threading.Lock()
        for client in self.clients:
            client.start(url, session)
            client.wait(lambda l: l.get("k") == "connected", 15, "sender connect")
        self.threads = [threading.Thread(target=self._loop, args=(i,), daemon=True) for i in range(count)]

    def begin(self):
        for thread in self.threads:
            thread.start()

    def _loop(self, index):
        client = self.clients[index]
        n = 0
        interval = 1.0 / self.rate
        time.sleep(index * interval / len(self.clients))
        next_at = time.monotonic()
        while not self.stop_flag.is_set():
            n += 1
            text = f"S{index}:{n}"
            before = now_ms()
            result = client.emit_ack("sendMessage", {"channelId": self.channel, "spans": spans(text), "attachments": []})
            record = {"key": [index, n], "sent": before, "acked": result["t"], "ok": result.get("ok"), "error": result.get("error")}
            with self.lock:
                (self.acked if result.get("ok") else self.failed).append(record)
            next_at += interval
            delay = next_at - time.monotonic()
            if delay > 0:
                self.stop_flag.wait(delay)

    def finish(self):
        self.stop_flag.set()
        for thread in self.threads:
            thread.join(timeout=10)

    def stop_clients(self):
        for client in self.clients:
            client.stop()


def write_transcript(path, client):
    with gzip.open(path, "wt") as handle:
        with client.cond:
            for line in client.lines:
                handle.write(json.dumps(line, sort_keys=True) + "\n")


def has_message_on(conn):
    return lambda line: line.get("k") == "ev" and line.get("e") == "newMessage" and line.get("conn") == conn


def cycles(args):
    state = load_state()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    url = api_url()
    rng = random.Random(args.seed)
    owner = login(state["users"]["owner"]["username"])
    listeners = {"rust": login(state["users"]["listener"]["username"]), "ref": login(state["users"]["listener"]["username"])}
    # Which client gets each command first. Presence events depend on it, see the report.
    order = ("ref", "rust") if args.ref_first else ("rust", "ref")
    clients = {kind: Client(kind) for kind in order}
    senders = Senders(url, owner, state["channel"])
    record = {"cycles_requested": args.cycles, "seed": args.seed, "reconnect_delay_ms": args.delay_ms, "hold_s": [args.hold_min, args.hold_max], "load_start": loadavg(),
              "started_at": now_ms(), "stuck": [], "modes": {"kill": 0, "close": 0}, "load_samples": []}
    try:
        for kind, client in clients.items():
            client.start(url, listeners[kind], delay_ms=args.delay_ms)
            client.wait(lambda l: l.get("k") == "connected", 20, "first connect")
        senders.begin()
        for client in clients.values():
            client.wait(has_message_on(1), 20, "first message")
        for cycle in range(1, args.cycles + 1):
            mode = "kill" if rng.random() < 0.8 else "close"
            record["modes"][mode] += 1
            time.sleep(rng.uniform(args.hold_min, args.hold_max))  # The time it stays up, chosen at random: not a wait.
            expected = {}
            for kind, client in clients.items():
                expected[kind] = client.conn + 1
                client.send(cmd=mode)
            if mode == "close":
                for client in clients.values():
                    client.wait(lambda l: l.get("k") == "disconnected" and l.get("conn") == client.conn, 10, "close")
                for client in clients.values():
                    client.send(cmd="open")
            for kind, client in clients.items():
                try:
                    client.wait(has_message_on(expected[kind]), 45, f"cycle {cycle} message on conn {expected[kind]}")
                except TimeoutError as error:
                    record["stuck"].append({"cycle": cycle, "client": kind, "error": str(error)})
            if record["stuck"] and len(record["stuck"]) >= 3:
                break
            if cycle % 100 == 0:
                record["load_samples"].append({"cycle": cycle, "load": loadavg(), "t": now_ms()})
                print(json.dumps({"cycle": cycle, "rust_conn": clients["rust"].conn, "ref_conn": clients["ref"].conn, "acked": len(senders.acked), "failed": len(senders.failed), "load": loadavg()}), flush=True)
        senders.finish()
        # Let the last acked messages reach both before cutting the transcripts.
        last = {tuple(r["key"]) for r in senders.acked[-4:]}
        for client in clients.values():
            deadline = time.monotonic() + 15
            while time.monotonic() < deadline:
                with client.cond:
                    seen = {tuple(map(int, m.groups())) for l in client.lines[-200:] if l.get("e") == "newMessage" for m in [SEQ.search(json.dumps(l["p"]))] if m}
                if last <= seen:
                    break
                time.sleep(0.05)
        record["ended_at"] = now_ms()
        record["load_end"] = loadavg()
        record["cycles_done"] = min(clients["rust"].conn, clients["ref"].conn) - 1
        record["acked"] = senders.acked
        record["send_failed"] = senders.failed
        (out / "run.json").write_text(json.dumps(record))
        for kind, client in clients.items():
            write_transcript(out / f"transcript-{kind}.jsonl.gz", client)
    finally:
        senders.finish()
        senders.stop_clients()
        for client in clients.values():
            client.stop()
    print(json.dumps(analyze(out), indent=1), flush=True)


def read_transcript(path):
    with gzip.open(path, "rt") as handle:
        return [json.loads(line) for line in handle]


def client_view(lines):
    view = {"received": {}, "dups": [], "by_conn": {}, "other_events": {}, "disconnect_reasons": {}, "connect_errors": {},
            "connected_at": {}, "disconnected_at": {}, "first_msg_at": {}, "last_msg_at": {}, "order_violations": 0, "unparsed": 0}
    last_seen = {}
    for line in lines:
        kind = line.get("k")
        if kind == "connected":
            view["connected_at"][line["conn"]] = line["t"]
        elif kind == "disconnected":
            view["disconnected_at"][line["conn"]] = line["t"]
            view["disconnect_reasons"][line["reason"]] = view["disconnect_reasons"].get(line["reason"], 0) + 1
        elif kind == "connect_error":
            view["connect_errors"][line["msg"]] = view["connect_errors"].get(line["msg"], 0) + 1
        elif kind == "ev":
            if line["e"] != "newMessage":
                view["other_events"][line["e"]] = view["other_events"].get(line["e"], 0) + 1
                continue
            match = SEQ.search(json.dumps(line["p"]))
            if not match:
                view["unparsed"] += 1
                continue
            key = (int(match.group(1)), int(match.group(2)))
            conn = line["conn"]
            if key in view["received"]:
                view["dups"].append(list(key))
            else:
                view["received"][key] = {"conn": conn, "t": line["t"], "p": line["p"]}
            view["by_conn"].setdefault(conn, {}).setdefault(key[0], []).append(key[1])
            view["first_msg_at"].setdefault(conn, line["t"])
            view["last_msg_at"][conn] = line["t"]
            if key[1] <= last_seen.get((conn, key[0]), 0):
                view["order_violations"] += 1
            last_seen[(conn, key[0])] = key[1]
    return view


def percentile(values, pct):
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(round(pct / 100 * (len(ordered) - 1))))] if ordered else None


def analyze(out):
    out = Path(out)
    run = json.loads((out / "run.json").read_text())
    acked = {tuple(r["key"]): r for r in run["acked"]}
    views = {kind: client_view(read_transcript(out / f"transcript-{kind}.jsonl.gz")) for kind in ("rust", "ref")}
    result = {"cycles_done": run["cycles_done"], "stuck": run["stuck"], "modes": run["modes"], "messages_acked": len(acked),
              "send_failed": len(run["send_failed"]), "send_failed_errors": sorted({str(r["error"]) for r in run["send_failed"]}),
              "duration_s": (run["ended_at"] - run["started_at"]) / 1000, "load_start": run["load_start"], "load_end": run["load_end"], "clients": {}}
    for kind, view in views.items():
        received = set(view["received"])
        missing = sorted(set(acked) - received)
        # A hole: inside one connection, one sender's numbers skip one that was acked.
        holes = []
        for conn, by_sender in view["by_conn"].items():
            for sender, numbers in by_sender.items():
                span = set(range(min(numbers), max(numbers) + 1))
                holes += [[conn, sender, n] for n in sorted(span - set(numbers)) if (sender, n) in acked]
        # Each loss must fall in this client's own gap: from the disconnect of connection k to the
        # first message of k+1. The margin covers acks and fan-out racing the cut.
        margin = 500
        conns = sorted(view["connected_at"])
        windows = [(view["disconnected_at"][c], view["first_msg_at"].get(c + 1, view["connected_at"].get(c + 1, 1 << 62))) for c in conns if c in view["disconnected_at"]]
        unexplained = [list(key) for key in missing if not any(start - margin <= acked[key]["sent"] <= end + margin or start - margin <= acked[key]["acked"] <= end + margin for start, end in windows)]
        reconnect_ms = [view["connected_at"][c + 1] - view["disconnected_at"][c] for c in conns if c in view["disconnected_at"] and c + 1 in view["connected_at"]]
        sub_ms = [view["first_msg_at"][c] - view["connected_at"][c] for c in conns if c in view["first_msg_at"]]
        result["clients"][kind] = {
            "connections": len(conns), "received_unique": len(received), "duplicates": len(view["dups"]),
            "missing": len(missing), "holes_inside_a_connection": len(holes), "holes_sample": holes[:10],
            "losses_outside_own_gap": len(unexplained), "unexplained_sample": unexplained[:10],
            "order_violations": view["order_violations"], "unparsed_newMessage": view["unparsed"],
            "disconnect_reasons": view["disconnect_reasons"], "connect_errors": view["connect_errors"],
            "other_events": view["other_events"],
            "reconnect_ms": {"p50": percentile(reconnect_ms, 50), "p95": percentile(reconnect_ms, 95), "max": max(reconnect_ms or [0])},
            "connect_to_first_message_ms": {"p50": percentile(sub_ms, 50), "p95": percentile(sub_ms, 95), "max": max(sub_ms or [0])},
        }
    rust, ref = views["rust"], views["ref"]
    both = set(rust["received"]) & set(ref["received"])
    mismatches = [list(key) for key in both if rust["received"][key]["p"] != ref["received"][key]["p"]]
    only_rust, only_ref = set(rust["received"]) - set(ref["received"]), set(ref["received"]) - set(rust["received"])
    result["diff"] = {"received_by_both": len(both), "only_rust": len(only_rust), "only_ref": len(only_ref), "payload_mismatches": len(mismatches), "mismatch_sample": mismatches[:5]}
    r, w = result["clients"]["rust"], result["clients"]["ref"]
    # Fixed before the first full run. "Beyond web-client behaviour" for losses in the gap means
    # within 20% (plus 10 messages) of what socket.io-client lost in the same cycles.
    result["bars"] = {
        "no_stuck_cycles": not run["stuck"],
        "all_cycles_done": run["cycles_done"] >= run["cycles_requested"],
        "no_duplicates_beyond_ref": r["duplicates"] <= w["duplicates"],
        "no_holes_beyond_ref": r["holes_inside_a_connection"] <= w["holes_inside_a_connection"],
        "every_loss_in_own_gap": r["losses_outside_own_gap"] <= w["losses_outside_own_gap"],
        "gap_loss_within_ref": r["missing"] <= w["missing"] * 1.2 + 10,
        "payloads_identical": not mismatches,
    }
    result["pass"] = all(result["bars"].values())
    (out / "analysis.json").write_text(json.dumps(result, indent=1))
    return result


def pair(url, sessions, **start):
    clients = {kind: Client(kind) for kind in ("rust", "ref")}
    for kind, client in clients.items():
        client.start(url, sessions[kind], **start)
    return clients


def socket_message(sender, state, text):
    """Over the socket, with its ack: REST POST /api/messages stores a message but emits no
    newMessage (only the gateway fans out), so a REST probe never reaches anyone."""
    answer = sender.emit_ack("sendMessage", {"channelId": state["channel"], "spans": spans(text), "attachments": []})
    if not answer.get("ok"):
        raise RuntimeError(f"probe {text}: {answer}")
    return answer["args"][0]


def saw_text(client, text, timeout_s=10):
    return client.wait(lambda l: l.get("k") == "ev" and l.get("e") == "newMessage" and text in json.dumps(l["p"]), timeout_s, f"message {text}")


def finish_pair(clients, out, name):
    for kind, client in clients.items():
        write_transcript(out / f"{name}-{kind}.jsonl.gz", client)
        client.stop()


def fresh(state, role, ttl=None):
    session = login(state["users"][role]["username"])
    if ttl is not None:
        session = dict(session, token=mint(session["token"], ttl))
    return session


def scenario(results, name, body):
    print(f"--- {name}", flush=True)
    started = time.monotonic()
    entry = {"name": name, "load_start": loadavg()}
    try:
        entry["checks"] = body()
        entry["ok"] = all(check["rust"] for check in entry["checks"].values())
    except Exception as error:  # A rig or client failure is a result, so the rest still runs.
        entry.update(ok=False, error=f"{type(error).__name__}: {error}")
    entry["duration_s"] = round(time.monotonic() - started, 1)
    entry["load_end"] = loadavg()
    results.append(entry)
    print(json.dumps(entry), flush=True)


def both(clients, predicate):
    """{"rust": bool, "ref": bool} for a predicate over each client's transcript."""
    out = {}
    for kind, client in clients.items():
        with client.cond:
            lines = list(client.lines)
        out[kind] = bool(predicate(lines))
    return out


def auth(args):
    state = load_state()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    url = api_url()
    owner = login(state["users"]["owner"]["username"])
    prober = Client("rust")
    prober.start(url, owner)
    prober.wait(lambda l: l.get("k") == "connected", 20, "prober connect")
    results = []

    def sessions(ttl=None):
        return {kind: fresh(state, "authuser", ttl) for kind in ("rust", "ref")}

    def wait_each(clients, predicate, timeout_s, what):
        for client in clients.values():
            client.wait(predicate, timeout_s, what)

    def ack_shapes():
        clients = pair(url, {"rust": fresh(state, "listener"), "ref": fresh(state, "listener")})
        try:
            wait_each(clients, lambda l: l.get("k") == "connected", 20, "connect")
            _, parent, _ = http("POST", "/api/messages", {"channelId": state["channel"], "spans": spans("t8 parent"), "attachments": []}, owner["token"], want=201)
            checks = {}
            cases = {
                "presenceOnline": ("presenceOnline", {"idle": False}),
                "sendMessage": ("sendMessage", {"channelId": state["channel"], "spans": spans("t8 ack"), "attachments": []}),
                "sendDirectMessage": ("sendDirectMessage", {"directMessageGroupId": state["dm"], "spans": spans("t8 dm"), "attachments": []}),
                "sendThreadReply": ("sendThreadReply", {"parentMessageId": parent["id"], "spans": spans("t8 reply"), "attachments": []}),
                "reauthenticate_bad": ("reauthenticate", {"token": "Bearer garbage"}),
            }
            for label, (event, payload) in cases.items():
                answers = {kind: client.emit_ack(event, payload) for kind, client in clients.items()}
                shapes = {kind: (a.get("ok"), type((a.get("args") or [None])[0]).__name__, a.get("args") if label in ("presenceOnline", "reauthenticate_bad") else None) for kind, a in answers.items()}
                checks[label] = {"rust": shapes["rust"] == shapes["ref"] and answers["rust"].get("ok") is True, "ref": answers["ref"].get("ok") is True, "ack_rust": answers["rust"].get("args"), "ack_ref": answers["ref"].get("args")}
            good = fresh(state, "listener")
            answers = {kind: client.emit_ack("reauthenticate", {"token": f"Bearer {good['token']}"}) for kind, client in clients.items()}
            checks["reauthenticate_good"] = {"rust": answers["rust"]["args"][0].get("ok") is True, "ref": answers["ref"]["args"][0].get("ok") is True}
            for label in ("newThreadReply", "newDirectMessage"):
                got = both(clients, lambda lines: any(l.get("e") == label for l in lines))
                checks[f"event_{label}"] = got
            return checks
        finally:
            finish_pair(clients, out, "acks")

    def refresh_real_margin():
        # 125 s: tokenExpiring at about 5 s, web's 30 s jitter, and the old token dies at 125 s.
        clients = pair(url, sessions(125), jitter_ms=30_000)
        try:
            wait_each(clients, lambda l: l.get("k") == "connected", 20, "connect")
            started = time.monotonic()
            warned = {kind: c.wait(lambda l: l.get("e") == "tokenExpiring", 20, "tokenExpiring")["t"] for kind, c in clients.items()}
            wait_each(clients, lambda l: l.get("k") == "reauthenticated", 45, "reauthenticated")
            time.sleep(max(0, 132 - (time.monotonic() - started)))  # Past the old token's expiry.
            socket_message(prober, state, "t8-past-expiry")
            wait_each(clients, lambda l: l.get("k") == "ev" and "t8-past-expiry" in json.dumps(l.get("p")), 10, "message past expiry")
            result = both(clients, lambda lines: any(l.get("k") == "reauthenticated" and (l["result"] or {}).get("ok") is True for l in lines))
            kept = both(clients, lambda lines: not any(l.get("k") == "disconnected" for l in lines))
            return {"reauthenticated_ok": result, "no_disconnect_past_old_expiry": kept, "warned_at_ms": {"rust": warned["rust"], "ref": warned["ref"]}}
        finally:
            finish_pair(clients, out, "refresh-real")

    def refresh_repeat():
        checks = {}
        for i in range(3):
            clients = pair(url, sessions(6), jitter_ms=500)
            try:
                wait_each(clients, lambda l: l.get("k") == "reauthenticated", 20, "reauthenticated")
                time.sleep(7)
                checks[f"round{i}"] = both(clients, lambda lines: any(l.get("k") == "reauthenticated" and (l["result"] or {}).get("ok") for l in lines) and not any(l.get("k") == "disconnected" for l in lines))
            finally:
                finish_pair(clients, out, f"refresh-short-{i}")
        return checks

    def expiry_recovers():
        # Too late to reauthenticate: the server ends the session; refresh and reconnect, resubscribed.
        clients = pair(url, sessions(3), jitter_ms=60_000)
        try:
            wait_each(clients, lambda l: l.get("k") == "disconnected", 15, "server ended the session")
            wait_each(clients, lambda l: l.get("k") == "connected" and l.get("conn") == 2, 20, "reconnected")
            deadline = time.monotonic() + 20
            text = "t8-after-expiry"
            for i in range(40):
                socket_message(prober, state, f"{text}-{i}")
                try:
                    wait_each(clients, lambda l: l.get("k") == "ev" and f"{text}-{i}" in json.dumps(l.get("p")), 0.5, "x")
                    break
                except TimeoutError:
                    if time.monotonic() > deadline:
                        raise
            return {
                "terminated_token_expired": both(clients, lambda lines: any(l.get("e") == "sessionTerminated" and l["p"].get("reason") == "TOKEN_EXPIRED" for l in lines)),
                "reason_io_server_disconnect": both(clients, lambda lines: any(l.get("k") == "disconnected" and l["reason"] == "io server disconnect" for l in lines)),
                "refreshed": both(clients, lambda lines: any(l.get("k") == "refresh" and l["result"] == "refreshed" for l in lines)),
            }
        finally:
            finish_pair(clients, out, "expiry")

    def expired_at_connect():
        clients = pair(url, sessions(-30))
        try:
            wait_each(clients, lambda l: l.get("k") == "connected", 20, "connected after AUTH_FAILED")
            return {"auth_failed_then_connected": both(clients, lambda lines: any(l.get("k") == "connect_error" and l["msg"] == "AUTH_FAILED" for l in lines))}
        finally:
            finish_pair(clients, out, "expired-at-connect")

    def logout_ends():
        s = sessions()
        clients = pair(url, s)
        try:
            wait_each(clients, lambda l: l.get("k") == "connected", 20, "connect")
            for kind in clients:
                http("POST", "/api/auth/logout", None, s[kind]["token"], s[kind]["cookie"], want=201)
            wait_each(clients, lambda l: l.get("k") == "auth_lost", 15, "auth lost")
            return {
                "logged_out": both(clients, lambda lines: any(l.get("e") == "sessionTerminated" and l["p"].get("reason") == "LOGGED_OUT" for l in lines)),
                "refresh_rejected": both(clients, lambda lines: any(l.get("k") == "refresh" and l["result"] == "rejected" for l in lines)),
                "stays_down": both(clients, lambda lines: sum(1 for l in lines if l.get("k") == "connected") == 1),
            }
        finally:
            finish_pair(clients, out, "logout")

    scenario(results, "acks_on_every_acked_event", ack_shapes)
    scenario(results, "refresh_and_reauthenticate_real_margin", refresh_real_margin)
    scenario(results, "refresh_and_reauthenticate_3x", refresh_repeat)
    scenario(results, "expiry_refresh_reconnect", expiry_recovers)
    scenario(results, "expired_token_at_connect", expired_at_connect)
    scenario(results, "logout_ends_for_good", logout_ends)
    prober.stop()
    (out / "auth.json").write_text(json.dumps(results, indent=1))
    print(f"AUTH {sum(1 for r in results if r['ok'])}/{len(results)}", flush=True)


def suspend(args):
    """What a resync can and can't recover. A witness stays connected throughout: what it saw and
    the suspended client didn't is what was missed; REST then shows what a refetch gets back."""
    state = load_state()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    url = api_url()
    owner = login(state["users"]["owner"]["username"])
    results = []

    def act_during_gap(tag, sender):
        """One of each kind of change. Returns the ids REST must then show."""
        edited = socket_message(sender, state, f"{tag}-to-edit")
        deleted = socket_message(sender, state, f"{tag}-to-delete")
        reacted = socket_message(sender, state, f"{tag}-to-react")
        new_ids = [socket_message(sender, state, f"{tag}-new-{i}") for i in range(5)]
        http("PATCH", f"/api/messages/{edited}", {"spans": spans(f"{tag}-edited")}, owner["token"], want=200)
        http("DELETE", f"/api/messages/{deleted}", None, owner["token"])
        http("POST", "/api/messages/reactions", {"messageId": reacted, "emoji": "\U0001F44D"}, owner["token"], want=201)
        sender.send(cmd="emit", id="typing", event="typingStart", payload={"channelId": state["channel"]}, ack=False)
        return {"edited": edited, "deleted": deleted, "reacted": reacted, "new": new_ids}

    def rest_view(session):
        _, page, _ = http("GET", f"/api/messages/channel/{state['channel']}?limit=100", None, session["token"], want=200)
        return {m["id"]: m for m in page["messages"] if isinstance(m, dict)} if isinstance(page, dict) and "messages" in page else {m["id"]: m for m in page}

    def counts(lines, since):
        tally = {}
        for line in lines:
            if line.get("k") == "ev" and line["t"] >= since:
                tally[line["e"]] = tally.get(line["e"], 0) + 1
        return tally

    def run_gap(name, enter, leave, gap_s):
        s = {kind: fresh(state, "listener") for kind in ("rust", "ref")}
        clients = pair(url, s)
        witness = Client("rust")
        witness.start(url, fresh(state, "listener"))
        typer = Client("rust")
        typer.start(url, owner)
        try:
            for client in [*clients.values(), witness, typer]:
                client.wait(lambda l: l.get("k") == "connected", 20, "connect")
            # subscribeAll has no ack: a message each has seen shows it took effect.
            for i in range(60):
                socket_message(typer, state, f"{name}-ready-{i}")
                try:
                    for client in [*clients.values(), witness]:
                        saw_text(client, f"{name}-ready-{i}", 0.5)
                    break
                except TimeoutError:
                    continue
            gap_start = now_ms()
            enter(clients)
            time.sleep(1)
            ids = act_during_gap(name, typer)
            time.sleep(gap_s)  # The length of the suspend being tested, not a wait for anything.
            gap_end = now_ms()
            leave(clients)
            after_tag = f"{name}-after"
            recovered_at = {}
            for i in range(200):
                socket_message(typer, state, f"{after_tag}-{i}")
                pending = [k for k in clients if k not in recovered_at]
                for kind in pending:
                    try:
                        saw_text(clients[kind], f"{after_tag}-{i}", 0.3)
                        recovered_at[kind] = now_ms()
                    except TimeoutError:
                        pass
                if len(recovered_at) == len(clients):
                    break
            view = rest_view(s["rust"])
            rest = {
                "new_messages_present": all(i in view for i in ids["new"]),
                "edit_visible": "edited" in json.dumps(view.get(ids["edited"], {})),
                "delete_applied": ids["deleted"] not in view or view[ids["deleted"]].get("deletedAt") is not None,
                "reaction_visible": bool(view.get(ids["reacted"], {}).get("reactions")),
            }
            def events(client):
                with client.cond:
                    return list(client.lines)
            witness_saw = counts(events(witness), gap_start)
            entry = {
                "gap_s": gap_s, "witness_saw": witness_saw, "rest_after_resync": rest, "recovered_ms_after_gap": {k: v - gap_end for k, v in recovered_at.items()},
                "clients": {},
            }
            for kind, client in clients.items():
                lines = events(client)
                saw = counts(lines, gap_start)
                missed = {e: witness_saw.get(e, 0) - saw.get(e, 0) for e in witness_saw if witness_saw.get(e, 0) > saw.get(e, 0)}
                reasons = [l["reason"] for l in lines if l.get("k") == "disconnected" and l["t"] >= gap_start]
                entry["clients"][kind] = {"saw": saw, "missed_vs_witness": missed, "disconnect_reasons": reasons,
                                          "resync_plans": [l for l in lines if l.get("k") == "resync_plan"]}
            write_transcript(out / f"{name}-witness.jsonl.gz", witness)
            return entry
        finally:
            finish_pair(clients, out, name)
            witness.stop()
            typer.stop()

    def graceful(clients):
        clients["rust"].send(cmd="suspend")
        clients["ref"].send(cmd="close")

    def graceful_back(clients):
        clients["rust"].send(cmd="resume")
        clients["ref"].send(cmd="open")

    def freeze(clients):
        for client in clients.values():
            sh("docker", "pause", client.name)

    def thaw_only(clients):
        for client in clients.values():
            sh("docker", "unpause", client.name)

    def thaw_and_resume(clients):
        thaw_only(clients)
        clients["rust"].send(cmd="resume")  # A real client's wake-up handler. The web has none.

    def stall(clients):
        for client in clients.values():
            sh("docker", "exec", "-u", "0", client.name, "tc", "qdisc", "add", "dev", "eth0", "root", "netem", "loss", "100%")

    def unstall(clients):
        for client in clients.values():
            sh("docker", "exec", "-u", "0", client.name, "tc", "qdisc", "del", "dev", "eth0", "root")

    cases = [
        ("suspend-graceful", graceful, graceful_back, 30),
        ("freeze-short", freeze, thaw_only, 40),
        ("freeze-short-resume", freeze, thaw_and_resume, 40),
        ("freeze-long", freeze, thaw_and_resume, 95),
        ("stall-past-ping-timeout", stall, unstall, 95),
    ]
    for name, enter, leave, gap_s in cases:
        print(f"--- {name}", flush=True)
        entry = {"name": name, "load_start": loadavg()}
        try:
            entry.update(run_gap(name, enter, leave, gap_s))
            entry["ok"] = len(entry["recovered_ms_after_gap"]) == 2
        except Exception as error:
            entry.update(ok=False, error=f"{type(error).__name__}: {error}")
        entry["load_end"] = loadavg()
        results.append(entry)
        print(json.dumps(entry), flush=True)
        (out / "suspend.json").write_text(json.dumps(results, indent=1))
    print(f"SUSPEND {sum(1 for r in results if r['ok'])}/{len(results)}", flush=True)


def sample_cost(args):
    """The rough number the result schema requires. Not a measurement to compare."""
    import importlib.util
    spec = importlib.util.spec_from_file_location("sample_proc", NATIVE / "scripts/sample-proc.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    state = load_state()
    url = api_url()
    client = Client("rust")
    senders = Senders(url, login(state["users"]["owner"]["username"]), state["channel"])
    try:
        client.start(url, fresh(state, "listener"))
        client.wait(lambda l: l.get("k") == "connected", 20, "connect")
        senders.begin()
        Path(args.out).write_text(json.dumps(module.sample(client.name, 30), indent=1))
    finally:
        senders.finish()
        senders.stop_clients()
        client.stop()


def main():
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("setup")
    c = commands.add_parser("cycles")
    c.add_argument("--cycles", type=int, default=1000)
    c.add_argument("--seed", type=int, default=7)
    c.add_argument("--delay-ms", type=int, default=100, help="reconnect base delay; the web's is 1000")
    c.add_argument("--ref-first", action="store_true", help="cut socket.io-client first, not the Rust client")
    c.add_argument("--hold-min", type=float, default=0.05)
    c.add_argument("--hold-max", type=float, default=0.3)
    c.add_argument("--out", required=True)
    a = commands.add_parser("auth")
    a.add_argument("--out", required=True)
    s = commands.add_parser("suspend")
    s.add_argument("--out", required=True)
    p = commands.add_parser("sample")
    p.add_argument("--out", required=True)
    n = commands.add_parser("analyze")
    n.add_argument("out")
    args = parser.parse_args()
    if args.command == "setup":
        setup()
    elif args.command == "cycles":
        cycles(args)
    elif args.command == "auth":
        auth(args)
    elif args.command == "suspend":
        suspend(args)
    elif args.command == "sample":
        sample_cost(args)
    else:
        print(json.dumps(analyze(args.out), indent=1))


if __name__ == "__main__":
    main()
