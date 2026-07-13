from http.server import BaseHTTPRequestHandler
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, urlencode, urlsplit
from urllib.request import Request, urlopen


UPSTREAM = "https://api-publica.transferegov.gestao.gov.br"


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        split = urlsplit(self.path)
        query = dict(parse_qsl(split.query, keep_blank_values=True))
        api_path = query.pop("path", "")

        if not api_path.startswith("/"):
            api_path = f"/{api_path}"

        if not api_path.startswith("/parcerias/") and api_path != "/parcerias":
            self.send_response(400)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.end_headers()
            self.wfile.write(b"Caminho de API nao permitido.")
            return

        upstream_url = f"{UPSTREAM}{api_path}"
        if query:
            upstream_url = f"{upstream_url}?{urlencode(query)}"

        request = Request(upstream_url, headers={"User-Agent": "convenios-pe-dashboard/1.0"})
        try:
            with urlopen(request, timeout=60) as response:
                body = response.read()
                self.send_response(response.status)
                self.send_header("Content-Type", response.headers.get("Content-Type", "application/json"))
                self.send_header("Cache-Control", "s-maxage=300, stale-while-revalidate=600")
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
