type HeaderValue = string | string[] | undefined;

export type PublicOriginRequest = {
  protocol: string;
  headers: Record<string, HeaderValue>;
};

function firstHeaderValue(value: HeaderValue): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const first = raw?.split(",", 1)[0]?.trim();
  return first || null;
}

function safeHost(value: HeaderValue): string | null {
  const host = firstHeaderValue(value);
  if (!host || /[\s/\\]/.test(host)) return null;
  return host;
}

export function requestPublicOrigin(req: PublicOriginRequest): string | null {
  const forwardedProtocol = firstHeaderValue(req.headers["x-forwarded-proto"]);
  const hasTrustedForwardedProtocol = forwardedProtocol === "http" || forwardedProtocol === "https";
  const protocol = hasTrustedForwardedProtocol ? forwardedProtocol : req.protocol;
  if (protocol !== "http" && protocol !== "https") return null;
  const host = hasTrustedForwardedProtocol
    ? safeHost(req.headers["x-forwarded-host"]) ?? safeHost(req.headers.host)
    : safeHost(req.headers.host);
  return host ? `${protocol}://${host}` : null;
}
