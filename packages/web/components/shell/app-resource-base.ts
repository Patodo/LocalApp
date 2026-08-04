const DEV_RAW_PREFIX = "/_localapp/raw";

function normalizeBasePath(pathname: string): string {
  return pathname.endsWith("/") ? pathname : `${pathname}/`;
}

function isPlatformShellPreview(currentHref: string): boolean {
  try {
    const url = new URL(currentHref);
    return url.pathname.startsWith("/platform-shell/");
  } catch {
    return false;
  }
}

export function resolveNativeAppResourceBase(pagePath: string, currentHref?: string): string {
  const href = currentHref ?? (typeof window !== "undefined" ? window.location.href : "");
  const prefix = isPlatformShellPreview(href) ? DEV_RAW_PREFIX : "/serve";
  return normalizeBasePath(`${prefix}/${pagePath}`);
}

export function resolveNativeAppUrl(resourceBase: string, rawUrl: string): string {
  if (!rawUrl) return "";
  if (/^https?:\/\//i.test(rawUrl)) return rawUrl;
  if (rawUrl.startsWith("/serve/") || rawUrl.startsWith(`${DEV_RAW_PREFIX}/`)) return rawUrl;

  const normalizedBase = normalizeBasePath(resourceBase);
  if (rawUrl.startsWith("/assets/")) return `${normalizedBase.slice(0, -1)}${rawUrl}`;

  return new URL(rawUrl, `http://localapp.local${normalizedBase}`).pathname;
}
