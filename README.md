# Painel de Convênios em Pernambuco

Painel estático que consulta a API pública do Transferegov.br para acompanhar propostas e parcerias com recebedor em Pernambuco.

## Como abrir

Rode o servidor local com proxy para a API:

```powershell
python server.py
```

Depois acesse:

```text
http://localhost:8000
```

## Fonte de dados

- API principal: `https://api-publica.transferegov.gestao.gov.br/parcerias`
- Base inicial: `/proposta?sg_uf_recebedor=PE`
- Enriquecimento: `/programa?id_programa=...`
- Emendas sob demanda: `/distribuicao-recurso-proposta?id_proposta=...`

O painel carrega os dados ao vivo, aplica filtros no navegador e permite exportar a base filtrada em CSV.

## Deploy na Vercel

Este projeto pode ser publicado na Vercel como aplicação estática com função serverless Python.

Arquivos importantes:

- `index.html`, `styles.css` e `app.js`: frontend estático.
- `api/proxy.py`: proxy serverless para evitar bloqueio de CORS da API pública.
- `server.py`: apenas para rodar localmente.

Na Vercel, o frontend chama `/api/proxy?path=/parcerias/...`, e a função encaminha a requisição para o Transferegov.
