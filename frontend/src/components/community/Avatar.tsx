import { cn } from '@/lib/utils';

interface AvatarProps {
  name: string;
  src?: string | null;
  level?: number;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE_CLASSES = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-14 w-14 text-lg',
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '?';
  const second = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + second).toUpperCase();
}

export function Avatar({ name, src, level, size = 'md', className }: AvatarProps) {
  return (
    <span className={cn('relative inline-flex shrink-0', className)}>
      {src ? (
        <img src={src} alt={name} className={cn('rounded-full object-cover', SIZE_CLASSES[size])} />
      ) : (
        <span
          className={cn(
            'flex items-center justify-center rounded-full bg-brand-100 font-semibold text-brand-700',
            SIZE_CLASSES[size],
          )}
        >
          {initials(name)}
        </span>
      )}
      {level !== undefined && (
        <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full border-2 border-white bg-amber-500 text-[10px] font-bold text-white">
          {level}
        </span>
      )}
    </span>
  );
}
