import {
  cleanup,
  render,
  screen,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  afterEach,
  describe,
  expect,
  it,
} from 'vitest';
import type { ThreadUnderstanding } from '../domain/contracts';
import { ReasoningMap } from './ReasoningMap';

const UNDERSTANDING: ThreadUnderstanding = {
  claims: ['Demand exists before the workflow is automated.'],
  observations: ['Three teams currently maintain separate spreadsheets.'],
  stakeholders: ['Operations leaders'],
  contexts: [],
  distinctions: ['Urgent compliance work is not always high-risk work.'],
  tensions: ['Speed may reduce auditability.'],
  exploredBlindSpots: [],
  unexploredBlindSpots: ['The buyer may not be the daily user.'],
};

afterEach(cleanup);

describe('ReasoningMap', () => {
  it('keeps structured understanding compact and closed until requested', async () => {
    const user = userEvent.setup();
    render(<ReasoningMap understanding={UNDERSTANDING} />);

    const disclosure = screen.getByRole('group');
    expect(disclosure).not.toHaveAttribute('open');
    await user.click(screen.getByText('Reasoning map'));

    expect(disclosure).toHaveAttribute('open');
    expect(screen.getByRole('heading', { name: 'Claims & assumptions' })).toBeVisible();
    expect(screen.getByText('Demand exists before the workflow is automated.')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Evidence & observations' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Open blind spots' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Contexts' })).not.toBeInTheDocument();
  });

  it('does not render an empty reasoning map', () => {
    render(<ReasoningMap understanding={{
      claims: [],
      observations: [],
      stakeholders: [],
      contexts: [],
      distinctions: [],
      tensions: [],
      exploredBlindSpots: [],
      unexploredBlindSpots: [],
    }} />);

    expect(screen.queryByText('Reasoning map')).not.toBeInTheDocument();
  });
});
