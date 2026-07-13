import json
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen


API = "https://api-publica.transferegov.gestao.gov.br/parcerias"
PAGE_SIZE = 200
OUT = Path("data/bootstrap.json")


def get(path, **params):
    query = urlencode({k: v for k, v in params.items() if v is not None})
    url = f"{API}{path}"
    if query:
        url = f"{url}?{query}"
    request = Request(
        url,
        headers={
            "Accept": "application/json",
            "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
            "User-Agent": "Mozilla/5.0 convenios-pe-dashboard/1.0",
        },
    )
    with urlopen(request, timeout=60) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_all(path, **params):
    first = get(path, **params, tamanho_da_pagina=PAGE_SIZE, pagina=1)
    rows = list(first.get("data") or [])
    for page in range(2, int(first.get("total_pages") or 1) + 1):
        print(f"{path}: pagina {page}/{first['total_pages']}")
        rows.extend(get(path, **params, tamanho_da_pagina=PAGE_SIZE, pagina=page).get("data") or [])
    return rows


def slim_proposal(item):
    keep = [
        "id_proposta",
        "id_programa",
        "cnpj_ente_recebedor",
        "nm_ente_recebedor",
        "nm_municipio_recebedor",
        "sg_uf_recebedor",
        "ds_objeto",
        "situacao_proposta",
        "vl_total_planejamento_gastos",
        "dt_proposta",
        "mes_proposta",
        "ano_proposta",
        "dt_limite_captacao",
        "categorias_despesa_proposta",
    ]
    return {key: item.get(key) for key in keep}


def slim_program(item):
    keep = ["id_programa", "nm_programa", "nm_ente_repassador"]
    return {key: item.get(key) for key in keep}


def main():
    update = get("/data-atualizacao")
    proposals = [slim_proposal(item) for item in fetch_all("/proposta", sg_uf_recebedor="PE")]
    program_ids = sorted({item["id_programa"] for item in proposals if item.get("id_programa")})
    programs = []
    for index, program_id in enumerate(program_ids, 1):
        print(f"/programa: {index}/{len(program_ids)}")
        data = get("/programa", id_programa=program_id, tamanho_da_pagina=1).get("data") or []
        if data:
            programs.append(slim_program(data[0]))

    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(
        json.dumps(
            {
                "data_ultima_atualizacao": update.get("data_ultima_atualizacao"),
                "proposals": proposals,
                "programs": programs,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )
    print(f"Arquivo gerado: {OUT} ({len(proposals)} propostas, {len(programs)} programas)")


if __name__ == "__main__":
    main()
