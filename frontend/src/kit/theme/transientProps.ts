/**
 * `shouldForwardProp` for every styled kit component: `$`-prefixed props are
 * styling inputs and must never reach the DOM or the MUI component below.
 */
export const transientProps = (prop: PropertyKey): boolean =>
  typeof prop === 'string' && !prop.startsWith('$');
