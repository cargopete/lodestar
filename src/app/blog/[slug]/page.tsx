import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getPost, getPostSlugs, getAllPosts } from '@/lib/blog';
import { Badge } from '@/components/ui/Badge';

export function generateStaticParams() {
  return getPostSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = getAllPosts().find((p) => p.slug === slug);
  if (!post) return {};

  return {
    title: `${post.title} | Lodestar Blog`,
    description: post.excerpt,
    openGraph: {
      title: post.title,
      description: post.excerpt,
      type: 'article',
      publishedTime: post.date,
      authors: [post.author],
      tags: post.tags,
    },
    twitter: {
      card: 'summary_large_image',
      title: post.title,
      description: post.excerpt,
    },
  };
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
            prose-p:text-[#B8B8C8] prose-p:leading-relaxed prose-p:mb-5
            prose-a:text-[var(--accent)] prose-a:no-underline hover:prose-a:underline
            prose-strong:text-[var(--text)] prose-strong:font-semibold
            prose-li:text-[#B8B8C8] prose-li:leading-relaxed
            prose-ul:my-4 prose-ol:my-4
            prose-td:text-[#B8B8C8] prose-th:text-[var(--text)] prose-th:font-semibold
            prose-table:border-collapse prose-th:border prose-th:border-[var(--border)] prose-th:px-3 prose-th:py-2
            prose-td:border prose-td:border-[var(--border)] prose-td:px-3 prose-td:py-2
            prose-code:text-[var(--accent)] prose-code:bg-[var(--bg-elevated)] prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-sm prose-code:font-mono
            prose-pre:bg-[var(--bg-elevated)] prose-pre:border prose-pre:border-[var(--border)] prose-pre:rounded-lg prose-pre:p-4 prose-pre:text-left prose-pre:text-[#B8B8C8]
            [&_pre_code]:p-0 [&_pre_code]:bg-transparent [&_pre_code]:text-inherit [&_pre_code]:text-sm
            prose-blockquote:border-l-2 prose-blockquote:border-[var(--accent)] prose-blockquote:pl-4 prose-blockquote:italic prose-blockquote:text-[#9999AA]
            prose-hr:border-[var(--border)]"
          dangerouslySetInnerHTML={{ __html: post.contentHtml }}
        />

        {/* Sidebar */}
        <aside className="lg:w-56 shrink-0">
          <div className="lg:sticky lg:top-6 space-y-6">
            {/* Tags */}
            {post.tags.length > 0 && (
              <div>
                <p className="text-[11px] font-medium text-[var(--text-faint)] mb-2.5">
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
                <p className="text-[11px] font-medium text-[var(--text-faint)] mb-2.5">
                  Author
                </p>
                <a
                  href={`https://github.com/${post.author}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-full border border-[var(--border)] text-[var(--text)] bg-[var(--bg-surface)] hover:border-[var(--border-mid)] transition-colors"
                >
                  {post.author}
                </a>
              </div>
            )}

            {/* Published */}
            <div>
              <p className="text-[11px] font-medium text-[var(--text-faint)] mb-2.5">
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
