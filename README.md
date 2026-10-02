# Vimaka Horus Telemetry

Plataforma OpenTelemetry-first da Vimaka Sistemas Inteligentes. Incremento **0.2.0**, para desenvolvimento local, um unico ambiente e somente leitura. Nao e uma versao pronta para producao.

## Iniciar

Requisitos: Git, Node.js 22+ e Docker Compose v2.

```bash
git clone https://github.com/vimakasystems-git/vimakahorustelemetry.git
cd vimakahorustelemetry
git checkout feat/observability-platform-bootstrap
node scripts/configure.mjs
docker compose up -d --build
```

O configurador cria `.env` com tres credenciais aleatorias independentes e nao sobrescreve um arquivo existente. Nao publique esse arquivo. No Windows, aplique permissoes de arquivo restritas ao seu usuario.

Abra **http://localhost:8080** e informe `HORUS_API_TOKEN` do `.env`. A chave fica apenas na memoria da aba. Grafana: **http://localhost:3000**, usuario `admin`, senha `GRAFANA_ADMIN_PASSWORD`.

O painel inicia sem dados. Para gerar trafego de teste e verificar a ingestao de ponta a ponta:

```bash
node scripts/smoke.mjs
```

O script exige `HORUS_ENABLE_DEMO=true`, definido pelo configurador local. Ele gera latencia e erros deliberados, verifica metricas no Prometheus, traces no Tempo, logs no Loki e os indicadores do Horus. As contagens `increase()` exigem mais de uma exportacao antes de aparecerem. Os dados gerados sao reais sinais de uma carga sintetica, nao resultados inseridos artificialmente no painel.

## Entregue neste incremento

- Painel responsivo proprio em portugues, selecao de servico/janela/meta e atualizacao manual.
- Descoberta de **servicos com spans de servidor**, nao uma CMDB de todos os ativos.
- SLI, orcamento de erros e burn rate da janela selecionada; sem trafego significa `no_data`.
- Conexoes client/server observadas pelo `servicegraph`; a cobertura depende da instrumentacao nas duas pontas.
- Diagnosticos deterministicos de sintomas com consultas e horarios como evidencia. **Sem LLM, causa raiz automatica ou remediacao.**
- API instrumentada manualmente com traces, metricas e logs via OTLP/HTTP protobuf e propagacao W3C.
- Collector, Prometheus, Tempo, Loki e Grafana. Portas publicadas somente em `127.0.0.1`.
- Credencial bearer para consultas, limites de consulta, timeouts, cache limitado, CSP e API sem endpoints de escrita.
- Volumes persistentes para backends. PostgreSQL e Pyroscope sao perfis opcionais, nao funcionalidades completas.

## API

`GET /health` e publico e verifica apenas o processo. As demais rotas exigem `Authorization: Bearer <HORUS_API_TOKEN>`.

| Rota | Resultado |
| --- | --- |
| `/ready` | Conectividade de consulta com Prometheus; nao valida todos os backends |
| `/api/v1/services?window=30m` | Servicos descobertos em spanmetrics |
| `/api/v1/topology?window=30m` | Conexoes observadas e taxas |
| `/api/v1/slo?service=horus-api&window=30m&target=0.999` | SLI e orcamento desta janela |
| `/api/v1/diagnostics?service=horus-api&window=30m` | Sintomas, limitacoes e evidencias |
| `/demo/latency`, `/demo/error` | Geradores sinteticos, somente quando habilitados |

Janelas permitidas: `5m`, `30m`, `1h`, `6h`, `24h`. Meta entre `0.9` inclusive e `1` exclusive. Nomes de servico: ate 128 caracteres ASCII alfanumericos com `_ . : / -`. Nao ha endpoint de PromQL arbitrario nem URL de backend fornecida pelo usuario.

## Testes

```bash
cd services/api
npm test                         # 36 testes; somente Node, sem dependencias externas
npm install --ignore-scripts     # instala o SDK OpenTelemetry
npm run test:otel                # exercita os tres exporters contra receptor OTLP de teste
cd ../..
node scripts/smoke.mjs           # exige a stack Docker em execucao
```

O CI valida os testes, o protocolo OTLP, as configuracoes com os binarios reais e a ingestao de ponta a ponta. Um CI antigo com sucesso nao valida um novo commit: consulte os checks do PR.

## Limites importantes

Os SLOs atuais sao derivados de spans de servidor: amostragem, perda ou cobertura incompleta distorcem os resultados. A API de demonstracao usa `AlwaysOnSampler`; outros produtores precisam ser configurados e verificados. O orcamento exibido nao representa automaticamente um SLO mensal nem um SLA contratual. As contagens podem ser fracionarias pela extrapolacao de `increase()`.

As portas de ingestao e os backends locais nao possuem autenticacao multi-tenant. Nao exponha esta stack na internet. A sanitizacao remove apenas alguns atributos conhecidos; nao garante a eliminacao de dados pessoais ou segredos arbitrarios. Veja [arquitetura e limites](docs/ARCHITECTURE.md).

As dependencias diretas estao fixadas por versao. Ainda falta versionar um lockfile resolvido, fixar imagens por digest e revisar vulnerabilidades antes de uma release reproduzivel.

```bash
docker compose --profile profiling up -d  # backend Pyroscope; requer instrumentacao de profiling
docker compose --profile metadata up -d   # PostgreSQL reservado; a API ainda nao o utiliza
docker compose down                       # preserva volumes
```

Nao execute `docker compose down -v` em ambientes com dados a preservar. O CI usa essa opcao apenas nos volumes descartaveis dos testes.

## Proximas etapas

Coleta de hosts Windows/Linux com instaladores, inventario persistente, OIDC/RBAC e isolamento por tenant, SLOs duraveis e alertas multi-janela, instrumentacao eBPF/profiling/RUM, integracao opcional com modelo local e remediacao com aprovacao. Esses itens continuam no roadmap; nao sao anunciados como implementados.

Licenca do codigo proprio: MIT, conforme `LICENSE`. Cada componente de terceiros mantem sua propria licenca.
