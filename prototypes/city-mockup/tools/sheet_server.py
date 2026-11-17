"""Serve the contact-sheet page and save each sheet it POSTs back. Exits after `expected` sheets or the deadline."""
import functools, http.server, pathlib, sys, time, urllib.parse

root, out, expected, deadline = sys.argv[1], pathlib.Path(sys.argv[2]), int(sys.argv[3]), time.time() + int(sys.argv[4])
saved = []

class Handler(http.server.SimpleHTTPRequestHandler):
    def do_POST(self):
        name = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)["name"][0]
        body = self.rfile.read(int(self.headers["Content-Length"]))
        filename = pathlib.Path(name).name
        (out / (filename if "." in filename else f"{filename}.png")).write_bytes(body)
        saved.append(name)
        print(f"saved {name} ({len(body)} bytes)", flush=True)
        self.send_response(204)
        self.end_headers()

    def log_message(self, *args):
        pass

server = http.server.HTTPServer(("127.0.0.1", 8765), functools.partial(Handler, directory=root))
server.timeout = 1
while len(saved) < expected and time.time() < deadline:
    server.handle_request()
print(f"done: {len(saved)}/{expected}", flush=True)
