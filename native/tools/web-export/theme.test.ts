// Exports the web client's resolved themes for native/tools/gen-design.
//
//   native/scripts/export-web.sh theme
//
// Runs at the commit in native/contract/PIN. `generateTheme` is the web's single source of truth
// for a theme, so this resolves all 72 combinations (mode x accent x intensity) instead of
// re-deriving palette values by hand. Imports are relative to
// `frontend/src/__tests__/native-export/`, where export-web.sh copies this file.
import { expect, it } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { generateTheme } from '../../theme/themeConfig';
import { accentColors } from '../../theme/constants';
import { FONT_FAMILY, HTML_FONT_SIZE, ICON_SCALE, RADIUS_UNIT, TYPE_SCALE } from '../../theme/tokens';

/** Members of a string-literal union declared in theme/constants.ts. */
function unionMembers(source: string, typeName: string): string[] {
  const declaration = source.match(new RegExp(`export type ${typeName}\\s*=([^;]+);`));
  if (!declaration) throw new Error(`theme/constants.ts declares no \`${typeName}\` union`);
  const members = [...declaration[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
  if (members.length === 0) throw new Error(`\`${typeName}\` has no string members`);
  return members;
}

/** What `JSON.stringify` keeps: drops functions (palette.augmentColor and friends). */
function jsonable(value: unknown): unknown {
  if (value === undefined || typeof value === 'function') return undefined;
  if (Array.isArray(value)) return value.map(jsonable);
  if (value !== null && typeof value === 'object') {
    const kept: Record<string, unknown> = {};
    for (const [key, member] of Object.entries(value)) {
      const serialized = jsonable(member);
      if (serialized !== undefined) kept[key] = serialized;
    }
    return kept;
  }
  return value;
}

it('exports every mode x accent x intensity theme', () => {
  const constants = readFileSync('src/theme/constants.ts', 'utf8');
  const modes = unionMembers(constants, 'ThemeMode');
  const intensities = unionMembers(constants, 'ThemeIntensity');
  const accents = accentColors.map((accent) => accent.id);

  expect(
    modes.length * accents.length * intensities.length,
    `${modes.length} modes x ${accents.length} accents x ${intensities.length} intensities`,
  ).toBe(72);

  const themes: Record<string, unknown> = {};
  let spacing1: string | undefined;

  for (const mode of modes) {
    for (const accent of accents) {
      for (const intensity of intensities) {
        const theme = generateTheme(mode, accent, intensity);
        const key = `${mode}-${accent}-${intensity}`;
        if (key in themes) throw new Error(`duplicate theme key ${key}`);
        themes[key] = jsonable(theme.palette);
        spacing1 ??= theme.spacing(1);
      }
    }
  }

  const output = {
    TYPE_SCALE,
    ICON_SCALE,
    FONT_FAMILY,
    HTML_FONT_SIZE,
    RADIUS_UNIT,
    SPACING_1: spacing1,
    themes,
  };
  mkdirSync('native-export-out/theme', { recursive: true });
  writeFileSync('native-export-out/theme/tokens.json', `${JSON.stringify(output, null, 2)}\n`);
}, 120_000);
