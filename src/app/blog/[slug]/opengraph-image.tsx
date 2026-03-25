import { ImageResponse } from 'next/og';
import { getAllPosts } from '@/lib/blog';

export const runtime = 'nodejs';
export const alt = 'Lodestar Blog';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OGImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getAllPosts().find((p) => p.slug === slug);

  const title = post?.title ?? slug;
  const excerpt = post?.excerpt ?? '';
  const date = post?.date
    ? new Date(post.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : '';
  const author = post?.author ?? '';
  const tags = post?.tags?.slice(0, 4) ?? [];

  return new ImageResponse(
    (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        background: '#111114',
        padding: '48px 56px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}>
        {/* Gradient accent bar */}
        <div style={{
          display: 'flex',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 6,
          background: 'linear-gradient(90deg, #8B85FF 0%, #A855F7 40%, #3B82F6 100%)',
        }} />

        {/* Tags */}
        {tags.length > 0 && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
            {tags.map((tag) => (
              <span key={tag} style={{
                display: 'flex',
                padding: '5px 14px',
                borderRadius: 20,
                border: '1px solid rgba(139,133,255,0.3)',
                background: 'rgba(139,133,255,0.1)',
                fontSize: 14,
                color: '#8B85FF',
                fontWeight: 500,
              }}>
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Title */}
        <span style={{
          fontSize: title.length > 50 ? 40 : 48,
          fontWeight: 700,
          color: '#EEEEF2',
          lineHeight: 1.15,
          maxWidth: '90%',
        }}>
          {title}
        </span>

        {/* Excerpt */}
        {excerpt && (
          <span style={{
            fontSize: 20,
            color: '#9898A6',
            marginTop: 20,
            lineHeight: 1.5,
            maxWidth: '85%',
          }}>
            {excerpt.length > 160 ? excerpt.slice(0, 157) + '...' : excerpt}
          </span>
        )}

        {/* Footer */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 'auto',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 20, fontWeight: 700, color: '#8B85FF' }}>
              Lodestar
            </span>
            <span style={{ fontSize: 15, color: '#6B6B7B' }}>
              Blog
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {author && (
              <span style={{ fontSize: 14, color: '#6B6B7B' }}>
                by {author}
              </span>
            )}
            {date && (
              <span style={{ fontSize: 14, color: '#6B6B7B' }}>
                {date}
              </span>
            )}
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
