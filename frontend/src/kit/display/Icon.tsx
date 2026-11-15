import { createElement, type JSX, type SVGProps } from 'react';
import { styled } from '@mui/material/styles';
import { iconNodes, type IconName } from '../icons/generated';
import { tokens } from '../../theme/generated/tokens';
import { kitTheme } from '../theme/KitProvider';
import { transientProps } from '../theme/transientProps';

export type IconSize = keyof typeof tokens.icon;

export type IconTone =
  | 'inherit'
  | 'default'
  | 'secondary'
  | 'dim'
  | 'accent'
  | 'danger'
  | 'positive'
  | 'warning';

export interface IconProps {
  name: IconName;
  size?: IconSize;
  tone?: IconTone;
  label?: string;
}

interface RootProps {
  $tone: IconTone;
}

const Root = styled('svg', {
  shouldForwardProp: transientProps,
})<RootProps>(({ theme, $tone }) => {
  const { palette } = kitTheme(theme);
  const tones: Record<Exclude<IconTone, 'inherit'>, string> = {
    default: palette.text,
    secondary: palette.textSecondary,
    dim: palette.textDim,
    accent: palette.accentText,
    danger: palette.danger,
    positive: palette.positive,
    warning: palette.warning,
  };
  return {
    flexShrink: 0,
    // inherit leaves `color` unset, so the icon paints the text it sits in.
    ...($tone === 'inherit' ? {} : { color: tones[$tone] }),
  };
});

/**
 * A Lucide icon from the generated set, sized by `tokens.icon` and toned by the
 * palette. Decorative by default (hidden from assistive technology); give it a
 * `label` only when nothing around it names it.
 */
export function Icon({ name, size = 'md', tone = 'inherit', label }: IconProps): JSX.Element {
  const nodes = iconNodes[name];
  const dimension = tokens.icon[size];
  // An empty or whitespace-only label names nothing; the icon stays decorative.
  const accessibility: SVGProps<SVGSVGElement> = label?.trim()
    ? { role: 'img', 'aria-label': label }
    : { 'aria-hidden': true, focusable: 'false' };

  return (
    <Root
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      width={dimension}
      height={dimension}
      $tone={tone}
      {...accessibility}
    >
      {nodes.map(([tag, attrs], index) =>
        // The generator writes shape elements only (see iconsGenerated.test.ts);
        // the tag is a literal, so create the element instead of a component per icon.
        createElement(tag, { key: index, ...attrs } as SVGProps<SVGSVGElement>),
      )}
    </Root>
  );
}
