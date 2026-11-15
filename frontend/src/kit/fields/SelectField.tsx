import { useId, useImperativeHandle, useRef, type JSX, type Ref } from 'react';
import Fade from '@mui/material/Fade';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import { styled, type Theme } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { Icon } from '../display/Icon';
import { kitTheme } from '../theme/KitProvider';
import { ANCHOR_GAP, menuItemStyle, overlaySurface } from '../overlays/surface';
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

const Item = styled(MenuItem)(({ theme }) => menuItemStyle(kitTheme(theme)));

const paperSx = (theme: Theme) => ({
  marginTop: `${ANCHOR_GAP}px`,
  ...overlaySurface(kitTheme(theme)),
});

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
