import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExistsSync = vi.fn();
const mockReaddirSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockMatter = vi.fn();

vi.mock('fs', () => ({
  default: {
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
    readdirSync: (...args: unknown[]) => mockReaddirSync(...args),
    readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  },
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readdirSync: (...args: unknown[]) => mockReaddirSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
}));

vi.mock('gray-matter', () => ({
  default: (...args: unknown[]) => mockMatter(...args),
}));

vi.mock('remark', () => ({
  remark: vi.fn(() => ({
    use: vi.fn().mockReturnThis(),
    process: vi.fn(() => Promise.resolve({ toString: () => '<p>rendered</p>' })),
  })),
}));
vi.mock('remark-gfm', () => ({ default: vi.fn() }));
vi.mock('remark-html', () => ({ default: vi.fn() }));

import { getPostSlugs, getAllPosts, getPost } from '../blog';

const defaultMatterResult = (overrides: Record<string, unknown> = {}) => ({
  data: {
    title: 'Test Post',
    date: '2026-03-01',
    author: 'Chief',
    tags: ['graph'],
    excerpt: 'excerpt',
    ...overrides,
  },
  content: '# Body',
});

describe('getPostSlugs', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns empty array when blog dir does not exist', () => {
    mockExistsSync.mockReturnValue(false);
    expect(getPostSlugs()).toEqual([]);
  });

  it('returns slugs from .md and .mdx files', () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(['alpha.md', 'beta.mdx', 'image.png']);
    mockReadFileSync.mockReturnValue('raw');
    mockMatter.mockReturnValue(defaultMatterResult());
    const slugs = getPostSlugs();
    expect(slugs).toContain('alpha');
    expect(slugs).toContain('beta');
    expect(slugs).not.toContain('image');
  });

  it('filters non-markdown files', () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(['config.json']);
    expect(getPostSlugs()).toEqual([]);
  });
});

describe('getAllPosts', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns empty array when no blog dir', () => {
    mockExistsSync.mockReturnValue(false);
    expect(getAllPosts()).toEqual([]);
  });

  it('returns posts with metadata', () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(['post-a.md']);
    mockReadFileSync.mockReturnValue('raw');
    mockMatter.mockReturnValue(defaultMatterResult());

    const posts = getAllPosts();
    expect(posts).toHaveLength(1);
    expect(posts[0].title).toBe('Test Post');
    expect(posts[0].slug).toBe('post-a');
  });

  it('falls back to slug when title is null', () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(['my-post.md']);
    mockReadFileSync.mockReturnValue('raw');
    mockMatter.mockReturnValue(defaultMatterResult({ title: null }));

    const [post] = getAllPosts();
    expect(post.title).toBe('my-post'); // falls back to slug
  });

  it('falls back to empty string when date/author/excerpt is null', () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(['p.md']);
    mockReadFileSync.mockReturnValue('raw');
    mockMatter.mockReturnValue(defaultMatterResult({ date: null, author: null, excerpt: null }));

    const [post] = getAllPosts();
    expect(post.date).toBe('');
    expect(post.author).toBe('');
    expect(post.excerpt).toBe('');
  });

  it('falls back to empty array when tags is null', () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(['p.md']);
    mockReadFileSync.mockReturnValue('raw');
    mockMatter.mockReturnValue(defaultMatterResult({ tags: null }));

    const [post] = getAllPosts();
    expect(post.tags).toEqual([]);
  });

  it('filters slugs where post file cannot be found', () => {
    mockExistsSync
      .mockReturnValueOnce(true)  // POSTS_DIR exists
      .mockReturnValue(false);    // post path: doesn't exist
    mockReaddirSync.mockReturnValue(['ghost.md']);

    const posts = getAllPosts();
    expect(posts).toHaveLength(0);
  });

  it('sorts posts by date descending', () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(['old.md', 'new.md']);
    mockReadFileSync.mockReturnValue('raw');
    // getPostSlugs() calls matter once per slug (draft check), then getAllPosts() calls it again
    mockMatter
      .mockReturnValueOnce(defaultMatterResult({ title: 'Old', date: '2024-01-01' })) // getPostSlugs: old
      .mockReturnValueOnce(defaultMatterResult({ title: 'New', date: '2026-01-01' })) // getPostSlugs: new
      .mockReturnValueOnce(defaultMatterResult({ title: 'Old', date: '2024-01-01' })) // getAllPosts: old
      .mockReturnValueOnce(defaultMatterResult({ title: 'New', date: '2026-01-01' })); // getAllPosts: new

    const posts = getAllPosts();
    expect(posts[0].date).toBe('2026-01-01');
    expect(posts[1].date).toBe('2024-01-01');
  });
});

describe('getPost', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns null when post file does not exist', async () => {
    mockExistsSync.mockReturnValue(false);
    const result = await getPost('nonexistent');
    expect(result).toBeNull();
  });

  it('returns post with rendered HTML when .md file exists', async () => {
    mockExistsSync.mockImplementation((p: unknown) => String(p).endsWith('.md'));
    mockReadFileSync.mockReturnValue('raw content');
    mockMatter.mockReturnValue(defaultMatterResult());

    const post = await getPost('hello-world');
    expect(post).not.toBeNull();
    expect(post?.slug).toBe('hello-world');
    expect(post?.contentHtml).toBe('<p>rendered</p>');
  });

  it('returns post when .mdx file exists', async () => {
    mockExistsSync.mockImplementation((p: unknown) => String(p).endsWith('.mdx'));
    mockReadFileSync.mockReturnValue('MDX content');
    mockMatter.mockReturnValue(defaultMatterResult());

    const post = await getPost('mdx-post');
    expect(post).not.toBeNull();
  });

  it('falls back to slug when title is null', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('raw');
    mockMatter.mockReturnValue(defaultMatterResult({ title: null, date: null, author: null, tags: null, excerpt: null }));

    const post = await getPost('my-slug');
    expect(post?.title).toBe('my-slug');
    expect(post?.date).toBe('');
    expect(post?.tags).toEqual([]);
  });
});
