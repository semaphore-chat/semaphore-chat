import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import tseslint from 'typescript-eslint'
import muiAllowlist from './eslint/mui-allowlist.json' with { type: 'json' }

// jsx-a11y's own "recommended" preset ships most rules at 'error'. This repo
// runs it at 'warn' (downgrade every enabled rule's severity but keep each
// rule's own options, and leave anything explicitly 'off' alone), so the
// editor shows a11y findings as warnings rather than errors. They still fail
// `pnpm run lint` — see the NOTE below.
//
// NOTE on package.json's `lint` / `lint:fix` scripts (`--max-warnings 0`):
// every warning was fixed, so any new warning fails lint (and CI). Fix it
// rather than raising the cap. Where a fix would be wrong (e.g. autoFocus on
// the first field of a dialog the user just opened, or a <video>/<audio> with
// no caption source), use a single-line
// `// eslint-disable-next-line <rule> -- <why>` with the reason after `--`.
function toWarnOnly(rules) {
  return Object.fromEntries(
    Object.entries(rules).map(([ruleId, config]) => {
      if (Array.isArray(config)) {
        const [severity, ...options] = config
        return [ruleId, severity === 'off' ? config : ['warn', ...options]]
      }
      return [ruleId, config === 'off' ? config : 'warn']
    }),
  )
}

export default tseslint.config(
  { ignores: ['dist', 'src/api-client', 'coverage', '.ladle/public', '.ux-shots'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      // The two classic rules, as eslint-plugin-react-hooks 5's `recommended`
      // had them. v7's `recommended` adds the React Compiler rules
      // (set-state-in-effect, refs, purity, ...): adopting those is a
      // separate change, since they flag ~65 existing call sites.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      '@typescript-eslint/explicit-function-return-type': 'off',
    },
  },
  // The Electron bridge (`window.electronAPI`) is read in ONE place,
  // src/utils/electronBridge.ts, so tests and the Ladle sandbox can fake it
  // through one seam. Everything else uses getElectronAPI() (non-React code),
  // useElectronAPI() (components/hooks) or the utils/platform checks; tests
  // use setElectronAPIOverride() / <ElectronProvider> with
  // createFakeElectronAPI() instead of assigning the global.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/utils/electronBridge.ts', 'src/__tests__/utils/electronBridge.test.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[property.name='electronAPI']",
          message:
            'Use getElectronAPI() (utils/electronBridge), useElectronAPI() (contexts/ElectronContext) or utils/platform instead of reading window.electronAPI; in tests, setElectronAPIOverride() or <ElectronProvider> with createFakeElectronAPI().',
        },
        {
          selector:
            "VariableDeclarator[init.name=/^(window|globalThis|self)$/] > ObjectPattern > Property[key.name='electronAPI']",
          message:
            'Use getElectronAPI() (utils/electronBridge) or useElectronAPI() (contexts/ElectronContext) instead of destructuring electronAPI from window.',
        },
      ],
    },
  },
  // MUI is the kit's implementation detail: src/kit builds the Lounge design
  // system on it, and everything else imports from the kit. The allow-list in
  // eslint/mui-allowlist.json is the old screens and stories that still import
  // MUI directly; it may only shrink (src/__tests__/lint/muiAllowlist.test.ts
  // keeps it in step with the tree, and CI rejects additions). Tests are
  // exempt: they build the old themes and renderWithProviders.
  //
  // Use no-restricted-imports, not no-restricted-syntax: a second
  // no-restricted-syntax config object would replace the Electron selectors
  // above for every file it matches.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/kit/**', 'src/__tests__/**', ...muiAllowlist.files],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@mui/*', '@mui/**', '@emotion/*'],
              message:
                'Import from src/kit. MUI is used only inside the kit (design/guide).',
            },
          ],
        },
      ],
    },
  },
  // Exempt Electron main/preload and service worker from no-console
  // (these run outside the browser app context where the logger utility is unavailable)
  {
    files: ['electron/**/*.ts', 'src/sw-custom.ts', 'src/utils/logger.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  // Node CLI scripts (run in containers by scripts/ui-review/ui-review.sh):
  // console output is their interface. The Playwright kit specs
  // (browser-tests/) also run in Node, with browser code inside evaluate().
  {
    files: ['scripts/**/*.ts', 'browser-tests/**/*.ts', 'playwright.kit.config.ts'],
    languageOptions: { globals: globals.node },
    rules: {
      'no-console': 'off',
    },
  },
  // jsx-a11y recommended ruleset, downgraded to warnings (see toWarnOnly).
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'jsx-a11y': jsxA11y },
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: toWarnOnly(jsxA11y.flatConfigs.recommended.rules),
  },
)
