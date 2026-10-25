import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatRelative(
  iso: string | undefined,
  now = Date.now(),
): string {
  if (!iso) return 'never';
  const diffMs = new Date(iso).getTime() - now;
  const abs = Math.abs(diffMs);
  const minutes = Math.round(abs / 60_000);
  const text =
    minutes < 1
      ? 'moments'
      : minutes < 60
        ? `${minutes} min`
        : `${Math.round(minutes / 60)} h`;
  if (minutes < 1) return diffMs > 0 ? 'in moments' : 'just now';
  return diffMs > 0 ? `in ${text}` : `${text} ago`;
}
