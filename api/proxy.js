const UPSTREAM = "https://api-publica.transferegov.gestao.gov.br";

export default async function handler(request, response) {
  const { path, ...params } = request.query;
  const apiPath = Array.isArray(path) ? path[0] : path;

  if (!apiPath || (!apiPath.startsWith("/parcerias/") && apiPath !== "/parcerias")) {
    response.status(400).send("Caminho de API nao permitido.");
    return;
  }

  const url = new URL(`${UPSTREAM}${apiPath}`);
  Object.entries(params).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((item) => url.searchParams.append(key, item));
    } else if (value !== undefined) {
      url.searchParams.set(key, value);
    }
  });

  try {
    const upstream = await fetch(url, {
      headers: { "user-agent": "convenios-pe-dashboard/1.0" },
    });
    const body = await upstream.text();
    response.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json; charset=utf-8");
    response.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    response.status(upstream.status).send(body);
  } catch (error) {
    response.status(502).send(error instanceof Error ? error.message : "Erro ao consultar API.");
  }
}
