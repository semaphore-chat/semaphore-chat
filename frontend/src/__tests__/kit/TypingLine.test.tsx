import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { TypingLine } from '../../kit';
import { typingText } from '../../kit/chat/typingText';
import { renderWithKit } from '../test-utils/renderWithKit';

describe('TypingLine', () => {
  it('words one, two and many typists as the old shell does', () => {
    expect(typingText([])).toBe('');
    expect(typingText(['aiko'])).toBe('aiko is typing…');
    expect(typingText(['aiko', 'dropbear'])).toBe('aiko and dropbear are typing…');
    expect(typingText(['aiko', 'dropbear', 'gracie'])).toBe('aiko and 2 others are typing…');
  });

  it('draws nothing while nobody types', () => {
    const { container } = renderWithKit(<TypingLine names={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the line', () => {
    renderWithKit(<TypingLine names={['aiko']} />);
    expect(screen.getByTestId('typing-line')).toHaveTextContent('aiko is typing…');
  });
});
