import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/react';
import { beforeAll, afterEach, afterAll } from 'vitest';
import { server } from './msw/server';
import { setElectronAPIOverride } from '../utils/electronBridge';

// Note: axe-core a11y assertions use `expectNoAxeViolations()` from
// `../test-utils/a11y`, not a `toHaveNoViolations` custom matcher.
// vitest-axe@0.1.0's `toHaveNoViolations` is broken for this project's
// vitest/TS versions two different ways (its `extend-expect` entrypoint
// ships an empty dist file, and its `matchers` entrypoint re-exports the
// function `export type`-only, so it can't be used as a value) — see
// test-utils/a11y.ts for the full explanation.

// RTL's default findBy*/waitFor timeout (1000ms) assumes a lightly-loaded
// machine. Under v8 coverage instrumentation + constrained CI parallelism,
// real timers (debounce, MSW round-trips) can occasionally take longer to
// fire even though nothing is actually stuck — bumping this gives assertions
// realistic headroom instead of trading it for a global vitest testTimeout
// bump alone.
configure({ asyncUtilTimeout: 5000 });

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => {
  server.resetHandlers();
  // A test that faked the Electron bridge (setElectronAPIOverride) must not
  // leave the next test running "in Electron".
  setElectronAPIOverride(undefined);
  // Composer drafts (useComposerDraft) live in sessionStorage; don't let one
  // test's unsent text show up in the next test's composer.
  try {
    sessionStorage.clear();
  } catch {
    // ignore: storage may be stubbed by a test
  }
});
afterAll(() => server.close());
