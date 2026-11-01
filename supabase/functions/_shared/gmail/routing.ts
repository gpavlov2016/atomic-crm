export function functionSubpath(url: string, functionName: string): string {
  const pathname = new URL(url).pathname.replace(/\/+$/, "") || "/";
  const marker = `/${functionName}`;
  const index = pathname.lastIndexOf(marker);
  if (index === -1) return pathname;
  const rest = pathname.slice(index + marker.length);
  return rest === "" ? "/" : rest;
}

const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export function isGmailResourceId(value: string): boolean {
  return ID_PATTERN.test(value);
}
