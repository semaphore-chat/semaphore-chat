import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import CommunityFormFields from '../../components/Community/CommunityFormFields';

const renderFields = (autoFocusName?: boolean) =>
  render(
    <CommunityFormFields
      name=""
      description=""
      onNameChange={vi.fn()}
      onDescriptionChange={vi.fn()}
      errors={{}}
      autoFocusName={autoFocusName}
    />,
  );

describe('CommunityFormFields', () => {
  it('focuses the name field when asked (create page)', () => {
    renderFields(true);
    expect(screen.getByRole('textbox', { name: /name/i })).toHaveFocus();
  });

  it('leaves focus alone by default (edit page)', () => {
    renderFields();
    expect(screen.getByRole('textbox', { name: /name/i })).not.toHaveFocus();
  });
});
