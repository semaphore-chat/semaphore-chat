import type { JSX } from 'react';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { Text } from '../typography/Text';
import { visuallyHidden } from '../theme/a11y';
import { transientProps } from '../theme/transientProps';

const TextColumn = styled('span', {
  shouldForwardProp: transientProps,
})<{ $hidden: boolean; $disabled: boolean }>(({ $hidden, $disabled }) => ({
  display: 'flex',
  flexDirection: 'column',
  flex: '1 1 0',
  minWidth: 0,
  overflowWrap: 'anywhere',
  // Flex items are blockified, so each Text line-height applies, not the row's.
  '& > span': { display: 'flex' },
  ...($disabled && { opacity: tokens.state.disabled }),
  ...($hidden && visuallyHidden),
}));

export interface ChoiceTextProps {
  label: string;
  description?: string;
  labelId: string;
  descriptionId: string;
  hidden?: boolean;
  disabled?: boolean;
}

/** Label and optional description of a choice; ids let the control name and describe itself. */
export function ChoiceText({
  label,
  description,
  labelId,
  descriptionId,
  hidden = false,
  disabled = false,
}: ChoiceTextProps): JSX.Element {
  return (
    <TextColumn $hidden={hidden} $disabled={disabled}>
      <span id={labelId}>
        <Text>{label}</Text>
      </span>
      {description !== undefined && (
        <span id={descriptionId}>
          <Text variant="meta" tone="secondary">
            {description}
          </Text>
        </span>
      )}
    </TextColumn>
  );
}
