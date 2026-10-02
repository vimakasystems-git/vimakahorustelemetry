'use strict';
const $ = id => document.getElementById(id);
let token = '';
let controller;
let revision = 0;
const number = value => value === null || value === undefined ? '\u2014' : new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(value);
const node = (tag, text, className) => { const el = document.createElement(tag); el.textContent = text; if (className) el.className = className; return el; };

async function request(path, signal) {
  const response = await fetch(path, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal });
  if (!response.ok) throw new Error(response.status === 401 ? 'Chave invalida.' : response.status === 503 ? 'Prometheus indisponivel. Os indicadores anteriores nao sao atuais.' : `Consulta recusada (HTTP ${response.status}).`);
  return response.json();
}

function clearReport() {
  for (const id of ['sli', 'latency', 'burn']) $(id).textContent = '\u2014';
  $('budget').textContent = 'Sem dados suficientes na janela selecionada.';
  $('findings').replaceChildren(node('p', 'Sem dados suficientes para analisar.'));
  $('queries').replaceChildren(node('p', 'Nenhuma consulta de diagnostico disponivel.'));
}

async function refresh() {
  if (!token) return;
  const version = ++revision;
  controller?.abort();
  controller = new AbortController();
  const signal = controller.signal;
  $('status').textContent = 'Consultando a telemetria...';
  $('status').dataset.error = 'false';
  $('refresh').disabled = true;
  const window = $('window').value;
  try {
    const [inventory, graph] = await Promise.all([
      request(`/api/v1/services?window=${window}`, signal),
      request(`/api/v1/topology?window=${window}`, signal)
    ]);
    if (version !== revision) return;
    const selected = $('service').value;
    $('service').replaceChildren(...inventory.services.map(s => { const option = node('option', s.name); option.value = s.name; return option; }));
    if (inventory.services.some(s => s.name === selected)) $('service').value = selected;
    $('service-count').textContent = number(inventory.services.length);
    $('services-body').replaceChildren(...inventory.services.map(s => { const row = node('tr', ''); row.append(node('td', s.name), node('td', number(s.requests))); return row; }));
    $('edges').replaceChildren(...(graph.edges.length ? graph.edges.map(e => { const row = node('div', '', 'edge'); row.append(node('strong', `${e.from} \u2192 ${e.to}`), node('span', `${number(e.requestsPerSecond)} req/s`)); return row; }) : [node('p', 'Nenhuma conexao observada nesta janela. Confira a instrumentacao client/server.', 'muted')]));
    clearReport();
    if ($('service').value) {
      const query = new URLSearchParams({ service: $('service').value, window, target: $('target').value });
      const report = await request(`/api/v1/diagnostics?${query}`, signal);
      if (version !== revision) return;
      $('sli').textContent = report.slo.sli === null ? 'Sem dados' : `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 }).format(report.slo.sli * 100)}%`;
      $('latency').textContent = report.p95Seconds === null ? '\u2014' : `${number(report.p95Seconds * 1000)} ms`;
      $('burn').textContent = report.slo.burnRate === null ? '\u2014' : `${number(report.slo.burnRate)}x`;
      const labels = { no_data: 'Sem dados', inconsistent_data: 'Dados inconsistentes', breached: 'Meta violada', within_target: 'Dentro da meta observada' };
      $('budget').textContent = `${labels[report.slo.status]} | Orcamento restante: ${number(report.slo.budgetRemaining)} requisicoes estimadas.`;
      $('findings').replaceChildren(...(report.findings.length ? report.findings.map(f => node('p', `${f.text} Evidencias: ${f.evidence.join(', ')}.`)) : [node('p', 'Nenhum limiar desta analise foi violado. Isto nao exclui falhas nao instrumentadas.')]), ...report.recommendations.map(r => node('p', r, 'muted')));
      $('queries').replaceChildren(...report.evidence.map(e => { const detail = node('details', ''); detail.append(node('summary', `${e.id}: ${number(e.value)} | ${e.queriedAt}`), node('pre', e.query)); return detail; }));
    }
    $('status').textContent = `Ultima consulta: ${new Date(inventory.observedAt).toLocaleString('pt-BR')} | Fonte: Prometheus | ${inventory.services.length ? 'Dados observados' : 'Sem dados; gere trafego e confira o Collector'}`;
  } catch (error) {
    if (error.name === 'AbortError' || version !== revision) return;
    clearReport();
    $('service-count').textContent = '\u2014';
    $('services-body').replaceChildren();
    $('edges').textContent = 'Dados indisponiveis.';
    $('status').textContent = error.message;
    $('status').dataset.error = 'true';
  } finally { if (version === revision) $('refresh').disabled = false; }
}

$('connect').addEventListener('submit', event => { event.preventDefault(); token = $('token').value; $('token').value = ''; refresh(); });
$('refresh').addEventListener('click', refresh);
for (const id of ['service', 'window', 'target']) $(id).addEventListener('change', refresh);
