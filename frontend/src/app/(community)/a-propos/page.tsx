'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Globe, CreditCard, Calendar } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useApi, invalidateCache } from '@/lib/useApi';
import { api } from '@/lib/api';
import { Card } from '@/components/community/Card';
import { Avatar } from '@/components/community/Avatar';
import { formatPrice } from '@/lib/utils';

interface CommunityResponse {
  community: {
    name: string;
    description: string | null;
    tagline: string | null;
    introVideoUrl: string | null;
    coverImageUrl: string | null;
    visibility: string;
    priceAmount: number | null;
    pricePeriod: string | null;
    currency: string;
    createdAt: string;
    memberCount: number;
  };
  owner: { id: string; name: string | null; avatarUrl: string | null } | null;
  me: { role: string } | null;
}

function isYoutubeOrVimeo(url: string): boolean {
  return /youtube\.com|youtu\.be|vimeo\.com/.test(url);
}

export default function AboutPage() {
  const { user } = useAuth();
  const { data, loading, refresh } = useApi<CommunityResponse>('/api/community');
  const [joining, setJoining] = useState(false);

  async function handleJoin() {
    setJoining(true);
    try {
      await api('/api/community/join', { method: 'POST' });
      invalidateCache('/api/community');
      await refresh();
    } finally {
      setJoining(false);
    }
  }

  if (loading && !data) {
    return <div className="text-sm text-gray-500">Chargement…</div>;
  }
  if (!data) {
    return <div className="text-sm text-gray-500">Communauté introuvable.</div>;
  }

  const { community, owner, me } = data;
  const price =
    community.priceAmount !== null
      ? `${formatPrice(community.priceAmount, community.currency)}${community.pricePeriod ? ` / ${community.pricePeriod}` : ''}`
      : 'Gratuit';

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
      <div>
        <Card className="aspect-video overflow-hidden bg-gray-900">
          {community.introVideoUrl ? (
            isYoutubeOrVimeo(community.introVideoUrl) ? (
              <iframe
                src={community.introVideoUrl}
                className="h-full w-full"
                allow="autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
              />
            ) : (
              <video src={community.introVideoUrl} controls className="h-full w-full" />
            )
          ) : (
            <div className="flex h-full w-full items-center justify-center text-sm text-gray-400">
              Aucune vidéo de présentation pour l&apos;instant
            </div>
          )}
        </Card>

        <h1 className="mt-6 text-2xl font-bold text-gray-900">{community.name}</h1>

        <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-gray-500">
          <span className="flex items-center gap-1.5">
            <Globe className="h-4 w-4" />
            {community.visibility === 'PUBLIC' ? 'Public' : 'Privé'}
          </span>
          <span className="flex items-center gap-1.5">
            <CreditCard className="h-4 w-4" />
            {price}
          </span>
          {owner && (
            <span className="flex items-center gap-1.5">
              <Avatar name={owner.name ?? 'Coach'} src={owner.avatarUrl} size="sm" />
              Par <span className="font-medium text-brand-700">{owner.name ?? 'Coach'}</span>
            </span>
          )}
        </div>

        {community.tagline && (
          <p className="mt-4 text-base font-semibold text-gray-900">{community.tagline}</p>
        )}
        {community.description && (
          <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-gray-600">
            {community.description}
          </p>
        )}
      </div>

      <div className="h-fit space-y-4 lg:sticky lg:top-24">
        <Card className="overflow-hidden p-4">
          {community.coverImageUrl && (
            <img
              src={community.coverImageUrl}
              alt={community.name}
              className="mb-3 aspect-video w-full rounded-lg object-cover"
            />
          )}
          <p className="font-bold text-gray-900">{community.name}</p>
          {community.tagline && <p className="mt-1 text-sm text-gray-500">{community.tagline}</p>}

          {!user ? (
            <Link
              href="/login"
              className="mt-4 block w-full rounded-lg bg-gray-900 py-2.5 text-center text-sm font-semibold text-white hover:bg-gray-800"
            >
              Se connecter pour rejoindre
            </Link>
          ) : me ? (
            <p className="mt-4 text-center text-sm text-gray-500">
              Tu es membre de cette communauté.
            </p>
          ) : (
            <button
              onClick={handleJoin}
              disabled={joining}
              className="mt-4 w-full rounded-lg bg-gray-900 py-2.5 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {joining ? 'Adhésion…' : 'Rejoindre'}
            </button>
          )}
        </Card>

        <Card className="p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
            À propos
          </p>
          <div className="space-y-3 text-sm">
            <div className="flex items-start gap-2">
              <Globe className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
              <div>
                <p className="font-medium text-gray-900">
                  Communauté {community.visibility === 'PUBLIC' ? 'publique' : 'privée'}
                </p>
                <p className="text-gray-500">
                  {community.visibility === 'PUBLIC'
                    ? 'La page de présentation est visible par tous. L’accès aux discussions nécessite une adhésion.'
                    : 'Réservée aux membres invités.'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <CreditCard className="h-4 w-4 shrink-0 text-gray-400" />
              <p className="font-medium text-gray-900">{price}</p>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 shrink-0 text-gray-400" />
              <p className="text-gray-500">
                Créé le {new Date(community.createdAt).toLocaleDateString('fr-FR')}
              </p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
