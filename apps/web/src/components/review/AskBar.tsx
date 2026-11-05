import { Loader2, SendHorizontal, X } from 'lucide-react';
import { useState } from 'react';
import { useAskReview } from '@/api/hooks';
import { errorMessage } from '@/components/ErrorState';
import { Markdown } from './Markdown';

/** Ask the model about the PR. Answers are not saved and never posted to GitHub. */
export function AskBar({ reviewId }: { reviewId: string }) {
  const ask = useAskReview(reviewId);
  const [question, setQuestion] = useState('');
  const [asked, setAsked] = useState('');
  const text = question.trim();

  return (
    <div className="sticky bottom-0 z-10 space-y-2 bg-gradient-to-t from-background via-background to-transparent px-4 pb-4 pt-6 md:px-8">
      {ask.data || ask.error ? (
        <section
          aria-label="Answer"
          className="relative max-h-72 overflow-y-auto rounded-lg border border-border bg-background p-4 shadow-sm"
        >
          <button
            type="button"
            aria-label="Close answer"
            className="absolute right-2 top-2 rounded p-1 hover:bg-muted"
            onClick={() => {
              ask.reset();
              setAsked('');
            }}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
          <p className="pr-6 text-xs text-muted-foreground">{asked}</p>
          {ask.error ? (
            <p role="alert" className="pt-2 text-sm text-destructive">
              {errorMessage(ask.error)}
            </p>
          ) : (
            <div className="pt-2">
              <Markdown text={ask.data!.answer} />
            </div>
          )}
        </section>
      ) : null}
      <form
        className="flex items-center gap-2 rounded-full border border-border bg-background px-4 py-1.5 shadow-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text || ask.isPending) return;
          setAsked(text);
          ask.mutate(text, { onSuccess: () => setQuestion('') });
        }}
      >
        <input
          aria-label="Ask about this pull request"
          placeholder="Ask about this pull request"
          maxLength={4000}
          value={question}
          disabled={ask.isPending}
          onChange={(e) => setQuestion(e.target.value)}
          className="h-8 min-w-0 flex-1 bg-transparent text-sm focus-visible:outline-none"
        />
        <button
          type="submit"
          aria-label="Ask"
          disabled={!text || ask.isPending}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"
        >
          {ask.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <SendHorizontal className="h-4 w-4" aria-hidden />
          )}
        </button>
      </form>
    </div>
  );
}
