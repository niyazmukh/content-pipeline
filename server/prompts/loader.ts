import { PROMPT_TEMPLATES } from '../../shared/prompts';

export const loadPrompt = (filename: string): string => {
  const content = PROMPT_TEMPLATES[filename];
  if (!content) {
    throw new Error(`Missing prompt template: ${filename}`);
  }
  return content;
};
