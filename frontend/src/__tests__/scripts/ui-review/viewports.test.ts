// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { REVIEW_VIEWPORTS, storyViewports, viewportsForStory } from '../../../../scripts/ui-review/lib/viewports.ts';

describe('storyViewports', () => {
  it('is null when the story sets no viewports', () => {
    expect(storyViewports(undefined)).toBeNull();
    expect(storyViewports({})).toBeNull();
    expect(storyViewports({ width: 'xsmall' })).toBeNull();
  });

  it("returns the story's own viewports, without duplicates", () => {
    expect(storyViewports({ viewports: ['phone'] })).toEqual(['phone']);
    expect(storyViewports({ viewports: ['phone', 'tablet', 'phone'] })).toEqual(['phone', 'tablet']);
  });

  it('rejects an empty list, a non-list and unknown viewport names', () => {
    expect(() => storyViewports({ viewports: [] })).toThrow(/non-empty list/);
    expect(() => storyViewports({ viewports: 'phone' })).toThrow(/non-empty list/);
    expect(() => storyViewports({ viewports: ['phone', 'mobile'] })).toThrow(/unknown viewport\(s\) "mobile"/);
  });
});

describe('viewportsForStory', () => {
  it('shoots phone, tablet and desktop by default', () => {
    expect(viewportsForStory('edge-nav-notifications--one')).toEqual(['phone', 'tablet', 'desktop']);
  });

  it('shoots "*keyboard*" stories only at phone-short', () => {
    expect(viewportsForStory('message-input--keyboard-open')).toEqual(['phone-short']);
  });

  it("uses the story's own viewports when it sets them, in the requested order", () => {
    expect(viewportsForStory('edge-nav-notifications--long-names-narrow320', REVIEW_VIEWPORTS, ['phone'])).toEqual(['phone']);
    expect(viewportsForStory('x--y', REVIEW_VIEWPORTS, ['desktop', 'phone'])).toEqual(['phone', 'desktop']);
    // Own viewports win over the keyboard rule.
    expect(viewportsForStory('message-input--keyboard-open', REVIEW_VIEWPORTS, ['phone-short', 'tablet'])).toEqual(['phone-short', 'tablet']);
  });

  it('only returns requested viewports (the probe order, for instance)', () => {
    expect(viewportsForStory('x--y', ['desktop', 'tablet', 'phone', 'phone-short'], ['phone', 'tablet'])).toEqual(['tablet', 'phone']);
  });
});
