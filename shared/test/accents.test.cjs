// The shared package has no test runner of its own: these tests import the
// compiled output and run on Node's built-in test runner
// (`pnpm --filter shared test`). Kept in plain CommonJS so no extra
// devDependency (and no Node type declarations in `src`) is needed.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  ACCENT_NAMES,
  ACCENT_PRIMARY,
  nearestAccent,
} = require('../dist/theme/accents.js');

test('every accent primary maps to itself', () => {
  for (const name of ACCENT_NAMES) {
    assert.equal(nearestAccent(ACCENT_PRIMARY[name]), name);
  }
});

test('the Lounge violet maps to purple', () => {
  assert.equal(nearestAccent('#8e75ff'), 'purple');
});

test('a grey maps to slate', () => {
  assert.equal(nearestAccent('#808080'), 'slate');
});

test('uppercase input works', () => {
  assert.equal(nearestAccent('#8E75FF'), 'purple');
});

test('an invalid colour throws RangeError', () => {
  for (const invalid of ['', 'purple', '#8e75f', '#8e75fff', '#gggggg']) {
    assert.throws(() => nearestAccent(invalid), RangeError);
  }
});
