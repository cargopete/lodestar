import Link from 'next/link';
import { getAllPosts } from '@/lib/blog';
import { Badge } from '@/components/ui/Badge';

export default function BlogIndexPage() {
  const posts = getAllPosts();
  const [featured, ...rest] = posts;

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-10">
        <h1 className="text-3xl font-bold text-[var(--text)] tracking-tight">Blog</h1>
        <p className="text-[var(--text-muted)] mt-2">
          Updates, guides, and insights from the Lodestar team.
        </p>
      </div>

      {!featured ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] py-16 text-center">
          <p className="text-[var(--text-muted)]">No posts yet. Check back soon.</p>
        </div>
      ) : (
        <>
          {/* Featured / Hero Post */}
          <Link href={`/blog/${featured.slug}`} className="group block">
            <div className="relative rounded-xl overflow-hidden border border-[var(--border)] bg-[var(--bg-surface)]">
              {/* Gradient accent bar */}
              <div className="h-1.5 bg-gradient-to-r from-[var(--accent)] via-purple-500 to-blue-500" />

              <div className="p-8 sm:p-10">
                <div className="flex flex-wrap gap-2 mb-4">
                  {featured.tags.map((tag) => (
                    <Badge key={tag} variant="accent">{tag}</Badge>
                  ))}
                </div>

                <h2 className="text-2xl sm:text-3xl font-bold text-[var(--text)] leading-tight group-hover:text-[var(--accent)] transition-colors">
                  {featured.title}
                </h2>

                {featured.excerpt && (
                  <p className="text-[var(--text-muted)] mt-4 text-base leading-relaxed max-w-2xl">
                    {featured.excerpt}
                  </p>
                )}

                <div className="flex items-center gap-4 mt-6">
                  <span className="text-sm text-[var(--text-faint)]">
                    {new Date(featured.date).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })}
                  </span>
                  {featured.author && (
                    <span className="text-sm text-[var(--text-faint)]">
                      by {featured.author}
                    </span>
                  )}
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

          {/* Remaining posts grid */}
          {rest.length > 0 && (
            <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {rest.map((post) => (
                <Link
                  key={post.slug}
                  href={`/blog/${post.slug}`}
                  className="group block"
                >
                  <div className="relative rounded-xl overflow-hidden border border-[var(--border)] bg-[var(--bg-surface)] h-full transition-colors hover:border-[var(--border-mid)]">
                    {/* Gradient accent line */}
                    <div className="h-1 bg-gradient-to-r from-[var(--accent)] to-purple-500 opacity-60" />

                    <div className="p-5">
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {post.tags.slice(0, 2).map((tag) => (
                          <Badge key={tag} variant="default">{tag}</Badge>
                        ))}
                      </div>

                      <h3 className="text-[15px] font-semibold text-[var(--text)] leading-snug group-hover:text-[var(--accent)] transition-colors">
                        {post.title}
                      </h3>

                      {post.excerpt && (
                        <p className="text-sm text-[var(--text-muted)] mt-2 line-clamp-2 leading-relaxed">
                          {post.excerpt}
                        </p>
                      )}

                      <div className="flex items-center gap-3 mt-4 pt-4 border-t border-[var(--border)]">
                        <span className="text-[11px] text-[var(--text-faint)]">
                          {new Date(post.date).toLocaleDateString('en-US', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric',
                          })}
                        </span>
                        {post.author && (
                          <span className="text-[11px] text-[var(--text-faint)]">
                            by {post.author}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
