'use client';

import { useCallback, useEffect, useState } from 'react';
import { Heart, MessageCircle, Pin, Send } from 'lucide-react';
import { useApi } from '@/lib/useApi';
import { api } from '@/lib/api';
import { Card } from '@/components/community/Card';
import { Avatar } from '@/components/community/Avatar';
import { Badge } from '@/components/community/Badge';
import { cn, timeAgo } from '@/lib/utils';

interface Category {
  id: string;
  name: string;
  emoji: string | null;
}

interface PostAuthor {
  id: string;
  name: string | null;
  avatarUrl: string | null;
  level: number;
}

interface PostItem {
  id: string;
  title: string | null;
  content: string;
  mediaUrl: string | null;
  mediaType: string | null;
  isPinned: boolean;
  createdAt: string;
  author: PostAuthor;
  category: Category | null;
  commentCount: number;
  likeCount: number;
  likedByMe: boolean;
}

interface CommentItem {
  id: string;
  content: string;
  createdAt: string;
  author: { id: string; name: string | null; avatarUrl: string | null };
}

interface CommunityResponse {
  community: { name: string };
  owner: { id: string; name: string | null; avatarUrl: string | null } | null;
  me: { name: string | null; avatarUrl: string | null; level: number } | null;
}

export default function ClubPage() {
  const { data: community } = useApi<CommunityResponse>('/api/community');
  const { data: categoriesData } = useApi<{ items: Category[] }>('/api/post-categories');
  const categories = categoriesData?.items ?? [];

  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [pinned, setPinned] = useState<PostItem[]>([]);
  const [items, setItems] = useState<PostItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState('');
  const [posting, setPosting] = useState(false);

  const load = useCallback(
    async (reset: boolean) => {
      setLoading(true);
      try {
        const qs = new URLSearchParams();
        if (activeCategory) qs.set('categoryId', activeCategory);
        if (!reset && cursor) qs.set('cursor', cursor);
        const res = await api<{ pinned: PostItem[]; items: PostItem[]; nextCursor: string | null }>(
          `/api/posts?${qs.toString()}`,
        );
        setPinned(res.pinned);
        setItems((prev) => (reset ? res.items : [...prev, ...res.items]));
        setCursor(res.nextCursor);
        setHasMore(res.nextCursor !== null);
      } finally {
        setLoading(false);
      }
    },
    [activeCategory, cursor],
  );

  useEffect(() => {
    void load(true);
    // load is intentionally excluded; it depends on `cursor`, which would
    // otherwise re-trigger this effect on every "Voir plus" page fetch.
  }, [activeCategory]);

  async function handlePost() {
    const trimmed = content.trim();
    if (!trimmed) return;
    setPosting(true);
    try {
      const created = await api<PostItem>('/api/posts', {
        method: 'POST',
        body: { content: trimmed, categoryId: activeCategory ?? undefined },
      });
      setContent('');
      setItems((prev) => [created, ...prev]);
    } finally {
      setPosting(false);
    }
  }

  async function handleLike(post: PostItem) {
    const optimistic = {
      ...post,
      likedByMe: !post.likedByMe,
      likeCount: post.likeCount + (post.likedByMe ? -1 : 1),
    };
    const apply = (list: PostItem[]) => list.map((p) => (p.id === post.id ? optimistic : p));
    setPinned(apply);
    setItems(apply);
    try {
      const res = await api<{ liked: boolean; likeCount: number }>(`/api/posts/${post.id}/like`, {
        method: 'POST',
      });
      const reconcile = (list: PostItem[]) =>
        list.map((p) =>
          p.id === post.id ? { ...p, likedByMe: res.liked, likeCount: res.likeCount } : p,
        );
      setPinned(reconcile);
      setItems(reconcile);
    } catch {
      const revert = (list: PostItem[]) => list.map((p) => (p.id === post.id ? post : p));
      setPinned(revert);
      setItems(revert);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_280px]">
      <div>
        <Card className="p-4">
          <div className="flex gap-3">
            <Avatar name={community?.me?.name ?? 'Toi'} src={community?.me?.avatarUrl ?? null} />
            <div className="flex-1">
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Écris quelque chose à la communauté…"
                rows={2}
                className="w-full resize-none rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
              />
              <div className="mt-2 flex justify-end">
                <button
                  onClick={handlePost}
                  disabled={posting || !content.trim()}
                  className="flex items-center gap-1.5 rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
                >
                  <Send className="h-4 w-4" />
                  Publier
                </button>
              </div>
            </div>
          </div>
        </Card>

        {categories.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={() => setActiveCategory(null)}
              className={cn(
                'rounded-full px-3 py-1.5 text-sm font-medium',
                activeCategory === null
                  ? 'bg-gray-900 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
              )}
            >
              Tous
            </button>
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={cn(
                  'rounded-full px-3 py-1.5 text-sm font-medium',
                  activeCategory === cat.id
                    ? 'bg-gray-900 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
                )}
              >
                {cat.emoji ? `${cat.emoji} ` : ''}
                {cat.name}
              </button>
            ))}
          </div>
        )}

        <div className="mt-4 space-y-4">
          {[...pinned, ...items].map((post) => (
            <PostCard key={post.id} post={post} onLike={() => handleLike(post)} />
          ))}

          {!loading && pinned.length === 0 && items.length === 0 && (
            <p className="py-10 text-center text-sm text-gray-500">
              Aucune publication pour l&apos;instant. Sois le premier à écrire !
            </p>
          )}

          {hasMore && (
            <div className="flex justify-center pt-2">
              <button
                onClick={() => void load(false)}
                disabled={loading}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                {loading ? 'Chargement…' : 'Voir plus'}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="h-fit space-y-4 lg:sticky lg:top-24">
        {community?.owner && (
          <Card className="p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
              Coach
            </p>
            <div className="flex items-center gap-3">
              <Avatar name={community.owner.name ?? 'Coach'} src={community.owner.avatarUrl} />
              <div>
                <p className="text-sm font-semibold text-gray-900">
                  {community.owner.name ?? 'Coach'}
                </p>
                <Badge color="brand">Coach</Badge>
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

function PostCard({ post, onLike }: { post: PostItem; onLike: () => void }) {
  const [showComments, setShowComments] = useState(false);
  const comments = useApi<{ items: CommentItem[] }>(`/api/posts/${post.id}/comments`, {
    skip: !showComments,
  });
  const [content, setContent] = useState('');
  const [posting, setPosting] = useState(false);

  async function handleSubmit() {
    const trimmed = content.trim();
    if (!trimmed) return;
    setPosting(true);
    try {
      await api(`/api/posts/${post.id}/comments`, { method: 'POST', body: { content: trimmed } });
      setContent('');
      await comments.refresh();
    } finally {
      setPosting(false);
    }
  }

  return (
    <Card className="p-4">
      {post.isPinned && (
        <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-brand-600">
          <Pin className="h-3.5 w-3.5" /> Épinglé
        </div>
      )}
      <div className="flex items-center gap-3">
        <Avatar
          name={post.author.name ?? 'Membre'}
          src={post.author.avatarUrl}
          level={post.author.level}
          size="sm"
        />
        <div>
          <p className="text-sm font-semibold text-gray-900">{post.author.name ?? 'Membre'}</p>
          <p className="text-xs text-gray-400">
            {timeAgo(post.createdAt)}
            {post.category && ` · ${post.category.emoji ?? ''} ${post.category.name}`}
          </p>
        </div>
      </div>

      {post.title && <p className="mt-3 font-bold text-gray-900">{post.title}</p>}
      <p className="mt-2 whitespace-pre-line text-sm text-gray-700">{post.content}</p>
      {post.mediaUrl && post.mediaType === 'IMAGE' && (
        <img src={post.mediaUrl} alt="" className="mt-3 max-h-96 w-full rounded-lg object-cover" />
      )}
      {post.mediaUrl && post.mediaType === 'VIDEO' && (
        <video src={post.mediaUrl} controls className="mt-3 max-h-96 w-full rounded-lg" />
      )}

      <div className="mt-3 flex items-center gap-4 border-t border-gray-100 pt-3">
        <button
          onClick={onLike}
          className={cn(
            'flex items-center gap-1.5 text-sm font-medium',
            post.likedByMe ? 'text-red-600' : 'text-gray-500 hover:text-gray-700',
          )}
        >
          <Heart className={cn('h-4 w-4', post.likedByMe && 'fill-current')} />
          {post.likeCount}
        </button>
        <button
          onClick={() => setShowComments((v) => !v)}
          className="flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-700"
        >
          <MessageCircle className="h-4 w-4" />
          {post.commentCount}
        </button>
      </div>

      {showComments && (
        <div className="mt-3 space-y-3 border-t border-gray-100 pt-3">
          <div className="flex gap-2">
            <input
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Écrire un commentaire…"
              className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSubmit();
              }}
            />
            <button
              onClick={handleSubmit}
              disabled={posting || !content.trim()}
              className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
            >
              Envoyer
            </button>
          </div>
          {(comments.data?.items ?? []).map((c) => (
            <div key={c.id} className="flex items-start gap-2">
              <Avatar name={c.author.name ?? 'Membre'} src={c.author.avatarUrl} size="sm" />
              <div>
                <p className="text-sm font-semibold text-gray-900">{c.author.name ?? 'Membre'}</p>
                <p className="text-sm text-gray-600">{c.content}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
