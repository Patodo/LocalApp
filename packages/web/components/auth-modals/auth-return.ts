export function resolveAuthReturnTo(returnTo: string | null): string {
  if (!returnTo) return "/";

  try {
    const target = new URL(returnTo, window.location.origin);
    if (target.origin !== window.location.origin) return "/";
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return "/";
  }
}
