import JSON5 from 'json5';

/**
 * Robust JSON extraction utilities for handling LLM responses.
 * Implements bracket-balanced extraction and auto-closing logic to cope with
 * partially emitted JSON payloads.
 */

/**
 * Remove markdown code fences from a string.
 */
export const stripCodeFence = (value: string): string =>
  value.replace(/^```(?:json|json5|text)?\s*\r?\n?/, '').replace(/```[\s\r\n]*$/, '').trim();

const buildClosers = (stack: string[]): string =>
  stack
    .slice()
    .reverse()
    .map((token) => (token === '{' ? '}' : token === '[' ? ']' : ''))
    .join('');

/**
 * Extract a JSON object/array from a string, handling nested braces/brackets.
 * If the payload is truncated (missing closing braces), we auto-close it using
 * the stack of unmatched openers so that downstream parsing can succeed.
 */
export const extractBalancedJson = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  let start = -1;
  let end = -1;
  let inString = false;
  let escapeNext = false;
  const stack: string[] = [];

  for (let i = 0; i < trimmed.length; i += 1) {
    const char = trimmed[i];

    if (inString) {
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      if (char === '\\') {
        escapeNext = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{' || char === '[') {
      if (stack.length === 0) {
        start = i;
      }
      stack.push(char);
      continue;
    }

    if (char === '}' || char === ']') {
      if (stack.length === 0) {
        continue;
      }
      const expected = stack[stack.length - 1] === '{' ? '}' : stack[stack.length - 1] === '[' ? ']' : '';
      if (char === expected) {
        stack.pop();
        if (stack.length === 0) {
          end = i;
          break;
        }
      } else {
        // Mismatched closer; drop the opener so we do not get stuck.
        stack.pop();
      }
    }
  }

  if (start === -1) {
    return null;
  }

  let candidate =
    end !== -1 ? trimmed.slice(start, end + 1) : trimmed.slice(start);

  if (end === -1 && inString) {
    if (escapeNext) {
      candidate = candidate.slice(0, -1);
    }
    candidate += '"';
  }

  if (stack.length > 0) {
    candidate = `${candidate}${buildClosers(stack)}`;
  }

  return candidate.trim();
};

/**
 * Fallback naive extraction (for backwards compatibility).
 * Extracts from first '{' to last '}'.
 */
export const extractJsonObjectNaive = (value: string): string => {
  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    return value.trim();
  }
  return value.slice(start, end + 1).trim();
};

/**
 * Primary JSON extraction function with multiple fallback strategies.
 */
export const extractJson = (rawResponse: string): string | null => {
  const stripped = stripCodeFence(rawResponse);

  // Try balanced extraction first
  const balanced = extractBalancedJson(stripped);
  if (balanced) {
    return balanced;
  }

  // Try naive extraction as fallback
  const naive = extractJsonObjectNaive(stripped);
  if (naive && naive !== stripped) {
    return naive;
  }

  return null;
};

/**
 * More robust extractor: attempts balanced extraction, then tries to JSON5-parse;
 * if parsing fails (e.g., due to truncated strings), progressively truncates the
 * tail and rebalances/auto-closes before retrying. Helpful for partial streams.
 */
export const extractJsonRobust = (rawResponse: string): string | null => {
  const stripped = stripCodeFence(rawResponse);
  const base = extractBalancedJson(stripped) ?? extractJsonObjectNaive(stripped);
  if (!base) return null;

  const tryParse = (text: string): boolean => {
    try {
      JSON5.parse(text);
      return true;
    } catch {
      return false;
    }
  };

  if (tryParse(base)) return base;

  // Attempt to salvage a dangling open string by appending a closing quote and rebalancing braces
  const salvageDanglingQuote = (text: string): string | null => {
    let inString = false;
    let escapeNext = false;
    const stack: string[] = [];
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (inString) {
        if (escapeNext) {
          escapeNext = false;
          continue;
        }
        if (ch === '\\') {
          escapeNext = true;
          continue;
        }
        if (ch === '"') {
          inString = false;
          continue;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === '{' || ch === '[') {
        stack.push(ch);
        continue;
      }
      if (ch === '}' || ch === ']') {
        if (stack.length === 0) continue;
        const expected = stack[stack.length - 1] === '{' ? '}' : stack[stack.length - 1] === '[' ? ']' : '';
        if (ch === expected) {
          stack.pop();
        } else {
          stack.pop();
        }
      }
    }
    if (!inString) return null;
    const closers = stack
      .slice()
      .reverse()
      .map((t) => (t === '{' ? '}' : t === '[' ? ']' : ''))
      .join('');
    const candidate = `${text}\"${closers}`;
    return candidate;
  };

  const quoteFixed = salvageDanglingQuote(base);
  if (quoteFixed && tryParse(quoteFixed)) return quoteFixed;

  // Iteratively trim from the end and rebalance, looking for a parseable prefix
  const steps = [80, 160, 240, 360, 520, 720, 1000];
  for (const step of steps) {
    if (base.length <= step) break;
    const prefix = base.slice(0, base.length - step);
    const rebalanced = extractBalancedJson(prefix) ?? extractJsonObjectNaive(prefix);
    if (rebalanced && tryParse(rebalanced)) {
      return rebalanced;
    }
  }
  return null;
};
