import { useId, useImperativeHandle, useRef, type JSX, type Ref } from 'react';
import Fade from '@mui/material/Fade';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import { styled, type Theme } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { Icon } from '../display/Icon';
import { kitTheme } from '../theme/KitProvider';
import { interactiveStates } from '../theme/states';
import { mix } from '../theme/mix';
import { shadow } from '../theme/shadow';
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
  /** The combobox element, so a form can focus it. */
  ref?: Ref<HTMLElement>;
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
    // MUI's MenuItem resets min-height at its `sm` breakpoint; hold the row height there too.
    [theme.breakpoints.up('sm')]: { minHeight: `${tokens.control.md}px` },
    borderRadius: `${tokens.radius.md}px`,
    background: 'transparent',
    fontFamily: theme.typography.fontFamily,
    fontSize: `${tokens.text.body.size}px`,
    lineHeight: `${tokens.text.body.line}px`,
    color: palette.text,
    ...states,
    // MUI tints a selected item (and its hover, and focus-visible) with the
    // primary colour. Selected reads as the accent label and a Check, so the
    // tint is cleared; the rules below are the kit's own hover and focus
    // states, and they match MUI's specificity so they win.
    '&.Mui-selected, &.Mui-selected:hover': { background: 'transparent', color: palette.accentText },
    '@media (hover: hover)': {
      ...states['@media (hover: hover)'],
      '&.Mui-selected:hover': { background: mix(palette.text, palette.surface, tokens.state.hover) },
    },
    '&.Mui-focusVisible, &.Mui-selected.Mui-focusVisible': {
      background: mix(palette.text, palette.surface, tokens.state.pressed),
    },
    '&.Mui-disabled': { opacity: tokens.state.disabled },
    '& > .label': { flex: '1 1 0', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' },
  };
});

const paperSx = (theme: Theme) => {
  const lounge = kitTheme(theme);
  const { palette } = lounge;
  return {
    marginTop: `${tokens.space.xs}px`,
    background: palette.surface,
    backgroundImage: 'none',
    border: `${tokens.border.hairline}px solid ${palette.hairline}`,
    borderRadius: `${tokens.radius.card}px`,
    boxShadow: shadow(lounge, 'overlay'),
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
  ref,
  id,
}: SelectFieldProps): JSX.Element {
  const uid = useId();
  const controlId = id ?? `${uid}-select`;
  const labelId = `${uid}-label`;
  // MUI's select hands this handle to `inputRef`; its focus() focuses the
  // combobox without opening it, as a native select's label does.
  const selectRef = useRef<{ focus: () => void }>(null);
  // The combobox is MUI's display div, found by the id this component gives it.
  useImperativeHandle(ref, () => document.getElementById(controlId) as HTMLElement, [controlId]);

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
      onLabelClick={() => selectRef.current?.focus()}
    >
      {({ invalid, describedBy }) => (
        <Select
          inputRef={selectRef}
          labelId={labelId}
          value={value}
          onChange={(event) => {
            const next = String(event.target.value);
            // MUI relies on CSS pointer-events to keep a disabled option from
            // being chosen; an assistive technology's synthetic click skips CSS.
            if (options.find((option) => option.value === next)?.disabled) {
              return;
            }
            onChange(next);
          }}
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
            // A plain fade at the fast timing: MUI's default Grow takes its
            // duration from the menu's height and scales the paper.
            transitionDuration: tokens.motion.fast,
            slots: { transition: Fade },
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
                lineHeight: `${tokens.text.body.line}px`,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                cursor: 'pointer',
              },
              '&.Mui-disabled .MuiSelect-select': { cursor: 'default' },
              // The chevron is a flex item of the field box (which centres its
              // children), not positioned over it, so the text ends before it.
              '& .MuiSelect-icon': {
                position: 'static',
                flexShrink: 0,
                color: palette.textSecondary,
                pointerEvents: 'none',
              },
              // Half a turn flips the chevron up while the list is open.
              '& .MuiSelect-icon.MuiSelect-iconOpen': { transform: 'rotate(180deg)' },
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
