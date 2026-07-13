from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, urlencode, urlsplit
from urllib.request import Request, urlopen


UPSTREAM = "https://api-publica.transferegov.gestao.gov.br"


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/api/proxy"):
            self.proxy_vercel_style()
            return
        if self.path.startswith("/api/"):
            self.proxy_api()
            return
        super().do_GET()

    def proxy_vercel_style(self):
        split = urlsplit(self.path)
        query = dict(parse_qsl(split.query, keep_blank_values=True))
        api_path = query.pop("path", "")
        if not api_path.startswith("/"):
            api_path = f"/{api_path}"
        query_string = urlencode(query)
        self.fetch_upstream(api_path, query_string)

    def proxy_api(self):
        split = urlsplit(self.path)
        upstream_path = split.path.removeprefix("/api")
        self.fetch_upstream(upstream_path, split.query)

    def fetch_upstream(self, upstream_path, query_string):
        url = f"{UPSTREAM}{upstream_path}"
        if query_string:
            url = f"{url}?{query_string}"
        request = Request(url, headers={"User-Agent": "convenios-pe-dashboard/1.0"})
        try:
            with urlopen(request, timeout=60) as response:
                body = response.read()
                self.send_response(response.status)
                self.send_header("Content-Type", response.headers.get("Content-Type", "application/json"))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(body)
        except HTTPError as error:
            body = error.read()
            self.send_response(error.code)
            self.send_header("Content-Type", error.headers.get("Content-Type", "application/json"))
            self.end_headers()
            self.wfile.write(body)
        except URLError as error:
            body = str(error.reason).encode("utf-8")
            self.send_response(502)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.end_headers()
            self.wfile.write(body)


if __name__ == "__main__":
    server = ThreadingHTTPServer(("localhost", 8000), Handler)
    print("Painel disponível em http://localhost:8000")
    server.serve_forever()
