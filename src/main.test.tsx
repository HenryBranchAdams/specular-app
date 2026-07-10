import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import './main';

describe('production Specular bootstrap', () => {
  it('renders the canonical thinking loop without modes or lens labels', async () => {
    expect(await screen.findByRole('heading', { name: 'Specular' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'What are you thinking about?' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Your thought' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Start voice input' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Send thought' })).toBeVisible();

    expect(screen.queryAllByText(/^Clarify$/u)).toHaveLength(0);
    expect(screen.queryAllByText(/^Invert$/u)).toHaveLength(0);
    expect(screen.queryAllByText(/^Distill$/u)).toHaveLength(0);
    expect(screen.queryAllByText(
      /core question|assumption audit|precision check|generated (?:clarification|inversion|distillation)/iu,
    )).toHaveLength(0);
  });
});
