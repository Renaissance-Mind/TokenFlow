import { createHash, randomBytes } from "node:crypto";

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}
let configuredFetch: typeof fetch | undefined;
export function setDesktopHttpClient(client: typeof fetch): void { configuredFetch = client; }
export function normalizeDesktopServer(value: string): string {
  const url = new URL(value.trim());
  if (url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    throw new Error("Use a server origin, such as https://tokenflow.renaissancemind.ai");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) throw new Error("HTTPS is required except for a local development server.");
  return url.origin;
}
export function createPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}
export async function apiRequest(server: string, endpoint: string, body?: unknown, token?: string, signal?: AbortSignal): Promise<Record<string, any>> {
  const response = await (configuredFetch || fetch)(`${normalizeDesktopServer(server)}${endpoint}`, {
    method: body === undefined ? "GET" : "POST", redirect: "error",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
  });
  const data = await response.json() as Record<string, any>;
  if (!response.ok) throw new ApiError(typeof data.error === "string" ? data.error : `Server returned ${response.status}`, response.status);
  return data;
}
export function checkedLoginUrl(value: unknown, server: string, provider: string): string {
  if (typeof value !== "string") throw new Error("Server did not return a login URL");
  const url = new URL(value);
  if (url.origin !== normalizeDesktopServer(server) || url.pathname !== `/auth/login/${provider}`) throw new Error("Server returned an unexpected login URL");
  return url.href;
}
