/**
 * Shown in the frame when a screen of the new design cannot be shown (its module did not load, or it
 * crashed). Try again loads and renders it again; Back to the app leaves for the home. A call carries on.
 */
import type { JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Island, Text } from '../../../kit';

function Body({ onRetry }: { onRetry: () => void }): JSX.Element {
  const navigate = useNavigate();
  return (
    <>
      <Text variant="title" as="h1">
        Couldn&apos;t show this screen
      </Text>
      <p>
        <Text tone="secondary">If you are in a call, it is still connected.</Text>
      </p>
      <div>
        <Button variant="primary" onClick={onRetry}>
          Try again
        </Button>{' '}
        <Button onClick={() => navigate('/')}>Back to the app</Button>
      </div>
    </>
  );
}

/** `inIsland`: inside a template's centre island (which is the `main` already); otherwise its own island. */
export function ScreenError({ inIsland = false, onRetry }: { inIsland?: boolean; onRetry: () => void }): JSX.Element {
  if (inIsland) return <Body onRetry={onRetry} />;
  return (
    <Island as="main" label="Couldn't show this screen" scroll>
      <Body onRetry={onRetry} />
    </Island>
  );
}
