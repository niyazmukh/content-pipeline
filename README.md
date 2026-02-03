# gemini-content-pipeline

This repo contains:
- A Vite + React UI (can be hosted on GitHub Pages)
- A Node/Express server that runs the retrieval + LLM pipeline (must be hosted separately)

## Local dev

- UI: `npm run dev`
- Server: `npm run server`

By default the UI calls same-origin `/api`.
For local dev with a separate Express server, set `VITE_API_BASE=http://localhost:3001/api`.

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
- `X-Google-Cse-Api-Key` + `X-Google-Cse-Cx` (optional)
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

4) **Google CSE key + Search Engine ID**
   - Create a search engine at `https://programmablesearchengine.google.com/`
   - In Google Cloud, enable **Custom Search API**
   - Copy the API key and the Search Engine ID (cx)

## Notes on modularity

The UI types live in [shared/types.ts](shared/types.ts).
The server has richer internal types under [server/retrieval/types.ts](server/retrieval/types.ts).
A recommended refactor plan for unifying DTOs without breaking the server build is in [.docs/modularity.md](.docs/modularity.md).
