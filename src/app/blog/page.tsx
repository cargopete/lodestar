import { getAllPosts } from '@/lib/blog';
import BlogIndex from './BlogIndex';

export default function BlogIndexPage() {
  const posts = getAllPosts();

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-10">
        <h1 className="text-3xl font-bold text-[var(--text)] tracking-tight">Blog</h1>
        <p className="text-[var(--text-muted)] mt-2">
          Updates, guides, and insights from the Lodestar team.
        </p>
      </div>
      <BlogIndex posts={posts} />
    </div>
  );
}
