import { useMutation } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { useState } from 'react';
import { api } from '@/api/client';
import { errorMessage } from '@/components/ErrorState';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';

const EXAMPLE =
  'Flag missing tests, hardcoded secrets and unhandled errors. Be strict on anything touching payments. Ignore lockfiles and generated files.';

/** Turns a plain-English description into a rules file. Never saves it. */
export function DescribeRules({
  repo,
  currentYaml,
  isNew,
  onDraft,
}: {
  repo: string;
  currentYaml: string;
  isNew: boolean;
  onDraft: (yaml: string) => void;
}) {
  const toast = useToast();
  const [description, setDescription] = useState('');
  const draft = useMutation({
    mutationFn: () =>
      api.draftRules(repo, description.trim(), isNew ? undefined : currentYaml),
    onSuccess: (res) => {
      onDraft(res.yaml);
      setDescription('');
      toast.success(
        res.valid
          ? 'Rules written. Read them over, then press Save.'
          : 'Rules written, but they need a fix before saving. See the checks on the right.',
      );
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <section
      aria-label="Describe your rules"
      className="space-y-2 rounded-md border border-border p-4"
    >
      <h2 className="flex items-center gap-2 text-sm font-medium">
        <Sparkles className="h-4 w-4" aria-hidden /> Describe what to check
      </h2>
      <p className="text-sm text-muted-foreground">
        Write it in plain English. We turn it into the rules file below, and
        nothing is saved until you press Save.
        {isNew
          ? ''
          : ' Your description is applied as a change to the current rules.'}
      </p>
      <textarea
        aria-label="Describe your rules in plain English"
        rows={3}
        className="w-full rounded-md border border-border bg-background p-2 text-sm"
        placeholder={EXAMPLE}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onKeyDown={(e) => {
          if (
            (e.metaKey || e.ctrlKey) &&
            e.key === 'Enter' &&
            description.trim()
          )
            draft.mutate();
        }}
      />
      <Button
        size="sm"
        disabled={!description.trim() || draft.isPending}
        onClick={() => draft.mutate()}
      >
        {draft.isPending ? 'Writing rules…' : 'Write the rules'}
      </Button>
    </section>
  );
}
