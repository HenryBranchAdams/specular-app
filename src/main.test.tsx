import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import './main';

describe('production Specular bootstrap', () => {
  it('renders the canonical human-owned thinking document', async () => {
    expect(await screen.findByRole('button', { name: 'Specular' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Document title' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Thought writing block' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Reflect' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Connections' })).toBeVisible();
    expect(screen.queryByRole('log')).not.toBeInTheDocument();
  });
});
