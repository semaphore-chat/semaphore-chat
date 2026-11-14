import { describe, expect, it } from 'vitest';
import packageJson from '../../../package.json?raw';
import fontsSource from '../../kit/fonts.ts?raw';
import { tokens } from '../../theme/generated/tokens';

// One `import '...'` per font weight. The kit bundles its own fonts because the
// CSP only allows `font-src 'self' data:` (frontend/nginx.conf).
const WEIGHT_STYLESHEETS = [
  '@fontsource/bricolage-grotesque/600.css',
  '@fontsource/bricolage-grotesque/700.css',
  '@fontsource/figtree/400.css',
  '@fontsource/figtree/500.css',
  '@fontsource/figtree/600.css',
];
const IMPORT_STATEMENT = /\bimport\s+(?:[^'"\n]*?\bfrom\s+)?['"]([^'"]+)['"];?/g;

describe('kit fonts', () => {
  it('pins both font packages to 5.3.0 in dependencies', () => {
    const { dependencies } = JSON.parse(packageJson) as { dependencies: Record<string, string> };
    expect(dependencies['@fontsource/bricolage-grotesque']).toBe('5.3.0');
    expect(dependencies['@fontsource/figtree']).toBe('5.3.0');
  });

  it('imports exactly the five weight stylesheets and nothing else', () => {
    const specifiers = [...fontsSource.matchAll(IMPORT_STATEMENT)].map((match) => match[1]);
    expect(specifiers).toEqual(WEIGHT_STYLESHEETS);
    expect(fontsSource.replace(IMPORT_STATEMENT, '').trim()).toBe('');
  });

  it('registers the family names the tokens ask for', () => {
    expect(tokens.font.heading).toBe('Bricolage Grotesque');
    expect(tokens.font.body).toBe('Figtree');
  });
});
