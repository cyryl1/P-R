import { screen } from '@testing-library/react';
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { makeQueryClient } from '@/App';
import { applyEvent } from '@/api/events';
import { renderApp } from '@/test-utils';

describe('PollIndicator', () => {
  it('shows the last and next poll from health', async () => {
    renderApp('/settings');
    expect(
      await screen.findByText(/Last checked 2 min ago · Next in 3 min/),
    ).toBeInTheDocument();
  });

  it('follows poll.status events: running, then error', async () => {
    const qc = makeQueryClient();
    renderApp('/settings', qc);
    await screen.findByText(/Last checked/);

    act(() =>
      applyEvent(qc, { type: 'poll.status', data: { state: 'running' } }),
    );
    expect(await screen.findByText('Checking GitHub…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check now' })).toBeDisabled();

    act(() =>
      applyEvent(qc, {
        type: 'poll.status',
        data: { state: 'error', error: 'rate limited' },
      }),
    );
    expect(
      await screen.findByText('Last check failed: rate limited'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check now' })).toBeEnabled();
  });
});
