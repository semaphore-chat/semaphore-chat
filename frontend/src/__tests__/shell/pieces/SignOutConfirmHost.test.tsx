/**
 * The frame's one sign-out question (SignOutConfirmHost): it outlives the control that opened it (the user
 * card at compact and wide, the phone sheet's row: the window crossing the phone width swaps them), confirming
 * signs out once, the busy confirm ignores a second press, and Cancel does nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState, type JSX } from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import { renderWithKit } from '../../test-utils/renderWithKit';
import { SignOutConfirmHost } from '../../../shell/lounge/pieces/signOutConfirm';
import { useSignOutRequest } from '../../../shell/lounge/pieces/signOutRequest';

const signOut = vi.hoisted(() => ({ fn: vi.fn(), release: () => undefined as void }));
vi.mock('../../../data/session', () => ({ useSignOut: () => ({ signOut: signOut.fn }) }));

/** A control that opens the question, and a switch that removes it (as a width change does). */
function Controls(): JSX.Element {
  const [shown, setShown] = useState(true);
  return (
    <>
      {shown && <Opener />}
      <button type="button" onClick={() => setShown(false)}>
        Cross the width
      </button>
    </>
  );
}

function Opener(): JSX.Element {
  const request = useSignOutRequest();
  return (
    <button type="button" onClick={request}>
      Sign out…
    </button>
  );
}

beforeEach(() => {
  signOut.fn.mockReset();
  signOut.fn.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        signOut.release = resolve;
      }),
  );
});

function renderHost() {
  return renderWithKit(
    <SignOutConfirmHost>
      <Controls />
    </SignOutConfirmHost>,
  );
}

describe('SignOutConfirmHost', () => {
  it('the question outlives the control that opened it; confirming signs out once; the busy confirm ignores a second press', async () => {
    const { user } = renderHost();
    await user.click(screen.getByRole('button', { name: 'Sign out…' }));
    const question = await screen.findByRole('dialog', { name: 'Sign out?' });

    // The window crosses the phone width: the control that opened the question goes.
    screen.getByRole('button', { name: 'Cross the width', hidden: true }).click();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Sign out…', hidden: true })).toBeNull());
    expect(screen.getByRole('dialog', { name: 'Sign out?' })).toBe(question);

    const confirm = within(question).getByRole('button', { name: 'Sign out' });
    await user.click(confirm);
    await waitFor(() => expect(signOut.fn).toHaveBeenCalledTimes(1));
    // Running: still focusable, says it is busy, and a second press does nothing.
    await waitFor(() => expect(confirm).toHaveAttribute('aria-disabled', 'true'));
    await user.click(confirm);
    expect(signOut.fn).toHaveBeenCalledTimes(1);
    signOut.release();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Sign out?' })).toBeNull());
  });

  it('Cancel signs nothing out', async () => {
    const { user } = renderHost();
    await user.click(screen.getByRole('button', { name: 'Sign out…' }));
    const question = await screen.findByRole('dialog', { name: 'Sign out?' });
    await user.click(within(question).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Sign out?' })).toBeNull());
    expect(signOut.fn).not.toHaveBeenCalled();
  });

  it('a control outside a host is a programming error, said plainly', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => renderWithKit(<Opener />)).toThrow(/SignOutConfirmHost/);
    error.mockRestore();
  });
});
