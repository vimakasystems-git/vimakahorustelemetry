export class BackendError extends Error {}

/** Read-only, bounded Prometheus client. The upstream is administrator-configured, never a request parameter. */
export class PrometheusClient {
  constructor(baseUrl, { fetchImpl = fetch, timeoutMs = 4000, maxBytes = 1048576, ttlMs = 5000 } = {}) {
    const base = new URL(baseUrl);
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
      throw new Error('Invalid Prometheus URL');
    }
    this.base = base.href.replace(/\/$/, '');
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.maxBytes = maxBytes;
    this.ttlMs = ttlMs;
    this.cache = new Map();
    this.pending = new Map();
  }

  async query(expression, time) {
    const key = `${time}:${expression}`;
    const cached = this.cache.get(key);
    if (cached && cached.until > Date.now()) return cached.rows;
    if (this.pending.has(key)) return this.pending.get(key);
    if (this.pending.size >= 16) throw new BackendError('Query concurrency limit');
    const task = this.load(expression, time).then(rows => {
      if (this.cache.size >= 64) this.cache.delete(this.cache.keys().next().value);
      this.cache.set(key, { rows, until: Date.now() + this.ttlMs });
      return rows;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, task);
    return task;
  }

  async load(expression, time) {
    const url = new URL(`${this.base}/api/v1/query`);
    url.searchParams.set('query', expression);
    url.searchParams.set('time', String(time));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetch(url, { signal: controller.signal, redirect: 'error' });
      if (!response.ok || Number(response.headers.get('content-length')) > this.maxBytes) throw new Error('Invalid response');
      const parts = [];
      let length = 0;
      for await (const part of response.body) {
        length += part.length;
        if (length > this.maxBytes) { controller.abort(); throw new Error('Response too large'); }
        parts.push(Buffer.from(part));
      }
      const body = JSON.parse(Buffer.concat(parts).toString('utf8'));
      const rows = body.data?.result;
      if (body.status !== 'success' || body.data?.resultType !== 'vector' || !Array.isArray(rows) || rows.length > 1000 || body.warnings?.length) {
        throw new Error('Incomplete or invalid query result');
      }
      for (const row of rows) {
        if (!row.metric || typeof row.metric !== 'object' || Array.isArray(row.metric) || !Array.isArray(row.value) || row.value.length !== 2 || typeof row.value[1] !== 'string') {
          throw new Error('Invalid sample');
        }
      }
      return rows;
    } catch {
      // Never return upstream payloads, credentials or URLs to API clients.
      throw new BackendError('Prometheus indisponivel ou resposta invalida.');
    } finally { clearTimeout(timer); }
  }
}
