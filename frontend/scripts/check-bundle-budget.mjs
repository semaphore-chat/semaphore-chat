#!/usr/bin/env node
/**
 * CI budget guard for PR-11 (bundle splitting: LiveKit/hls.js out of the
 * initial bundle).
 *
 * Run AFTER `pnpm run build`. Asserts against the built `dist/`:
 *
 *   (a) The entry chunk (the <script type="module"> vite injects into
 *       dist/index.html) contains no inlined LiveKit or hls.js source code.
 *
 *       A naive substring search for "livekit" is NOT enough — the entry
 *       chunk legitimately contains that substring today via unrelated app
 *       strings: REST paths ("/api/livekit/token"), generated SDK function
 *       names ("livekitControllerGetMyClips"), a debug global
 *       ("window.__livekit_room"), and the expected cross-chunk
 *       `import {...} from "./livekit-<hash>.js"` statement that lets the
 *       entry statically reference the split-out chunk. None of those are
 *       livekit's actual bundled source landing in the entry chunk.
 *
 *       Instead this scans for markers that only appear inside livekit-client
 *       / hls.js's own bundled implementation:
 *         - "livekit.SignalRequest" — a protobuf message type name from
 *           livekit-client's signaling protocol layer.
 *         - "levelController" — an internal hls.js HLS-level-selection class.
 *       Both were verified (2026-07) to appear in the livekit/hls chunks and
 *       nowhere else in the built output, including the entry chunk.
 *
 *   (b) The entry chunk's raw (uncompressed) size is <= BUDGET_BYTES, derived
 *       from the post-split measurement (1,275,014 bytes) + 20% headroom,
 *       rounded to a clean number. Update BUDGET_BYTES deliberately if the
 *       entry legitimately grows (new eager feature) — don't just bump it to
 *       silence a regression caused by an accidental eager import.
 *
 *   (c) dist/index.html itself contains no <script src="...">/<link
 *       rel="modulepreload" href="..."> reference to the livekit chunk (found
 *       by the same "livekit.SignalRequest" marker, scanned across every file
 *       in dist/assets). (a)+(b) only prove the livekit chunk's CODE doesn't
 *       land inside the entry chunk — manualChunks physically isolates it by
 *       module id regardless of *how* eagerly the app reaches it (a dynamic
 *       import() gets the same chunk as a static import). This check catches
 *       the distinct regression where the chunk is still correctly split out,
 *       but something always-mounted (e.g. a top-level provider in Layout.tsx,
 *       or a hook/component statically reachable from it) statically imports
 *       a *value* from livekit-client, causing Vite to mark the chunk for
 *       eager <link rel="modulepreload"> fetch on every authenticated page
 *       load — see the PR-11 report, "Fix round 1" section, for the concrete
 *       leaks this caught (soundboardPlayer.ts, volumeStorage.ts,
 *       useReplayBuffer.ts, useSpeakingDetection.ts, voiceDiagnostics.ts,
 *       useLocalMediaState.ts all statically reachable from always-mounted
 *       providers/mobile screens despite the entry chunk itself being clean).
 *
 * Usage: pnpm run check:bundle-budget   (after pnpm run build)
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIST_DIR = join(process.cwd(), "dist");
const ASSETS_DIR = join(DIST_DIR, "assets");
const INDEX_HTML = join(DIST_DIR, "index.html");

// Measured post-split entry size was 1,275,014 bytes (PR-11, 2026-07).
// +20% headroom, rounded to a clean number.
const BUDGET_BYTES = 1_536_000; // 1500 KB

const FORBIDDEN_MARKERS = [
  { name: "livekit-client", marker: "livekit.SignalRequest" },
  { name: "hls.js", marker: "levelController" },
];

// The marker used to positively identify "this asset file IS the livekit
// chunk" for check (c) below. Reuses the same discriminating marker as (a)
// rather than a naming convention (e.g. `livekit-*.js`) so it keeps working
// even if manualChunks' output naming changes.
const LIVEKIT_CHUNK_MARKER = "livekit.SignalRequest";

function fail(message) {
  console.error(`\n[check-bundle-budget] FAIL: ${message}\n`);
  process.exit(1);
}

if (!existsSync(INDEX_HTML)) {
  fail(`${INDEX_HTML} not found — run \`pnpm run build\` first.`);
}

const indexHtml = readFileSync(INDEX_HTML, "utf-8");

// Entry chunk(s): the <script type="module" ... src="..."> tags Vite injects
// directly into index.html (as opposed to <link rel="modulepreload">, which
// point at eagerly-fetched-but-not-inlined dependency chunks).
//
// Attribute order on the <script> tag isn't guaranteed (Vite has emitted both
// `<script type="module" crossorigin src="...">` and other orderings across
// versions) — match the whole tag first, then pull `src` out of it, instead
// of assuming `type="module"` precedes `src=`.
const scriptTags = [...indexHtml.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
const scriptSrcs = scriptTags
  .filter((tag) => /\btype="module"/.test(tag))
  .map((tag) => tag.match(/\bsrc="([^"]+)"/)?.[1])
  .filter((src) => !!src);

if (scriptSrcs.length === 0) {
  fail(`No <script type="module" src="..."> found in ${INDEX_HTML}.`);
}

let hadFailure = false;

for (const src of scriptSrcs) {
  // src is relative to index.html, e.g. "./assets/index-XXXX.js"
  const entryPath = join(DIST_DIR, src.replace(/^\.\//, ""));
  if (!existsSync(entryPath)) {
    fail(`Entry script referenced in index.html not found on disk: ${entryPath}`);
  }

  const contents = readFileSync(entryPath, "utf-8");
  const sizeBytes = Buffer.byteLength(contents, "utf-8");

  console.log(`[check-bundle-budget] Entry chunk: ${src} (${(sizeBytes / 1024).toFixed(1)} KB)`);

  for (const { name, marker } of FORBIDDEN_MARKERS) {
    if (contents.includes(marker)) {
      console.error(
        `[check-bundle-budget] Found ${name} marker "${marker}" inlined in entry chunk ${src}. ` +
          `${name} must stay behind a dynamic import()/manualChunks boundary — it must not ship in the initial bundle.`
      );
      hadFailure = true;
    }
  }

  if (sizeBytes > BUDGET_BYTES) {
    console.error(
      `[check-bundle-budget] Entry chunk ${src} is ${sizeBytes} bytes, over budget of ${BUDGET_BYTES} bytes ` +
        `(${(sizeBytes / 1024).toFixed(1)} KB > ${(BUDGET_BYTES / 1024).toFixed(1)} KB). ` +
        `If this growth is legitimate, update BUDGET_BYTES in scripts/check-bundle-budget.mjs deliberately.`
    );
    hadFailure = true;
  }
}

// --- (c) index.html must not eagerly reference the livekit chunk at all ---
//
// Find every asset dist/assets emits that IS the livekit chunk (by content,
// not filename pattern), then confirm none of index.html's <script src="...">
// or <link rel="modulepreload" href="..."> tags point at it. A dynamic
// import() elsewhere in the app (the join path, lazy voice components) is
// fine and expected — those never appear in index.html at all, only in
// asset-to-asset `import()` calls inside other chunks.
if (existsSync(ASSETS_DIR)) {
  const livekitChunkFiles = readdirSync(ASSETS_DIR)
    .filter((f) => f.endsWith(".js"))
    .filter((f) => readFileSync(join(ASSETS_DIR, f), "utf-8").includes(LIVEKIT_CHUNK_MARKER));

  if (livekitChunkFiles.length === 0) {
    fail(
      `Could not locate the livekit-client chunk in ${ASSETS_DIR} (no asset contains the ` +
        `"${LIVEKIT_CHUNK_MARKER}" marker). Either the build changed unexpectedly or this ` +
        `script's marker needs updating — this check can't validate anything without it.`
    );
  }

  const referencedAssets = [
    ...[...indexHtml.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]),
    ...[...indexHtml.matchAll(/<link\b[^>]*\brel="modulepreload"[^>]*\bhref="([^"]+)"/g)].map((m) => m[1]),
  ].map((ref) => ref.replace(/^\.\//, "").replace(/^assets\//, ""));

  for (const chunkFile of livekitChunkFiles) {
    if (referencedAssets.includes(chunkFile)) {
      console.error(
        `[check-bundle-budget] dist/index.html references the livekit-client chunk ` +
          `(assets/${chunkFile}) via a <script>/<link rel="modulepreload"> tag. This means the ` +
          `browser eagerly fetches (and the module graph forces evaluation of) livekit-client on ` +
          `every authenticated page load — even for users who never open voice. This happens when ` +
          `an always-mounted module (a Layout.tsx-reachable provider/hook/component, or anything ` +
          `statically imported by mobile's MobileChatPanel/MobileScreenContainer, which is NOT ` +
          `behind a React.lazy() boundary) holds a runtime (non \`import type\`) reference to a ` +
          `livekit-client value (RoomEvent, Track, ConnectionQuality, ConnectionState, ` +
          `DisconnectReason, Room, ...). Fix: replace the runtime enum access with the typed string ` +
          `constants in features/voice/livekitEvents.ts and convert the import to \`import type\`.`
      );
      hadFailure = true;
    }
  }

  if (!hadFailure) {
    console.log(
      `[check-bundle-budget] livekit-client chunk (assets/${livekitChunkFiles[0]}) is not referenced by index.html — good.`
    );
  }
}

if (hadFailure) {
  fail("Bundle budget check failed — see errors above.");
}

console.log("[check-bundle-budget] PASS — entry chunk is within budget and free of livekit/hls code, and livekit is not eagerly fetched.");
