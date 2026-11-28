import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { PanelPane } from '../../../kit';
import { renderWithKit } from '../../test-utils/renderWithKit';

describe('PanelPane', () => {
  it('draws the header, the fixed top and the body in that order; only the body scrolls', () => {
    const { container } = renderWithKit(
      <PanelPane header={<h2>Search messages</h2>} top={<input aria-label="field" />}>
        <p>the results</p>
      </PanelPane>,
    );
    const text = container.textContent ?? '';
    expect(text.indexOf('Search messages')).toBeLessThan(text.indexOf('the results'));
    const field = screen.getByRole('textbox', { name: 'field' });
    const body = container.querySelector('[data-kit-panel-pane-body]') as HTMLElement;
    expect(body).toHaveTextContent('the results');
    expect(body).not.toContainElement(field);
    expect(getComputedStyle(body).overflowY).toBe('auto');
    expect(getComputedStyle(container.querySelector('[data-kit-panel-pane]') as HTMLElement).height).toBe('100%');
  });

  it('leaves out the top row when there is none', () => {
    const { container } = renderWithKit(
      <PanelPane header={<h2>head</h2>}>
        <p>body</p>
      </PanelPane>,
    );
    expect((container.querySelector('[data-kit-panel-pane]') as HTMLElement).children).toHaveLength(2);
  });
});
