const API = "/api/proxy";
const PAGE_SIZE = 200;
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const number = new Intl.NumberFormat("pt-BR");
const state = { proposals: [], programs: new Map(), enriched: [], filtered: [], charts: {}, amendmentsLoaded: false };

const $ = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", () => {
  lucide.createIcons();
  bindEvents();
  loadDashboard();
});

function bindEvents() {
  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  });
  ["yearFilter", "statusFilter", "cityFilter", "searchFilter"].forEach((id) => {
    $(id).addEventListener("input", applyFilters);
  });
  $("refreshBtn").addEventListener("click", () => loadDashboard(true));
  $("exportBtn").addEventListener("click", exportCsv);
  $("loadAmendmentsBtn").addEventListener("click", loadAmendments);
}

async function loadDashboard(force = false) {
  $("loadingState").hidden = false;
  $("errorState").hidden = true;
  $("dashboard").hidden = true;
  $("loadingText").textContent = "Consultando data de atualização...";

  try {
    if (!state.proposals.length || force) {
      state.amendmentsLoaded = false;
      state.programs.clear();
      const update = await apiGet("/data-atualizacao");
      $("updatedAt").textContent = `Atualizado em ${formatDate(update.data_ultima_atualizacao)}`;
      state.proposals = await fetchAll("/proposta", { sg_uf_recebedor: "PE" });
      state.enriched = state.proposals.map((proposal) => ({ ...proposal, program: null }));
      enrichPrograms().then(() => {
        applyFilters();
      }).catch((error) => console.warn("Programas não carregados", error));
    }
    fillFilters();
    applyFilters();
    $("loadingState").hidden = true;
    $("dashboard").hidden = false;
  } catch (error) {
    console.error(error);
    $("apiErrorMessage").textContent = error.message || "Erro desconhecido ao consultar a API.";
    $("loadingState").hidden = true;
    $("errorState").hidden = false;
  }
}

async function fetchAll(path, params = {}) {
  const first = await apiGet(path, { ...params, tamanho_da_pagina: PAGE_SIZE, pagina: 1 });
  const rows = [...(first.data || [])];
  const totalPages = first.total_pages || 1;
  const pages = Array.from({ length: Math.max(0, totalPages - 1) }, (_, index) => index + 2);
  for (let index = 0; index < pages.length; index += 6) {
    const chunk = pages.slice(index, index + 6);
    $("loadingText").textContent = `Carregando ${path.replace("/", "")}: páginas ${chunk[0]}-${chunk[chunk.length - 1]} de ${totalPages}`;
    const results = await Promise.all(chunk.map((page) => apiGet(path, { ...params, tamanho_da_pagina: PAGE_SIZE, pagina: page })));
    results.forEach((next) => rows.push(...(next.data || [])));
  }
  return rows;
}

async function apiGet(path, params = {}) {
  const url = new URL(API, window.location.origin);
  url.searchParams.set("path", `/parcerias${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
  });
  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${response.status} em ${url.pathname}: ${body.slice(0, 240) || response.statusText}`);
  }
  return fixEncoding(await response.json());
}

async function enrichPrograms() {
  $("loadingText").textContent = "Relacionando propostas com programas...";
  const ids = [...new Set(state.proposals.map((item) => item.id_programa).filter(Boolean))];
  for (let index = 0; index < ids.length; index += 8) {
    const chunk = ids.slice(index, index + 8);
    const results = await Promise.all(chunk.map((id) => apiGet("/programa", { id_programa: id, tamanho_da_pagina: 1 }).catch(() => null)));
    results.forEach((result) => {
      const program = result?.data?.[0];
      if (program) state.programs.set(program.id_programa, program);
    });
  }
  state.enriched = state.proposals.map((proposal) => ({ ...proposal, program: state.programs.get(proposal.id_programa) || null }));
}

function fillFilters() {
  setOptions("yearFilter", ["Todos", ...sortAsc(unique(state.enriched.map((x) => x.ano_proposta).filter(Boolean)))]);
  setOptions("statusFilter", ["Todas", ...sortAsc(unique(state.enriched.map((x) => x.situacao_proposta).filter(Boolean)))]);
  setOptions("cityFilter", ["Todos", ...sortAsc(unique(state.enriched.map((x) => x.nm_municipio_recebedor).filter(Boolean)))]);
}

function setOptions(id, options) {
  const current = $(id).value;
  $(id).innerHTML = options.map((option) => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`).join("");
  if (options.map(String).includes(current)) $(id).value = current;
}

function applyFilters() {
  const year = $("yearFilter").value;
  const status = $("statusFilter").value;
  const city = $("cityFilter").value;
  const search = normalize($("searchFilter").value);
  state.filtered = state.enriched.filter((item) => {
    const haystack = normalize([item.ds_objeto, item.nm_ente_recebedor, item.cnpj_ente_recebedor, item.nm_municipio_recebedor, item.program?.nm_programa].join(" "));
    return (year === "Todos" || String(item.ano_proposta) === year)
      && (status === "Todas" || item.situacao_proposta === status)
      && (city === "Todos" || item.nm_municipio_recebedor === city)
      && (!search || haystack.includes(search));
  });
  renderAll();
}

function renderAll() {
  renderOverview();
  renderTerritory();
  renderFinance();
  renderPrograms();
  renderRisks();
  renderDetails();
}

function renderOverview() {
  const total = state.filtered.length;
  const planned = sum(state.filtered, "vl_total_planejamento_gastos");
  const approved = state.filtered.filter((x) => x.situacao_proposta === "Aprovada").length;
  $("kpiProposals").textContent = number.format(total);
  $("kpiFiltered").textContent = `${number.format(state.enriched.length)} na base PE`;
  $("kpiPlanned").textContent = money.format(planned);
  $("kpiApproved").textContent = number.format(approved);
  $("kpiApprovedShare").textContent = total ? `${Math.round((approved / total) * 100)}% do filtro` : "-";
  $("kpiCities").textContent = number.format(unique(state.filtered.map((x) => x.nm_municipio_recebedor)).length);

  drawChart("yearChart", "bar", groupBy(state.filtered, "ano_proposta", "vl_total_planejamento_gastos", true), { label: "Valor planejado" });
  drawChart("statusChart", "doughnut", groupBy(state.filtered, "situacao_proposta", null, false), { label: "Propostas", currency: false });
  renderRows("latestRows", state.filtered.slice().sort((a, b) => String(b.dt_proposta).localeCompare(String(a.dt_proposta))).slice(0, 12), (x) =>
    `<tr><td>${formatDate(x.dt_proposta)}</td><td>${escapeHtml(x.nm_municipio_recebedor)}</td><td>${escapeHtml(x.nm_ente_recebedor)}</td><td>${pill(x.situacao_proposta)}</td><td>${money.format(toNumber(x.vl_total_planejamento_gastos))}</td></tr>`);
}

function renderTerritory() {
  const cityData = groupObjects(state.filtered, "nm_municipio_recebedor", "vl_total_planejamento_gastos").slice(0, 20);
  drawChart("cityChart", "bar", cityData, { label: "Valor planejado", horizontal: true });
  const max = cityData[0]?.value || 1;
  $("territoryHint").textContent = `${number.format(cityData.length)} maiores municípios`;
  $("territoryMap").innerHTML = cityData.map((city) => {
    const intensity = Math.max(0.28, city.value / max);
    const bg = `rgba(31, 122, 92, ${intensity})`;
    return `<div class="city-tile" style="background:${bg}" title="${escapeHtml(city.label)}"><strong>${escapeHtml(city.label)}</strong><span>${money.format(city.value)}</span><span>${number.format(city.count)} propostas</span></div>`;
  }).join("");
}

function renderFinance() {
  const categories = [];
  state.filtered.forEach((proposal) => {
    (proposal.categorias_despesa_proposta || []).forEach((category) => {
      categories.push({ label: category.categoria_despesa_proposta || "Não informado", value: toNumber(proposal.vl_total_planejamento_gastos) });
    });
  });
  drawChart("categoryChart", "doughnut", groupArray(categories), { label: "Valor" });
  drawChart("monthChart", "line", groupByMonth(state.filtered), { label: "Valor planejado" });
  renderRows("valueRows", state.filtered.slice().sort((a, b) => toNumber(b.vl_total_planejamento_gastos) - toNumber(a.vl_total_planejamento_gastos)).slice(0, 20), (x) =>
    `<tr><td>${escapeHtml(x.nm_municipio_recebedor)}</td><td>${escapeHtml(x.nm_ente_recebedor)}</td><td>${escapeHtml(shorten(x.ds_objeto, 90))}</td><td>${pill(x.situacao_proposta)}</td><td>${money.format(toNumber(x.vl_total_planejamento_gastos))}</td></tr>`);
}

async function loadAmendments() {
  if (state.amendmentsLoaded) return;
  $("amendmentRows").innerHTML = `<tr><td colspan="5">Carregando emendas das propostas filtradas...</td></tr>`;
  const sample = state.filtered.slice(0, 700);
  const rows = [];
  for (let index = 0; index < sample.length; index += 10) {
    const chunk = sample.slice(index, index + 10);
    const results = await Promise.all(chunk.map((item) => apiGet("/distribuicao-recurso-proposta", { id_proposta: item.id_proposta, tamanho_da_pagina: 50 }).catch(() => null)));
    results.forEach((result) => rows.push(...(result?.data || [])));
  }
  const grouped = groupCustom(rows, (x) => `${x.nm_parlamentar_proposta || "Não informado"}|${x.in_tipo_emenda_parlamentar_proposta || "Não informado"}|${x.nr_emenda_proposta || "-"}`, "valor_emenda");
  $("amendmentSummary").innerHTML = [
    mini("Registros", number.format(rows.length)),
    mini("Valor identificado", money.format(sum(rows, "valor_emenda"))),
    mini("Amostra", `${number.format(sample.length)} propostas`)
  ].join("");
  renderRows("amendmentRows", grouped.slice(0, 80), (x) => {
    const [parlamentar, tipo, emenda] = x.label.split("|");
    return `<tr><td>${escapeHtml(parlamentar)}</td><td>${escapeHtml(tipo)}</td><td>${escapeHtml(emenda)}</td><td>${number.format(x.count)}</td><td>${money.format(x.value)}</td></tr>`;
  });
  state.amendmentsLoaded = true;
}

function renderPrograms() {
  const programs = groupCustom(state.filtered, (x) => x.program?.nm_programa || `Programa ${x.id_programa}`, "vl_total_planejamento_gastos").slice(0, 15);
  drawChart("programChart", "bar", programs, { label: "Valor planejado", horizontal: true });
  const agencies = groupCustom(state.filtered, (x) => x.program?.nm_ente_repassador || "Não informado", "vl_total_planejamento_gastos").slice(0, 12);
  const max = agencies[0]?.value || 1;
  $("agencyList").innerHTML = agencies.map((item) =>
    `<div class="rank-item"><strong>${escapeHtml(item.label)}</strong><span>${money.format(item.value)}</span><div class="rank-bar"><span style="width:${Math.max(4, item.value / max * 100)}%"></span></div></div>`).join("");
}

function renderRisks() {
  const today = new Date();
  const in60 = new Date(today.getTime() + 60 * 24 * 60 * 60 * 1000);
  const noValue = state.filtered.filter((x) => !toNumber(x.vl_total_planejamento_gastos));
  const analysis = state.filtered.filter((x) => ["Em Análise", "Em Elaboração"].includes(x.situacao_proposta));
  const rejected = state.filtered.filter((x) => ["Rejeitada", "Inativada"].includes(x.situacao_proposta));
  const deadline = state.filtered.filter((x) => x.dt_limite_captacao && new Date(x.dt_limite_captacao) <= in60);
  $("riskAnalysis").textContent = number.format(analysis.length);
  $("riskNoValue").textContent = number.format(noValue.length);
  $("riskRejected").textContent = number.format(rejected.length);
  $("riskDeadline").textContent = number.format(deadline.length);
  const risks = [
    ...analysis.map((x) => ({ ...x, reason: "Situação pendente" })),
    ...noValue.map((x) => ({ ...x, reason: "Sem valor planejado" })),
    ...rejected.map((x) => ({ ...x, reason: "Rejeitada ou inativada" })),
    ...deadline.map((x) => ({ ...x, reason: "Prazo próximo" })),
  ].slice(0, 60);
  renderRows("riskRows", risks, (x) =>
    `<tr><td>${escapeHtml(x.nm_municipio_recebedor)}</td><td>${escapeHtml(x.nm_ente_recebedor)}</td><td>${pill(x.situacao_proposta)}</td><td>${formatDate(x.dt_limite_captacao)}</td><td>${escapeHtml(x.reason)}</td></tr>`);
}

function renderDetails() {
  $("tableCount").textContent = `${number.format(state.filtered.length)} registros`;
  renderRows("detailRows", state.filtered.slice(0, 500), (x) =>
    `<tr><td>${x.id_proposta}</td><td>${x.ano_proposta || "-"}</td><td>${escapeHtml(x.nm_municipio_recebedor)}</td><td>${escapeHtml(x.nm_ente_recebedor)}</td><td>${escapeHtml(shorten(x.ds_objeto, 110))}</td><td>${escapeHtml(shorten(x.program?.nm_programa || "-", 90))}</td><td>${pill(x.situacao_proposta)}</td><td>${money.format(toNumber(x.vl_total_planejamento_gastos))}</td></tr>`);
}

function drawChart(id, type, data, options = {}) {
  const ctx = $(id);
  if (state.charts[id]) state.charts[id].destroy();
  const chartType = options.horizontal ? "bar" : type;
  state.charts[id] = new Chart(ctx, {
    type: chartType,
    data: {
      labels: data.map((x) => x.label),
      datasets: [{
        label: options.label || "Total",
        data: data.map((x) => x.value),
        backgroundColor: ["#1f7a5c", "#2f6f9f", "#b28322", "#7f6a9f", "#b64b45", "#4b7d80", "#667244"],
        borderColor: "#1f7a5c",
        borderWidth: type === "line" ? 2 : 0,
        tension: 0.32,
        fill: type === "line"
      }]
    },
    options: {
      indexAxis: options.horizontal ? "y" : "x",
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: type !== "bar" }, tooltip: { callbacks: { label: (item) => `${item.dataset.label}: ${options.currency === false ? number.format(item.raw) : money.format(item.raw)}` } } },
      scales: type === "doughnut" ? {} : { y: { beginAtZero: true, ticks: { callback: compactNumber } }, x: { ticks: { autoSkip: false, maxRotation: 0 } } }
    }
  });
}

function switchTab(tab) {
  document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("is-active", x.dataset.tab === tab));
  document.querySelectorAll(".panel").forEach((x) => x.classList.toggle("is-active", x.dataset.panel === tab));
}

function exportCsv() {
  const header = ["id_proposta", "ano", "municipio", "recebedor", "cnpj", "situacao", "valor", "programa", "objeto"];
  const lines = state.filtered.map((x) => [x.id_proposta, x.ano_proposta, x.nm_municipio_recebedor, x.nm_ente_recebedor, x.cnpj_ente_recebedor, x.situacao_proposta, toNumber(x.vl_total_planejamento_gastos), x.program?.nm_programa || "", x.ds_objeto || ""]);
  const csv = [header, ...lines].map((row) => row.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(";")).join("\n");
  const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "convenios-pe-transferegov.csv";
  link.click();
  URL.revokeObjectURL(link.href);
}

function renderRows(id, rows, mapper) {
  $(id).innerHTML = rows.length ? rows.map(mapper).join("") : `<tr><td colspan="8">Nenhum registro para o filtro atual.</td></tr>`;
}
function fixEncoding(value) {
  if (typeof value === "string") return fixText(value);
  if (Array.isArray(value)) return value.map(fixEncoding);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fixEncoding(item)]));
  }
  return value;
}
function fixText(value) {
  const looksBroken = /Ã[\u0080-\u00bf]|Â[\u0080-\u00bf]|â[\u0080-\u00bf]|Â[ºª°]/.test(value);
  if (!looksBroken) return value;
  try {
    const bytes = Uint8Array.from([...value].map((char) => char.charCodeAt(0) & 0xff));
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return value;
  }
}
function groupBy(items, key, valueKey, sumValues) {
  return Object.values(items.reduce((acc, item) => {
    const label = item[key] || "Não informado";
    acc[label] ||= { label: String(label), value: 0, count: 0 };
    acc[label].count += 1;
    acc[label].value += sumValues ? toNumber(item[valueKey]) : 1;
    return acc;
  }, {})).sort((a, b) => String(a.label).localeCompare(String(b.label), "pt-BR"));
}
function groupByMonth(items) {
  return groupCustom(items, (x) => `${x.ano_proposta || "-"}-${String(x.mes_proposta || 0).padStart(2, "0")}`, "vl_total_planejamento_gastos")
    .sort((a, b) => a.label.localeCompare(b.label));
}
function groupObjects(items, key, valueKey) { return groupCustom(items, (x) => x[key] || "Não informado", valueKey); }
function groupArray(items) { return groupCustom(items, (x) => x.label, "value"); }
function groupCustom(items, labelFn, valueKey) {
  return Object.values(items.reduce((acc, item) => {
    const label = labelFn(item);
    acc[label] ||= { label, value: 0, count: 0 };
    acc[label].count += 1;
    acc[label].value += toNumber(item[valueKey]);
    return acc;
  }, {})).sort((a, b) => b.value - a.value);
}
function sum(items, key) { return items.reduce((total, item) => total + toNumber(item[key]), 0); }
function unique(items) { return [...new Set(items.filter(Boolean))]; }
function sortAsc(items) { return items.slice().sort((a, b) => String(a).localeCompare(String(b), "pt-BR")); }
function toNumber(value) { return Number(value || 0); }
function normalize(value) { return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }
function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}
function compactNumber(value) {
  if (value >= 1_000_000_000) return `${Math.round(value / 1_000_000_000)} bi`;
  if (value >= 1_000_000) return `${Math.round(value / 1_000_000)} mi`;
  if (value >= 1_000) return `${Math.round(value / 1_000)} mil`;
  return value;
}
function pill(value) { return `<span class="status-pill">${escapeHtml(value || "-")}</span>`; }
function mini(label, value) { return `<div class="mini-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`; }
function shorten(value, size) { const text = String(value || "-"); return text.length > size ? `${text.slice(0, size - 1)}...` : text; }
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}
