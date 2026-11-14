import { useId, type JSX } from 'react';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import { styled, type Theme } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { Icon } from '../display/Icon';
import { kitTheme } from '../theme/KitProvider';
import { interactiveStates } from '../theme/states';
import { mix } from '../theme/mix';
import { FieldBox, type FieldBoxProps } from './FieldBox';
import { FieldShell } from './FieldShell';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectFieldProps {
  /** Names the field; shown above it. */
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  /** Shown while `value` matches no option. */
  placeholder?: string;
  helper?: string;
  /** An error message. Marks the field invalid and replaces the helper. */
  error?: string;
  disabled?: boolean;
  /** Hides the label visually; it still names the field. */
  labelHidden?: boolean;
  id?: string;
}

/** Select hands its input an outlined-variant `notched` flag that InputBase would put on the DOM. */
function SelectBox({ notched, ...rest }: FieldBoxProps & { notched?: boolean }): JSX.Element {
  void notched;
  return <FieldBox {...rest} />;
}

const Placeholder = styled('span')(({ theme }) => ({ color: kitTheme(theme).palette.textDim }));

const ChevronSlot = styled('span')(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  color: kitTheme(theme).palette.textSecondary,
}));

/** MUI hands its icon slot a className that positions and flips it; keep that on our wrapper. */
function Chevron({ className }: { className?: string }): JSX.Element {
  return (
    <ChevronSlot className={className}>
      <Icon name="ChevronDown" size="sm" />
    </ChevronSlot>
  );
}

const Item = styled(MenuItem)(({ theme }) => {
  const { palette } = kitTheme(theme);
  const states = interactiveStates({
    palette,
    under: palette.surface,
    hover: tokens.state.hover,
    pressed: tokens.state.pressed,
  });
  return {
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    gap: `${tokens.space.sm}px`,
    minHeight: `${tokens.control.md}px`,
    padding: `0 ${tokens.space.md}px`,
    borderRadius: `${tokens.radius.md}px`,
    background: 'transparent',
    fontFamily: theme.typography.fontFamily,
    fontSize: `${tokens.text.body.size}px`,
    lineHeight: `${tokens.text.body.line}px`,
    color: palette.text,
    ...states,
    '&.Mui-selected, &.Mui-selected:hover': { background: 'transparent', color: palette.accentText },
    '&.Mui-focusVisible': { background: mix(palette.text, palette.surface, tokens.state.pressed) },
    '&.Mui-disabled': { opacity: tokens.state.disabled },
    '& > .label': { flex: '1 1 0', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' },
  };
});

const paperSx = (theme: Theme) => {
  const { palette } = kitTheme(theme);
  return {
    marginTop: `${tokens.space.xs}px`,
    background: palette.surface,
    backgroundImage: 'none',
    border: `${tokens.border.hairline}px solid ${palette.hairline}`,
    borderRadius: `${tokens.radius.card}px`,
    boxShadow: tokens.shadow.overlay.css,
  };
};

const listSx = { padding: `${tokens.space.xs}px` };

/**
 * A single-choice dropdown in the Lounge look, built on MUI's Select for its
 * keyboard handling and focus return. The menu renders in a portal but is
 * styled from the same theme. Controlled by `value`.
 */
export function SelectField({
  label,
  value,
  onChange,
  options,
  placeholder,
  helper,
  error,
  disabled = false,
  labelHidden = false,
  id,
}: SelectFieldProps): JSX.Element {
  const uid = useId();
  const controlId = id ?? `${uid}-select`;
  const labelId = `${uid}-label`;

  return (
    <FieldShell
      label={label}
      labelHidden={labelHidden}
      helper={helper}
      error={error}
      disabled={disabled}
      controlId={controlId}
      labelId={labelId}
      messageId={`${uid}-message`}
    >
      {({ invalid, describedBy }) => (
        <Select
          value={value}
          onChange={(event) => onChange(String(event.target.value))}
          disabled={disabled}
          displayEmpty
          IconComponent={Chevron}
          renderValue={(selected) => {
            const option = options.find((candidate) => candidate.value === selected);
            return option === undefined ? <Placeholder>{placeholder ?? ''}</Placeholder> : option.label;
          }}
          input={<SelectBox $error={invalid} $round={false} $multiline={false} />}
          SelectDisplayProps={{
            id: controlId,
            'aria-labelledby': labelId,
            'aria-describedby': describedBy,
            'aria-invalid': invalid ? true : undefined,
          }}
          MenuProps={{
            slotProps: { paper: { sx: paperSx }, list: { sx: listSx } },
          }}
          sx={(theme) => {
            const { palette } = kitTheme(theme);
            return {
              '& .MuiSelect-select.MuiSelect-select.MuiSelect-select': {
                display: 'block',
                flex: '1 1 0',
                minWidth: 0,
                height: 'auto',
                minHeight: 0,
                padding: 0,
                paddingRight: `${tokens.icon.sm + tokens.space.sm}px`,
                lineHeight: `${tokens.text.body.line}px`,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                cursor: 'pointer',
              },
              '&.Mui-disabled .MuiSelect-select': { cursor: 'default' },
              '& .MuiSelect-icon': {
                position: 'absolute',
                right: `${tokens.space.lg}px`,
                top: '50%',
                transform: 'translateY(-50%)',
                color: palette.textSecondary,
                pointerEvents: 'none',
              },
              '& .MuiSelect-icon.MuiSelect-iconOpen': { transform: 'translateY(-50%) rotate(180deg)' },
            };
          }}
        >
          {options.map((option) => (
            <Item key={option.value} value={option.value} disabled={option.disabled}>
              <span className="label">{option.label}</span>
              {option.value === value && <Icon name="Check" size="sm" tone="accent" />}
            </Item>
          ))}
        </Select>
      )}
    </FieldShell>
  );
}
