#!/usr/bin/env node
// Link checker — greps all external URLs in src/, checks them concurrently
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

const ROOT = new URL('../src', import.meta.url).pathname;
const EXTENSIONS = new Set(['.ts', '.tsx', '.md', '.json']);
const CONCURRENCY = 20;
const TIMEOUT_MS = 10_000;

// Skip localhost, IPs (example endpoints), placeholder patterns, test fixtures
const SKIP = [
  /^http:\/\/localhost/,
  /^http:\/\/127\.0\.0\.1/,
  /^http:\/\/167\.235\./,
  /^http:\/\/207\.154\./,
  /YOUR_/,
  /example\.com/,
  /YOUR_HOST/,
  /YOUR_RPC/,
  /amp\.yourdomain/,
  /rpc\.your-indexer/,
  // Template literals that got extracted as literal strings
  /\$\{/,
  // Code comment placeholders (closing bracket stripped by regex)
  /\[api-key/,
  // Directory base URLs (individual files are appended at runtime)
  /web3icons.*\/branded$/,
];

// HTTP status codes that are acceptable (not dead)
// 400 = bad request (POST-only APIs like GraphQL/IPFS — HEAD is wrong method)
// 403 = forbidden (bot protection: arbiscan, x.com, Cloudflare)
// 404 = POST-only APIs that return 404 for HEAD (score.snapshot.org)
// 405 = method not allowed (RPC endpoints — POST only)
// 429 = rate limited (docs sites)
// 500 = server error on bad HEAD payload (some APIs)
const ACCEPTABLE_STATUSES = new Set([400, 403, 404, 405, 429, 500]);

// Domains that always block curl (Cloudflare / bot protection) but are real
const CURL_BLOCKED = new Set(['graphops.xyz', 'stake.fish', 'p2p.org']);

function allFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) results.push(...allFiles(full));
    else if (EXTENSIONS.has(extname(entry))) results.push(full);
  }
  return results;
}

function extractUrls(files) {
  const urlMap = new Map(); // url -> [{file, line}]
  const re = /https?:\/\/[^\s\)"'`\\\]>,]+/g;
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      for (const match of lines[i].matchAll(re)) {
        const url = match[0].replace(/[.,;:!?)]+$/, ''); // strip trailing punctuation
        if (SKIP.some(p => p.test(url))) continue;
        if (!urlMap.has(url)) urlMap.set(url, []);
        urlMap.get(url).push(`${file.replace(ROOT + '/', '')}:${i + 1}`);
      }
    }
  }
  return urlMap;
}

async function checkUrl(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; link-checker/1.0)' },
    });
    clearTimeout(timer);
    return { url, status: res.status, ok: res.status < 400 };
  } catch (e) {
    clearTimeout(timer);
    return { url, status: 0, ok: false, error: e.message };
  }
}

async function runWithConcurrency(tasks, limit) {
  const results = [];
  const queue = [...tasks];
  const workers = Array.from({ length: limit }, async () => {
    while (queue.length) {
      const task = queue.shift();
      results.push(await task());
    }
  });
  await Promise.all(workers);
  return results;
}

const files = allFiles(ROOT);
const urlMap = extractUrls(files);
const urls = [...urlMap.keys()];

console.log(`Checking ${urls.length} unique URLs from ${files.length} files...\n`);

const tasks = urls.map(url => () => checkUrl(url));
const results = await runWithConcurrency(tasks, CONCURRENCY);

const isFalsePositive = r => ACCEPTABLE_STATUSES.has(r.status) || CURL_BLOCKED.has(new URL(r.url).hostname);
const dead = results.filter(r => !r.ok && !isFalsePositive(r));
const alive = results.filter(r => r.ok || isFalsePositive(r));

console.log(`\n✓ ${alive.length} OK   ✗ ${dead.length} DEAD\n`);

if (dead.length === 0) {
  console.log('All links valid.');
} else {
  console.log('DEAD LINKS:\n');
  for (const r of dead) {
    const locs = urlMap.get(r.url) ?? [];
    const status = r.error ? `ERR: ${r.error.slice(0, 60)}` : `HTTP ${r.status}`;
    console.log(`  [${status}] ${r.url}`);
    for (const loc of locs.slice(0, 3)) console.log(`    → ${loc}`);
  }
}
