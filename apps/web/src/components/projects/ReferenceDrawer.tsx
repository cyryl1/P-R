import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';

const ruleTypes: Array<[string, string, string]> = [
  [
    'llm',
    'description, paths?',
    'The model reports it satisfied, or it does not apply to the changed files',
  ],
  [
    'require_tests',
    'when_paths, test_paths',
    'No file matches when_paths, or at least one changed file matches test_paths',
  ],
  [
    'max_changed_lines',
    'limit',
    'additions + deletions (excluding ignore_paths) ≤ limit',
  ],
  ['forbid_paths', 'paths', 'No changed file matches paths'],
  [
    'require_description',
    'min_length',
    'PR body, trimmed, has at least min_length characters',
  ],
  [
    'require_linked_issue',
    '—',
    'PR has a closing issue reference, or the body contains #<number>',
  ],
];

const fields: Array<[string, string]> = [
  ['version', 'Always 1.'],
  ['repo', 'owner/repo. Must match the file name.'],
  ['enabled', 'false stops all reviews for this repo.'],
  [
    'triggers.on_review_request',
    'auto | manual — manual waits for a click in the inbox.',
  ],
  [
    'triggers.on_new_commits',
    'auto | notify | ignore — what to do when the author pushes again.',
  ],
  ['triggers.skip_drafts', 'Skip draft PRs.'],
  [
    'review.focus.<area>',
    'strict | normal | light | off for security, correctness, performance, readability, style.',
  ],
  ['review.tone', 'Free text that shapes the wording of comments.'],
  [
    'review.max_comments',
    'Keep at most this many comments, highest severity first.',
  ],
  [
    'review.min_severity',
    'blocker | major | minor | nit — drop anything below.',
  ],
  [
    'review.ignore_paths',
    'Globs left out of the prompt (still counted by deterministic checks).',
  ],
  [
    'review.context_files',
    'Files fetched at the PR head and given to the model (20 000 characters each).',
  ],
  ['review.instructions', 'Free-text house rules for the model.'],
  [
    'rules[].id / severity / enabled',
    'Every rule needs a unique slug id and a severity; enabled defaults to true.',
  ],
];

export function ReferenceDrawer() {
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <section className="rounded-md border border-border">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-4 py-2 text-sm font-medium"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Chevron className="h-4 w-4" aria-hidden /> Reference
      </button>
      {open ? (
        <div className="space-y-4 border-t border-border p-4 text-sm">
          <table className="w-full text-left">
            <caption className="mb-1 text-left font-medium">Fields</caption>
            <tbody>
              {fields.map(([name, text]) => (
                <tr key={name} className="border-t border-border align-top">
                  <td className="py-1 pr-4">
                    <code className="text-xs">{name}</code>
                  </td>
                  <td className="py-1 text-muted-foreground">{text}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table className="w-full text-left">
            <caption className="mb-1 text-left font-medium">Rule types</caption>
            <thead className="text-muted-foreground">
              <tr>
                <th className="pr-4 font-normal">type</th>
                <th className="pr-4 font-normal">fields</th>
                <th className="font-normal">passes when</th>
              </tr>
            </thead>
            <tbody>
              {ruleTypes.map(([type, fieldList, passes]) => (
                <tr key={type} className="border-t border-border align-top">
                  <td className="py-1 pr-4">
                    <code className="text-xs">{type}</code>
                  </td>
                  <td className="py-1 pr-4 text-muted-foreground">
                    {fieldList}
                  </td>
                  <td className="py-1 text-muted-foreground">{passes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
