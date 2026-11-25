# Fase 3 — teste de carga real (RLS)

Harness de carga da Fase 3 do plano `stateless-chasing-stallman.md`, depois
de fechar as 38 tabelas de negocio com RLS (HANDOFF.md itens 206-216).

Roda contra o deployment de **Preview** desta branch (`loadtest/fase3`),
nunca contra produção. A Neon provisiona automaticamente uma branch de
banco descartável para este preview, separada de `main`.

Env vars de Preview escopadas a esta branch (`GC_MULTI_TENANT=1`,
`GC_DEMO_SEED=1`, `VITE_MULTI_TENANT=true`): cada cadastro é aberto (SaaS)
e já nasce com catálogo de demonstração e caixa aberto, prontos pro
checkout do PDV sem passo manual extra.

Ver HANDOFF.md para o resultado e a data da rodada.
