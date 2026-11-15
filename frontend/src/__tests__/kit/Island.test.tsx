import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { screen } from '@testing-library/react';
import { Island } from '../../kit';
import { renderWithKit } from '../test-utils/renderWithKit';

let consoleError: MockInstance;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

const px = (value: string) => Number.parseFloat(value);

describe('Island landmarks', () => {
  it('a default island is a section that is not a region', () => {
    renderWithKit(<Island>content</Island>);
    expect(screen.queryByRole('region')).toBeNull();
    expect(screen.getByText('content').tagName).toBe('SECTION');
  });

  it('a labelled section is a region with that name', () => {
    renderWithKit(<Island label="Voice rooms">content</Island>);
    expect(screen.getByRole('region', { name: 'Voice rooms' })).toBeInTheDocument();
  });

  it('as nav is a navigation landmark', () => {
    renderWithKit(<Island as="nav" label="Channels">content</Island>);
    expect(screen.getByRole('navigation', { name: 'Channels' })).toBeInTheDocument();
  });

  it('as aside is a complementary landmark', () => {
    renderWithKit(<Island as="aside" label="Members">content</Island>);
    expect(screen.getByRole('complementary', { name: 'Members' })).toBeInTheDocument();
  });

  it('as main is the main landmark', () => {
    renderWithKit(<Island as="main">content</Island>);
    expect(screen.getByRole('main')).toBeInTheDocument();
  });

  it('forwards id', () => {
    renderWithKit(<Island id="left">content</Island>);
    expect(screen.getByText('content')).toHaveAttribute('id', 'left');
  });
});

describe('Island look', () => {
  it('padding none is zero and lg is larger than md', () => {
    renderWithKit(
      <>
        <Island padding="none">none</Island>
        <Island padding="md">md</Island>
        <Island padding="lg">lg</Island>
      </>,
    );
    const pad = (text: string) => px(getComputedStyle(screen.getByText(text)).paddingTop);
    expect(pad('none')).toBe(0);
    expect(pad('md')).toBeGreaterThan(0);
    expect(pad('lg')).toBeGreaterThan(pad('md'));
  });

  it('defaults to lg padding', () => {
    renderWithKit(
      <>
        <Island>default</Island>
        <Island padding="lg">lg</Island>
      </>,
    );
    expect(getComputedStyle(screen.getByText('default')).paddingTop).toBe(getComputedStyle(screen.getByText('lg')).paddingTop);
  });

  it('has no border and casts a shadow', () => {
    renderWithKit(<Island>content</Island>);
    const style = getComputedStyle(screen.getByText('content'));
    expect(['', '0px', 'none']).toContain(style.borderTopWidth === '' ? '' : style.borderTopWidth);
    expect(style.boxShadow).not.toBe('');
  });

  it('scroll makes the content scroll inside the island', () => {
    renderWithKit(
      <>
        <Island scroll>scrolls</Island>
        <Island>still</Island>
      </>,
    );
    const scrolling = getComputedStyle(screen.getByText('scrolls'));
    expect(scrolling.overflowY).toBe('auto');
    expect(scrolling.minHeight).toBe('0px');
    expect(getComputedStyle(screen.getByText('still')).overflowY).not.toBe('auto');
  });
});
