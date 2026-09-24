#!/usr/bin/env node
// Guard against dependency bumps that rewrite a package.json "scripts" entry
// sharing its name with a package (e.g. scripts.prisma -> "^6.19.3").
// A script body is a shell command, never a bare semver range or version.
import { readFileSync } from 'node:fs';

const files = ['package.json', 'backend/package.json', 'frontend/package.json', 'shared/package.json'];
const semverLike = /^\s*(?:[\^~]|[<>]=?|=)?\s*v?\d+(?:\.(?:\d+|[xX*]))*(?:-[\w.]+)?(?:\+[\w.]+)?\s*$|^\s*(?:\*|latest|workspace:.*|npm:.*)\s*$/;

let failed = false;
for (const file of files) {
  const scripts = JSON.parse(readFileSync(file, 'utf8')).scripts ?? {};
  for (const [name, body] of Object.entries(scripts)) {
    if (typeof body !== 'string' || semverLike.test(body)) {
      console.error(`${file}: scripts["${name}"] looks like a version, not a command: ${JSON.stringify(body)}`);
      failed = true;
    }
  }
}
if (failed) process.exit(1);
console.log(`package.json scripts OK (${files.join(', ')})`);
