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

  return (
    <div className="max-w-3xl mx-auto">
      {/* Back link */}
      <Link
        href="/blog"
        className="inline-flex items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors mb-6"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
        </svg>
        All posts
      </Link>

      {/* Header */}
      <header className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-semibold text-[var(--text)] leading-tight">
          {post.title}
        </h1>
        <div className="flex items-center gap-3 mt-3">
          <span className="text-sm text-[var(--text-faint)]">
            {new Date(post.date).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </span>
          {post.author && (
            <span className="text-sm text-[var(--text-faint)]">by {post.author}</span>
          )}
        </div>
        {post.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {post.tags.map((tag) => (
              <Badge key={tag} variant="default">{tag}</Badge>
            ))}
          </div>
        )}
      </header>

      {/* Content */}
      <article
        className="prose prose-invert max-w-none
          prose-headings:text-[var(--text)] prose-headings:font-semibold
          prose-h2:text-xl prose-h2:mt-8 prose-h2:mb-4
          prose-h3:text-lg prose-h3:mt-6 prose-h3:mb-3
          prose-p:text-[var(--text-muted)] prose-p:leading-relaxed prose-p:mb-4
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
    </div>
  );
}
