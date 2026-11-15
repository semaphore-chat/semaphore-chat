import type { JSX, ReactNode } from 'react';
import { Button, Text } from '../../kit';
import { tokens } from '../../theme/generated/tokens';

/** Some page behind an overlay, so the scrim and the surface edge have something to dim and to sit on. */
export function PageBehind({ children }: { children?: ReactNode }): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.md, width: '100%' }}>
      <Text variant="title">Couch Co-op</Text>
      <Text tone="secondary">
        Movie night is on Friday. Bring snacks, and vote on the film in the poll pinned to the top of the channel.
      </Text>
      <div style={{ display: 'flex', gap: tokens.space.sm, flexWrap: 'wrap' }}>
        <Button variant="primary">Join voice</Button>
        <Button variant="soft">Invite people</Button>
      </div>
      {children}
    </div>
  );
}
