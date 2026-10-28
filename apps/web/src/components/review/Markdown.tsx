/** Minimal markdown: fenced code blocks and inline `code`; everything else is plain text. */
export function Markdown({ text }: { text: string }) {
  const parts = text.split(/(```[\s\S]*?```)/g);
  return (
    <div className="space-y-2 text-sm">
      {parts.map((part, i) =>
        part.startsWith('```') ? (
          <pre
            key={i}
            className="overflow-x-auto rounded bg-muted p-2 font-mono text-xs"
          >
            {part.replace(/^```[^\n]*\n?/, '').replace(/```$/, '')}
          </pre>
        ) : part.trim() ? (
          <p key={i} className="whitespace-pre-wrap">
            {part.split(/(`[^`]+`)/g).map((seg, j) =>
              seg.startsWith('`') && seg.endsWith('`') && seg.length > 1 ? (
                <code
                  key={j}
                  className="rounded bg-muted px-1 font-mono text-xs"
                >
                  {seg.slice(1, -1)}
                </code>
              ) : (
                seg
              ),
            )}
          </p>
        ) : null,
      )}
    </div>
  );
}
