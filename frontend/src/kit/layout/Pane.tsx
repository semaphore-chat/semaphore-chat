import { styled } from '@mui/material/styles';
import { transientProps } from '../theme/transientProps';

/**
 * The grid item an island sits in. It is what a layout hides on a phone: `hidden` takes the pane out
 * of the render tree and `inert` out of the tab order and the accessibility tree, while the content
 * stays mounted, so what was typed in it is still there when the pane comes back.
 * (An author `display` would beat the `hidden` attribute, so the rule is repeated here.)
 */
export const Pane = styled('div', { shouldForwardProp: transientProps })<{ $area: string }>(({ $area }) => ({
  gridArea: $area,
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  minHeight: 0,
  '&[hidden]': { display: 'none' },
}));
