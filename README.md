# gemini-content-pipeline

This repo contains:
- A Vite + React UI (can be hosted on GitHub Pages)
- A Cloudflare Worker API for production GitHub Pages deployments
- A Node/Express API for local development and alternate hosting

## Local dev

- UI: `npm run dev`
- Server: `npm run server`

By default the UI calls same-origin `/api`.
For local dev with a separate Express server, set `VITE_API_BASE=http://localhost:3001/api`.

## Pipeline quality controls

The pipeline retrieves candidates from Google CSE, Google News RSS, NewsAPI, and EventRegistry, then extracts and ranks articles before outline and article generation.

Current reliability controls:

- Provider-specific query planning expands a natural-language topic into source-appropriate query variants.
- Negative topic constraints are first-class: phrases such as `ignore company BigCommerce` or `ignore news from India` are parsed as exclusions, kept out of positive anchors/facets, rendered as provider-specific negative operators where supported, and enforced again during candidate/article filtering.
- RSS, Google CSE, and NewsAPI report which query variants were tried and which one produced usable results. Google CSE is treated as a legacy optional source; new users should rely on NewsAPI/EventRegistry/Google News RSS unless they already have CSE access.
- Evidence scoring favors articles that contain topic anchors, requested facets, named entities, factual density, and usable body text.
- A source quality gate selects the source set used for clustering and outline generation. Weak, thin, off-topic, or duplicate-domain sources can be rejected before synthesis.
- Source credibility tiering (`server/retrieval/sourceAuthority.ts`) boosts premier outlets and primary research/consulting firms (Reuters, Bloomberg, FT, Forbes, Yahoo Finance, McKinsey, Gartner, S&P, OECD, ...) in ranking and extraction order, treats unknown domains as neutral, and rejects PR wires and SEO "market-report" mills as low-credibility. This is a preference + denylist (not a hard allowlist), so niche/regional coverage is not starved. Extend the tier/deny sets in that file as needed.
- EventRegistry results are biased toward established sources via its source-rank percentile. Set `EVENT_REGISTRY_SOURCE_RANK_PERCENTILE` (10-100, default 50; lower = stricter; 100 disables) to tune how aggressively the long tail of obscure sources is dropped at the source.
- Retrieval metrics in the UI show source readiness, selected/rejected source counts, provider diversity, anchor coverage, facet coverage, warnings, rejected-source reasons, and per-provider query diagnostics.

For broad topics, include the core subject and the desired facets in the topic prompt, for example:

```text
Top B2B ecommerce news, focus on market research and reports, regulation, notable case studies and acquisitions.
```

To exclude an entity, source, term, or location, state it explicitly:

```text
Top B2B ecommerce news, focus on regulation and acquisitions, ignore company BigCommerce, ignore news from India.
```

If the UI shows `Needs Review`, inspect the retrieval diagnostics before generating the final article. The usual fixes are broadening the topic anchor, increasing the recency window, enabling more providers, or rerunning with clearer required facets.

## Verification

Before pushing pipeline changes, run:

```bash
npm run typecheck
npx tsc -p tsconfig.server.json --noEmit
npm test
npm run lint
npm run build
```

## GitHub Pages (UI only)

GitHub Pages cannot run the Express server. You have two options:

1) Host the server elsewhere (Render/Fly.io/Cloud Run/Azure/etc.) and point the UI at it.
2) Run the API on Cloudflare Workers (recommended for GitHub Pages).
3) Run everything locally (no GitHub Pages).

### Configure the API base URL

If `VITE_API_BASE` is unset, the UI calls same-origin `/api` (works when UI and API are hosted together).
For GitHub Pages or a separate API host, set a GitHub Actions repository variable:
- `VITE_API_BASE` = `https://<your-server-host>/api`

The workflow also sets:
- `VITE_BASE` = `/<repo-name>/` (required for GitHub Pages path routing)

### Deploy

- Push to `main` to trigger the Pages workflow: [.github/workflows/deploy-pages.yml](.github/workflows/deploy-pages.yml)
- In the repo settings: enable Pages from GitHub Actions

## Cloudflare Workers (recommended)

The UI can be hosted on GitHub Pages while the API runs on Cloudflare Workers. Users provide their own API keys in the UI, which are sent with each request and never stored on the server.

### Deploy the Worker

From `worker/`:

1) Install Wrangler (once): `npm i -g wrangler`
2) Login: `wrangler login`
3) Deploy: `wrangler deploy`

Set `VITE_API_BASE` in GitHub Pages to your Worker URL (e.g., `https://<name>.workers.dev/api`).

### User-supplied keys

The UI stores keys in `localStorage` and includes them as headers:
- `X-Gemini-Api-Key` (required)
- `X-Google-Cse-Api-Key` + `X-Google-Cse-Cx` (optional; legacy existing CSE customers only)
- `X-Newsapi-Key` (optional)
- `X-Eventregistry-Api-Key` (optional)

### Getting API keys (low-tech guide)

1) **Gemini API key**
   - Go to `https://aistudio.google.com/apikey`
   - Click **Create API key**
   - Copy the key into the Gemini field

2) **NewsAPI key**
   - Go to `https://newsapi.org/register`
   - Sign up and open your dashboard
   - Copy your API key into the NewsAPI field

3) **EventRegistry key**
   - Go to `https://eventregistry.org/register`
   - Sign up and open your profile page
   - Copy your API key into the EventRegistry field

4) **Google CSE key + Search Engine ID (legacy optional)**
   - Google's Custom Search JSON API is closed to new customers and existing customers must move before January 1, 2027.
   - Use this app's Google CSE fields only if you already have Custom Search JSON API access.
   - For new source coverage, obtain NewsAPI and/or EventRegistry keys instead. A future full-web replacement should use a supported provider such as Vertex AI Search or another news/web search API and add a matching connector.

## Notes on modularity

The UI types live in [shared/types.ts](shared/types.ts).
Server retrieval internals extend those shared DTOs in [server/retrieval/types.ts](server/retrieval/types.ts).
