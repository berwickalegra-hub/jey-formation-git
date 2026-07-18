import { cn } from '@/lib/utils';

interface ProgressBarProps {
  percent: number; // 0-100
  color?: 'brand' | 'green';
  className?: string;
  trackClassName?: string;
}

export function ProgressBar({
  percent,
  color = 'brand',
  className,
  trackClassName,
}: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-gray-200', trackClassName)}>
      <div
        className={cn(
          'h-full rounded-full transition-all',
          color === 'brand' ? 'bg-brand-600' : 'bg-green-600',
          className,
        )}
        style={{ width: `${clamped}%` }}
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
      />
    </div>
  );
}
