export const WINDOWS = Object.freeze(['5m', '30m', '1h', '6h', '24h']);
export const COUNTER = 'traces_span_metrics_calls_total';

export class InputError extends Error {}

export function parameters(search) {
  const window = search.get('window') ?? '30m';
  const service = search.get('service');
  const target = Number(search.get('target') ?? '0.999');
  if (!WINDOWS.includes(window)) throw new InputError('Janela invalida.');
  if (service !== null && !/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$/.test(service)) {
    throw new InputError('Nome de servico invalido.');
  }
  if (!Number.isFinite(target) || target < 0.9 || target >= 1) {
    throw new InputError('A meta deve ser >= 0.9 e < 1.');
  }
  return { service, window, target };
}

export function queries({ service, window }) {
  const match = `service_name=${JSON.stringify(service)},span_kind="SPAN_KIND_SERVER"`;
  return {
    total: `sum(increase(${COUNTER}{${match}}[${window}]))`,
    errors: `sum(increase(${COUNTER}{${match},status_code="STATUS_CODE_ERROR"}[${window}]))`,
    p95: `histogram_quantile(0.95, sum by (le) (rate(traces_span_metrics_duration_seconds_bucket{${match}}[${window}])))`
  };
}

export function scalar(rows) {
  if (!rows.length) return null;
  const value = Number(rows[0].value[1]);
  return Number.isFinite(value) ? value : null;
}

export function calculateSlo(total, errors, target) {
  if (!Number.isFinite(target) || target <= 0 || target >= 1) throw new InputError('Meta invalida.');
  if (total !== null && (!Number.isFinite(total) || total < 0)) throw new InputError('Contagem invalida.');
  if (errors !== null && (!Number.isFinite(errors) || errors < 0 || (total !== null && errors > total))) {
    return { status: 'inconsistent_data', target, sli: null, burnRate: null, budgetRemaining: null };
  }
  if (total === null || total === 0) {
    return { status: 'no_data', target, sli: null, burnRate: null, budgetRemaining: null };
  }
  // An empty successful error-series query means zero observed errors, not a backend failure.
  const bad = errors ?? 0;
  const allowance = total * (1 - target);
  return {
    status: bad > allowance ? 'breached' : 'within_target', target,
    sli: 1 - bad / total, burnRate: (bad / total) / (1 - target),
    budgetRemaining: allowance - bad, budgetAllowed: allowance, total, errors: bad
  };
}

export function diagnose(report) {
  const findings = [];
  if (report.slo.status === 'no_data' || report.slo.status === 'inconsistent_data') {
    findings.push({ type: 'coverage', evidence: ['total', 'errors'], text: 'Dados insuficientes ou inconsistentes; nao e possivel afirmar saude.' });
  } else if (report.slo.status === 'breached') {
    findings.push({ type: 'error_budget', evidence: ['total', 'errors'], text: 'Erros observados excedem o orcamento da janela selecionada.' });
  }
  if (report.p95Seconds !== null && report.p95Seconds > 0.5) {
    findings.push({ type: 'latency', evidence: ['p95'], text: 'P95 observado acima do limiar diagnostico de 500 ms; nao e uma causa raiz.' });
  }
  return {
    ...report, engine: 'deterministic-rules-v1', findings, rootCause: null,
    automationEnabled: false,
    limitations: ['Correlacao nao comprova causalidade.', 'SLI derivado de spans exige coleta sem amostragem.', 'Orcamento calculado apenas na janela selecionada, nao em um contrato mensal.'],
    recommendations: findings.length
      ? ['Verificar traces e logs do mesmo servico e intervalo antes de qualquer alteracao.', 'Conferir cobertura, perdas no Collector e mudancas recentes.']
      : ['Nenhum limiar desta analise foi violado; isto nao exclui falhas nao instrumentadas.']
  };
}
