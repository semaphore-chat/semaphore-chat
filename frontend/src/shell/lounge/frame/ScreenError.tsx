/** Shown in the frame when a screen of the new design crashes. The call, if any, carries on. */
import type { JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Island, Text } from '../../../kit';

function Body(): JSX.Element {
  const navigate = useNavigate();
  return (
    <>
      <Text variant="title" as="h1">
        Something went wrong
      </Text>
      <p>
        <Text tone="secondary">This screen could not be shown. If you are in a call, it is still connected.</Text>
      </p>
      <div>
        <Button onClick={() => navigate('/')}>Back to the app</Button>
      </div>
    </>
  );
}

/** `inIsland`: inside a template's centre island (which is the `main` already); otherwise its own island. */
export function ScreenError({ inIsland = false }: { inIsland?: boolean }): JSX.Element {
  if (inIsland) return <Body />;
  return (
    <Island as="main" label="Something went wrong" scroll>
      <Body />
    </Island>
  );
}
