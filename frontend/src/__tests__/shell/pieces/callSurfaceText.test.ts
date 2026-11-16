/** The call surface's words: the offered summary, the keyboard line, tile labels. */
import { describe, expect, it } from 'vitest';
import { offeredSummary, surfaceSummary, tileLabel } from '../../../shell/lounge/pieces/call/callSurfaceText';

const screen = (name: string, watched = false) => ({ name, kind: 'screen' as const, watched });
const camera = (name: string, watched = false) => ({ name, kind: 'camera' as const, watched });

describe('callSurfaceText', () => {
  it('labels a share by its owner and a camera by its person', () => {
    expect(tileLabel(screen('dropbear'))).toBe("dropbear's screen");
    expect(tileLabel(camera('pri'))).toBe('pri');
  });

  it.each([
    [[], ''],
    [[camera('a')], '1 camera on'],
    [[camera('a'), camera('b')], '2 cameras on'],
    [[screen('a')], '1 screen shared'],
    [[screen('a'), screen('b'), camera('c'), camera('d'), camera('e')], '2 screens shared · 3 cameras on'],
  ])('offered %#: %s', (tiles, text) => {
    expect(offeredSummary(tiles)).toBe(text);
  });

  it.each([
    [[screen('dropbear', true)], false, "Watching dropbear's screen"],
    [[screen('dropbear', true), camera('pri', true)], false, 'Watching 2'],
    [[screen('dropbear', true), camera('pri')], false, "Watching dropbear's screen · 1 camera on"],
    [[screen('a'), screen('b')], false, '2 screens shared'],
    [[], true, "You're sharing your screen"],
    [[screen('a', true)], true, "Watching a's screen · You're sharing"],
  ])('keyboard line %#: %s', (tiles, sharing, text) => {
    expect(surfaceSummary(tiles, sharing)).toBe(text);
  });
});
