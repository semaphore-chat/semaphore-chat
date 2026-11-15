/**
 * PLACEHOLDER (PR 3): marks a slot of the frame whose piece is a later PR. Nothing in the app; in a
 * story (ShowPlaceholdersContext true) the slot's name, so a screenshot shows where it sits.
 */
import { useContext, type JSX } from 'react';
import { Text } from '../../../kit';
import { ShowPlaceholdersContext } from './placeholderContext';

export function Placeholder({ name }: { name: string }): JSX.Element | null {
  const show = useContext(ShowPlaceholdersContext);
  if (!show) return null;
  return (
    <Text variant="small" tone="dim">
      {`${name} (placeholder)`}
    </Text>
  );
}
