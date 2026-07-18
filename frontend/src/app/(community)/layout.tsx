'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Search,
  Flame,
  MessageCircle,
  Bell,
  UserPlus,
  MessageSquare,
  BookOpen,
  Calendar,
  FileText,
  Users,
  Info,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useApi } from '@/lib/useApi';
import { Avatar } from '@/components/community/Avatar';
import { cn } from '@/lib/utils';

interface CommunityMe {
  role: string;
  xp: number;
  level: number;
  streakCount: number;
  name: string | null;
  avatarUrl: string | null;
}

interface CommunityResponse {
  community: { name: string; logoUrl: string | null; memberCount: number };
  me: CommunityMe | null;
}

const TABS = [
  { href: '/club', label: 'Club', icon: MessageSquare },
  { href: '/cours', label: 'Cours', icon: BookOpen },
  { href: '/calendrier', label: 'Calendrier', icon: Calendar },
  { href: '/documents', label: 'Documents', icon: FileText },
  { href: '/membres', label: 'Membres', icon: Users },
  { href: '/a-propos', label: 'À propos', icon: Info },
];

export default function CommunityLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user } = useAuth();
  const { data } = useApi<CommunityResponse>('/api/community');
  const { data: notifCount } = useApi<{ count: number }>('/api/notifications/count', {
    skip: !user,
  });

  const communityName = data?.community.name ?? 'Jey-club';
  const displayName = data?.me?.name ?? user?.email ?? 'Toi';
  const unread = notifCount?.count ?? 0;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4">
          <Link href="/club" className="flex shrink-0 items-center gap-2 font-bold text-gray-900">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm text-white">
              {communityName[0]?.toUpperCase()}
            </span>
            <span className="hidden truncate sm:inline">{communityName}</span>
          </Link>

          <div className="relative hidden max-w-md flex-1 md:block">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="search"
              placeholder="Rechercher..."
              className="w-full rounded-full border border-gray-200 bg-gray-50 py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          <div className="ml-auto flex items-center gap-4 text-gray-500">
            {user ? (
              <>
                {data?.me && (
                  <span className="hidden items-center gap-1 text-sm font-semibold text-amber-600 sm:flex">
                    <Flame className="h-4 w-4" />
                    {data.me.streakCount}
                  </span>
                )}
                <MessageCircle className="h-5 w-5" aria-hidden />
                <span className="relative">
                  <Bell className="h-5 w-5" aria-hidden />
                  {unread > 0 && (
                    <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-0.5 text-[10px] font-bold text-white">
                      {unread > 9 ? '9+' : unread}
                    </span>
                  )}
                </span>
                <span title="Inviter">
                  <UserPlus className="h-5 w-5" aria-hidden />
                </span>
                <Link href="/settings">
                  <Avatar
                    name={displayName}
                    src={data?.me?.avatarUrl ?? null}
                    {...(data?.me?.level !== undefined ? { level: data.me.level } : {})}
                    size="sm"
                  />
                </Link>
              </>
            ) : (
              <Link
                href="/login"
                className="flex items-center gap-1.5 rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800"
              >
                <UserPlus className="h-4 w-4" aria-hidden />
                Se connecter
              </Link>
            )}
          </div>
        </div>

        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4">
          {TABS.map((tab) => {
            const active = pathname?.startsWith(tab.href) ?? false;
            const Icon = tab.icon;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  'flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
                  active
                    ? 'border-gray-900 text-gray-900'
                    : 'border-transparent text-gray-500 hover:text-gray-900',
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
