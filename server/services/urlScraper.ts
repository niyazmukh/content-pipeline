export interface ScrapedMetadata {
  title: string;
  description: string;
  content?: string;
  url: string;
}

const extractTagContent = (html: string, tag: string): string | null => {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = html.match(re);
  return match ? match[1].trim() : null;
};

const extractMetaContent = (html: string, key: string): string | null => {
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    `<meta[^>]+(?:property|name|itemprop)=[\"']${esc}[\"'][^>]*>`,
    'i',
  );
  const match = html.match(re);
  if (!match) return null;
  const tag = match[0];
  const contentMatch = tag.match(/content=[\"']([^\"']+)[\"']/i);
  return contentMatch ? contentMatch[1].trim() : null;
};

const stripTags = (html: string): string => {
  const withoutScripts = html.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  const withoutStyles = withoutScripts.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  return withoutStyles.replace(/<[^>]+>/g, ' ');
};

const decodeEntities = (text: string): string =>
  text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_match, num) => {
      const code = Number(num);
      return Number.isFinite(code) ? String.fromCharCode(code) : '';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCharCode(code) : '';
    });

const normalizeWhitespace = (text: string): string => text.replace(/\s+/g, ' ').trim();

export const scrapeMetadata = async (url: string): Promise<ScrapedMetadata> => {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      },
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();

    const title =
      extractMetaContent(html, 'og:title') ||
      extractTagContent(html, 'title') ||
      '';

    const description =
      extractMetaContent(html, 'description') ||
      extractMetaContent(html, 'og:description') ||
      '';

    const mainBlock =
      extractTagContent(html, 'article') ||
      extractTagContent(html, 'main') ||
      extractTagContent(html, 'body') ||
      html;

    const content = normalizeWhitespace(decodeEntities(stripTags(mainBlock))).slice(0, 2000);

    return {
      title: decodeEntities(title).trim(),
      description: decodeEntities(description).trim(),
      content,
      url,
    };
  } catch (error) {
    throw new Error(`Failed to scrape URL: ${(error as Error).message}`);
  }
};
