# Route parity: flag-on against production

Before a `NUTHATCH_*` flag goes on in Vercel, run the route it gates from a local build with the flag
on and diff the answer against production, which still answers from the gateway. This is how the
nuthatch#1160 migration was checked; in one afternoon it found sixteen defects that the unit tests,
the view checker and the contract parity had all passed.

```sh
# 1. the staging nests, over ssh, and a stand-in for the box's Caddy routing /alloc and /gns
ssh -N -L 18107:localhost:8107 -L 18113:localhost:8113 root@<box> &
python3 scripts/two-nest-proxy.py 18100 18107 18113 &

# 2. a local Lodestar with the flags on, pointed at the proxy, touching no shared state
vercel env pull .env.parity --environment=production      # gitignored
set -a; . ./.env.parity; set +a
export NUTHATCH_URL=http://127.0.0.1:18100; unset NUTHATCH_USER NUTHATCH_PASSWORD DATABASE_URL REDIS_URL
export NUTHATCH_INDEXERS=true NUTHATCH_NETWORK=true ...    # the flags under test
npx next dev -p 3111

# 3. the diff: keys missing either side, numbers beyond TOL relative, list items aligned by `id`
TOL=0.001 MAXL=100000 python3 scripts/route-parity.py http://localhost:3111 https://www.lodestar-dashboard.com \
  /api/network-stats /api/indexers "/api/indexer/0x…" ...
```

Two things that cost an hour each:

- `lib/cache.ts` falls back to an in-memory cache with no Redis and serves stale for four times the
  TTL. After changing a view, restart the local server before measuring, or the old answer comes back.
- Run at a loose tolerance (`TOL=0.05`) while a nest is still backfilling: that catches shape and
  key problems, and the figures only mean something once the nest reports the same tip as the
  gateway.

A difference is not a defect until it has been run down to a contract call or the subgraph's own
mapping. Several of the day's findings were the subgraph being inconsistent with itself, and parity
with production meant reproducing the quirk.
