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
  const tags = post?.tags?.slice(0, 3) ?? [];

  // Truncate excerpt to roughly 2 lines
  const shortExcerpt = excerpt.length > 140 ? excerpt.slice(0, 137) + '...' : excerpt;

  return new ImageResponse(
    (
      <div style={{
        display: 'flex',
        width: '100%',
        height: '100%',
        background: '#0D0D10',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Background grid */}
        <div style={{
          display: 'flex',
          position: 'absolute',
          inset: 0,
          backgroundImage: 'radial-gradient(circle, rgba(139,133,255,0.07) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }} />

        {/* Purple glow top-right */}
        <div style={{
          display: 'flex',
          position: 'absolute',
          top: -120,
          right: -80,
          width: 480,
          height: 480,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(139,133,255,0.18) 0%, transparent 70%)',
        }} />

        {/* Left accent bar */}
        <div style={{
          display: 'flex',
          position: 'absolute',
          top: 0,
          left: 0,
          bottom: 0,
          width: 5,
          background: 'linear-gradient(180deg, #8B85FF 0%, #A855F7 50%, #3B82F6 100%)',
        }} />

        {/* Main content */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '56px 72px 52px 80px',
          width: '100%',
          height: '100%',
          position: 'relative',
        }}>
          {/* Top: branding + tags */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{
                fontSize: 18,
                fontWeight: 800,
                color: '#8B85FF',
                letterSpacing: '-0.3px',
              }}>
                LODESTAR
              </span>
              <span style={{
                fontSize: 13,
                color: '#444455',
                fontWeight: 500,
                marginLeft: 4,
              }}>
                / Blog
              </span>
            </div>
            {tags.length > 0 && (
              <div style={{ display: 'flex', gap: 8 }}>
                {tags.map((tag) => (
                  <span key={tag} style={{
                    display: 'flex',
                    padding: '4px 12px',
                    borderRadius: 20,
                    border: '1px solid rgba(139,133,255,0.25)',
                    background: 'rgba(139,133,255,0.08)',
                    fontSize: 13,
                    color: '#8B85FF',
                    fontWeight: 500,
                  }}>
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Middle: title + excerpt */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: '88%' }}>
            <span style={{
              fontSize: title.length > 55 ? 46 : title.length > 40 ? 52 : 58,
              fontWeight: 800,
              color: '#F0F0F6',
              lineHeight: 1.1,
              letterSpacing: '-1px',
            }}>
              {title}
            </span>
            {shortExcerpt && (
              <span style={{
                fontSize: 21,
                color: '#7070A0',
                lineHeight: 1.55,
                fontWeight: 400,
              }}>
                {shortExcerpt}
              </span>
            )}
          </div>

          {/* Bottom: date */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: '#8B85FF',
              display: 'flex',
            }} />
            <span style={{ fontSize: 15, color: '#555568', fontWeight: 500 }}>
              {date}
            </span>
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
