import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';

const BOILERPLATE_SELECTOR =
  'nav, footer, aside, [class*="cookie" i], [id*="cookie" i], [class*="newsletter" i], [class*="subscribe" i], [class*="advert" i], [id*="advert" i]';

export const stripHtmlTags = (html: string): string => {
  const withoutScripts = html.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  const withoutStyles = withoutScripts.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  return withoutStyles.replace(/<[^>]+>/g, ' ');
};

export const normalizeTextWhitespace = (text: string): string =>
  text.replace(/\s+/g, ' ').replace(/\u00a0/g, ' ').trim();

export const extractTagContents = (html: string, tag: string): string[] => {
  const blocks: string[] = [];
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    if (match[1]) blocks.push(match[1]);
  }
  return blocks;
};

export const extractReadableText = (html: string, options: { minLength?: number } = {}): string | null => {
  const minLength = options.minLength ?? 200;
  try {
    const { document } = parseHTML(html);
    for (const node of Array.from(document.querySelectorAll(BOILERPLATE_SELECTOR) as Iterable<any>)) {
      node.remove?.();
    }
    const reader = new Readability(document as unknown as Document, { keepClasses: false });
    const parsed = reader.parse();
    const text = normalizeTextWhitespace(parsed?.textContent || '');
    return text.length >= minLength ? text : null;
  } catch {
    return null;
  }
};

export const extractLongestContentBlock = (html: string, decode: (value: string) => string): string => {
  const candidates = ['article', 'main', 'body']
    .flatMap((tag) => extractTagContents(html, tag))
    .map((block) => normalizeTextWhitespace(decode(stripHtmlTags(block))))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  return candidates[0] || normalizeTextWhitespace(decode(stripHtmlTags(html)));
};
