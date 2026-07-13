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
 * Usage: pnpm run check:bundle-budget   (after pnpm run build)
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const DIST_DIR = join(process.cwd(), "dist");
const INDEX_HTML = join(DIST_DIR, "index.html");

// Measured post-split entry size was 1,275,014 bytes (PR-11, 2026-07).
// +20% headroom, rounded to a clean number.
const BUDGET_BYTES = 1_536_000; // 1500 KB

const FORBIDDEN_MARKERS = [
  { name: "livekit-client", marker: "livekit.SignalRequest" },
  { name: "hls.js", marker: "levelController" },
];

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
const scriptSrcs = [...indexHtml.matchAll(/<script[^>]*\btype="module"[^>]*\bsrc="([^"]+)"/g)].map(
  (m) => m[1]
);

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

if (hadFailure) {
  fail("Bundle budget check failed — see errors above.");
}

console.log("[check-bundle-budget] PASS — entry chunk is within budget and free of livekit/hls code.");
