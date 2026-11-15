/**
 * Clips content to nothing while keeping it in the accessibility tree.
 *
 * The 1px here is the standard clipping size of the visually-hidden pattern,
 * not a design value: it is the one bare pixel literal the kit allows.
 */
export const visuallyHidden = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  margin: '-1px',
  padding: 0,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
} as const;
