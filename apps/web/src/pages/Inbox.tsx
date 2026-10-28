import { ReviewByUrlForm } from '@/components/review/ReviewByUrlForm';
import { Placeholder } from './Placeholder';

/** Phase 2 ships only the "Review a PR by URL" input; the table arrives in Phase 3. */
export function Inbox() {
  return (
    <div className="space-y-6">
      <ReviewByUrlForm />
      <Placeholder title="Inbox" phase={3} />
    </div>
  );
}
