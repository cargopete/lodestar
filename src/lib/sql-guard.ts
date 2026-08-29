// Defence in depth for the public SQL proxy, and it is worth being clear that it is only that.
//
// The real guarantees live in the nest: DuckDB opened with `enable_external_access=false`, an
// `allowed_directories` restriction, `lock_configuration=true` so a query cannot widen its own
// access mid-flight, a function allowlist as well as a denylist, comment stripping before matching,
// and rejection of unknown table references. Those are tested there, including against quoted-
// identifier and comment evasion.
//
// So this file is not trying to be a SQL parser, and a regex pretending to be one would be worse
// than nothing: it would look like a security boundary while leaking through the first `/**/` an
// attacker tried. What it does is narrow and honest: refuse anything that is obviously not a single
// read-only statement, so mistakes and drive-by nonsense never reach the nest at all, and cap the
// length. If this ever disagrees with the nest, the nest wins, because the nest is the boundary.

/** Longer than any hand-written query has a business being, and well under the nest's own cap. */
export const MAX_QUERY_LENGTH = 4000;

export type SqlRejection =
  | { ok: true }
  | { ok: false; reason: string };

/** Statement keywords that have no place on a read-only surface. */
const WRITE_KEYWORDS = [
  'insert',
  'update',
  'delete',
  'drop',
  'create',
  'alter',
  'truncate',
  'attach',
  'detach',
  'copy',
  'install',
  'load',
  'pragma',
  'set',
  'reset',
  'export',
  'import',
  'call',
  'grant',
  'revoke',
  'vacuum',
  'checkpoint',
];

/**
 * Strip string literals and comments so keyword matching cannot be fooled by a column called
 * `"drop"` or by `/* create *​/`. This mirrors what the nest does before its own matching, for the
 * same reason: matching raw text is matching the attacker's formatting choices.
 */
function stripLiteralsAndComments(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    // Line comment.
    if (c === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      out += ' ';
      continue;
    }
    // Block comment. DuckDB does not nest these, so neither do we.
    if (c === '/' && sql[i + 1] === '*') {
      i += 2;
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      i += 2;
      out += ' ';
      continue;
    }
    // Single-quoted string, '' escapes a quote.
    if (c === "'") {
      i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          i++;
          break;
        }
        i++;
      }
      out += " '' ";
      continue;
    }
    // Double-quoted identifier: keep it, but neutered, so `"drop"` as a column name is fine.
    if (c === '"') {
      i++;
      while (i < sql.length) {
        if (sql[i] === '"' && sql[i + 1] === '"') {
          i += 2;
          continue;
        }
        if (sql[i] === '"') {
          i++;
          break;
        }
        i++;
      }
      out += ' "id" ';
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * Accept a single read-only `SELECT` or `WITH`, reject anything else.
 *
 * Deliberately conservative: a query this refuses but the nest would have answered is an
 * inconvenience, and the reverse is a hole.
 */
export function isReadOnlySql(raw: string): SqlRejection {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: 'Empty query.' };
  if (trimmed.length > MAX_QUERY_LENGTH) {
    return { ok: false, reason: `Query too long: ${trimmed.length} characters, limit ${MAX_QUERY_LENGTH}.` };
  }

  const bare = stripLiteralsAndComments(trimmed);

  // One statement only. A trailing semicolon is a habit, not an attack, so allow exactly that.
  const withoutTrailing = bare.replace(/;\s*$/, '');
  if (withoutTrailing.includes(';')) {
    return { ok: false, reason: 'Only one statement at a time.' };
  }

  const words = new Set(withoutTrailing.toLowerCase().match(/[a-z_]+/g) ?? []);
  for (const kw of WRITE_KEYWORDS) {
    if (words.has(kw)) {
      return { ok: false, reason: `Read-only surface: \`${kw.toUpperCase()}\` is not allowed.` };
    }
  }

  // File-reading table functions. The nest refuses these already, by an allowlist that also refuses
  // whatever upstream adds tomorrow, which is the property a denylist can never have. Repeated here
  // only because it costs one line and turns a remote refusal into a local one.
  for (const w of words) {
    if (w.startsWith('read_') || w === 'glob' || w === 'sniff_csv') {
      return { ok: false, reason: `File access is not available on this surface: \`${w}\`.` };
    }
  }

  // Last, and deliberately: a `DROP TABLE` fails the keyword check above with a message naming
  // DROP, which is the reason someone can act on. Reaching here means the statement is not a write
  // and still is not a query, so the generic message is the right one.
  const firstWord = withoutTrailing.trimStart().split(/[\s(]+/)[0]?.toLowerCase() ?? '';
  if (firstWord !== 'select' && firstWord !== 'with' && firstWord !== 'table') {
    return { ok: false, reason: 'Read-only surface: queries must start with SELECT or WITH.' };
  }

  return { ok: true };
}
