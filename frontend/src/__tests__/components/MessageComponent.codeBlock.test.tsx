import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import MessageComponent from '../../components/Message/MessageComponent';
import { createMessage } from '../test-utils/factories';
import { SpanType } from '../../types/message.type';

vi.mock('../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { id: 'user-1', username: 'alice' } }),
}));

vi.mock('../../contexts/UserProfileContext', () => ({
  useUserProfile: () => ({ openProfile: vi.fn() }),
}));

vi.mock('../../components/Common/UserAvatar', () => ({
  default: () => <div data-testid="user-avatar" />,
}));

const mockPermissions = {
  canEdit: false,
  canDelete: false,
  canPin: false,
  canReact: false,
  isOwnMessage: false,
};
vi.mock('../../hooks/useMessagePermissions', () => ({
  useMessagePermissions: () => mockPermissions,
}));

const mockActions = {
  isEditing: false,
  editText: '',
  editAttachments: [],
  stagedForDelete: false,
  isDeleting: false,
  setEditText: vi.fn(),
  handleEditClick: vi.fn(),
  handleEditSave: vi.fn(),
  handleEditCancel: vi.fn(),
  handleRemoveAttachment: vi.fn(),
  handleDeleteClick: vi.fn(),
  handleConfirmDelete: vi.fn(),
  handleCancelDelete: vi.fn(),
  handleConfirmThreadDelete: vi.fn(),
  handleCancelThreadDelete: vi.fn(),
  showThreadDeleteConfirm: false,
  handleReactionClick: vi.fn(),
  handleEmojiSelect: vi.fn(),
  handlePin: vi.fn(),
  handleUnpin: vi.fn(),
};
vi.mock('../../components/Message/useMessageActions', () => ({
  useMessageActions: () => mockActions,
}));

const codeBlockMessage = () =>
  createMessage({
    spans: [
      { type: SpanType.PLAINTEXT, text: 'Here is the fix:' },
      { type: SpanType.CODE_BLOCK, text: 'const x = 1;\nconsole.log(x);' },
      { type: SpanType.PLAINTEXT, text: 'Works now.' },
    ],
  });

/** console.error calls React makes for invalid DOM nesting (e.g. <pre> inside <p>). */
const nestingErrors = (spy: MockInstance) =>
  spy.mock.calls
    .map((args) => args.map(String).join(' '))
    .filter((msg) => /cannot be a descendant of|cannot contain a nested|validateDOMNesting/i.test(msg));

describe('MessageComponent code blocks', () => {
  let errorSpy: MockInstance;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it.each([
    ['an ungrouped', false],
    ['a grouped', true],
  ])('renders a code block in %s message without invalid DOM nesting', (_label, grouped) => {
    const { container } = renderWithProviders(
      <MessageComponent message={codeBlockMessage()} grouped={grouped} />,
    );

    // React reports invalid nesting ("<pre> cannot be a descendant of <p>") via console.error.
    expect(nestingErrors(errorSpy)).toEqual([]);

    const pre = screen.getByText(/const x = 1;/).closest('pre');
    expect(pre).not.toBeNull();
    // A <pre> is block content: no <p> may contain it.
    expect(pre!.closest('p')).toBeNull();
    expect(container.querySelector('p pre')).toBeNull();
  });

  it('keeps the surrounding text in the same messageBody container as the code block', () => {
    renderWithProviders(<MessageComponent message={codeBlockMessage()} />);

    const pre = screen.getByText(/const x = 1;/).closest('pre')!;
    const body = pre.parentElement!;
    expect(body.tagName).toBe('DIV');
    expect(body.className).toMatch(/MuiTypography-messageBody/);
    expect(body).toHaveTextContent('Here is the fix:');
    expect(body).toHaveTextContent('Works now.');
  });

  it('caps message text at 80ch and lets code blocks grow to 120ch of the column', () => {
    renderWithProviders(<MessageComponent message={codeBlockMessage()} />);

    // jsdom's CSSOM drops `ch`/`cqi` values, so read the emitted rules instead.
    const css = Array.from(document.querySelectorAll('style'))
      .map((el) => el.textContent ?? '')
      .join('\n');
    const body = screen.getByTestId('message-body');
    const bodyClass = Array.from(body.classList).find((c) => c.startsWith('css-'))!;
    const bodyRule = css.slice(css.indexOf(`.${bodyClass}{`));
    expect(bodyRule).toMatch(/^[^}]*max-width:80ch/);
    expect(bodyRule).toMatch(
      new RegExp(`\\.${bodyClass} \\.message-code-block\\{[^}]*width:max-content;min-width:100%;max-width:min\\(120ch, ?100cqi\\);?\\}`),
    );

    const pre = screen.getByText(/const x = 1;/).closest('pre')!;
    expect(pre).toHaveClass('message-code-block');
    // Long code lines scroll instead of wrapping.
    expect(pre).toHaveStyle({ whiteSpace: 'pre', overflowX: 'auto' });
  });
});
