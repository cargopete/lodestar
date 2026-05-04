'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import type { PostMeta } from '@/lib/blog';

const CATEGORIES = ['All', 'News', 'Analysis', 'Ecosystem', 'Guides'] as const;

function PostCard({ post, featured = false }: { post: PostMeta; featured?: boolean }) {
  if (featured) {
    return (
      <Link href={`/blog/${post.slug}`} className="group block">
        <div className="relative rounded-xl overflow-hidden border border-[var(--border)] bg-[var(--bg-surface)]">
          <div className="h-1.5 bg-gradient-to-r from-[var(--accent)] via-purple-500 to-blue-500" />
          <div className="p-8 sm:p-10">
            <div className="flex flex-wrap gap-2 mb-4">
              {post.category && (
                <Badge variant="accent">{post.category}</Badge>
              )}
              {post.tags.slice(0, 2).map((tag) => (
                <Badge key={tag} variant="default">{tag}</Badge>
              ))}
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold text-[var(--text)] leading-tight group-hover:text-[var(--accent)] transition-colors">
              {post.title}
            </h2>
            {post.excerpt && (
              <p className="text-[#B8B8C8] mt-4 text-base leading-relaxed max-w-2xl">{post.excerpt}</p>
            )}
            <div className="flex items-center gap-4 mt-6">
              <span className="text-sm text-[var(--text-faint)]">
                {new Date(post.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
              </span>
              {post.author && <span className="text-sm text-[var(--text-faint)]">by {post.author}</span>}
            </div>
            <div className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-[var(--accent)] group-hover:gap-3 transition-all">
              View Post
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
              </svg>
            </div>
          </div>
        </div>
      </Link>
    );
  }

  return (
    <Link href={`/blog/${post.slug}`} className="group block">
      <div className="relative rounded-xl overflow-hidden border border-[var(--border)] bg-[var(--bg-surface)] h-full transition-colors hover:border-[var(--border-mid)]">
        <div className="h-1 bg-gradient-to-r from-[var(--accent)] to-purple-500 opacity-60" />
        <div className="p-6">
          <div className="flex flex-wrap gap-1.5 mb-3">
            {post.category && <Badge variant="accent">{post.category}</Badge>}
            {post.tags.slice(0, 2).map((tag) => (
              <Badge key={tag} variant="default">{tag}</Badge>
            ))}
          </div>
          <h3 className="text-base font-semibold text-[var(--text)] leading-snug group-hover:text-[var(--accent)] transition-colors">
            {post.title}
          </h3>
          {post.excerpt && (
            <p className="text-sm text-[#B8B8C8] mt-2 line-clamp-3 leading-relaxed">{post.excerpt}</p>
          )}
          <div className="flex items-center gap-3 mt-4 pt-4 border-t border-[var(--border)]">
            <span className="text-[11px] text-[var(--text-faint)]">
              {new Date(post.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
            </span>
            {post.author && <span className="text-[11px] text-[var(--text-faint)]">by {post.author}</span>}
          </div>
        </div>
      </div>
    </Link>
  );
}

function PostGrid({ posts }: { posts: PostMeta[] }) {
  return (
    <div className={`grid gap-5 ${posts.length === 1 ? 'sm:grid-cols-1 max-w-xl' : posts.length === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-3'}`}>
      {posts.map((post) => <PostCard key={post.slug} post={post} />)}
    </div>
  );
}

export default function BlogIndex({ posts }: { posts: PostMeta[] }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('All');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return posts.filter((p) => {
      const matchesCategory = category === 'All' || p.category === category;
      if (!matchesCategory) return false;
      if (!q) return true;
      return (
        p.title.toLowerCase().includes(q) ||
        p.excerpt.toLowerCase().includes(q) ||
        p.rawContent.toLowerCase().includes(q) ||
        p.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [posts, query, category]);

  const isFiltering = query.trim() !== '' || category !== 'All';

  const showGrouped = !isFiltering;

  return (
    <>
      {/* Search + filter bar */}
      <div className="flex flex-col sm:flex-row gap-3 mb-8">
        <div className="relative flex-1">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search posts…"
            className="w-full pl-9 pr-4 py-2 text-[13px] bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius-button)] text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] transition-colors"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text)]"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        <div className="relative">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="appearance-none pl-3 pr-8 py-2 text-[13px] bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius-button)] text-[var(--text)] focus:outline-none focus:border-[var(--accent)] transition-colors cursor-pointer"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <svg className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      {/* No results */}
      {filtered.length === 0 && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] py-16 text-center">
          <p className="text-[var(--text-muted)]">No posts match your search.</p>
        </div>
      )}

      {/* Flat search/filter results */}
      {!showGrouped && filtered.length > 0 && (
        <div className="space-y-10">
          {filtered.length > 0 && (
            <div>
              <p className="text-[12px] text-[var(--text-muted)] mb-5">
                {filtered.length} {filtered.length === 1 ? 'post' : 'posts'} found
              </p>
              <PostGrid posts={filtered} />
            </div>
          )}
        </div>
      )}

      {/* Default view — newest first, featured post at top */}
      {showGrouped && filtered.length > 0 && (
        <div className="space-y-8">
          <PostCard post={filtered[0]} featured />
          {filtered.length > 1 && <PostGrid posts={filtered.slice(1)} />}
        </div>
      )}
    </>
  );
}
