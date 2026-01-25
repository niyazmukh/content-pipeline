export const PROMPT_TEMPLATES: Record<string, string> = {
  'final_article.md': String.raw`# Final Article Prompt (Outline + Evidence -> Article)

You are drafting a professional weekly intelligence briefing for cross-industry decision makers on the topic below. All material must be published within the last {RECENCY_WINDOW}. Use only the supplied outline, clusters, and evidence digests. Never introduce claims without citations or promotional copy.

## Requirements

- Length: 400-600 words, professional, neutral tone.
- Include inline numeric citations like [1] attached to the sentence they support.
- Weave in at least six inline citations referencing different sources across the narrative (not just the Key developments bullets).
- Mention at least three distinct YYYY-MM-DD dates in the article body, ideally tied to when events occurred or announcements were made.
- After the article body, add a Key developments (past {RECENCY_WINDOW}) section with bullet points; each bullet must follow: YYYY-MM-DD - Source - Headline (URL) and reuse inline citation numbers.
- Conclude with a sources array (JSON) listing { "id": number, "title": "...", "url": "..." } for every citation in order of first appearance.
- Highlight novelty compared to last week's recap if noveltyHints are provided.
- Maintain a factual, analyst-grade tone. Avoid endorsements, calls to action, or sales language.

Integrity & compliance:
- Avoid overtly promotional phrasing (“buy now”, “best-ever deal”, “exclusive discount”, etc.). Focus on neutral explanations of what happened and why it matters.
- If a company or product must be mentioned, keep it descriptive and cite the supporting evidence in the same sentence.
- Do not fabricate facts, dates, or quotes. Stay within the provided materials.

## Input Data

Topic: {TOPIC}

Outline (JSON):
\`\`\`
{OUTLINE}
\`\`\`

Evidence Digest:
\`\`\`
{EVIDENCE}
\`\`\`

Cluster Catalog:
\`\`\`
{CLUSTERS}
\`\`\`

Source Catalog (IDs for inline citations):
\`\`\`
{SOURCES}
\`\`\`

Previous Article Synopsis (may be empty):
\`\`\`
{PREVIOUS}
\`\`\`

## Output Format

Return only:

\`\`\`
{
  "title": "Concise headline",
  "article": "Full article with inline [n] citations and Key developments section",
  "sources": [
    { "id": 1, "title": "Source title", "url": "https://..." }
  ],
  "wordCount": 0
}
\`\`\`

The wordCount must reflect the article body (excluding the sources list).
`,
  'image_prompt.md': String.raw`# Image Prompt Brief (Human-Centric, Realistic, Editorial)

Craft a photorealistic prompt that produces an authentic editorial-style image tied directly to the supplied article. The result should feel like reportage or PR photography—not an illustration or advertisement—and must avoid overt promotion.

Branding & tone guidelines:
- Keep the scene brand-agnostic. No large logos, slogans, or marketing signage. At most, include subtle generic branding (e.g., a small badge or screen UI) without naming real companies.
- Never add watermarks, banner text, or product packaging hero shots.
- Use neutral, modern color palettes guided by the article context instead of fixed corporate colors.

## Input Article
\`\`\`
{ARTICLE_CONTENT}
\`\`\`

## Output Format
Return well-structured Markdown with these sections, in order:
1) Summary (1-2 sentences)
2) Audience & Mood (bullets)
3) Human Subjects & Setting (bullets)
4) Composition & Camera (bullets)
5) Visual Consistency Plan (bullets)
6) Positive Style Modifiers (bullets)
7) Negative Modifiers (bullets)
8) Master Prompt (single paragraph)
9) Alternative Prompts (3 bullets, concise)

## Guidance
- **Setting Specificity**: Anchor the scene in the article’s specific industry context. Avoid generic "modern offices" unless the story is about general office work.
    - *Cybersecurity*: Dark SOC, server room, blue-lit screens.
    - *Logistics*: Warehouse floor, shipping container yard, dispatch center.
    - *Healthcare*: Lab, clinic, MRI room, nurse station.
    - *Finance*: Trading floor, boardroom with city view, bank lobby.
    - *Tech/Cloud*: Server hardware, data center aisles, cabling, hardware engineering bench.
- **Visual Metaphors**: Ground abstract concepts in physical reality.
    - "Cloud" -> Server racks, data center.
    - "AI" -> Code on screens, neural network visualizations on monitors (not floating holograms).
    - "Security" -> Locks, shields (subtle), secure access doors, biometric scanners.
- **Lighting & Mood**: Match the lighting to the article's sentiment.
    - *Innovation/Growth*: High-key, bright, natural light, warm tones.
    - *Risk/Threat*: Moody, low-key, cool tones, dramatic shadows.
    - *Stability/Trust*: Balanced, soft lighting, neutral tones.
- **Human Element**: Include 1-3 professionals whose roles make sense for the story. Show plausible actions (reviewing data, inspecting equipment, discussing strategy).
- **Composition**: Widescreen hero (16:9), rule of thirds, one clear focal subject.
- **Camera**: Photorealistic, 35-50mm look, f/2.8-f/4, natural soft key with subtle rim, realistic skin texture, filmic contrast, minimal grain.

## Sections to Produce

### Summary
- 1-2 sentences capturing the narrative focus and desired emotional response.

### Audience & Mood
- Primary audience (e.g., enterprise buyers, security leaders, supply-chain executives).
- Mood (confident, focused, collaborative, urgent, resilient, etc.).

### Human Subjects & Setting
- Roles, number of people (1-3), attire, representation.
- Specific setting matching the article.
- Actions tied to the story.

### Composition & Camera
- Angle, depth of field, lighting style.

### Visual Consistency Plan
- Color palette, texture, atmosphere.

### Positive Style Modifiers
- "Photorealistic", "Cinematic lighting", "Editorial", "8k", "Detailed texture".

### Negative Modifiers
- "Cartoon", "Illustration", "3D render", "Watermark", "Text", "Logo", "Blurry", "Distorted".

### Master Prompt
- A single, cohesive paragraph combining all elements. Start with the subject and setting, then action, then lighting and camera details.

### Alternative Prompts
- 3 variations exploring different angles or focuses within the same theme.
`,
  'outline_from_clusters.md': String.raw`# Outline Generation Prompt (Clusters -> JSON)

You are an editorial research lead preparing a weekly intelligence briefing on the topic below. You receive story clusters representing fact-checked news published within the last {RECENCY_WINDOW}. Each cluster includes a headline, publication date, source, summary, and canonical citations.

## Task

Produce a JSON object with the following structure:

\`\`\`json
{
  "thesis": "single sentence",
  "outline": [
    {
      "point": "concise bullet",
      "summary": "1-2 sentence expansion that references dated facts",
      "supports": ["clusterId1", "clusterId2"],
      "dates": ["YYYY-MM-DD", "YYYY-MM-DD"]
    }
  ],
  "coverage": {
    "usedClusterIds": ["clusterId1", "..."],
    "coverageRatio": 0.0
  }
}
\`\`\`

### Constraints

1. Use at least {CLUSTER_TARGET} distinct clusterId values across the outline points.
2. Include at least {DATE_TARGET} unique YYYY-MM-DD dates taken from the clusters.
3. Every outline point must reference one or more cluster IDs in supports.
4. All statements must be grounded in the supplied cluster summaries; do not invent facts.
5. Keep the thesis to a single sentence (< 35 words) and at least 12 characters.
6. The outline must have exactly {POINT_TARGET} points ordered from most critical to least, covering different angles (e.g., strategy, finance, regulation, product, market impact).

Important:
- Use the clusterId values exactly as shown in the input JSON (do not renumber or fabricate IDs).
- Prefer covering different clusters before reusing the same clusterId across points.
- Choose dates directly from the clusters' publishedAt values (format YYYY-MM-DD).
- Maintain brand neutrality: avoid praising or promoting any companies or products. Keep language factual, analytical, and free of marketing language.

### Output Requirements

* Return only valid JSON (no additional prose).
* coverage.coverageRatio should be the fraction of clusters that appear in supports.
* If you cannot satisfy a constraint, set "error": "explanation" at the top level and leave other fields empty.

## Inputs

Topic: {TOPIC}

Clusters (JSON):
\`\`\`
{CLUSTERS}
\`\`\`
`,
  'query_expansion.md': String.raw`# Targeted Research Query Expansion

You generate focused Google-style web search queries to find the freshest evidence (published within the last {RECENCY_WINDOW}) to support an outline point for a weekly intelligence briefing.

## Inputs

- Topic: {TOPIC}
- Outline point: {POINT}

## Requirements

- Return only valid JSON (no extra prose):
\`\`\`
{ "queries": ["...", "..."] }
\`\`\`
- Produce 3-6 queries, each 5-12 words.
- Use **implicit AND** (spaces) to combine concepts. Do NOT use the word "AND".
- Use \`OR\` (capitalized) for synonyms or alternative phrasings (e.g. \`(revenue OR sales)\`).
- Use **quotes ("") ONLY** for specific named entities (e.g. "European Union"). Avoid quoting generic phrases.
- Prefer specificity (entities, metrics, regulation names, regions) over generic words.
- Add date/time operators or recency hints where appropriate (e.g., "past 14 days") but do not use unsupported operators.
- Avoid promotional or sales-driven language (“buy now”, “best deal”, “exclusive discount”, etc.).
- Keep the tone factual and investigative.

Examples of good techniques:
- Combine the Topic with the point in one or two quoted phrases.
- Add qualifiers like site:gov or site:europa.eu for regulatory items when pertinent.
- Include synonyms for key concepts (e.g., "composable commerce", "headless architecture", "product information management").
`,
  'topic_analysis.md': String.raw`# Topic Analysis & Query Generation

You are an expert search query optimizer for a news retrieval pipeline. Your goal is to analyze the user's input (which might be a raw topic, a question, or metadata from a URL) and generate optimized search queries for different providers.

## Input Context
User Input:
"""
{INPUT_TEXT}
"""

Current Date: {CURRENT_DATE}

## Instructions

1.  **Analyze Intent**: Determine the core subject and specific facets the user is interested in.
2.  **Extract Keywords**: Identify 3-5 specific, high-value keywords or entities.
3.  **Infer Date Range**: If the user mentions "yesterday", "last week", "2024", etc., calculate the ISO 8601 date range. If no specific time is mentioned, leave it null (implies "recent" based on system config).
4.  **Generate Queries**:
    *   **Google CSE**: Keyword-centric. Use quotes ONLY for specific named entities (e.g. "Elon Musk"). Avoid quoting generic phrases. Use \`OR\` for alternative terms. Max ~32 words.
    *   **NewsAPI**: Boolean logic. Use \`AND\`, \`OR\`. Use \`NOT\` to exclude obvious noise if necessary. Keep it under 500 chars.
    *   **EventRegistry**: List of 3-5 simple keywords or short phrases. Avoid long sentences.

## Output Format (JSON Only)

\`\`\`json
{
  "mainTopic": "Short descriptive topic label",
  "keywords": ["keyword1", "keyword2", "keyword3"],
  "dateRange": {
    "start": "YYYY-MM-DD", // or null
    "end": "YYYY-MM-DD"   // or null
  },
  "queries": {
    "google": "optimized query string for Google",
    "newsapi": "optimized query string for NewsAPI",
    "eventregistry": ["keyword1", "keyword2"] // Array of strings for EventRegistry
  }
}
\`\`\`
`,
};
