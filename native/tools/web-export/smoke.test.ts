import { it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { generateTheme } from '../../theme/themeConfig';
import { buildScenario } from '../../stories/fixtures/builder';

it('writes', () => {
  mkdirSync('native-export-out/smoke', { recursive: true });
  const theme = generateTheme('dark', 'teal', 'balanced');
  const scenario = buildScenario({ seed: 's', messagesInGeneral: 3 });
  writeFileSync('native-export-out/smoke/x.json', JSON.stringify({ primary: theme.palette.primary.main, m: Object.keys(scenario) }));
});
