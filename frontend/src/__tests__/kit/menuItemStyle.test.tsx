import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { Button, Menu } from '../../kit';
import { menuItemStyle } from '../../kit/overlays/surface';
import { createLoungeTheme } from '../../kit/theme/createLoungeTheme';
import { derivePalette } from '../../theme/derive/derivePalette';
import { tokens } from '../../theme/generated/tokens';
import { renderWithKit } from '../test-utils/renderWithKit';

describe('menu row height', () => {
  // jsdom does not evaluate @media rules, so the wide-viewport case is pinned on the
  // generated style: the height sits under the doubled-class selector, which beats MUI's
  // `min-width: sm` reset. The rendered row is also checked at jsdom's (narrow) default.
  it('declares min-height and padding at doubled specificity', () => {
    const lounge = createLoungeTheme(derivePalette('#8E75FF', 'dark', 'minimal'), 'dark').lounge!;
    const style = menuItemStyle(lounge);
    expect(style['&&']).toEqual({
      minHeight: `${tokens.control.md}px`,
      padding: `0 ${tokens.space.md}px`,
    });
    expect(style).not.toHaveProperty('minHeight');
  });

  it('a rendered menu item is control.md high', () => {
    renderWithKit(
      <>
        <Button>x</Button>
        <Menu open anchor={document.body} onClose={() => {}} label="m" items={[{ id: 'a', label: 'A', onSelect: () => {} }]} />
      </>,
    );
    expect(getComputedStyle(screen.getByRole('menuitem')).minHeight).toBe(`${tokens.control.md}px`);
  });
});
