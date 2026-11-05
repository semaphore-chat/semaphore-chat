/**
 * Deterministic channel history on top of seed:e2e (backend/prisma/seed-e2e.ts).
 *
 *   node gen-history.ts --server URL --messages N --manifest FILE > history.sql
 *
 * The image pool goes through the real upload API; everything else is SQL
 * (COPY), so a 100k-message history takes seconds rather than hours of REST
 * calls and rate limits. Pipe stdout to psql in one transaction. The manifest
 * has what the other steps need: ids of the community, channels and bench users.
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const flag = (name: string, fallback?: string): string => {
  const at = process.argv.indexOf(`--${name}`);
  const value = at >= 0 ? process.argv[at + 1] : fallback;
  if (value === undefined) throw new Error(`--${name} is required`);
  return value;
};

const SERVER = flag('server');
const COUNT = Number(flag('messages', '5000'));
if (!Number.isInteger(COUNT) || COUNT < 1) throw new Error('--messages must be a positive integer');
const MANIFEST = flag('manifest');
const SEED = Number(flag('seed', '20261105'));
const BENCH_USERS = 20;
const POOL_IMAGES = 8;
const USER = { username: 'testuser', password: 'Test123!@#' };

// mulberry32: small, stable across Node versions
let state = SEED >>> 0;
function random(): number {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)];

function uuid(kind: string, n: number): string {
  const h = createHash('sha256').update(`${SEED}:${kind}:${n}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** COPY text format: NULL is \N; backslash, tab and newlines escaped. */
function copyValue(value: string | number | boolean | null): string {
  if (value === null) return '\\N';
  return String(value).replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}
const copyRow = (values: (string | number | boolean | null)[]): string => values.map(copyValue).join('\t');
const sqlString = (value: string): string => `'${value.replace(/'/g, "''")}'`;

// ------------------------------------------------------------------ API
async function api<T>(path: string, init: RequestInit & { token?: string; form?: FormData } = {}): Promise<T> {
  const res = await fetch(`${SERVER}/api${path}`, {
    ...init,
    body: init.form ?? init.body,
    headers: {
      ...(init.form ? {} : { 'Content-Type': 'application/json' }),
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

// ------------------------------------------------------------------ images
function crc32(buf: Buffer): number {
  let crc = ~0;
  for (const byte of buf) {
    crc ^= byte;
    for (let k = 0; k < 8; k += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, tail]);
}
/** A photo-sized RGB PNG: gradient plus coarse noise. Decoded size is what the client pays for. */
function makePng(width: number, height: number, variant: number): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let at = 0;
  for (let y = 0; y < height; y += 1) {
    raw[at++] = 0;
    for (let x = 0; x < width; x += 1) {
      const noise = random() * 24;
      raw[at++] = (x * 255) / width + noise;
      raw[at++] = (y * 255) / height + noise;
      raw[at++] = (variant * 32 + (x ^ y) / 8) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 6 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------------ content
const WORDS = 'the voice channel server latency packet frame render scroll message thread community member token build release client native window memory budget sample stream codec decode layer tile focus hover draft sync cache patch deploy review merge retry socket presence avatar banner emoji pinned upload'.split(' ');
const sentence = (min: number, max: number): string => {
  const n = min + Math.floor(random() * (max - min + 1));
  const words = Array.from({ length: n }, () => pick(WORDS));
  words[0] = words[0][0].toUpperCase() + words[0].slice(1);
  return `${words.join(' ')}.`;
};
const REACTIONS = ['👍', '🎉', '😂', '❤️', '🚀', '👀'];
const CODE = [
  'const room = new Room(getRoomOptions());\nawait room.connect(url, token);',
  'fn main() {\n    let window = cx.open_window(options, build_root);\n    window.activate();\n}',
  'SELECT id, "sentAt" FROM "Message"\nWHERE "channelId" = $1\nORDER BY "sentAt" DESC LIMIT 50;',
];

interface Row { message: string; spans: string[]; reactions: string[]; image: number | null }

async function main(): Promise<void> {
  const { accessToken: token } = await api<{ accessToken: string }>('/auth/login', {
    method: 'POST', body: JSON.stringify(USER),
  });
  const me = await api<{ id: string }>('/users/profile', { token });
  const communities = await api<{ id: string; name: string }[]>('/community/mine', { token });
  const community = communities.find((c) => c.name === 'Test Community');
  if (!community) throw new Error('seeded "Test Community" not found (did seed:e2e run?)');
  const channels = await api<{ id: string; name: string }[]>(`/channels/community/${community.id}`, { token });
  const channel = (name: string) => {
    const found = channels.find((c) => c.name === name);
    if (!found) throw new Error(`seeded channel ${name} not found`);
    return found.id;
  };
  const general = channel('general');

  // The pool goes through the real upload path, so the bytes are really in
  // storage. Rows for individual messages then share each pool file's object.
  const pool: string[] = [];
  for (let i = 0; i < POOL_IMAGES; i += 1) {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(makePng(800, 600, i))], { type: 'image/png' }), `baseline-${i}.png`);
    form.append('resourceType', 'USER_AVATAR');
    form.append('resourceId', me.id);
    const uploaded = await api<{ id: string }>('/file-upload', { method: 'POST', token, form });
    pool.push(uploaded.id);
  }

  const benchUsers = Array.from({ length: BENCH_USERS }, (_, i) => ({
    id: uuid('user', i),
    username: `bench${String(i + 1).padStart(2, '0')}`,
    display_name: `Bench User ${i + 1}`,
  }));

  // Re-runnable on a kept (--keep) stack: replaces an earlier run's history.
  const out: string[] = [
    'BEGIN;',
    `DELETE FROM "Message" WHERE "channelId" = ${sqlString(general)};`,
    `DELETE FROM "User" WHERE username LIKE 'bench%';`,
  ];
  // Not a loginable password: these users only author messages and publish media.
  out.push(`COPY "User" (id, username, email, "hashedPassword", "displayName") FROM stdin;`);
  for (const u of benchUsers) out.push(copyRow([u.id, u.username, `${u.username}@bench.local`, '!', u.display_name]));
  out.push('\\.');
  out.push(`COPY "Membership" (id, "userId", "communityId") FROM stdin;`);
  benchUsers.forEach((u, i) => out.push(copyRow([uuid('membership', i), u.id, community.id])));
  out.push('\\.');

  const authors = [me.id, ...benchUsers.map((u) => u.id)];
  const baseMs = Date.now() - COUNT * 120_000;
  const rows: Row[] = [];
  const messageRows: string[] = [];
  const counts: Record<string, number> = {};

  for (let seq = 0; seq < COUNT; seq += 1) {
    const id = uuid('message', seq);
    const author = pick(authors);
    const sentAt = new Date(baseMs + seq * 120_000).toISOString();
    const roll = random();
    const prefix = `#${seq} `;
    let spans: [string, string | null, string | null, boolean | null, boolean | null][];
    let kind = 'plain';
    let image: number | null = null;
    let replyTo: string | null = null;
    let linkPreviews: string | null = null;

    if (roll < 0.04) {
      kind = 'image_attachment';
      image = Math.floor(random() * POOL_IMAGES);
      spans = [['PLAINTEXT', `${prefix}${sentence(3, 8)}`, null, null, null]];
    } else if (roll < 0.09) {
      kind = 'code_block';
      spans = [['PLAINTEXT', `${prefix}${sentence(3, 6)}`, null, null, null], ['CODE_BLOCK', pick(CODE), null, null, null]];
    } else if (roll < 0.14 && seq > 0) {
      kind = 'reply';
      replyTo = uuid('message', Math.max(0, seq - 1 - Math.floor(random() * 20)));
      spans = [['PLAINTEXT', `${prefix}${sentence(4, 14)}`, null, null, null]];
    } else if (roll < 0.19) {
      kind = 'link_preview';
      const url = `https://example.com/post/${seq}`;
      spans = [['PLAINTEXT', `${prefix}${url}`, null, null, null]];
      linkPreviews = JSON.stringify([{ url, title: sentence(3, 7), description: sentence(10, 22), siteName: 'example.com' }]);
    } else if (roll < 0.29) {
      kind = 'mention';
      spans = [
        ['PLAINTEXT', prefix, null, null, null],
        ['USER_MENTION', null, pick(authors), null, null],
        ['PLAINTEXT', ` ${sentence(4, 14)}`, null, null, null],
      ];
    } else if (roll < 0.39) {
      kind = 'formatted';
      spans = [
        ['PLAINTEXT', prefix, null, null, null],
        ['PLAINTEXT', sentence(2, 5), null, true, null],
        ['PLAINTEXT', ` ${sentence(2, 5)} `, null, null, null],
        ['PLAINTEXT', pick(WORDS), null, null, true],
      ];
    } else if (roll < 0.45) {
      kind = 'long_text';
      spans = [['PLAINTEXT', `${prefix}${Array.from({ length: 6 }, () => sentence(14, 28)).join(' ')}`, null, null, null]];
    } else {
      spans = [['PLAINTEXT', `${prefix}${sentence(3, 22)}`, null, null, null]];
    }
    counts[kind] = (counts[kind] ?? 0) + 1;

    const search = spans.map((s) => s[1] ?? '').join(' ');
    messageRows.push(copyRow([id, general, author, sentAt, search, replyTo, linkPreviews]));
    const row: Row = { message: id, spans: [], reactions: [], image };
    spans.forEach(([type, text, userId, bold, code], position) => {
      row.spans.push(copyRow([uuid('span', seq * 10 + position), id, position, type, text, userId, bold, code]));
    });
    if (random() < 0.15) {
      const n = 1 + Math.floor(random() * 3);
      for (let r = 0; r < n; r += 1) {
        // (message, emoji, user) is unique: one user per reaction slot
        row.reactions.push(copyRow([uuid('reaction', seq * 10 + r), id, REACTIONS[r], authors[r]]));
      }
    }
    rows.push(row);
  }

  out.push(`COPY "Message" (id, "channelId", "authorId", "sentAt", "searchText", "replyToId", "linkPreviews") FROM stdin;`);
  out.push(...messageRows, '\\.');
  out.push(`COPY "MessageSpan" (id, "messageId", position, type, text, "userId", bold, code) FROM stdin;`);
  for (const r of rows) out.push(...r.spans);
  out.push('\\.');
  out.push(`COPY "MessageReaction" (id, "messageId", emoji, "userId") FROM stdin;`);
  for (const r of rows) out.push(...r.reactions);
  out.push('\\.');

  // One File row per attachment, as the upload path makes, sharing a pool object.
  let attachmentNo = 0;
  for (const r of rows) {
    if (r.image === null) continue;
    const fileId = uuid('file', attachmentNo);
    attachmentNo += 1;
    out.push(
      `INSERT INTO "File" (id, filename, "mimeType", "fileType", size, checksum, "uploadedById", "resourceType", "fileMessageId", "storageType", "storagePath")\n` +
      `SELECT ${sqlString(fileId)}, filename, "mimeType", "fileType", size, checksum, "uploadedById", 'MESSAGE_ATTACHMENT', ${sqlString(r.message)}, "storageType", "storagePath" FROM "File" WHERE id = ${sqlString(pool[r.image])};`,
      `INSERT INTO "MessageAttachment" (id, "messageId", "fileId", position) VALUES (${sqlString(uuid('attachment', attachmentNo))}, ${sqlString(r.message)}, ${sqlString(fileId)}, 0);`,
    );
  }
  out.push('COMMIT;');
  process.stdout.write(`${out.join('\n')}\n`);

  writeFileSync(MANIFEST, JSON.stringify({
    community: community.id,
    general,
    channels: Object.fromEntries(channels.map((c) => [c.name, c.id])),
    bench_users: benchUsers.map(({ id, display_name }) => ({ id, display_name })),
    messages: COUNT,
    newest_seq: COUNT - 1,
    prng_seed: SEED,
    mix_actual: counts,
    attachments: attachmentNo,
  }, null, 1));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
