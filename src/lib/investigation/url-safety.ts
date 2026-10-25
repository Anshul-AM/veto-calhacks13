const PRIVATE_IPV4_RANGES: Array<[number, number]> = [
  [0x00000000, 0x00ffffff],
  [0x0a000000, 0x0affffff],
  [0x64400000, 0x647fffff],
  [0x7f000000, 0x7fffffff],
  [0xa9fe0000, 0xa9feffff],
  [0xac100000, 0xac1fffff],
  [0xc0000000, 0xc00000ff],
  [0xc0000200, 0xc00002ff],
  [0xc0a80000, 0xc0a8ffff],
  [0xc6120000, 0xc613ffff],
  [0xc6336400, 0xc63364ff],
  [0xcb007100, 0xcb0071ff],
  [0xe0000000, 0xffffffff],
];

export type UrlRejectionReason =
  | "missing_or_non_string"
  | "too_long"
  | "invalid_url"
  | "unsupported_protocol"
  | "embedded_credentials"
  | "private_or_local_host";

export type PublicUrlInspection =
  | { url: string; reason: null }
  | { url: null; reason: UrlRejectionReason };

function ipv4Number(hostname: string): number | null {
  const parts = hostname.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map(Number);
  if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return (((octets[0] * 256 + octets[1]) * 256 + octets[2]) * 256 + octets[3]) >>> 0;
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const isIpv6 = host.includes(":");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "::" ||
    host === "::1" ||
    (isIpv6 && (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:") || host.startsWith("::ffff:")))
  ) {
    return true;
  }

  const ipv4 = ipv4Number(host);
  return ipv4 !== null && PRIVATE_IPV4_RANGES.some(([start, end]) => ipv4 >= start && ipv4 <= end);
}

export function inspectPublicUrl(value: unknown): PublicUrlInspection {
  if (typeof value !== "string" || !value.trim()) {
    return { url: null, reason: "missing_or_non_string" };
  }
  if (value.length > 2_048) return { url: null, reason: "too_long" };
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol)) {
      return { url: null, reason: "unsupported_protocol" };
    }
    if (url.username || url.password) return { url: null, reason: "embedded_credentials" };
    if (!url.hostname || isPrivateHost(url.hostname)) {
      return { url: null, reason: "private_or_local_host" };
    }
    url.hash = "";
    return { url: url.toString(), reason: null };
  } catch {
    return { url: null, reason: "invalid_url" };
  }
}

export function safePublicUrl(value: unknown): string | null {
  return inspectPublicUrl(value).url;
}

export function domainForUrl(url: string): string {
  return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
}
