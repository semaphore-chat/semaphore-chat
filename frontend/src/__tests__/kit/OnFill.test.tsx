import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { screen } from '@testing-library/react';
import { Button, Card, IconButton, Pill, SelectField, TextField } from '../../kit';
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

describe('kit pieces on a Card (the on-fill context)', () => {
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
