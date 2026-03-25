import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPost, getPostSlugs } from '@/lib/blog';
import { Badge } from '@/components/ui/Badge';

export function generateStaticParams() {
  return getPostSlugs().map((slug) => ({ slug }));
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = await getPost(slug);

  if (!post) notFound();

  const formattedDate = new Date(post.date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="max-w-4xl mx-auto">
      {/* Gradient accent bar */}
      <div className="h-1.5 rounded-full bg-gradient-to-r from-[var(--accent)] via-purple-500 to-blue-500 mb-8" />

      {/* Back button */}
      <Link
        href="/blog"
        className="inline-flex items-center justify-center w-9 h-9 rounded-full border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--border-mid)] transition-colors mb-8"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
        </svg>
      </Link>

      {/* Title */}
      <h1 className="text-3xl sm:text-4xl font-bold text-[var(--text)] leading-tight tracking-tight">
        {post.title}
      </h1>

      {/* Excerpt as bold subtitle */}
      {post.excerpt && (
        <p className="text-lg font-medium text-[var(--text-muted)] mt-4 leading-relaxed max-w-3xl">
          {post.excerpt}
        </p>
      )}

      {/* Two-column layout: content + sidebar */}
      <div className="mt-10 flex flex-col lg:flex-row gap-10">
        {/* Main content */}
        <article
          className="min-w-0 flex-1 prose prose-invert max-w-none
            prose-headings:text-[var(--text)] prose-headings:font-semibold prose-headings:tracking-tight
            prose-h2:text-xl prose-h2:mt-10 prose-h2:mb-4
            prose-h3:text-lg prose-h3:mt-8 prose-h3:mb-3
            prose-p:text-[var(--text-muted)] prose-p:leading-relaxed prose-p:mb-5
            prose-a:text-[var(--accent)] prose-a:no-underline hover:prose-a:underline
            prose-strong:text-[var(--text)] prose-strong:font-semibold
            prose-li:text-[var(--text-muted)] prose-li:leading-relaxed
            prose-ul:my-4 prose-ol:my-4
            prose-code:text-[var(--accent)] prose-code:bg-[var(--bg-elevated)] prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-sm prose-code:font-mono
            prose-pre:bg-[var(--bg-elevated)] prose-pre:border prose-pre:border-[var(--border)] prose-pre:rounded-lg prose-pre:p-4
            prose-blockquote:border-l-2 prose-blockquote:border-[var(--accent)] prose-blockquote:pl-4 prose-blockquote:italic prose-blockquote:text-[var(--text-faint)]
            prose-hr:border-[var(--border)]"
          dangerouslySetInnerHTML={{ __html: post.contentHtml }}
        />

        {/* Sidebar */}
        <aside className="lg:w-56 shrink-0">
          <div className="lg:sticky lg:top-6 space-y-6">
            {/* Tags */}
            {post.tags.length > 0 && (
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-faint)] mb-2.5">
                  Tags
                </p>
                <div className="flex flex-wrap gap-2">
                  {post.tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-full border border-[var(--border)] text-[var(--text)] bg-[var(--bg-surface)] hover:border-[var(--border-mid)] transition-colors"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Author */}
            {post.author && (
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-faint)] mb-2.5">
                  Author
                </p>
                <span className="inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-full border border-[var(--border)] text-[var(--text)] bg-[var(--bg-surface)]">
                  {post.author}
                </span>
              </div>
            )}

            {/* Published */}
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-faint)] mb-2.5">
                Published
              </p>
              <p className="text-sm text-[var(--text)]">{formattedDate}</p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
