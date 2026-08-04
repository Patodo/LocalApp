const APP_CSS_SCOPE = ":where([data-localapp-app-root])";

const GLOBAL_AT_RULES = [
  "@font-face",
  "@keyframes",
  "@-webkit-keyframes",
  "@property",
  "@page",
];

export function scopeNativeAppCss(css: string, scope = APP_CSS_SCOPE): string {
  return scopeCssBlock(css, scope);
}

export function rewriteNativeAppCssUrls(css: string, stylesheetHref: string): string {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (match, quote: string, rawUrl: string) => {
    const url = rawUrl.trim();
    if (
      !url ||
      url.startsWith("#") ||
      url.startsWith("/") ||
      /^[a-z][a-z0-9+.-]*:/i.test(url)
    ) {
      return match;
    }
    try {
      return `url(${quote}${new URL(url, stylesheetHref).toString()}${quote})`;
    } catch {
      return match;
    }
  });
}

function scopeCssBlock(css: string, scope: string): string {
  let output = "";
  let cursor = 0;

  while (cursor < css.length) {
    const open = css.indexOf("{", cursor);
    if (open === -1) {
      output += css.slice(cursor);
      break;
    }

    const close = findMatchingBrace(css, open);
    if (close === -1) {
      output += css.slice(cursor);
      break;
    }

    const selector = css.slice(cursor, open);
    const body = css.slice(open + 1, close);
    const trimmed = selector.trimStart().toLowerCase();

    output += selectorPrefix(selector, scope, trimmed);
    output += "{";
    output += shouldScopeAtRuleBody(trimmed) ? scopeCssBlock(body, scope) : body;
    output += "}";
    cursor = close + 1;
  }

  return output;
}

function selectorPrefix(selector: string, scope: string, trimmedLower: string): string {
  if (trimmedLower.startsWith("@")) return selector;
  return splitSelectors(selector)
    .map((item) => prefixSelector(item, scope))
    .join(",");
}

function shouldScopeAtRuleBody(trimmedLower: string): boolean {
  if (!trimmedLower.startsWith("@")) return false;
  return !GLOBAL_AT_RULES.some((rule) => trimmedLower.startsWith(rule));
}

function prefixSelector(selector: string, scope: string): string {
  const leading = selector.match(/^\s*/)?.[0] ?? "";
  const trailing = selector.match(/\s*$/)?.[0] ?? "";
  const body = selector.trim();
  if (!body || body.startsWith(scope)) return selector;

  if (/^(html|body|:root)\b/.test(body)) {
    return `${leading}${body.replace(/^(html|body|:root)\b/, scope)}${trailing}`;
  }

  return `${leading}${scope} ${body}${trailing}`;
}

function splitSelectors(selector: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: string | null = null;

  for (let i = 0; i < selector.length; i++) {
    const char = selector[i];
    const prev = selector[i - 1];
    if (quote) {
      if (char === quote && prev !== "\\") quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "(" || char === "[" || char === "{") depth++;
    if (char === ")" || char === "]" || char === "}") depth = Math.max(0, depth - 1);
    if (char === "," && depth === 0) {
      parts.push(selector.slice(start, i));
      start = i + 1;
    }
  }

  parts.push(selector.slice(start));
  return parts;
}

function findMatchingBrace(css: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;

  for (let i = open; i < css.length; i++) {
    const char = css[i];
    const prev = css[i - 1];
    if (quote) {
      if (char === quote && prev !== "\\") quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "{") depth++;
    if (char === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }

  return -1;
}
