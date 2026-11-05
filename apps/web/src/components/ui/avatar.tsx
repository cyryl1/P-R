import { cn } from '@/lib/utils';

/** Initials in a circle; the backend sends no avatar URL. */
export function Avatar({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-medium uppercase text-primary-foreground',
        className,
      )}
    >
      {name.slice(0, 2)}
    </span>
  );
}
