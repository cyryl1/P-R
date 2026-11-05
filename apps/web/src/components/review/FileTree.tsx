import { useState } from 'react';
import type { DiffFile } from '@/api/types';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Search } from 'lucide-react';

type Row =
  | { kind: 'dir'; key: string; name: string; depth: number }
  | { kind: 'file'; key: string; file: DiffFile; depth: number };

/** Flatten paths into directory headings and file rows, sharing common directories. */
function toRows(files: DiffFile[]): Row[] {
  const rows: Row[] = [];
  const seen = new Set<string>();
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const parts = file.path.split('/');
    parts.slice(0, -1).forEach((name, depth) => {
      const key = parts.slice(0, depth + 1).join('/');
      if (seen.has(key)) return;
      seen.add(key);
      rows.push({ kind: 'dir', key, name, depth });
    });
    rows.push({
      kind: 'file',
      key: file.path,
      file,
      depth: parts.length - 1,
    });
  }
  return rows;
}

/** Filterable tree of changed files; picking one opens it and scrolls to it. */
export function FileTree({
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
    <nav aria-label="Changed files" className="space-y-3">
      <div className="relative">
        <Search
          className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground"
          aria-hidden
        />
        <Input
          aria-label="Filter files"
          placeholder="Filter files…"
          className="rounded-full bg-muted/60 pl-9"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <label className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={commentedOnly}
          onChange={(e) => setCommentedOnly(e.target.checked)}
        />
        With comments
      </label>
      <ul className="max-h-[calc(100vh-14rem)] overflow-y-auto text-sm">
        {toRows(shown).map((row) =>
          row.kind === 'dir' ? (
            <li
              key={`d:${row.key}`}
              className="px-2 py-1.5"
              style={{ paddingLeft: `${row.depth * 12 + 8}px` }}
            >
              {row.name}
            </li>
          ) : (
            <li key={row.key}>
              <button
                type="button"
                aria-label={row.file.path}
                title={row.file.path}
                className="flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left hover:bg-muted"
                style={{ paddingLeft: `${row.depth * 12 + 8}px` }}
                onClick={() => onSelect(row.file.path)}
              >
                <span className="min-w-0 flex-1 truncate">
                  {row.file.path.split('/').pop()}
                </span>
                {commentCount(row.file.path) ? (
                  <Badge>{commentCount(row.file.path)}</Badge>
                ) : null}
                <span className="text-xs text-success-foreground">
                  +{row.file.additions}
                </span>
                {row.file.deletions ? (
                  <span className="text-xs text-destructive">
                    −{row.file.deletions}
                  </span>
                ) : null}
              </button>
            </li>
          ),
        )}
        {shown.length === 0 ? (
          <li className="px-2 py-1 text-muted-foreground">No files match.</li>
        ) : null}
      </ul>
    </nav>
  );
}
