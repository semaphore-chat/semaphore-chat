import { useId, useImperativeHandle, useRef, useState, type JSX, type Ref } from 'react';
import { createPortal } from 'react-dom';
import Fade from '@mui/material/Fade';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import { styled, type Theme } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { LiveRegionSlot } from '../behaviour/hosts/LiveRegionSlot';
import { useOverlayLayer } from '../behaviour/hosts/overlay';
import { Icon } from '../display/Icon';
import { kitTheme } from '../theme/KitProvider';
import { useOverlayContainer } from '../overlays/overlayContainer';
import { ANCHOR_GAP, menuItemStyle, overlaySurface } from '../overlays/surface';
import { SurfaceContext, useSurface } from '../theme/onSurface';
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
  const on = useSurface();
  return <FieldBox {...rest} $on={on} />;
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
 * keyboard handling. The open list is a menu layer of the overlay stack, which
 * decides when it closes (Escape, a press outside, Tab) and returns focus to
 * the field. The list renders in a portal but is styled from the same theme.
 * Controlled by `value`.
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
  // Inside a Dialog the list renders in the Dialog, where its focus trap lets focus in.
  const container = useOverlayContainer();
  // MUI's select hands this handle to `inputRef`; its focus() focuses the
  // combobox without opening it, as a native select's label does.
  const selectRef = useRef<{ focus: () => void }>(null);
  // The combobox is MUI's display div, found by the id this component gives it.
  useImperativeHandle(ref, () => document.getElementById(controlId) as HTMLElement, [controlId]);
  // MUI opens the list (a press or a key on the field) and closes it when an
  // option is chosen; every other close is the stack's.
  const [open, setOpen] = useState(false);
  const paper = useRef<HTMLDivElement>(null);
  useOverlayLayer({ kind: 'menu', open, panel: paper, onRequestClose: () => setOpen(false) });
  // The list's modal root: its live-region slot goes there, outside the list MUI manages.
  const [listRoot, setListRoot] = useState<HTMLElement | null>(null);

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
        <>
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
          open={open}
          onOpen={() => setOpen(true)}
          onClose={() => setOpen(false)}
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
            container,
            transitionDuration: tokens.motion.fast,
            slots: { transition: Fade },
            // MUI's reasons (escapeKeyDown, backdropClick, tabKeyDown) are not ours to act on.
            onClose: () => undefined,
            disableEscapeKeyDown: true,
            disableRestoreFocus: true,
            slotProps: { root: { ref: setListRoot }, paper: { sx: paperSx, ref: paper }, list: { sx: listSx } },
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
              {/* The list is a portal: it draws on its own surface, not the layer the field sits on. */}
              <SurfaceContext value="surface">
                <span className="label">{option.label}</span>
                {option.value === value && <Icon name="Check" size="sm" tone="accent" />}
              </SurfaceContext>
            </Item>
          ))}
        </Select>
        {listRoot !== null && createPortal(<LiveRegionSlot scope="layer" active={open} />, listRoot)}
        </>
      )}
    </FieldShell>
  );
}
