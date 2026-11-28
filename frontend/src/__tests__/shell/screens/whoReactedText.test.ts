/** The who-reacted tooltip's words (PR 10e). */
import { describe, expect, it } from 'vitest';
import { whoReactedText } from '../../../shell/lounge/screens/chat/ChatRow';

const person = (id: string, name: string | null) => ({ id, name });

describe('whoReactedText', () => {
  it('names one person, or you', () => {
    expect(whoReactedText([person('u-1', 'aiko')], 0, '😂', 'me')).toBe('aiko reacted with 😂');
    expect(whoReactedText([person('me', 'alexk')], 0, '😂', 'me')).toBe('You reacted with 😂');
  });

  it('joins several with "and", and counts the rest', () => {
    expect(whoReactedText([person('me', 'alexk'), person('u-1', 'aiko'), person('u-2', 'kwam3')], 0, '🔥', 'me')).toBe(
      'You, aiko and kwam3 reacted with 🔥',
    );
    expect(whoReactedText([person('u-1', 'aiko')], 1, '🔥', 'me')).toBe('aiko and 1 other reacted with 🔥');
    expect(whoReactedText([person('u-1', 'aiko')], 4, '🔥', 'me')).toBe('aiko and 4 others reacted with 🔥');
  });

  it('capitalises only the literal "you", never a first name', () => {
    expect(whoReactedText([person('u-1', 'aiko'), person('me', 'alexk')], 0, '👍', 'me')).toBe('aiko and you reacted with 👍');
    expect(whoReactedText([person('u-1', 'youssef')], 0, '👍', 'me')).toBe('youssef reacted with 👍');
  });

  it('shows a name still loading as "…", and with nobody named only the emoji', () => {
    expect(whoReactedText([person('u-1', null)], 0, ':partyparrot:', 'me')).toBe('… reacted with :partyparrot:');
    expect(whoReactedText([], 0, '👍', 'me')).toBe('Reacted with 👍');
  });
});
