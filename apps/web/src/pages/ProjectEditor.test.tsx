import { EditorView } from '@codemirror/view';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { invalidYaml } from '@/mocks/fixtures';
import { renderApp } from '@/test-utils';

const view = () =>
  EditorView.findFromDOM(document.querySelector<HTMLElement>('.cm-editor')!)!;
const setText = (text: string) =>
  view().dispatch({
    changes: { from: 0, to: view().state.doc.length, insert: text },
  });

describe('ProjectEditor', () => {
  it('loads a saved file, shows it valid and summarises what was parsed', async () => {
    renderApp('/projects/acme/payments-api');
    expect(
      await screen.findByText('The rules file is valid.'),
    ).toBeInTheDocument();
    expect(view().state.doc.toString()).toContain('repo: acme/payments-api');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled(); // nothing changed
    expect(screen.getByText('auth-on-endpoints')).toBeInTheDocument();
    expect(screen.getByText('Saved')).toBeInTheDocument();
  });

  it('shows validation errors with their line and blocks saving', async () => {
    renderApp('/projects/acme/payments-api');
    await screen.findByText('The rules file is valid.');
    setText(invalidYaml);
    expect(
      await screen.findByRole('button', { name: /Line 6/ }, { timeout: 3000 }),
    ).toHaveTextContent('rules[0].limit: expected number');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });

  it('saves a valid edit and clears the unsaved state', async () => {
    const user = userEvent.setup();
    renderApp('/projects/acme/payments-api');
    await screen.findByText('The rules file is valid.');
    setText('version: 1\nrepo: acme/payments-api\nenabled: false\nrules: []\n');
    await waitFor(
      () => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled(),
      { timeout: 3000 },
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText('Saved rules for acme/payments-api'),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument());
  });

  it('starts a missing file from the template and allows saving it unchanged', async () => {
    renderApp('/projects/acme/new');
    expect(
      await screen.findByText(/New rules file — not saved yet/),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(view().state.doc.toString()).toContain('repo: acme/new'),
    );
    expect(
      screen.queryByRole('button', { name: /Delete/ }),
    ).not.toBeInTheDocument();
    await waitFor(
      () => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled(),
      { timeout: 3000 },
    );
  });

  it('asks before leaving with unsaved changes', async () => {
    const user = userEvent.setup();
    const router = renderApp('/projects/acme/payments-api');
    await screen.findByText('The rules file is valid.');
    setText('version: 1\n');
    await user.click(screen.getByRole('link', { name: 'History' }));
    expect(
      await screen.findByText('Discard unsaved changes?'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(router.state.location.pathname).toBe('/projects/acme/payments-api');
    await user.click(screen.getByRole('link', { name: 'History' }));
    await user.click(await screen.findByRole('button', { name: 'Discard' }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/history'),
    );
  });

  it('deletes only after confirmation', async () => {
    const user = userEvent.setup();
    const router = renderApp('/projects/acme/payments-api');
    await screen.findByText('The rules file is valid.');
    await user.click(screen.getByRole('button', { name: /Delete/ }));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(router.state.location.pathname).toBe('/projects/acme/payments-api');
    await user.click(screen.getByRole('button', { name: /Delete/ }));
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/projects'),
    );
  });

  it('opens the reference drawer', async () => {
    const user = userEvent.setup();
    renderApp('/projects/acme/payments-api');
    await user.click(await screen.findByRole('button', { name: /Reference/ }));
    expect(screen.getByRole('table', { name: 'Rule types' })).toHaveTextContent(
      'max_changed_lines',
    );
  });
});
