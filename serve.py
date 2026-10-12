#!/usr/bin/env python3
"""Dev server for System32: python3 serve.py [port]   (default 8000, bound to 127.0.0.1)

Why not plain `python3 -m http.server`? Games run in sandboxed iframes without allow-same-origin, so their origin is
opaque and every request they make for a module script or a fetch() is cross-origin. Those only work if the server
answers with Access-Control-Allow-Origin (GitHub Pages does; http.server does not). This adds that header, and
Cache-Control: no-store so edits always reload. Development only. Standard library only.
"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
HOST = '127.0.0.1'


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        '.js': 'text/javascript', '.mjs': 'text/javascript',
        '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
        '.wasm': 'application/wasm', '.bin': 'application/octet-stream',
    }

    def end_headers(self):                       # every response: 200, 304, errors, OPTIONS
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', self.headers.get('Access-Control-Request-Headers', '*'))
        self.send_header('Access-Control-Max-Age', '600')
        self.end_headers()


def main(argv):
    try:
        port = int(argv[1]) if len(argv) > 1 else 8000
        if not 0 < port < 65536:
            raise ValueError
    except ValueError:
        sys.exit('usage: python3 serve.py [port]')
    try:
        server = ThreadingHTTPServer((HOST, port), partial(Handler, directory=str(ROOT)))
    except OSError as e:
        sys.exit(f'cannot listen on {HOST}:{port}: {e.strerror}')
    print(f'System32 dev server: http://{HOST}:{port}/   (CORS on, no-store; Ctrl+C to stop)', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nbye')
    finally:
        server.server_close()


if __name__ == '__main__':
    main(sys.argv)
