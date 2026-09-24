# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react/README.md) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default tseslint.config({
  extends: [
    // Remove ...tseslint.configs.recommended and replace with this
    ...tseslint.configs.recommendedTypeChecked,
    // Alternatively, use this for stricter rules
    ...tseslint.configs.strictTypeChecked,
    // Optionally, add this for stylistic rules
    ...tseslint.configs.stylisticTypeChecked,
  ],
  languageOptions: {
    // other options...
    parserOptions: {
      project: ['./tsconfig.node.json', './tsconfig.app.json'],
      tsconfigRootDir: import.meta.dirname,
    },
  },
})
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default tseslint.config({
  plugins: {
    // Add the react-x and react-dom plugins
    'react-x': reactX,
    'react-dom': reactDom,
  },
  rules: {
    // other rules...
    // Enable its recommended typescript rules
    ...reactX.configs['recommended-typescript'].rules,
    ...reactDom.configs.recommended.rules,
  },
})
```

## UX sandbox (Ladle)

Renders real app screens and components against fake data (MSW) — no backend, no database, no LiveKit — for fast UX review. See `docs/superpowers/specs/2026-09-22-ladle-ux-sandbox-design.md` for the design.

**Run it locally:**

```bash
docker compose build frontend   # once, or after adding a devDependency
docker compose --profile tools up -d ladle
open http://localhost:61000
```

Stop it with `docker compose stop ladle && docker compose rm -f ladle` (this doesn't touch other running services or volumes).

**Fixtures** live in `src/stories/fixtures/`: `buildScenario(options)` (`builder.ts`) generates a deterministic (seeded) dataset — users, communities, channels, messages, DMs, notifications, friends. Reshape it with the `with*` modifiers in `modifiers.ts` (`withLongNames`, `withUnread`, `withVoiceParticipants`, `withThread`, `withAttachments`, `withEmpty`), and `makeHandlers(scenario)` (`handlers.ts`) turns it into the full set of MSW handlers the app needs. `withErrors`/`withSlowEndpoint` (`handlerHelpers.ts`) simulate a failing or slow endpoint. Adding a new screen story is ~2 lines:

```tsx
export const MyScreen = defineScreen(bigCommunityScenario, '/community/community-1/channel/channel-1');
```

**UI review for PRs** — `frontend/scripts/ui-review/ui-review.sh` renders the stories a change affects on the merge-base and on your working tree at phone/tablet/desktop, pixel-diffs them and writes labelled before/after composites plus a PR-description section. Run it before opening any PR that touches the UI, look at the composites, then attach them to the PR (images go to the orphan `pr-screenshots` branch, never to a code branch):

```bash
frontend/scripts/ui-review/ui-review.sh --base origin/main                    # → .ui-review/out/
frontend/scripts/ui-review/ui-review.sh --base origin/main --pr 123 --update-pr --reuse
```

If it lists changed files that no story renders, add a story for them. Details: [UI Review Screenshots](https://docs.semaphorechat.app/contributing/ui-review/).

**Screenshot sweep** — captures every story at phone/tablet/desktop viewports:

```bash
docker compose --profile tools up -d ladle
docker compose --profile tools run --rm ux-shots
docker compose stop ladle && docker compose rm -f ladle
```

Output: `frontend/.ux-shots/<viewport>/<story-id>.png` + `.ux-shots/report.json` (console errors/warnings and unhandled MSW requests per story). Both gitignored. Filter with env vars: `UX_SHOTS_FILTER=channel-chat` (substring match on story id), `UX_SHOTS_VIEWPORTS=phone,desktop`. A story that only makes sense at some widths limits itself with `MyStory.meta = { viewports: ['phone'] };` (a top-level statement, read statically by Ladle); the sweep and the UI review honour it.
```
