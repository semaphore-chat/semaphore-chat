import type { JSX, ReactNode } from 'react';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { reducedMotion } from '../overlays/surface';
import { kitTheme } from '../theme/KitProvider';
import { interactiveStates } from '../theme/states';
import { transientProps } from '../theme/transientProps';

type CardBase = {
  children: ReactNode;
  /** You are in this card (a voice room) or it is the current item: an accent outline, announced as current. */
  selected?: boolean;
  padding?: 'md' | 'lg';
  id?: string;
};

export type CardProps = CardBase &
  (
    | { onClick?: undefined; href?: undefined }
    | { onClick: () => void; href?: undefined; label?: string }
    | { href: string; onClick?: undefined; label?: string }
  );

interface LookProps {
  $selected: boolean;
  $padding: 'md' | 'lg';
  $interactive: boolean;
}

/** One look for the plain, button and link forms. The border is always there (transparent when unselected) so selecting never resizes the card. */
const look = ({ theme, $selected, $padding, $interactive }: LookProps & { theme: Parameters<typeof kitTheme>[0] }) => {
  const { palette } = kitTheme(theme);
  return {
    ...reducedMotion,
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    gap: `${tokens.space.md}px`,
    width: '100%',
    minWidth: 0,
    margin: 0,
    padding: `${tokens.space[$padding]}px`,
    border: `${tokens.border.selected}px solid ${$selected ? palette.accent : 'transparent'}`,
    borderRadius: `${tokens.radius.card}px`,
    background: palette.fill,
    color: palette.text,
    font: 'inherit',
    textAlign: 'start',
    textDecoration: 'none',
    ...($interactive && {
      cursor: 'pointer',
      transition: `background-color ${tokens.motion.fast}ms`,
      ...interactiveStates({
        palette,
        under: palette.fill,
        hover: tokens.state.hover,
        pressed: tokens.state.pressed,
      }),
    }),
  } as const;
};

const options = { shouldForwardProp: transientProps };
const Plain = styled('div', options)<LookProps>(look);
const Button = styled('button', options)<LookProps>(look);
const Anchor = styled('a', options)<LookProps>(look);

/**
 * A soft-filled card inside an island. Plain, or one button (`onClick`) or link (`href`) that covers
 * the whole card, named by its text or by `label`. Because a button or link holds the content, a
 * clickable card must not contain other controls. `selected` is drawn and announced.
 */
export function Card(props: CardProps): JSX.Element {
  const { children, selected = false, padding = 'md', id } = props;
  const current = selected ? ('true' as const) : undefined;
  const label = 'label' in props ? props.label : undefined;
  if (props.href !== undefined) {
    return (
      <Anchor id={id} href={props.href} aria-label={label} aria-current={current} $selected={selected} $padding={padding} $interactive>
        {children}
      </Anchor>
    );
  }
  if (props.onClick !== undefined) {
    return (
      <Button id={id} type="button" onClick={props.onClick} aria-label={label} aria-current={current} $selected={selected} $padding={padding} $interactive>
        {children}
      </Button>
    );
  }
  return (
    <Plain id={id} aria-current={current} $selected={selected} $padding={padding} $interactive={false}>
      {children}
    </Plain>
  );
}
