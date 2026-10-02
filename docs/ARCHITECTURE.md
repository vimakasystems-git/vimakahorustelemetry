# Arquitetura do incremento 0.2

## Caminho implementado

API de referencia -> SDK OpenTelemetry -> Collector gateway -> Tempo / Prometheus / Loki.

O Collector produz spanmetrics e servicegraph. O backend HTTP do Horus executa apenas consultas PromQL predefinidas e entrega resultados ao painel. Nenhuma telemetria e persistida no processo da API. O inventario de servicos e uma consulta sobre sinais recebidos, nao cadastro nem CMDB.

O SDK exporta os tres sinais via HTTP/protobuf. Instrumentacao manual explicita evita depender de interceptacao ESM; nao ha promessa de instrumentacao automatica de bibliotecas. Headers, corpos, URLs completas e mensagens de erro arbitrarias nao sao emitidos pelo logger da API de referencia.

## Separacao agente / gateway

O gateway nao usa `resourcedetection/system` nem `hostmetrics`: executar esses coletores dentro do container e anexar seus atributos a sinais encaminhados pode confundir o container do Collector com os hosts das aplicacoes. `config/otel-agent.example.yaml` e uma configuracao separada para um Collector nativo em Linux autorizado. Nao foi instalado nenhum agente nos computadores do usuario.

Prometheus faz scrape das metricas internas do Collector uma unica vez, em 8888. A porta 8889 sem exportador foi removida. Metricas recebidas por OTLP e derivadas de spans seguem diretamente ao receptor OTLP do Prometheus. Nao existe metrics-generator duplicado no Tempo.

## Semantica dos indicadores

`service_name`, `span_kind=SPAN_KIND_SERVER` e `status_code=STATUS_CODE_ERROR` seguem a saida do spanmetrics na versao selecionada. A unidade do histograma e explicitamente segundos. Todas as consultas de um relatorio usam o mesmo instante, arredondado em intervalos de cinco segundos.

SLI = 1 - erros / total. Orcamento = total * (1 - meta). Burn rate = (erros / total) / (1 - meta). `increase()` pode retornar estimativas fracionarias. Ausencia de total e zero trafego produzem `no_data`; contagens contraditorias produzem `inconsistent_data`; falhas no backend produzem HTTP 503, nunca zeros artificiais. Uma serie de erros ausente, depois de consulta bem-sucedida e com total positivo, representa zero erros observados. NaN em contagens e recusado; NaN no histograma e ausencia de percentil.

Um status dentro da meta nao prova saude geral. Amostragem, perda de spans, roteamento parcial e instrumentacao incompleta precisam ser verificados antes do uso operacional de SLOs. O motor atual apenas identifica sintomas; retorna `rootCause: null` e `automationEnabled: false`.

## Seguranca local

Um token aleatorio, comparacao resistente a timing, somente GET, nenhuma consulta ou URL arbitraria, 120 consultas por minuto para a unica credencial, limite de 16 consultas simultaneas ao backend, cache de ate 64 entradas, resposta upstream de ate 1 MiB, timeout de quatro segundos e rejeicao de resultados parciais. Credencial no navegador apenas em memoria. DOM construido com `textContent`, sem inserir HTML de telemetria.

A API executa como usuario nao privilegiado, filesystem somente leitura e sem capabilities. As portas de host usam loopback. Backends locais continuam sem isolamento por tenant: nao tratar bearer token como arquitetura SaaS pronta. O Collector tem apenas sanitizacao limitada de atributos conhecidos. Filas de exportacao sao em memoria e podem perder dados quando o processo termina.

## Persistencia e funcionalidades opcionais

Prometheus: sete dias configurados; Tempo: 24 horas; Loki: sete dias com compactor; Grafana: volume persistente. Politicas precisam de dimensionamento e testes de restauracao. `docker compose down` preserva volumes, `down -v` os remove.

PostgreSQL (`metadata`) e Pyroscope (`profiling`) so iniciam com seus perfis. A API nao grava no PostgreSQL e ainda nao produz perfis de CPU/memoria. Expor um datasource Pyroscope nao equivale a coleta de profiling.

## Portoes antes de producao

TLS/mTLS em ingress e OTLP; autenticacao de produtores; OIDC e RBAC; isolamento de armazenamento e consulta por tenant; gestao e rotacao de segredos; limiares e SLOs duraveis; auditoria; backup e restauracao; filas persistentes; disponibilidade e escalabilidade; autenticacao de backends; lockfile e imagens por digest; revisao de licencas e vulnerabilidades; testes de carga; politicas abrangentes de privacidade. Nenhum deploy automatico nesta etapa.

## Fontes tecnicas

- OpenTelemetry Node.js: https://opentelemetry.io/docs/languages/js/getting-started/nodejs/
- Prometheus como backend OTLP: https://prometheus.io/docs/guides/opentelemetry/
- Spanmetrics da versao usada: https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/v0.137.0/connector/spanmetricsconnector/README.md
- Tempo e diretorios do container: https://github.com/grafana/tempo/blob/v2.8.2/cmd/tempo/Dockerfile

As versoes herdadas do bootstrap foram mantidas para este incremento. Nao sao apresentadas como as mais recentes ou como isentas de vulnerabilidades.
