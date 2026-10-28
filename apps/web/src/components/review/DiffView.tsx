import type { DiffSide, ReviewComment } from '@pr-reviewer/shared';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { useState } from 'react';
import type { DiffFile } from '@/api/types';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { AddCommentForm } from './AddCommentForm';
import { CommentCard } from './CommentCard';

type Line = DiffFile['hunks'][number]['lines'][number];

/** Where a comment on this line would anchor; deleted lines are LEFT, the rest RIGHT. */
function anchorOf(line: Line): { line: number; side: DiffSide } | undefined {
  if (line.kind === 'del')
    return line.oldLine ? { line: line.oldLine, side: 'LEFT' } : undefined;
  return line.newLine ? { line: line.newLine, side: 'RIGHT' } : undefined;
}

const rowTint = {
  add: 'bg-success/15',
  del: 'bg-destructive/15',
  context: '',
} as const;
const marker = { add: '+', del: '-', context: ' ' } as const;

export function DiffView({
  reviewId,
  files,
  comments,
  editable,
}: {
  reviewId: string;
  files: DiffFile[];
  comments: ReviewComment[];
  editable: boolean;
}) {
  // Contract has no "ignored" flag; files with no hunks (and not binary) are treated as ignored.
  const isCollapsedByDefault = (f: DiffFile) => !f.isBinary && !f.hunks.length;
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(files.map((f) => [f.path, isCollapsedByDefault(f)])),
  );
  const [adding, setAdding] = useState<string>();

  const inline = comments.filter((c) => c.anchorStatus === 'valid');
  const commentsAt = (path: string, a: { line: number; side: DiffSide }) =>
    inline.filter(
      (c) => c.path === path && c.line === a.line && c.side === a.side,
    );

  return (
    <div className="space-y-4">
      {files.map((file) => {
        const isCollapsed = collapsed[file.path] ?? isCollapsedByDefault(file);
        const count = inline.filter((c) => c.path === file.path).length;
        return (
          <section
            key={file.path}
            aria-label={file.path}
            className="rounded-md border border-border"
          >
            <button
              type="button"
              aria-expanded={!isCollapsed}
              className="flex w-full items-center gap-2 bg-muted px-3 py-2 text-left text-sm"
              onClick={() =>
                setCollapsed((c) => ({ ...c, [file.path]: !isCollapsed }))
              }
            >
              {isCollapsed ? (
                <ChevronRight className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
              <span className="font-mono">
                {file.oldPath ? `${file.oldPath} → ` : ''}
                {file.path}
              </span>
              <span className="text-xs text-muted-foreground">
                +{file.additions} −{file.deletions}
              </span>
              {isCollapsedByDefault(file) ? (
                <Badge>ignored by rules</Badge>
              ) : null}
              {count ? (
                <Badge className="ml-auto">
                  {count} comment{count === 1 ? '' : 's'}
                </Badge>
              ) : null}
            </button>
            {isCollapsed ? null : file.isBinary ? (
              <p className="p-3 text-sm text-muted-foreground">
                Binary file not shown.
              </p>
            ) : (
              <table className="w-full border-collapse font-mono text-xs">
                <tbody>
                  {file.hunks.flatMap((hunk) => [
                    <tr key={`${hunk.header}-h`} className="bg-muted/60">
                      <td
                        colSpan={4}
                        className="px-3 py-1 text-muted-foreground"
                      >
                        {hunk.header}
                      </td>
                    </tr>,
                    ...hunk.lines.flatMap((line, i) => {
                      const anchor = anchorOf(line);
                      const key = anchor
                        ? `${file.path}:${anchor.side}:${anchor.line}`
                        : undefined;
                      const here = anchor ? commentsAt(file.path, anchor) : [];
                      const rows = [
                        <tr
                          key={`${hunk.header}-${i}`}
                          className={cn('group', rowTint[line.kind])}
                        >
                          <td className="w-10 select-none px-1 text-right text-muted-foreground">
                            {line.oldLine}
                          </td>
                          <td className="w-10 select-none px-1 text-right text-muted-foreground">
                            {line.newLine}
                          </td>
                          <td className="w-6 text-center">
                            {editable && anchor && key ? (
                              <button
                                type="button"
                                aria-label={`Add comment on line ${anchor.line}`}
                                className="invisible rounded bg-primary text-primary-foreground group-hover:visible focus-visible:visible"
                                onClick={() => setAdding(key)}
                              >
                                <Plus className="h-3 w-3" />
                              </button>
                            ) : null}
                          </td>
                          <td className="whitespace-pre px-2">
                            {marker[line.kind]}
                            {line.text}
                          </td>
                        </tr>,
                      ];
                      if (anchor && (here.length || adding === key))
                        rows.push(
                          <tr key={`${hunk.header}-${i}-c`}>
                            <td colSpan={4} className="space-y-2 p-2">
                              {here.map((c) => (
                                <CommentCard
                                  key={c.id}
                                  reviewId={reviewId}
                                  comment={c}
                                  editable={editable}
                                />
                              ))}
                              {adding === key ? (
                                <AddCommentForm
                                  reviewId={reviewId}
                                  path={file.path}
                                  line={anchor.line}
                                  side={anchor.side}
                                  onDone={() => setAdding(undefined)}
                                />
                              ) : null}
                            </td>
                          </tr>,
                        );
                      return rows;
                    }),
                  ])}
                </tbody>
              </table>
            )}
          </section>
        );
      })}
    </div>
  );
}
