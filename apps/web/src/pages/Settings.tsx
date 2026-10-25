import type { AppConfig } from '@pr-reviewer/shared';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useHealth, useSettings, useUpdateSettings } from '@/api/hooks';
import {
  ErrorState,
  errorMessage,
  LoadingState,
} from '@/components/ErrorState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';

type Draft = Omit<AppConfig, 'server'>;

const strip = ({ poller, llm, jobs }: AppConfig): Draft => ({
  poller,
  llm,
  jobs,
});

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="grid grid-cols-[16rem_1fr] items-center gap-4 text-sm">
      <span>
        {label}
        {hint ? (
          <span className="block text-xs text-muted-foreground">{hint}</span>
        ) : null}
      </span>
      {children}
    </label>
  );
}

function NumberInput({
  label,
  value,
  min,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  onChange: (n: number) => void;
}) {
  const invalid = !Number.isInteger(value) || value < min;
  return (
    <Field label={label}>
      <Input
        type="number"
        className="max-w-40"
        min={min}
        value={Number.isNaN(value) ? '' : value}
        aria-invalid={invalid}
        onChange={(e) => onChange(e.target.valueAsNumber)}
      />
    </Field>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid grid-cols-[16rem_1fr] gap-4 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function Settings() {
  const settings = useSettings();
  const health = useHealth();
  const update = useUpdateSettings();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);

  useEffect(() => {
    if (settings.data) setDraft(strip(settings.data));
  }, [settings.data]);

  if (settings.isPending) return <LoadingState />;
  if (settings.error)
    return (
      <ErrorState
        error={settings.error}
        onRetry={() => void settings.refetch()}
      />
    );
  if (!draft) return null;

  const dirty = JSON.stringify(draft) !== JSON.stringify(strip(settings.data));
  const positive = (n: number) => Number.isInteger(n) && n >= 1;
  const valid =
    positive(draft.poller.interval_minutes) &&
    positive(draft.llm.max_input_tokens) &&
    positive(draft.llm.max_output_tokens) &&
    positive(draft.jobs.concurrency) &&
    Number.isInteger(draft.jobs.max_retries) &&
    draft.jobs.max_retries >= 0 &&
    draft.llm.model.trim() !== '';

  const patch = <K extends keyof Draft>(key: K, value: Partial<Draft[K]>) =>
    setDraft({ ...draft, [key]: { ...draft[key], ...value } });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid || !dirty) return;
    update.mutate(draft, {
      onSuccess: () => toast.success('Settings saved'),
      onError: (err) => toast.error(errorMessage(err)),
    });
  };

  const h = health.data;
  return (
    <form onSubmit={submit} className="max-w-3xl space-y-8">
      <h1 className="text-xl font-semibold">Settings</h1>

      <section aria-label="Status" className="space-y-2">
        <h2 className="font-medium">Status</h2>
        <dl className="space-y-1">
          <Row
            label="GitHub (gh) login"
            value={
              !h
                ? '…'
                : h.gh.authenticated
                  ? `Logged in as ${h.gh.login ?? 'unknown'}`
                  : `Not logged in${h.gh.error ? ` — ${h.gh.error}` : ''}`
            }
          />
          <Row
            label="Anthropic API key"
            value={
              !h
                ? '…'
                : h.llm.configured
                  ? 'Set'
                  : 'Not set — add ANTHROPIC_API_KEY to .env'
            }
          />
          <Row
            label="Server port"
            value={`${settings.data.server.port} (change in config.yml, restart required)`}
          />
        </dl>
      </section>

      <section aria-label="Poller" className="space-y-3">
        <h2 className="font-medium">Poller</h2>
        <Field label="Poll for review requests">
          <input
            type="checkbox"
            className="h-4 w-4 justify-self-start"
            checked={draft.poller.enabled}
            onChange={(e) => patch('poller', { enabled: e.target.checked })}
          />
        </Field>
        <NumberInput
          label="Interval (minutes)"
          min={1}
          value={draft.poller.interval_minutes}
          onChange={(n) => patch('poller', { interval_minutes: n })}
        />
        <Field
          label="Include team requests"
          hint="Off means direct requests only"
        >
          <input
            type="checkbox"
            className="h-4 w-4 justify-self-start"
            checked={draft.poller.include_team_requests}
            onChange={(e) =>
              patch('poller', { include_team_requests: e.target.checked })
            }
          />
        </Field>
      </section>

      <section aria-label="Model" className="space-y-3">
        <h2 className="font-medium">Model</h2>
        <Field label="Provider">
          <select
            className="h-9 max-w-40 rounded-md border border-border bg-background px-2 text-sm"
            value={draft.llm.provider}
            onChange={(e) =>
              patch('llm', {
                provider: e.target.value as Draft['llm']['provider'],
              })
            }
          >
            <option value="anthropic">anthropic</option>
            <option value="mock">mock</option>
          </select>
        </Field>
        <Field label="Model">
          <Input
            className="max-w-72"
            value={draft.llm.model}
            aria-invalid={draft.llm.model.trim() === ''}
            onChange={(e) => patch('llm', { model: e.target.value })}
          />
        </Field>
        <NumberInput
          label="Max input tokens"
          min={1}
          value={draft.llm.max_input_tokens}
          onChange={(n) => patch('llm', { max_input_tokens: n })}
        />
        <NumberInput
          label="Max output tokens"
          min={1}
          value={draft.llm.max_output_tokens}
          onChange={(n) => patch('llm', { max_output_tokens: n })}
        />
      </section>

      <section aria-label="Jobs" className="space-y-3">
        <h2 className="font-medium">Jobs</h2>
        <NumberInput
          label="Concurrency"
          min={1}
          value={draft.jobs.concurrency}
          onChange={(n) => patch('jobs', { concurrency: n })}
        />
        <NumberInput
          label="Max retries"
          min={0}
          value={draft.jobs.max_retries}
          onChange={(n) => patch('jobs', { max_retries: n })}
        />
      </section>

      <Button type="submit" disabled={!valid || !dirty || update.isPending}>
        {update.isPending ? 'Saving…' : 'Save settings'}
      </Button>
    </form>
  );
}
