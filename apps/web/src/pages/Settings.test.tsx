import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { healthNoKey } from '@/mocks/fixtures';
import { server } from '@/mocks/server';
import { renderApp } from '@/test-utils';

describe('Settings', () => {
  it('shows config values and read-only gh and API key status', async () => {
    renderApp('/settings');
    expect(await screen.findByLabelText('Interval (minutes)')).toHaveValue(5);
    expect(screen.getByRole('textbox', { name: 'Model' })).toHaveValue(
      'claude-sonnet-5-5',
    );
    expect(await screen.findByText('Logged in as cyryl1')).toBeInTheDocument();
    expect(screen.getByText('Set')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Save settings' }),
    ).toBeDisabled();
  });

  it('reports a missing API key', async () => {
    server.use(http.get('/api/health', () => HttpResponse.json(healthNoKey)));
    renderApp('/settings');
    expect(
      await screen.findByText(/Not set — add ANTHROPIC_API_KEY/),
    ).toBeInTheDocument();
  });

  it('blocks saving invalid numbers', async () => {
    const user = userEvent.setup();
    renderApp('/settings');
    const interval = await screen.findByLabelText('Interval (minutes)');
    await user.clear(interval);
    await user.type(interval, '0');
    expect(
      screen.getByRole('button', { name: 'Save settings' }),
    ).toBeDisabled();
    expect(interval).toHaveAttribute('aria-invalid', 'true');
  });

  it('saves changes through PUT /settings', async () => {
    const user = userEvent.setup();
    let sent: unknown;
    server.use(
      http.put('/api/settings', async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({
          server: { port: 4317 },
          ...(sent as object),
        });
      }),
    );
    renderApp('/settings');
    const interval = await screen.findByLabelText('Interval (minutes)');
    await user.clear(interval);
    await user.type(interval, '10');
    await user.selectOptions(screen.getByLabelText('Provider'), 'mock');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(await screen.findByText('Settings saved')).toBeInTheDocument();
    expect(sent).toMatchObject({
      poller: { interval_minutes: 10 },
      llm: { provider: 'mock' },
    });
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Save settings' }),
      ).toBeDisabled(),
    );
  });

  it('shows the error toast when saving fails', async () => {
    const user = userEvent.setup();
    server.use(
      http.put('/api/settings', () =>
        HttpResponse.json(
          { error: { code: 'VALIDATION_ERROR', message: 'Invalid request.' } },
          { status: 400 },
        ),
      ),
    );
    renderApp('/settings');
    const interval = await screen.findByLabelText('Interval (minutes)');
    await user.clear(interval);
    await user.type(interval, '7');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(await screen.findByText('Invalid request.')).toBeInTheDocument();
  });
});
