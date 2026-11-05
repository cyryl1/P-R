import type { ReactNode } from 'react';

/** Inline `code` and **bold**; everything else is plain text. */
function inline(text: string): ReactNode[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((seg, i) => {
    if (seg.length > 1 && seg.startsWith('`') && seg.endsWith('`'))
      return (
        <code key={i} className="rounded bg-muted px-1 font-mono text-xs">
          {seg.slice(1, -1)}
        </code>
      );
    if (seg.length > 4 && seg.startsWith('**') && seg.endsWith('**'))
      return <strong key={i}>{seg.slice(2, -2)}</strong>;
    return seg;
  });
}

const headings = {
  1: 'text-xl font-semibold',
  2: 'text-xl font-semibold pt-2',
  3: 'text-base font-semibold pt-1',
} as const;

/** Minimal markdown: fenced code, #/##/### headings, - bullets, **bold**, `code`, paragraphs. */
export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const parts = text.split(/(```[\s\S]*?```)/g);
  parts.forEach((part, p) => {
    if (part.startsWith('```')) {
      blocks.push(
        <pre
          key={`pre${p}`}
          className="overflow-x-auto rounded bg-muted p-2 font-mono text-xs"
        >
          {part.replace(/^```[^\n]*\n?/, '').replace(/```$/, '')}
        </pre>,
      );
      return;
    }
    let bullets: string[] = [];
    let para: string[] = [];
    const flush = (k: string) => {
      if (bullets.length)
        blocks.push(
          <ul key={`ul${k}`} className="list-disc space-y-1 pl-5">
            {bullets.map((b, i) => (
              <li key={i}>{inline(b)}</li>
            ))}
          </ul>,
        );
      if (para.length)
        blocks.push(
          <p key={`p${k}`} className="whitespace-pre-wrap">
            {inline(para.join('\n'))}
          </p>,
        );
      bullets = [];
      para = [];
    };
    part.split('\n').forEach((line, i) => {
      const k = `${p}-${i}`;
      const heading = /^(#{1,3})\s+(.*)$/.exec(line);
      const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
      if (heading) {
        flush(k);
        const level = heading[1]!.length as 1 | 2 | 3;
        blocks.push(
          <h3 key={`h${k}`} className={headings[level]}>
            {inline(heading[2]!)}
          </h3>,
        );
      } else if (bullet) {
        if (para.length) flush(k);
        bullets.push(bullet[1]!);
      } else if (!line.trim()) flush(k);
      else {
        if (bullets.length) flush(k);
        para.push(line);
      }
    });
    flush(`${p}-end`);
  });
  return <div className="space-y-2 text-sm leading-relaxed">{blocks}</div>;
}
