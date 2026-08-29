import { describe, it, expect } from 'vitest';
import { isReadOnlySql, MAX_QUERY_LENGTH } from '../sql-guard';

const ok = (q: string) => expect(isReadOnlySql(q), q).toEqual({ ok: true });
const no = (q: string) => expect(isReadOnlySql(q).ok, q).toBe(false);

describe('isReadOnlySql', () => {
  it('accepts the queries the playground ships with', () => {
    ok('SELECT 1');
    ok('SELECT block_timestamp, tokens FROM staking__delegated ORDER BY block_number DESC LIMIT 20');
    ok('WITH recent AS (SELECT * FROM staking__delegated LIMIT 5) SELECT count(*) FROM recent');
    ok('  select * from usdc__transfer limit 1  ');
    ok('SELECT * FROM staking__delegated LIMIT 1;');
  });

  it('rejects everything that writes', () => {
    for (const q of [
      'DROP TABLE staking__delegated',
      'CREATE TABLE t (a INT)',
      'INSERT INTO t VALUES (1)',
      'UPDATE t SET a = 1',
      'DELETE FROM t',
      'ATTACH DATABASE \'/tmp/x.db\' AS x',
      'INSTALL httpfs',
      'PRAGMA database_list',
      'COPY (SELECT 1) TO \'/tmp/out.csv\'',
    ]) {
      no(q);
    }
  });

  it('rejects a second statement, which is the whole point of the semicolon rule', () => {
    no('SELECT 1; DROP TABLE staking__delegated');
    no('SELECT 1;SELECT 2');
  });

  it('allows one trailing semicolon, because that is a habit and not an attack', () => {
    ok('SELECT 1;');
    ok('SELECT 1;   ');
  });

  // The failure mode a naive regex guard has: the attacker controls the formatting.
  it('is not fooled by comments hiding a second statement', () => {
    no('SELECT 1 /* harmless */; DROP TABLE staking__delegated');
    no('SELECT 1 -- comment\n; DROP TABLE staking__delegated');
    no('SELECT/**/1;/**/DROP/**/TABLE/**/x');
  });

  it('does not reject a query for containing a keyword inside a string or an identifier', () => {
    ok("SELECT * FROM staking__delegated WHERE tx_hash = 'drop'");
    ok('SELECT "create" FROM staking__delegated');
    ok('SELECT created_at, deleted_flag, insertion_id FROM staking__delegated');
    ok("SELECT 'it''s fine; really' AS quoted");
  });

  it('refuses file-reading table functions even though the nest also would', () => {
    no("SELECT * FROM read_csv_auto('/etc/passwd')");
    no("SELECT * FROM read_parquet('/var/lib/nuthatch/x.parquet')");
    no("SELECT content FROM read_text('/etc/hostname')");
    no("SELECT * FROM glob('/etc/*')");
  });

  it('refuses anything that does not begin as a query', () => {
    no('EXPLAIN SELECT 1');
    no('SHOW TABLES');
    no('');
    no('   ');
  });

  it('caps length', () => {
    no('SELECT ' + '1,'.repeat(MAX_QUERY_LENGTH) + '1');
  });

  it('gives a reason, because a bare rejection sends people to the wrong problem', () => {
    const r = isReadOnlySql('DROP TABLE x');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/DROP/);
  });
});
