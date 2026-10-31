import { useEffect } from 'react';

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

/** `j` / `k` move focus to the next / previous comment card on the page. */
export function useCommentShortcuts(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (e.key !== 'j' && e.key !== 'k') return;
      const cards = [
        ...document.querySelectorAll<HTMLElement>('[data-comment-card]'),
      ];
      if (!cards.length) return;
      const current = cards.findIndex(
        (c) =>
          c === document.activeElement || c.contains(document.activeElement),
      );
      const next =
        e.key === 'j'
          ? Math.min(current + 1, cards.length - 1)
          : Math.max(current === -1 ? 0 : current - 1, 0);
      const card = cards[next]!;
      card.focus();
      card.scrollIntoView?.({ block: 'center' });
      e.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [enabled]);
}
