import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { Card } from '../../kit';
import { renderWithKit } from '../test-utils/renderWithKit';

/**
 * The development check for a control inside a clickable Card. This file expects console.error on
 * purpose, so it keeps its own spy; every other kit test file asserts that nothing is logged.
 */
let consoleError: MockInstance;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  consoleError.mockRestore();
});

const kitCardErrors = () => consoleError.mock.calls.filter((call) => String(call[0]).includes('[kit] Card'));

describe('Card nested controls (development check)', () => {
  it.each([
    ['an input', <input key="i" aria-label="name" />],
    ['a select', <select key="s" aria-label="kind" />],
    ['a textarea', <textarea key="t" aria-label="note" />],
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the case under test
    ['an element with a tabindex', <span key="x" tabIndex={0}>focus</span>],
  ])('logs once, naming the Card, for %s inside a clickable Card', (_name, child) => {
    renderWithKit(<Card onClick={() => undefined}>{child}</Card>);
    expect(kitCardErrors()).toHaveLength(1);
    expect(String(kitCardErrors()[0][0])).toMatch(/clickable Card/);
  });

  it('logs for a nested link or button too (a kit Button inside a Card button)', () => {
    renderWithKit(
      <Card onClick={() => undefined}>
        <button type="button">inner</button>
      </Card>,
    );
    expect(kitCardErrors()).toHaveLength(1);
  });

  it('logs for a link Card that holds a control', () => {
    renderWithKit(
      <Card href="/x">
        <input aria-label="name" />
      </Card>,
    );
    expect(kitCardErrors()).toHaveLength(1);
  });

  it('does not log for a clickable Card holding only text and display pieces', () => {
    renderWithKit(
      <Card onClick={() => undefined}>
        <span>Squad Up</span>
        <strong>and some more</strong>
      </Card>,
    );
    expect(kitCardErrors()).toHaveLength(0);
  });

  it('does not log for a plain Card with controls inside', () => {
    renderWithKit(
      <Card>
        <input aria-label="name" />
        <button type="button">ok</button>
      </Card>,
    );
    expect(kitCardErrors()).toHaveLength(0);
  });
});
