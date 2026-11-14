import type { JSX, ReactNode } from 'react';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { kitTheme } from '../theme/KitProvider';

export type TextVariant = keyof typeof tokens.text;
export type TextTone = 'default' | 'secondary' | 'dim' | 'accent' | 'danger';

/** The elements kit text may render as. */
type TextElement = 'span' | 'p' | 'div' | 'label' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

export interface TextProps {
  variant?: TextVariant;
  tone?: TextTone;
  as?: TextElement;
  truncate?: boolean;
  children: ReactNode;
}

const FALLBACK_FONTS = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

const DEFAULT_ELEMENT: Partial<Record<TextVariant, TextElement>> = {
  title: 'h2',
  section: 'h3',
};

interface RootProps {
  $variant: TextVariant;
  $tone: TextTone;
  $truncate: boolean;
}

const Root = styled('span', {
  // `as` must be excluded here: emotion then swaps the element instead of forwarding it.
  shouldForwardProp: (prop) => typeof prop === 'string' && prop !== 'as' && !prop.startsWith('$'),
})<RootProps>(({ theme, $variant, $tone, $truncate }) => {
  const { palette } = kitTheme(theme);
  const style = tokens.text[$variant];
  const colours: Record<TextTone, string> = {
    default: palette.text,
    secondary: palette.textSecondary,
    dim: palette.textDim,
    accent: palette.accentText,
    danger: palette.danger,
  };
  return {
    margin: 0,
    fontFamily: `'${style.family}', ${FALLBACK_FONTS}`,
    fontSize: `${style.size}px`,
    lineHeight: `${style.line}px`,
    fontWeight: style.weight,
    color: colours[$tone],
    ...($truncate && {
      display: 'block',
      minWidth: 0,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    }),
  };
});

/** Kit text in one of the eight type styles, coloured by tone. */
export function Text({
  variant = 'body',
  tone = 'default',
  as,
  truncate = false,
  children,
}: TextProps): JSX.Element {
  return (
    <Root
      as={as ?? DEFAULT_ELEMENT[variant] ?? 'span'}
      $variant={variant}
      $tone={tone}
      $truncate={truncate}
    >
      {children}
    </Root>
  );
}
