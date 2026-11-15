import { styled, type CSSObject } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import type { LoungeTheme } from '../theme/createLoungeTheme';
import { kitTheme } from '../theme/KitProvider';

/** The width at or below which a modal is full-width and its action buttons stack. */
export const PHONE = `@media (max-width: ${tokens.breakpoint.phone}px)`;

/** On a phone the bottom edge of the screen may be the home indicator: room the panel adds below its last row. */
export const SAFE_BOTTOM = 'env(safe-area-inset-bottom)';

/** The container's padding is the margin a modal keeps from the viewport edge. */
export const gutterContainer: CSSObject = { padding: `${tokens.layout.gutter}px` };

/** At phone width the action buttons take a full row each, in order: the safe action on top. */
export const actionsStack: CSSObject = {
  [PHONE]: { flexDirection: 'column', '& > *': { width: '100%' } },
};

/** The panel's look both share: the surface colour, a hairline edge, the overlay shadow, full width up to a cap. */
export function panelBase(lounge: LoungeTheme, shadowCss: string): CSSObject {
  return {
    boxSizing: 'border-box',
    width: '100%',
    // The container's padding is the margin, so MUI's own `100% - 64px` would double it.
    maxHeight: '100%',
    margin: 0,
    background: lounge.palette.surface,
    backgroundImage: 'none',
    border: `${tokens.border.hairline}px solid ${lounge.palette.hairline}`,
    boxShadow: shadowCss,
    borderRadius: `${tokens.radius.island}px`,
    color: lounge.palette.text,
    // Focus can land on the panel itself (a Sheet has no first action); it is not a control, so no ring.
    outline: 'none',
  };
}

/** The modal's heading. */
export const ModalTitle = styled('h2')(({ theme }) => {
  const type = tokens.text.title;
  return {
    margin: 0,
    fontFamily: `'${type.family}', ${theme.typography.fontFamily}`,
    fontSize: `${type.size}px`,
    lineHeight: `${type.line}px`,
    fontWeight: type.weight,
    color: kitTheme(theme).palette.text,
  };
});
