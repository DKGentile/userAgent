# Aegis · Autonomous Claims Intelligence

An end-to-end, AI-powered claims-adjudication platform for a **fictional** shipping-insurance carrier. A single Node/TypeScript server owns a SQL database, a RAG pipeline, a document analyzer, and a guard-railed agentic decision engine — and serves a polished React console on top.

> **It runs with one command and zero configuration.** No API keys, no native builds, no external services. Add an `ANTHROPIC_API_KEY` to swap the deterministic reasoner for real Claude tool-use; add an embeddings key for production vectors. Nothing else changes.

```bash
npm install
npm run dev
# open http://localhost:8787
```

---

## What it demonstrates

This is a portfolio piece built to show a specific set of skills working together in one coherent system:

| Capability | Where it lives |
|---|---|
| **SQL orchestration** — schema, joins, repositories, a swappable driver, and a backtest **write-guard kill-switch** | [`apps/server/src/db`](apps/server/src/db) |
| **Agentic decision engine** — deterministic pre-flights → RAG → reasoning → guard rails, streamed live over SSE | [`apps/server/src/services/agent`](apps/server/src/services/agent) |
| **RAG pipeline** — pluggable embeddings → in-memory vector store → cosine retrieval → 2-D PCA projection | [`apps/server/src/services`](apps/server/src/services) (`embeddings`, `vectorStore`, `pca`, `rag`) |
| **Document analysis** — extract invoice amount / tracking / doc-type, Claude when available, heuristics otherwise | [`documentAnalyzer.ts`](apps/server/src/services/documentAnalyzer.ts) |
| **Multi-carrier tracking** — normalized status resolver (a stand-in for live carrier APIs) | [`tracking.ts`](apps/server/src/services/tracking.ts) |
| **Evaluation harness** — re-runs the agent vs. human ground truth, scores agreement, builds a confusion matrix | [`backtest.ts`](apps/server/src/services/backtest.ts) |
| **A presentable React app** — dashboard, claims queue, live agent theater, vector-space explorer, analytics | [`apps/web/src`](apps/web/src) |

### 100% synthetic — and deliberately so
Every client, carrier, coverage rule, exclusion, and claim in this repo is **invented for the demo**. There is no real customer data, no real policy text, and no credentials anywhere — only a `.env.example` with empty placeholders.

---

## The agent pipeline

Each claim flows through the same stages, streamed to the UI in real time:

```
context → preflight → documents → tracking → retrieval → reasoning → gates → decision
```

1. **Context** — assemble the claim, client SOP parameters, carrier, documents, tracking.
2. **Pre-flight** — deterministic, no-AI checks (filing window, excluded commodity, restricted ZIP). A failure here *short-circuits* the whole decision before any model is invoked — the production fast-path.
3. **Documents** — extract the invoice amount, tracking number, and doc type from each file.
4. **Tracking** — resolve the carrier scan history into a normalized state.
5. **Retrieval (RAG)** — embed the claim's salient facts, cosine-rank them against the knowledge base, and inject the top matches into the prompt.
6. **Reasoning** — Claude (tool-use + extended thinking) when a key is present, otherwise a deterministic reasoner that applies the same rules. Either way the structured STEP 1–5 reasoning streams token-by-token.
7. **Guard rails** — a reasoning↔decision **consistency gate** and a **confidence floor**; either can auto-escalate.
8. **Decision** — persisted with a full audit trail (`agent_decisions` + `agent_changes`), and the claim status updated.

Open any claim and press **Run agent** to watch all of this happen live.

---

## RAG, end to end

- The knowledge base (28 synthetic chunks: coverage rules, exclusions, procedures, prior-claim precedents) is embedded on first boot and cached in SQLite.
- **Embeddings are pluggable.** With no key, a dependency-free **feature-hashing** provider (the hashing trick + domain synonym expansion, 384-dim) runs offline. Set `OPENAI_API_KEY` → `text-embedding-3-small`; set `VOYAGE_API_KEY` → `voyage-3`. The store re-embeds automatically if the dimensionality changes.
- The **Semantic Search** page projects the whole embedding space to 2-D (PCA) so you can *see* where a query lands relative to the corpus, with the top matches highlighted.

---

## Safety: the backtest write-guard

The SQL layer carries a hard kill-switch (mirroring a real production agent). The **Backtest** re-runs the current agent over every claim that has a human ground-truth label and scores agreement — and it executes with the database **write-guard armed and scoped to a single eval table**. Any stray write to a live claim table throws. An evaluation can never mutate production data. See [`connection.ts`](apps/server/src/db/connection.ts) (`withWriteGuard`).

The seeded dataset includes two claims where the human adjudicator and the agent deliberately diverge, so the agreement matrix is honest (≈92% rather than a suspicious 100%).

---

## One server, built for AWS

There is exactly **one server** in this repo. In development it also runs Vite in-process (`build --watch`) and live-reloads the browser; in production the same server serves the pre-built SPA. One process, one port, one thing to deploy (Elastic Beanstalk / ECS / App Runner / a single EC2).

```bash
npm run build   # vite build -> apps/web/dist
npm start       # one server serves API + SPA + DB on $PORT
```

**Going to production:**
- **Database** — the app talks to SQL through a narrow `SqlDb` interface. The demo uses Node's built-in `node:sqlite`; pointing at **RDS (Postgres/MySQL)** is a single new implementation of that interface — nothing above it changes.
- **Documents** — swap local seed text for **S3** objects + Claude vision in `documentAnalyzer.ts`.
- **Tracking** — replace the simulator in `tracking.ts` with live FedEx/UPS/DHL calls; the normalized shape is already what the rest of the system expects.
- **LLM / embeddings** — set the relevant env vars; no code changes.

---

## Project structure

```
aegis-claims-intelligence/
├─ packages/shared/         # types shared across the boundary (one source of truth)
├─ apps/
│  ├─ server/               # the single server (Fastify + node:sqlite)
│  │  └─ src/
│  │     ├─ index.ts        # boots DB + vector store, serves API + SPA
│  │     ├─ db/             # connection (write-guard), schema, seed, repos, knowledge
│  │     ├─ services/       # embeddings, vectorStore, pca, rag, tracking, analyzer, llm, stats, backtest
│  │     │  └─ agent/       # context, preflight, prompts, simulator, llmDecision, gates, engine
│  │     └─ routes.ts       # /api (+ SSE agent stream)
│  └─ web/                  # React + Vite + Tailwind console
│     └─ src/pages/         # Dashboard, Claims, ClaimDetail, SemanticSearch, KnowledgeBase, Backtest
```

## Configuration (all optional — see `.env.example`)

| Variable | Effect |
|---|---|
| `ANTHROPIC_API_KEY` | Use real Claude (tool-use + extended thinking + streaming) for decisions & doc extraction |
| `OPENAI_API_KEY` / `VOYAGE_API_KEY` | Production embeddings instead of the offline feature-hash provider |
| `AGENT_MODEL`, `ANALYZER_MODEL`, `AGENT_THINKING_BUDGET`, `AGENT_MIN_CONFIDENCE` | Tune the agent |
| `PORT` | Server port (default `8787`) |

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Single server, in-process Vite watch + live reload |
| `npm run build` | Build the SPA for production |
| `npm start` | Production server (API + prebuilt SPA) |
| `npm run seed` | Rebuild the synthetic database from scratch |
| `npm run typecheck` | Typecheck both workspaces |

## Tech stack

TypeScript · Node 22+ · Fastify · `node:sqlite` · `@anthropic-ai/sdk` · React 18 · Vite · Tailwind · Recharts · Framer Motion.

---

*Aegis is a demonstration project. The carrier, clients, coverage rules, and claims are entirely fictional.*
