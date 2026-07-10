import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { questionMarkCount } from './domain/validators';
import './main';

describe('interim Specular prototype', () => {
  it('renders one validated normal question without modes or lens labels', async () => {
    const user = userEvent.setup();
    const generate = await screen.findByRole('button', { name: 'Sharpen this thought' });

    expect(screen.queryAllByText(/^Clarify$/u)).toHaveLength(0);
    expect(screen.queryAllByText(/^Invert$/u)).toHaveLength(0);
    expect(screen.queryAllByText(/^Distill$/u)).toHaveLength(0);
    expect(screen.queryAllByText(/core question|assumption audit|precision check|generated (?:clarification|inversion|distillation)/iu)).toHaveLength(0);

    const input = screen.getByPlaceholderText(/Example:/u);
    await user.type(input, 'What? Why?');
    await user.click(generate);

    const questionBox = document.querySelector('.questionBox');
    expect(questionBox).not.toBeNull();
    expect(questionBox?.querySelector('.pill')).toBeNull();
    expect(questionMarkCount(questionBox?.textContent ?? '')).toBe(1);
  });
});
