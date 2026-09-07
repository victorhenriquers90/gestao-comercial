# Regras do produto (Gestão Comercial)

Aplica-se a qualquer IA neste repo. O `AGENTS.md` da raiz é o contrato do
sandbox Grok — **este arquivo** é o contrato do produto.

- UI em **pt-BR**. Desktop-first. Loja (PDV + estoque + financeiro).
- Multi-tenant: toda query de negócio filtra `company_id`.
- Server fn: `authMiddleware` + `requireTenant` + `assertCan`.
- CPF/CNPJ: `src/lib/document.ts`. EAN: `src/lib/check-digit.ts`.
- Sem login social. CSRF em mutações. Sanitizar entrada na borda.
- Fontes: Outfit + Syne + IBM Plex Mono. Classe `ed-label` nos kickers.
- Login: imagem full-bleed `/public/login-store.jpg`.
- Migrations só para frente (`migrations/0021_*.sql` em diante).
- Detalhes e mapa: [HANDOFF.md](HANDOFF.md).
