// Exports every MUI icon the web client imports, as plain SVGs for
// native/crates/semaphore-design.
//
//   native/scripts/export-web.sh icons
//
// Walks the frontend source at run time, so it finds both import forms:
//   import Check from '@mui/icons-material/Check';
//   import { Check, Done as DoneIcon } from '@mui/icons-material';
// and picks up icons added later without this file changing. Imports are
// relative to `frontend/src/__tests__/native-export/`, where export-web.sh
// copies this file.
import { expect, it } from 'vitest';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as muiIcons from '@mui/icons-material';

const SRC = 'src';
const SKIPPED_DIRS: Record<string, true> = { __tests__: true, stories: true };
const IMPORT_PATTERNS = [
  // `import CheckCircle from '@mui/icons-material/CheckCircle'`. The module
  // segment is the icon's name, whatever the local binding is called.
  /import\s+[A-Za-z_$][\w$]*\s+from\s+['"]@mui\/icons-material\/([\w]+)['"]/g,
  // `import { CheckCircle, Delete as DeleteIcon } from '@mui/icons-material'`.
  /import\s*(?:type\s+)?\{([^}]*)\}\s*from\s*['"]@mui\/icons-material['"]/g,
];

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS[entry.name]) files.push(...sourceFiles(join(dir, entry.name)));
    } else if (/\.tsx?$/.test(entry.name)) {
      files.push(join(dir, entry.name));
    }
  }
  return files;
}

/** Every icon name the source imports. */
function importedIcons(): string[] {
  const names = new Set<string>();
  for (const file of sourceFiles(SRC)) {
    const source = readFileSync(file, 'utf8');
    for (const pattern of IMPORT_PATTERNS) {
      for (const match of source.matchAll(pattern)) {
        const captured = match[1];
        // Default import: the captured group is the module's icon name.
        // Named imports: one entry per `Name` / `Name as Alias`.
        if (pattern === IMPORT_PATTERNS[0]) {
          names.add(captured);
        } else {
          for (const entry of captured.split(',')) {
            const name = entry.trim().split(/\s+as\s+/)[0].trim();
            if (/^[A-Za-z_$][\w$]*$/.test(name) && name !== 'type') names.add(name);
          }
        }
      }
    }
  }
  return [...names].sort();
}

/** PascalCase -> snake_case, the asset file name (`CheckCircle` -> `check_circle`). */
function snakeCase(name: string): string {
  return name
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase();
}

it('exports every imported MUI icon as an SVG', () => {
  const names = importedIcons();
  expect(names.length, 'no @mui/icons-material imports found under src/').toBeGreaterThan(0);

  const iconsDir = 'native-export-out/icons/icons';
  mkdirSync(iconsDir, { recursive: true });

  const manifest: Record<string, string> = {};
  const twoTone: string[] = [];

  for (const name of names) {
    const component = (muiIcons as Record<string, unknown>)[name];
    if (component === undefined) throw new Error(`${name} is not exported by @mui/icons-material`);

    let markup: string;
    try {
      markup = renderToStaticMarkup(createElement(component as never));
    } catch (error) {
      throw new Error(`${name} is not a renderable icon: ${String(error)}`);
    }
    const svg = markup
      // The root SvgIcon carries the tint through `fill="currentColor"`; a
      // plain shape lets GPUI apply its own colour.
      .replace(/^<svg\b[^>]*>/, (root) => root.replace(/\sfill="currentColor"/, ''))
      // Emotion's generated classes (and MUI's test ids) are build noise: they
      // make the file differ between runs and mean nothing to an SVG parser.
      .replace(/\sclass="[^"]*"/g, '')
      .replace(/\sdata-testid="[^"]*"/g, '')
      .replace(/\saria-hidden="[^"]*"/g, '')
      .replace(/\sfocusable="[^"]*"/g, '');

    if (!svg.startsWith('<svg')) throw new Error(`${name} did not render an <svg>: ${svg.slice(0, 60)}`);
    if (/opacity=/.test(svg) || />\s*<path[^>]*fill="(?!currentColor)/.test(svg)) {
      twoTone.push(name);
    }

    const file = `${snakeCase(name)}.svg`;
    if (manifest[file] !== undefined) {
      throw new Error(`${name} and ${manifest[file]} both map to ${file}`);
    }
    manifest[file] = name;
    writeFileSync(join(iconsDir, file), `${svg}\n`);
  }

  // One entry per line: tools/gen-design and the crate's tests read it.
  const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => (a < b ? -1 : 1)));
  writeFileSync(
    'native-export-out/icons/manifest.json',
    `{\n${Object.entries(sorted)
      .map(([file, name]) => `  ${JSON.stringify(file)}: ${JSON.stringify(name)}`)
      .join(',\n')}\n}\n`,
  );

  console.log(`icons: ${names.length}`);
  if (twoTone.length > 0) console.log(`icons: opacity or extra fills: ${twoTone.join(', ')}`);
}, 300_000);
