#!/usr/bin/env python3
"""A stand-in for the box's Caddy, for a local Lodestar parity run: /alloc/* goes to one nest and /gns/*
to another, both reached over ssh tunnels. No auth, no TLS, loopback only. Everything else is 404.

usage: two-nest-proxy.py <listen-port> <alloc-upstream-port> <gns-upstream-port>
"""
import sys, http.server, urllib.request, urllib.error, socketserver

LISTEN, ALLOC, GNS = int(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3])
ROUTES = {"/alloc": ALLOC, "/gns": GNS}


class H(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _route(self):
        for prefix, port in ROUTES.items():
            if self.path == prefix or self.path.startswith(prefix + "/") or self.path.startswith(prefix + "?"):
                rest = self.path[len(prefix):] or "/"
                if not rest.startswith("/"):
                    rest = "/" + rest
                return f"http://127.0.0.1:{port}{rest}"
        return None

    def _relay(self, body=None):
        target = self._route()
        if not target:
            self.send_response(404); self.send_header("content-length", "0"); self.end_headers(); return
        headers = {k: v for k, v in self.headers.items() if k.lower() not in ("host", "connection", "content-length", "authorization")}
        req = urllib.request.Request(target, data=body, method=self.command, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=600) as r:
                data = r.read()
                self.send_response(r.status)
                for k, v in r.getheaders():
                    if k.lower() not in ("transfer-encoding", "connection", "content-length"):
                        self.send_header(k, v)
                self.send_header("content-length", str(len(data))); self.end_headers(); self.wfile.write(data)
        except urllib.error.HTTPError as e:
            data = e.read()
            self.send_response(e.code)
            self.send_header("content-type", e.headers.get("content-type", "application/json"))
            self.send_header("content-length", str(len(data))); self.end_headers(); self.wfile.write(data)
        except Exception as e:  # tunnel down, upstream gone
            data = f'{{"error":"proxy: {type(e).__name__}: {e}"}}'.encode()
            self.send_response(502); self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(data))); self.end_headers(); self.wfile.write(data)

    def do_GET(self):
        self._relay()

    def do_POST(self):
        n = int(self.headers.get("content-length") or 0)
        self._relay(self.rfile.read(n) if n else None)

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.command, self.path[:120]))


class TS(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


print(f"two-nest-proxy on 127.0.0.1:{LISTEN}: /alloc -> {ALLOC}, /gns -> {GNS}", flush=True)
TS(("127.0.0.1", LISTEN), H).serve_forever()
