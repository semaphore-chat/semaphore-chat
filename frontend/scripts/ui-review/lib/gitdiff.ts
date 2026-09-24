/**
 * Parsers for the git output ui-review.sh hands over (it runs git on the host;
 * everything here is pure):
 *   git diff --name-status -z -M <merge-base>     → parseNameStatusZ
 *   git diff -U0 --no-color -M <merge-base>       → parseChangedLines
 * Both diff the *working tree* against the merge-base, so uncommitted edits
 * are reviewed too. Untracked files are appended by the caller as status A.
 */
import type { ChangedFile } from './affected.ts';
import type { TargetLines } from './coverage.ts';

/** Renames/copies become delete-old + add-new so both sides are handled. */
export function parseNameStatusZ(text: string): ChangedFile[] {
  const fields = text.split('\0');
  const out: ChangedFile[] = [];
  for (let i = 0; i < fields.length; ) {
    const status = fields[i++];
    if (!status) continue;
    if (status.startsWith('R') || status.startsWith('C')) {
      const from = fields[i++];
      const to = fields[i++];
      if (status.startsWith('R')) out.push({ path: from, status: 'D' });
      out.push({ path: to, status: 'A' });
    } else {
      out.push({ path: fields[i++], status: status[0] });
    }
  }
  return out;
}

function stripPrefix(raw: string): string | null {
  let p = raw.trim();
  if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1);
  if (p === '/dev/null') return null;
  return p.replace(/^[ab]\//, '');
}

/** Changed 1-based lines of each file in the head, from a `-U0` unified diff. */
export function parseChangedLines(diff: string): Map<string, TargetLines> {
  const out = new Map<string, TargetLines>();
  let current: string | null = null;
  let isNew = false;
  let lines: number[] = [];

  const flush = () => {
    if (current) out.set(current, isNew ? 'all' : [...new Set(lines)].sort((a, b) => a - b));
    current = null;
    isNew = false;
    lines = [];
  };

  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      flush();
      const m = / b\/(.+)$/.exec(line);
      current = m ? m[1].replace(/"$/, '') : null;
      continue;
    }
    if (line.startsWith('new file mode')) isNew = true;
    else if (line.startsWith('Binary files ')) isNew = true;
    else if (line.startsWith('+++ ')) {
      const p = stripPrefix(line.slice(4));
      if (p === null) current = null; // deleted file
      else current = p;
    } else if (line.startsWith('@@ ') && current && !isNew) {
      const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (!m) continue;
      const start = Number(m[1]);
      const count = m[2] === undefined ? 1 : Number(m[2]);
      if (count === 0) lines.push(Math.max(1, start), start + 1);
      else for (let n = start; n < start + count; n++) lines.push(n);
    }
  }
  flush();
  return out;
}
