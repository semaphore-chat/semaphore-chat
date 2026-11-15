import { useLayoutEffect, useRef, type JSX, type ReactNode } from 'react';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { reducedMotion } from '../overlays/surface';
import { kitTheme } from '../theme/KitProvider';
import { interactiveStates } from '../theme/states';
import { SurfaceContext, standOutFill, useSurface, type Surface } from '../theme/onSurface';
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
  $on: Surface;
}

/** One look for the plain, button and link forms. The border is always there (transparent when unselected) so selecting never resizes the card. */
const look = ({ theme, $selected, $padding, $interactive, $on }: LookProps & { theme: Parameters<typeof kitTheme>[0] }) => {
  const { palette } = kitTheme(theme);
  // Stands out from what it sits on: a Card in a Card is `surface`, not fill on fill.
  const fill = standOutFill(palette, $on);
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
    background: fill,
    color: palette.text,
    font: 'inherit',
    textAlign: 'start',
    textDecoration: 'none',
    ...($interactive && {
      cursor: 'pointer',
      transition: `background-color ${tokens.motion.fast}ms`,
      ...interactiveStates({
        palette,
        under: fill,
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

/** What counts as another control in a clickable Card. */
const CONTROLS = 'button, a[href], input, select, textarea, [tabindex]';

/**
 * A soft-filled card inside an island. Plain, or one button (`onClick`) or link (`href`) that covers
 * the whole card, named by its text or by `label`. Because a button or link holds the content, a
 * clickable card must not contain other controls. `selected` is drawn and announced.
 */
export function Card(props: CardProps): JSX.Element {
  const { children, selected = false, padding = 'md', id } = props;
  const current = selected ? ('true' as const) : undefined;
  const on = useSurface();
  const clickable = props.href !== undefined || props.onClick !== undefined;
  const button = useRef<HTMLButtonElement>(null);
  const anchor = useRef<HTMLAnchorElement>(null);
  // Development only: a control inside a button or link is invalid HTML and its clicks reach the card.
  // Types cannot see inside `children`, so look at the DOM once after mount.
  useLayoutEffect(() => {
    if (!import.meta.env.DEV || !clickable) {
      return;
    }
    const inner = (button.current ?? anchor.current)?.querySelector(CONTROLS);
    if (inner) {
      console.error(
        `[kit] Card: a clickable Card holds no other controls, but this one contains <${inner.tagName.toLowerCase()}>. ` +
          'Use a plain Card with the controls inside, or a ListRow with a trailing control.',
      );
    }
    // Once, at mount: the check is a hint for the author, not a runtime guard.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // A Card is `fill` (or `surface` on a fill), so the kit pieces inside draw to stand out from it.
  const content = <SurfaceContext value={on === 'fill' ? 'surface' : 'fill'}>{children}</SurfaceContext>;
  const label = 'label' in props ? props.label : undefined;
  if (props.href !== undefined) {
    return (
      <Anchor ref={anchor} id={id} href={props.href} aria-label={label} aria-current={current} $selected={selected} $padding={padding} $interactive $on={on}>
        {content}
      </Anchor>
    );
  }
  if (props.onClick !== undefined) {
    return (
      <Button ref={button} id={id} type="button" onClick={props.onClick} aria-label={label} aria-current={current} $selected={selected} $padding={padding} $interactive $on={on}>
        {content}
      </Button>
    );
  }
  return (
    <Plain id={id} aria-current={current} $selected={selected} $padding={padding} $interactive={false} $on={on}>
      {content}
    </Plain>
  );
}
