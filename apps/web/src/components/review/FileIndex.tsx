import { useState } from 'react';
import type { DiffFile } from '@/api/types';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';

/** Filterable list of changed files; picking one opens it and scrolls to it. */
export function FileIndex({
  files,
  commentCount,
  onSelect,
}: {
  files: DiffFile[];
  commentCount: (path: string) => number;
  onSelect: (path: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [commentedOnly, setCommentedOnly] = useState(false);
  const shown = files.filter(
    (f) =>
      f.path.toLowerCase().includes(query.trim().toLowerCase()) &&
      (!commentedOnly || commentCount(f.path) > 0),
  );

  return (
    <nav
      aria-label="Changed files"
      className="space-y-2 rounded-md border border-border p-3"
    >
      <div className="flex items-center gap-3">
        <Input
          aria-label="Filter files"
          placeholder="Filter files"
          className="h-8"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label className="flex shrink-0 items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={commentedOnly}
            onChange={(e) => setCommentedOnly(e.target.checked)}
          />
          With comments
        </label>
      </div>
      <ul className="max-h-48 overflow-y-auto text-xs">
        {shown.map((f) => {
          const n = commentCount(f.path);
          return (
            <li key={f.path}>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-muted"
                onClick={() => onSelect(f.path)}
              >
                <span className="min-w-0 flex-1 truncate font-mono">
                  {f.path}
                </span>
                <span className="text-muted-foreground">
                  +{f.additions} −{f.deletions}
                </span>
                {n ? <Badge>{n}</Badge> : null}
              </button>
            </li>
          );
        })}
        {shown.length === 0 ? (
          <li className="px-2 py-1 text-muted-foreground">No files match.</li>
        ) : null}
      </ul>
    </nav>
  );
}
