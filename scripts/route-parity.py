#!/usr/bin/env python3
"""Route parity: the same Lodestar API route answered by production (flags off, gateway) and by a local
build with the nest flags on. Structural diff: keys missing either side, and per-number relative deltas
above a tolerance. `source`, `provenance`, `asOf`, `cachedAt` style fields are ignored.

usage: route-parity.py http://localhost:3000 https://www.lodestar-dashboard.com /api/indexers /api/curators ...
"""
import json, sys, urllib.request, math
IGNORE = {"source", "provenance", "asOf", "as_of", "cachedAt", "fetchedAt", "generatedAt", "timestamp", "updatedAt"}
TOL = float(__import__("os").environ.get("TOL", "0.01"))

def get(base, path):
    req = urllib.request.Request(base + path, headers={"user-agent": "lodestar-parity/1"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.status, json.loads(r.read())

def num(x):
    if isinstance(x, bool): return None
    if isinstance(x, (int, float)): return float(x)
    if isinstance(x, str):
        try: return float(x)
        except ValueError: return None
    return None

def walk(a, b, path, out):
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)):
            if k in IGNORE: continue
            if k not in a: out.append(("missing-in-local", f"{path}.{k}")); continue
            if k not in b: out.append(("missing-in-prod", f"{path}.{k}")); continue
            walk(a[k], b[k], f"{path}.{k}", out)
    elif isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b): out.append(("length", f"{path}: prod={len(a)} local={len(b)}"))
        # align by id when present, else by position
        if a and isinstance(a[0], dict) and "id" in a[0]:
            bi = {str(x.get("id")).lower(): x for x in b if isinstance(x, dict)}
            for x in a:
                k = str(x.get("id")).lower()
                if k in bi: walk(x, bi[k], f"{path}[{k[:10]}]", out)
                else: out.append(("missing-in-local", f"{path}[{k[:10]}]"))
        else:
            for i, (x, y) in enumerate(zip(a, b)): walk(x, y, f"{path}[{i}]", out)
    else:
        na, nb = num(a), num(b)
        if na is not None and nb is not None:
            if na == nb: return
            denom = max(abs(na), abs(nb), 1e-18)
            rel = abs(na - nb) / denom
            if rel > TOL: out.append(("delta", f"{path}: prod={a} local={b} rel={rel:.4f}"))
        elif a != b:
            out.append(("value", f"{path}: prod={str(a)[:60]!r} local={str(b)[:60]!r}"))

local, prod, paths = sys.argv[1], sys.argv[2], sys.argv[3:]
worst = 0
for p in paths:
    try:
        sp, jp = get(prod, p)
    except Exception as e:
        print(f"{p}: PROD ERROR {e}"); worst = 2; continue
    try:
        sl, jl = get(local, p)
    except Exception as e:
        print(f"{p}: LOCAL ERROR {e}"); worst = 2; continue
    out = []
    walk(jp, jl, "", out)
    kinds = {}
    for k, _ in out: kinds[k] = kinds.get(k, 0) + 1
    print(f"{p}: prod {sp} local {sl} source={jl.get('source','-')} findings={len(out)} {kinds}")
    MAXL = int(__import__("os").environ.get("MAXL", "25"))
    for k, d in out[:MAXL]: print(f"   {k:16} {d}")
    if len(out) > MAXL: print(f"   ... {len(out)-MAXL} more")
    if out: worst = max(worst, 1)
sys.exit(worst)
