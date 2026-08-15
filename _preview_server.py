import http.server
import socketserver

PORT = 5173


class Handler(http.server.SimpleHTTPRequestHandler):
    def guess_type(self, path):
        if path.endswith(".jsx") or path.endswith(".js"):
            return "application/javascript"
        return super().guess_type(path)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()


with socketserver.TCPServer(("", PORT), Handler) as httpd:
    print(f"Serving at http://localhost:{PORT}")
    httpd.serve_forever()
