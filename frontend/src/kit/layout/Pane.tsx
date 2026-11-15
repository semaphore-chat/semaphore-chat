import { styled } from '@mui/material/styles';
import { transientProps } from '../theme/transientProps';

/**
 * The grid item an island sits in. It is what a layout hides on a phone: `hidden` takes the pane out
 * of the render tree and `inert` out of the tab order and the accessibility tree, while the content
 * stays mounted, so what was typed in it is still there when the pane comes back.
 *
 * It can take focus from code (`tabIndex={-1}`, never a Tab stop), so a layout can move focus into the pane now
 * shown when the one that held it is hidden.
 * (An author `display` would beat the `hidden` attribute, so the rule is repeated here.)
 */
export const Pane = styled('div', { shouldForwardProp: transientProps })<{ $area: string }>(({ $area }) => ({
  gridArea: $area,
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  minHeight: 0,
  '&[hidden]': { display: 'none' },
  // Focus is placed here by the layout, not by the user: the island inside carries the visible edge.
  outline: 'none',
}));
