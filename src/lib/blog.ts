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
  category: string;
  /**
   * Pre-lowercased haystack of the post's *metadata* only: title, excerpt, tags
   * and category. Cheap enough to ship with the listing, and enough to filter on
   * instantly while the body index is still in flight.
   *
   * Bodies deliberately live behind `/api/blog/search-index` instead. Inlining
   * them cost every visitor ~160KB compressed to serve the minority who actually
   * type in the search box.
   */
  searchText: string;
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

/** Lowercase haystack of a post's metadata. Small; ships with the listing. */
function buildSearchText(data: Record<string, unknown>): string {
  const tags = Array.isArray(data.tags) ? data.tags.join(' ') : '';
  return [data.title, data.excerpt, data.category, tags]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .trim();
}

/**
 * Lowercase body text per slug, for full-text search.
 *
 * Code blocks are kept (their identifiers are exactly what people search a
 * technical blog for) but fence markers, link URLs and runs of whitespace go,
 * since none of them are ever the search target. Served on demand rather than
 * embedded in the listing payload.
 */
export function getSearchIndex(): Record<string, string> {
  const index: Record<string, string> = {};
  for (const slug of getPostSlugs()) {
    const filePath = resolvePostPath(slug);
    if (!filePath) continue;
    const { content } = matter(fs.readFileSync(filePath, 'utf-8'));
    index[slug] = content
      .replace(/```[a-zA-Z0-9]*\n?/g, ' ')
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\s+/g, ' ')
      .toLowerCase()
      .trim();
  }
  return index;
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
        category: data.category ?? '',
        searchText: buildSearchText(data),
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
    category: data.category ?? '',
    searchText: buildSearchText(data),
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
