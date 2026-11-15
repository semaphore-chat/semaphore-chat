import type { JSX, MouseEvent, ReactNode, Ref } from 'react';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { kitTheme } from '../theme/KitProvider';
import { focusRing, interactiveStates } from '../theme/states';
import { transientProps } from '../theme/transientProps';

export interface ListRowProps {
  primary: string;
  secondary?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  /** `md` is one line (control md high); `lg` has room for two. */
  size?: 'md' | 'lg';
  /** The current item: the solid accent pill. Sets `aria-current`. */
  selected?: boolean;
  /** Bolder primary line, in the full text colour. */
  unread?: boolean;
  /** Both lines dimmed. */
  muted?: boolean;
  disabled?: boolean;
  /** Renders a link. */
  href?: string;
  /** Renders a button. */
  onClick?: () => void;
  ref?: Ref<HTMLElement>;
  id?: string;
}

interface LookProps {
  $size: 'md' | 'lg';
  $selected: boolean;
  $interactive: boolean;
  $disabled: boolean;
}

/** The whole row: background, hover and selection live here so a trailing slot sits inside the pill. */
const Wrapper = styled('div', { shouldForwardProp: transientProps })<LookProps>(
  ({ theme, $size, $selected, $interactive, $disabled }) => {
    const { palette } = kitTheme(theme);
    const under = $selected ? palette.accent : palette.surface;
    return {
      display: 'flex',
      alignItems: 'center',
      boxSizing: 'border-box',
      width: '100%',
      minWidth: 0,
      gap: `${tokens.space.sm}px`,
      minHeight: `${$size === 'md' ? tokens.control.md : tokens.control.lg}px`,
      padding: `0 ${tokens.space.md}px 0 ${tokens.space.xs}px`,
      borderRadius: `${$size === 'md' ? tokens.radius.full : tokens.radius.card}px`,
      background: $selected ? palette.accent : 'transparent',
      color: $selected ? palette.onAccent : palette.textSecondary,
      transition: `background-color ${tokens.motion.fast}ms`,
      ...($interactive &&
        !$disabled &&
        interactiveStates({
          palette,
          under,
          hover: $selected ? tokens.state.hoverOnFill : tokens.state.hover,
          pressed: $selected ? tokens.state.pressedOnFill : tokens.state.pressed,
        })),
      // The ring belongs to the inner element; the wrapper only paints states.
      '&:focus-visible': { outline: 'none' },
      ...($disabled && { opacity: tokens.state.disabled }),
    };
  },
);

const mainStyle = (theme: Parameters<typeof kitTheme>[0], interactive: boolean) => {
  const { palette } = kitTheme(theme);
  return {
    display: 'flex',
    alignItems: 'center',
    flex: '1 1 auto',
    minWidth: 0,
    alignSelf: 'stretch',
    gap: `${tokens.space.sm}px`,
    boxSizing: 'border-box',
    margin: 0,
    padding: 0,
    border: 'none',
    background: 'none',
    borderRadius: 'inherit',
    color: 'inherit',
    font: 'inherit',
    textAlign: 'start',
    textDecoration: 'none',
    cursor: interactive ? 'pointer' : 'default',
    '&:focus-visible': focusRing(palette, -tokens.border.focus),
    '&:disabled, &[aria-disabled="true"]': { cursor: 'default' },
  } as const;
};

const Anchor = styled('a')(({ theme }) => mainStyle(theme, true));
const Button = styled('button')(({ theme }) => mainStyle(theme, true));
const Plain = styled('div')(({ theme }) => mainStyle(theme, false));

const Leading = styled('span')({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  // Keeps the text column aligned whether the slot holds an icon or an avatar.
  minWidth: `${tokens.avatar.sm}px`,
});

const Trailing = styled('span')({
  display: 'inline-flex',
  alignItems: 'center',
  flexShrink: 0,
  gap: `${tokens.space.xs}px`,
});

const Column = styled('span')({
  display: 'flex',
  flexDirection: 'column',
  flex: '1 1 auto',
  minWidth: 0,
});

interface LineProps {
  $weight: number;
  $type: 'body' | 'meta';
  $tone: 'row' | 'strong' | 'dim';
}

const Line = styled('span', { shouldForwardProp: transientProps })<LineProps>(
  ({ theme, $type, $weight, $tone }) => {
    const { palette } = kitTheme(theme);
    const style = tokens.text[$type];
    return {
      display: 'block',
      minWidth: 0,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      fontFamily: theme.typography.fontFamily,
      fontSize: `${style.size}px`,
      lineHeight: `${style.line}px`,
      fontWeight: $weight,
      // `row` takes the row's own colour: secondary text, or the on-accent ink when selected.
      color: $tone === 'dim' ? palette.textDim : $tone === 'strong' ? palette.text : 'inherit',
    };
  },
);

/**
 * A row in a list of channels, people or places. A link with `href`, a button
 * with `onClick`, plain content with neither; the whole row is the hit area.
 * `trailing` sits beside the link or button, never inside it, so it can hold
 * its own buttons. `selected` is the solid accent pill.
 */
export function ListRow({
  primary,
  secondary,
  leading,
  trailing,
  size = 'md',
  selected = false,
  unread = false,
  muted = false,
  disabled = false,
  href,
  onClick,
  ref,
  id,
}: ListRowProps): JSX.Element {
  const current = selected ? (href !== undefined ? 'page' : 'true') : undefined;
  // Selected keeps the on-accent ink whatever else is set.
  const tone = (dim: boolean, strong: boolean): 'row' | 'strong' | 'dim' =>
    selected ? 'row' : dim ? 'dim' : strong ? 'strong' : 'row';
  const interactive = href !== undefined || onClick !== undefined;

  const content = (
    <>
      {leading !== undefined && <Leading>{leading}</Leading>}
      <Column>
        <Line
          $type="body"
          $weight={unread ? tokens.text.bodyStrong.weight : tokens.text.body.weight}
          $tone={tone(muted, unread && !selected)}
        >
          {primary}
        </Line>
        {secondary !== undefined && (
          <Line $type="meta" $weight={tokens.text.meta.weight} $tone={tone(muted, false)}>
            {secondary}
          </Line>
        )}
      </Column>
    </>
  );

  let main: JSX.Element;
  if (href !== undefined && !disabled) {
    main = (
      <Anchor ref={ref as Ref<HTMLAnchorElement>} id={id} href={href} aria-current={current}>
        {content}
      </Anchor>
    );
  } else if (href !== undefined) {
    // A disabled link has no destination: not focusable, not navigable.
    main = (
      <Anchor
        ref={ref as Ref<HTMLAnchorElement>}
        id={id}
        role="link"
        aria-disabled="true"
        aria-current={current}
        onClick={(event: MouseEvent) => event.preventDefault()}
      >
        {content}
      </Anchor>
    );
  } else if (onClick !== undefined) {
    main = (
      <Button
        ref={ref as Ref<HTMLButtonElement>}
        id={id}
        type="button"
        disabled={disabled}
        aria-current={current}
        onClick={onClick}
      >
        {content}
      </Button>
    );
  } else {
    main = (
      <Plain ref={ref as Ref<HTMLDivElement>} id={id} aria-current={current}>
        {content}
      </Plain>
    );
  }

  return (
    <Wrapper $size={size} $selected={selected} $interactive={interactive} $disabled={disabled}>
      {main}
      {trailing !== undefined && <Trailing>{trailing}</Trailing>}
    </Wrapper>
  );
}
