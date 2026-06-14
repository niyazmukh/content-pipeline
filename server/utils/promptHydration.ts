// Function replacement avoids $-pattern interpretation in dynamic content.
export const replacePlaceholders = (template: string, replacements: Record<string, string>): string =>
  Object.entries(replacements).reduce(
    (acc, [placeholder, value]) => acc.replaceAll(placeholder, () => value),
    template,
  );
