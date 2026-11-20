import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { screen } from '@testing-library/react';
import { useState } from 'react';
import { Alert, Avatar, AvatarStack, Button, Card, Dialog, Icon, IconButton, Island, KeyCap, ListRow, Menu, Pill, Popover, SelectField, Skeleton, Tabs, Text, TextField } from '../../kit';
import { mix } from '../../kit/theme/mix';
import { tokens } from '../../theme/generated/tokens';
import { rulesFor } from './cssRules';
import { derivePalette } from '../../theme/derive/derivePalette';
import { renderWithKit } from '../test-utils/renderWithKit';

let consoleError: MockInstance;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

const palette = derivePalette('#8E75FF', 'dark', 'minimal');

/** A colour the browser has normalised, so a hex and its painted rgb() compare equal. */
function computed(value: string): string {
  const probe = document.createElement('div');
  probe.style.backgroundColor = value;
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return resolved;
}
const background = (element: Element) => getComputedStyle(element).backgroundColor;

describe('kit pieces on a Card (the fill surface)', () => {
  it('a card and the palette really differ, so the tests mean something', () => {
    expect(computed(palette.fill)).not.toBe(computed(palette.surface));
  });

  it('a soft Button is fill outside a Card and surface inside one', () => {
    renderWithKit(
      <>
        <Button variant="soft">Outside</Button>
        <Card>
          <Button variant="soft">Inside</Button>
        </Card>
      </>,
    );
    expect(background(screen.getByRole('button', { name: 'Outside' }))).toBe(computed(palette.fill));
    expect(background(screen.getByRole('button', { name: 'Inside' }))).toBe(computed(palette.surface));
  });

  it('a quietDanger Button follows the same rule', () => {
    renderWithKit(
      <>
        <Button variant="quietDanger">Outside</Button>
        <Card>
          <Button variant="quietDanger">Inside</Button>
        </Card>
      </>,
    );
    expect(background(screen.getByRole('button', { name: 'Outside' }))).toBe(computed(palette.fill));
    expect(background(screen.getByRole('button', { name: 'Inside' }))).toBe(computed(palette.surface));
  });

  it('a primary Button is unchanged inside a Card', () => {
    renderWithKit(
      <Card>
        <Button variant="primary">Go</Button>
      </Card>,
    );
    expect(background(screen.getByRole('button', { name: 'Go' }))).toBe(computed(palette.accent));
  });

  it('a soft IconButton is fill outside a Card and surface inside one', () => {
    renderWithKit(
      <>
        <IconButton icon="X" label="Outside" variant="soft" />
        <Card>
          <IconButton icon="X" label="Inside" variant="soft" />
        </Card>
      </>,
    );
    expect(background(screen.getByRole('button', { name: 'Outside' }))).toBe(computed(palette.fill));
    expect(background(screen.getByRole('button', { name: 'Inside' }))).toBe(computed(palette.surface));
  });

  it('a neutral Pill is fill outside a Card and surface inside one; accent is unchanged', () => {
    renderWithKit(
      <>
        <Pill>outside</Pill>
        <Card>
          <Pill>inside</Pill>
          <Pill tone="danger" dot>
            hot
          </Pill>
          <Pill tone="accent">here</Pill>
        </Card>
      </>,
    );
    const pill = (text: string) => screen.getByText(text).parentElement as HTMLElement;
    expect(background(pill('outside'))).toBe(computed(palette.fill));
    expect(background(pill('inside'))).toBe(computed(palette.surface));
    expect(background(pill('hot'))).toBe(computed(palette.surface));
    expect(background(pill('here'))).toBe(computed(palette.accent));
  });

  it('a TextField box is fill outside a Card and surface inside one', () => {
    renderWithKit(
      <>
        <TextField label="Outside" value="" onChange={() => undefined} />
        <Card>
          <TextField label="Inside" value="" onChange={() => undefined} />
        </Card>
      </>,
    );
    const box = (label: string) => screen.getByRole('textbox', { name: label }).parentElement as HTMLElement;
    expect(background(box('Outside'))).toBe(computed(palette.fill));
    expect(background(box('Inside'))).toBe(computed(palette.surface));
  });

  it('a SelectField box is fill outside a Card and surface inside one', () => {
    const options = [{ value: 'a', label: 'A' }];
    renderWithKit(
      <>
        <SelectField label="Outside" value="a" onChange={() => undefined} options={options} />
        <Card>
          <SelectField label="Inside" value="a" onChange={() => undefined} options={options} />
        </Card>
      </>,
    );
    const box = (label: string) => screen.getByRole('combobox', { name: label }).closest('.MuiInputBase-root') as HTMLElement;
    expect(background(box('Outside'))).toBe(computed(palette.fill));
    expect(background(box('Inside'))).toBe(computed(palette.surface));
  });
});

const hoverRule = (element: Element) =>
  rulesFor(element, ':hover')
    .map((rule) => rule.cssText)
    .join(' ');

describe('the surface context composes', () => {
  it('a soft Button is fill on the ground and in an Island, surface on a Card', () => {
    renderWithKit(
      <>
        <Button variant="soft">Ground</Button>
        <Island>
          <Button variant="soft">Island</Button>
          <Card>
            <Button variant="soft">Card</Button>
          </Card>
        </Island>
      </>,
    );
    expect(background(screen.getByRole('button', { name: 'Ground' }))).toBe(computed(palette.fill));
    expect(background(screen.getByRole('button', { name: 'Island' }))).toBe(computed(palette.fill));
    expect(background(screen.getByRole('button', { name: 'Card' }))).toBe(computed(palette.surface));
  });

  it('a Card inside a Card is surface, not fill on fill', () => {
    renderWithKit(
      <Card>
        <Card>
          <span>inner</span>
        </Card>
      </Card>,
    );
    expect(background(screen.getByText('inner').parentElement as HTMLElement)).toBe(computed(palette.surface));
  });

  it('a ListRow on a Card with a trailing soft IconButton: the button is surface and the row hovers over fill', () => {
    renderWithKit(
      <Card>
        <ListRow primary="row" onClick={() => undefined} trailing={<IconButton icon="Ellipsis" label="More" variant="soft" />} />
      </Card>,
    );
    expect(background(screen.getByRole('button', { name: 'More' }))).toBe(computed(palette.surface));
    const wrapper = screen.getByRole('button', { name: 'row' }).parentElement as HTMLElement;
    expect(hoverRule(wrapper)).toContain(computed(mix(palette.text, palette.fill, tokens.state.hover)));
  });

  it('a selected IconButton on a Card is drawn surface', () => {
    renderWithKit(
      <Card>
        <IconButton icon="Pin" label="Pinned" selected />
      </Card>,
    );
    expect(background(screen.getByRole('button', { name: 'Pinned' }))).toBe(computed(palette.surface));
  });

  it('a ghost Button hovers over the ground, the surface or the fill it sits on', () => {
    renderWithKit(
      <>
        <Button variant="ghost">Ground</Button>
        <Island>
          <Button variant="ghost">Island</Button>
          <Card>
            <Button variant="ghost">Card</Button>
          </Card>
        </Island>
      </>,
    );
    const over = (name: string, under: string) =>
      expect(hoverRule(screen.getByRole('button', { name }))).toContain(computed(mix(palette.text, under, tokens.state.hover)));
    over('Ground', palette.ground);
    over('Island', palette.surface);
    over('Card', palette.fill);
  });

  it('an AvatarStack "+N" on a Card is surface', () => {
    renderWithKit(
      <>
        <AvatarStack label="outside" max={1} people={[{ name: 'A' }, { name: 'B' }]} />
        <Card>
          <AvatarStack label="inside" max={1} people={[{ name: 'A' }, { name: 'B' }]} />
        </Card>
      </>,
    );
    const [outside, inside] = screen.getAllByText('+1');
    expect(background(outside)).toBe(computed(palette.fill));
    expect(background(inside)).toBe(computed(palette.surface));
  });

  it('tabs, key caps, skeletons, alerts and initials stand out on a Card', () => {
    renderWithKit(
      <Card>
        <Tabs variant="segmented" label="t" value="a" onChange={() => undefined} tabs={[{ id: 'a', label: 'A' }]} />
        <KeyCap>Esc</KeyCap>
        <Skeleton shape="rect" />
        <Alert severity="info">note</Alert>
        <Avatar name="Zed Zed" />
      </Card>,
    );
    const surface = computed(palette.surface);
    expect(background(screen.getByRole('tablist'))).toBe(surface);
    expect(background(screen.getByText('Esc'))).toBe(surface);
    expect(background(screen.getByRole('status'))).toBe(surface);
    expect(background(screen.getByText('ZZ'))).toBe(surface);
    expect(background(document.querySelector('[aria-hidden="true"]') as HTMLElement)).toBe(surface);
  });

  it('a Dialog opened from a Card draws its soft Button as fill again', async () => {
    function FromCard() {
      const [open, setOpen] = useState(false);
      return (
        <Card>
          <Button onClick={() => setOpen(true)}>Leave</Button>
          <Dialog open={open} onClose={() => setOpen(false)} title="Leave room" actions={<Button variant="soft">Stay</Button>}>
            body
          </Dialog>
        </Card>
      );
    }
    const { user } = renderWithKit(<FromCard />);
    expect(background(screen.getByRole('button', { name: 'Leave' }))).toBe(computed(palette.surface));
    await user.click(screen.getByRole('button', { name: 'Leave' }));
    expect(background(await screen.findByRole('button', { name: 'Stay' }))).toBe(computed(palette.fill));
  });

  it('a Menu opened from a selected ListRow draws its key caps as on a surface, not on the accent', async () => {
    function Host() {
      const [open, setOpen] = useState(false);
      const [anchor, setAnchor] = useState<HTMLElement | null>(null);
      return (
        <>
          <ListRow
            primary="row"
            selected
            onClick={() => undefined}
            trailing={
              <>
                <IconButton ref={setAnchor} icon="Ellipsis" label="More" onClick={() => setOpen(true)} />
                <Menu
                  open={open}
                  anchor={anchor}
                  onClose={() => setOpen(false)}
                  label="Row actions"
                  items={[{ id: 'pin', label: 'Pin', icon: 'Pin', shortcut: ['P'], onSelect: () => undefined }]}
                />
              </>
            }
          />
        </>
      );
    }
    const { user } = renderWithKit(<Host />);
    await user.click(screen.getByRole('button', { name: 'More' }));
    await screen.findByRole('menuitem', { name: /Pin/ });
    expect(background(screen.getByText('P'))).toBe(computed(palette.fill));
  });

  it('a Popover opened from a selected ListRow keeps default ink for its text and icons', async () => {
    function Host() {
      const [open, setOpen] = useState(false);
      const [anchor, setAnchor] = useState<HTMLElement | null>(null);
      return (
        <>
          <ListRow
            primary="row"
            selected
            onClick={() => undefined}
            trailing={
              <>
                <IconButton ref={setAnchor} icon="Ellipsis" label="More" onClick={() => setOpen(true)} />
                <Popover open={open} anchor={anchor} onClose={() => setOpen(false)} label="Details">
                  <Text tone="secondary">details</Text>
                  <Icon name="Bell" tone="secondary" label="bell" />
                  <Pill>tag</Pill>
                </Popover>
              </>
            }
          />
        </>
      );
    }
    const { user } = renderWithKit(<Host />);
    await user.click(screen.getByRole('button', { name: 'More' }));
    expect(await screen.findByText('details')).toHaveStyle({ color: computed(palette.textSecondary) });
    expect(screen.getByRole('img', { name: 'bell' })).toHaveStyle({ color: computed(palette.textSecondary) });
    expect(background(screen.getByText('tag').parentElement as HTMLElement)).toBe(computed(palette.fill));
  });
});
