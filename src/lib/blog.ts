import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { remark } from 'remark';
import remarkGfm from 'remark-gfm';
import html from 'remark-html';

const POSTS_DIR = path.join(process.cwd(), 'src/content/blog');

export interface PostMeta {
  slug: string;
  title: string;
  date: string;
  author: string;
  tags: string[];
  excerpt: string;
}

export interface Post extends PostMeta {
  contentHtml: string;
}

/**
 * Get all post slugs for static generation
 */
export function getPostSlugs(): string[] {
  if (!fs.existsSync(POSTS_DIR)) return [];
  return fs
    .readdirSync(POSTS_DIR)
    .filter((f) => f.endsWith('.md') || f.endsWith('.mdx'))
    .map((f) => f.replace(/\.mdx?$/, ''))
    .filter((slug) => {
      const filePath = resolvePostPath(slug);
      if (!filePath) return false;
      const { data } = matter(fs.readFileSync(filePath, 'utf-8'));
      return !data.draft;
    });
}

/**
 * Get metadata for all posts, sorted by date descending
 */
export function getAllPosts(): PostMeta[] {
  const slugs = getPostSlugs();

  return slugs
    .map((slug) => {
      const filePath = resolvePostPath(slug);
      if (!filePath) return null;
      const raw = fs.readFileSync(filePath, 'utf-8');
      const { data } = matter(raw);
      return {
        slug,
        title: data.title ?? slug,
        date: data.date ?? '',
        author: data.author ?? '',
        tags: data.tags ?? [],
        excerpt: data.excerpt ?? '',
      } satisfies PostMeta;
    })
    .filter((p): p is PostMeta => p !== null)
    .sort((a, b) => (a.date > b.date ? -1 : 1));
}

/**
 * Get a single post with rendered HTML content
 */
export async function getPost(slug: string): Promise<Post | null> {
  const filePath = resolvePostPath(slug);
  if (!filePath) return null;

  const raw = fs.readFileSync(filePath, 'utf-8');
  const { data, content } = matter(raw);

  const result = await remark().use(remarkGfm).use(html).process(content);

  return {
    slug,
    title: data.title ?? slug,
    date: data.date ?? '',
    author: data.author ?? '',
    tags: data.tags ?? [],
    excerpt: data.excerpt ?? '',
    contentHtml: result.toString(),
  };
}

function resolvePostPath(slug: string): string | null {
  for (const ext of ['.mdx', '.md']) {
    const p = path.join(POSTS_DIR, slug + ext);
    if (fs.existsSync(p)) return p;
  }
  return null;
}
