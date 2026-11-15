import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import tseslint from 'typescript-eslint'
import muiAllowlist from './eslint/mui-allowlist.json' with { type: 'json' }

// The five reducers in src/kit/behaviour/ and their barrel. Only the step,
// initial-state and default-params names are restricted; their types are not.
const reducerStepPattern = {
  group: [
    '**/behaviour/{toastQueue,overlayStack,confirmDestructive,listFocus,loadState}',
    '**/behaviour',
    '**/behaviour/index',
  ],
  importNamePattern: '^(step[A-Z]|initial[A-Z]|DEFAULT_PARAMS$|[A-Z_]+_DEFAULT_PARAMS$)',
  message:
    'Only the hosts in src/kit/behaviour/hosts/ may call a reducer step (design/guide/behaviour.md, "Applying a step"). Types are fine to import.',
}

// What src/data and src/shell/lounge may not import (design report §2).
// `components` is the classic-UI pattern (a regex: a gitignore-style group
// cannot re-include a file under an excluded directory). There is no exception:
// the Lounge chunk has its own kit-free boundary (shell/lounge/frame/ScreenBoundary).
function headlessPatterns(components) {
  return [
    {
      group: ['@mui/*', '@mui/**', '@emotion/*'],
      message: 'Import from src/kit. MUI is used only inside the kit (design/guide).',
    },
    reducerStepPattern,
    {
      regex: components,
      message: 'src/data and src/shell/lounge are headless: no classic components (move the logic into src/data).',
    },
    { group: ['**/pages', '**/pages/**'], message: 'No classic pages in src/data or src/shell/lounge.' },
    {
      group: ['**/Layout*', '**/theme', '**/theme/**'],
      message: 'No classic layouts or the classic MUI theme in src/data or src/shell/lounge.',
    },
    { group: ['**/kit/*', '**/kit/**'], message: "Import the kit from its public index ('src/kit')." },
    {
      group: ['**/hooks/useResponsive'],
      message: "Classic breakpoints: use the kit's useWidthRange.",
    },
    {
      group: ['**/hooks/useScreenShare'],
      message: 'useScreenShare owns the classic source picker; stop a share with the call bar model.',
    },
    {
      group: ['**/utils/SocketContext', '**/utils/SocketProvider', '**/utils/socketSingleton'],
      message: 'No raw socket: read the query cache (kept live by socket-hub) or useServerEvent.',
    },
    {
      group: ['**/hooks/useSocket'],
      importNames: ['useSocket'],
      message: 'No raw socket: read the query cache (kept live by socket-hub) or useServerEvent.',
    },
    {
      group: ['**/contexts/NotificationContext'],
      message: 'Its module renders an MUI Snackbar; the new shell reaches toasts through the notification sink.',
    },
  ]
}

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

// The Electron bridge selectors (see the config object that uses them below).
const electronBridgeSelectors = [
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
]

// usePushToTalk is the push-to-talk engine (key listeners, mode switches) and
// runs once per call, in components/Voice/VoiceSessionEffects.tsx. A second
// caller would add a second set of key listeners and share one held flag in
// pushToTalkStore. UI reads it through usePushToTalkStatus().
const pushToTalkEngineSelector = {
  selector: "ImportSpecifier[imported.name='usePushToTalk']",
  message:
    'usePushToTalk is the push-to-talk engine and is mounted only by VoiceSessionEffects. In UI, use usePushToTalkStatus() (same module).',
}
const PUSH_TO_TALK_ENGINE_FILES = ['src/components/Voice/VoiceSessionEffects.tsx', 'src/__tests__/**']

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
  //
  // The same rule also keeps the push-to-talk engine to its one call site
  // (pushToTalkEngineSelector above); the second object restates only the
  // Electron selectors for the files allowed to import the engine, because a
  // config object replaces a rule's options instead of merging them.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/utils/electronBridge.ts', 'src/__tests__/utils/electronBridge.test.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...electronBridgeSelectors, pushToTalkEngineSelector],
    },
  },
  {
    files: PUSH_TO_TALK_ENGINE_FILES,
    ignores: ['src/__tests__/utils/electronBridge.test.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...electronBridgeSelectors],
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
            reducerStepPattern,
          ],
        },
      ],
    },
  },
  // The shared data layer (src/data) and the new shell's chunk (src/shell/lounge)
  // stay headless: no classic UI, no MUI, no classic theme or breakpoints, no
  // raw socket, no screen-share picker, no old snackbar (design report §2).
  // This object replaces the MUI block's no-restricted-imports options for these
  // files, so it restates the MUI and reducer-step patterns. Transitive imports
  // are checked by src/__tests__/shell/loungeImportBoundary.test.ts.
  {
    files: ['src/data/**/*.{ts,tsx}', 'src/shell/lounge/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: headlessPatterns('(^|/)components(/|$)') }],
    },
  },
  // A screen module (src/shell/lounge/screens) default-exports its descriptor (shell/lounge/screen.ts),
  // an object beside the screen's components: Fast Refresh reloads such a module instead of patching it,
  // which is fine for a screen.
  {
    files: ['src/shell/lounge/screens/**/*.{ts,tsx}'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
  // livekit-client: types only, except in the lazy call-surface chunk.
  {
    files: ['src/data/**/*.{ts,tsx}', 'src/shell/lounge/**/*.{ts,tsx}'],
    ignores: ['src/shell/lounge/call/surface/**'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'livekit-client',
              allowTypeImports: true,
              message:
                'livekit-client values load only in the lazy call surface (src/shell/lounge/call/surface). Import types with `import type`.',
            },
          ],
          patterns: [
            {
              group: ['livekit-client/*'],
              allowTypeImports: true,
              message:
                'livekit-client values load only in the lazy call surface (src/shell/lounge/call/surface). Import types with `import type`.',
            },
          ],
        },
      ],
    },
  },
  // The reducers' step functions (src/kit/behaviour/*.ts) are called only by the
  // hosts in src/kit/behaviour/hosts/, which apply a step's effects in order and
  // queue events sent meanwhile (design/guide/behaviour.md, "Applying a step").
  // Anyone else calling a step skips that. Types are fine to import. This is a
  // second no-restricted-imports block for the kit: it covers src/kit/** minus
  // the reducers and hosts, while the MUI block above (screens and stories, which
  // also carry reducerStepPattern) covers everything outside the kit.
  {
    files: ['src/kit/**/*.{ts,tsx}'],
    ignores: ['src/kit/behaviour/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [reducerStepPattern] }],
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
