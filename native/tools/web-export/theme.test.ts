// Exports the web client's type scale for native/tools/gen-design.
//
//   native/scripts/export-web.sh theme
//
// Runs at the commit in native/contract/PIN. The colours no longer come from here: the native theme
// derives its palette from a base colour (design/colour.json). Imports are relative to
// `frontend/src/__tests__/native-export/`, where export-web.sh copies this file.
import { it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { FONT_FAMILY, HTML_FONT_SIZE, ICON_SCALE, RADIUS_UNIT, TYPE_SCALE } from '../../theme/tokens';

it('exports the type scale', () => {
  const output = { TYPE_SCALE, ICON_SCALE, FONT_FAMILY, HTML_FONT_SIZE, RADIUS_UNIT };
  mkdirSync('native-export-out/theme', { recursive: true });
  writeFileSync('native-export-out/theme/tokens.json', `${JSON.stringify(output, null, 2)}\n`);
});
