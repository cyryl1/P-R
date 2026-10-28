import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCreateReview } from '@/api/hooks';
import { errorMessage } from '@/components/ErrorState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function ReviewByUrlForm() {
  const create = useCreateReview();
  const navigate = useNavigate();
  const [url, setUrl] = useState('');
  const valid = /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/.test(
    url.trim(),
  );

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate(url.trim(), {
          onSuccess: (review) => navigate(`/reviews/${review.id}`),
        });
      }}
    >
      <div className="flex gap-2">
        <Input
          aria-label="Pull request URL"
          placeholder="Review a PR by URL: https://github.com/owner/repo/pull/123"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <Button type="submit" disabled={!valid || create.isPending}>
          Review
        </Button>
      </div>
      {create.error ? (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(create.error)}
        </p>
      ) : null}
    </form>
  );
}
