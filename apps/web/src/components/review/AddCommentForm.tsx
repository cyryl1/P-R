import {
  SeveritySchema,
  type DiffSide,
  type Severity,
} from '@pr-reviewer/shared';
import { useState } from 'react';
import { useAddComment } from '@/api/hooks';
import { errorMessage } from '@/components/ErrorState';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';

export function AddCommentForm({
  reviewId,
  path,
  line,
  side,
  onDone,
}: {
  reviewId: string;
  path: string;
  line: number;
  side: DiffSide;
  onDone: () => void;
}) {
  const add = useAddComment(reviewId);
  const toast = useToast();
  const [body, setBody] = useState('');
  const [severity, setSeverity] = useState<Severity>('minor');

  return (
    <form
      className="space-y-2 rounded-md border border-border bg-background p-3 font-sans"
      onSubmit={(e) => {
        e.preventDefault();
        add.mutate(
          { path, line, side, body: body.trim(), severity },
          {
            onSuccess: onDone,
            onError: (err) => toast.error(errorMessage(err)),
          },
        );
      }}
    >
      <textarea
        autoFocus
        aria-label="New comment"
        className="w-full rounded border border-border bg-background p-2 text-sm"
        rows={3}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="flex items-center gap-2">
        <select
          aria-label="New comment severity"
          className="rounded border border-border bg-background px-1 py-1 text-xs"
          value={severity}
          onChange={(e) => setSeverity(e.target.value as Severity)}
        >
          {SeveritySchema.options.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onDone}>
            Cancel
          </Button>
          <Button
            type="submit"
            size="sm"
            disabled={!body.trim() || add.isPending}
          >
            Add comment
          </Button>
        </div>
      </div>
    </form>
  );
}
