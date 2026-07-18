import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export type BadgeColor = 'brand' | 'green' | 'amber' | 'gray';

const COLOR_CLASSES: Record<BadgeColor, string> = {
  brand: 'bg-brand-100 text-brand-700',
  green: 'bg-green-100 text-green-700',
  amber: 'bg-amber-100 text-amber-700',
  gray: 'bg-gray-100 text-gray-600',
};

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  color?: BadgeColor;
}

export function Badge({ color = 'gray', className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium',
        COLOR_CLASSES[color],
        className,
      )}
      {...props}
    />
  );
}
