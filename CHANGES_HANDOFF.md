# Changes Handoff — content_pipeline

**Audience:** the next AI/engineer picking this up.
**State:** all changes below are LOCAL and UNCOMMITTED. Nothing is committed, pushed, or deployed.
**Branch:** `main` · **HEAD:** `48b882b` ("Improve pipeline source and generation quality").

---

## 0. READ FIRST — sandbox mount truncation gotcha (critical before committing)

In this Cowork sandbox, files edited via the file tools (Edit/Write) are written correctly to the
real Windows working tree, but the **Linux build sandbox mount serves a STALE, TRUNCATED copy** of
any *existing* file that was edited in-session (newly created paths sync fine). Symptoms: `wc -l`
shows fewer lines than reality, files are cut mid-line, and `git diff` may flag a truncated file as
**binary** (null byte). If you `git add -A && git commit` from the bash sandbox in this state, you
will **commit corrupted/truncated files.**

How to get correct content / commit safely:
- The **file tools (Read) are authoritative** — they show the real, complete content.
- A **bash write repairs the mount**: `cat <good-source> > <repo-file>` updates the mount view (verified working).
- This session verified the full build against a reconstructed tree at `/tmp/proj` (git-HEAD base +
  the exact edits below). That reconstruction passed: app typecheck, server typecheck, **55 tests**, vite build.
- Safe commit procedure: ensure the working tree files match the file-tool/Read content (re-save or
  bash-repair the edited files), run the verification suite, then commit. Do NOT trust raw `wc -l`/`cat`
  on edited files until repaired.

---

## 1. What this work delivers (two themes)

### A. Source credibility (favor Forbes/Yahoo/Reuters/consulting reports; drop 3rd-tier/PR/SEO mills)
Policy chosen: **strong preference + denylist (tunable), NOT a hard allowlist** (so niche/regional
coverage isn't starved). Credibility is judged by outlet reputation, never by country.

### B. Prompt quality (all 4 LLM prompts rewritten; image prompts made specific & best-practice)
Policy chosen for image prompts: **model-agnostic** (no `--ar`/Midjourney syntax; positive prompt
stands alone since Imagen/DALL·E ignore separate negatives; optional `negativePrompt` for SD/MJ).

(Also folded in: the prior correctness round — Gemini thinking-budget clamping, uppercase
`responseSchema` types, adaptive citation target. See §3.)

---

## 2. New files

| File | Purpose |
|------|---------|
| `server/retrieval/sourceAuthority.ts` | Domain credibility tiering. `getSourceTier` (1 premier / 2 strong / 3 neutral-unknown / 4 denied), `getSourceAuthorityWeight` (+0.25 / +0.12 / 0 / -0.6), `isDeniedSource`, `registrableDomain`. Curated TIER1 (Reuters, Bloomberg, FT, WSJ, NYT, Forbes, Yahoo Finance, CNBC, Wired, Nature + McKinsey/BCG/Bain/Deloitte/PwC/Gartner/Forrester/IDC/S&P/Moody's/Nielsen/Pew/OECD/IMF/WEF…), TIER2 (Business Insider, Fortune, trade press, reputable regional incl. The Hindu/SCMP/Economic Times), DENY (PRNewswire/GlobeNewswire/BusinessWire/EIN… + SEO report mills MarketResearchFuture/Mordor/etc. + naturalnews) plus regex DENY_PATTERNS for PR families. Subdomain + www matching. Extend sets here. |
| `server/retrieval/__tests__/sourceAuthority.test.ts` | 5 unit tests: tier-1 boost, tier-2 boost, deny PR/SEO mills, neutral unknowns, subdomain matching. |

## 3. Modified files (this + prior uncommitted rounds)

| File | Change |
|------|--------|
| `server/retrieval/ranking.ts` | Removed the 6-entry `DOMAIN_WEIGHTS`/`getDomainWeight`; ranking now uses `getSourceAuthorityWeight(canonicalUrl)` as the domain score component (premier/strong boosted, denied buried). |
| `server/retrieval/sourceSelection.ts` | Rejects denied domains with reason `low_credibility_source`; the diversity fallback never re-adds denied sources. |
| `server/retrieval/orchestrator.ts` | `computeCandidateScore` adds `getSourceAuthorityWeight(candidate.url)` so the limited extraction budget is spent on credible candidates first and denied PR/SEO go to the back of each provider queue. |
| `server/retrieval/connectors/eventRegistry.ts` | Adds EventRegistry source-rank filter: when `sourceRankPercentile < 100`, sets `startSourceRankPercentile=0` + `endSourceRankPercentile=<clamped to 10..100, step 10>` to bias toward established sources at the source. |
| `shared/config.ts` | `connectors.eventRegistry.sourceRankPercentile: z.number().int().min(10).max(100).default(50)`. |
| `server/config/config.ts` | Loads `EVENT_REGISTRY_SOURCE_RANK_PERCENTILE` (default 50). |
| `worker/src/config.ts` | Added `EVENT_REGISTRY_SOURCE_RANK_PERCENTILE?: string` to `WorkerEnv` and wired `sourceRankPercentile` (default 50) into the worker config. |
| `shared/prompts.ts` | **Full rewrite of all four templates** (clean cooked template literals — the old `String.raw` leaked `\` before every code fence). final_article: analyst-grade voice + banned-filler list + specificity mandate + `{CITATION_TARGET}`. outline_from_clusters: per-point distinct-angle + named-entity/date grounding, anti-generic bar. topic_analysis: tighter anchor-vs-facet + exclusions + provider query rules. image_prompt: Subject+Context+Style formula grounded in article/source-catalog entities, photographic levers (shot/lens/lighting/palette/16:9), text-free + overlayText, **Visual Consistency Contract**, hard cliché negatives, model-agnostic mechanics, worked generic→grounded example. ALL original placeholders preserved (see §5). |
| `server/services/genai.ts` | `clampThinkingBudgetForModel(model,budget)` (Pro 128–32768 can't be 0; Flash 0–24576; Flash-Lite 0 or 512–24576; -1 dynamic) applied per attempt (model changes across fallback). |
| `server/pipeline/synthesis.ts` | `ARTICLE_RESPONSE_SCHEMA` uses uppercase OpenAPI `Type` (OBJECT/STRING/ARRAY/NUMBER) — `responseSchema` rejects lowercase. Adaptive `citationTarget = max(3, min(8, distinctSourceTarget*2))` wired into prompt `{CITATION_TARGET}` and `validateArticleBody.minCitations`. |
| `server/pipeline/imagePrompt.ts` | `IMAGE_PROMPT_RESPONSE_SCHEMA` uppercase Type; dropped numeric `minItems`/`maxItems` (count enforced in code). |
| `server/utils/promptHydration.ts` | Comment only (the `$`-safe function-replacement hydration was added in the prior committed round). |
| `README.md` | Documents the credibility tiering + `EVENT_REGISTRY_SOURCE_RANK_PERCENTILE`. |

> Also present uncommitted from an earlier pass (not mine, leave as-is): `server/retrieval/connectors/newsapi.ts` (variant-merge + searchIn/domains/excludeDomains/sortBy), `server/retrieval/providerQueryPlan.ts` (EventRegistry anchors-only), `components/RetrievalMetricsPanel.tsx` (provider diagnostics), and tests `newsapi.test.ts`, `providerQueryPlan.test.ts`, `imagePrompt.test.ts`.

## 4. New configuration / env

- `EVENT_REGISTRY_SOURCE_RANK_PERCENTILE` (10–100, default **50**; lower = stricter; 100 disables). Server reads `process.env`; Worker reads `env.*`. No new API keys required.

## 5. Prompt placeholders that MUST stay intact (hydration breaks otherwise)
- final_article.md: `{RECENCY_WINDOW} {DATE_TARGET} {DISTINCT_SOURCE_TARGET} {CITATION_TARGET} {TOPIC} {OUTLINE} {EVIDENCE} {SOURCES} {AVAILABLE_DATES} {PREVIOUS}`
- image_prompt.md: `{IMAGE_PREFERENCES} {FOCUS_INSTRUCTIONS} {STYLE_GUIDELINES} {WORD_LIMIT} {ARTICLE_CONTENT} {SOURCE_CONTEXT}`
- outline_from_clusters.md: `{TOPIC} {RECENCY_WINDOW} {CLUSTERS} {POINT_TARGET} {CLUSTER_TARGET} {DATE_TARGET}`
- topic_analysis.md: `{INPUT_TEXT} {CURRENT_DATE}`
- `imagePrompt.test.ts` asserts the image template contains the string `Visual Consistency Contract` — keep it.

## 6. Verification (all green, via /tmp reconstruction — see §0)
- `tsc -p tsconfig.json --noEmit` → pass
- `tsc -p tsconfig.server.json --noEmit` → pass
- `vitest run` → **55 passed (18 files)** (50 existing + 5 new source-authority)
- `vite build` → pass
- ESLint → clean (only the stale `baseline-browser-mapping` advisory)

## 7. Remaining steps to ship
1. **Repair working tree** so the build sandbox sees correct (non-truncated) content for the edited files (see §0), then re-run the verification suite.
2. **Commit** the modified files + the two new `sourceAuthority*` files (+ this handoff). Suggested message: `Add source credibility tiering and rewrite LLM/image prompts`.
3. **Push `main`** → triggers `.github/workflows/deploy-pages.yml` (GitHub Pages, UI only). Note: Pages does NOT run the server/worker pipeline.
4. **Deploy the API (Cloudflare Worker):** `cd worker && wrangler deploy` — requires `CLOUDFLARE_API_TOKEN` (or `wrangler login`), which is not available in this sandbox. The Worker bundles `server/` (incl. `@mozilla/readability`+`linkedom`); confirm the bundle stays within the Workers size limit on deploy.
5. Optional: set `EVENT_REGISTRY_SOURCE_RANK_PERCENTILE` (Worker secret/var and/or server env) to tune strictness.

## 8. Known follow-ups (not done; optional)
- Clustering still uses lexical Jaccard (dedup is fixed); embeddings-based clustering would be a further upgrade.
- Google Custom Search JSON API is closed to new customers (EOL 2027-01-01) — a Vertex AI Search (or alternative) connector is the longer-term replacement; only documented so far.
