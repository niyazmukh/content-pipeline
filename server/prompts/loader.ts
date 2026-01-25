import { PROMPT_TEMPLATES } from '../../shared/prompts';

const cache = new Map<string, string>();

export const loadPrompt = async (filename: string): Promise<string> => {
  if (cache.has(filename)) {
    return cache.get(filename)!;
  }
  const content = PROMPT_TEMPLATES[filename];
  if (!content) {
    throw new Error(`Missing prompt template: ${filename}`);
  }
  cache.set(filename, content);
  return content;
};
