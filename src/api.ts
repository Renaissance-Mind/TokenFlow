import {
  replacementScopeKey,
  toIngestPayload,
  unknownReplacementScopesForBuckets,
  type DailyReplacementScope,
  type UnknownReplacementScope,
} from "./ingest-payload.js";
import type { RemoteApiTokenStatus, RemoteDeviceStatus } from "./status.js";
import type { UsageBucket } from "./types.js";

const INGEST_CHUNK_SIZE = 20;
const REQUEST_TIMEOUT_MS = 30_000;
const REQUEST_RETRY_DELAYS_MS = [500, 1_500];

export interface DeviceStartResponse {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  expiresAt: string;
  pollIntervalSeconds: number;
}

export interface DevicePollResponse {
  status: "pending" | "approved";
  token?: string;
  deviceId?: string;
}

export async function startDeviceFlow(params: {
  serverUrl: string;
  deviceName: string;
  platform: string;
}): Promise<DeviceStartResponse> {
  const data = await postJson(`${params.serverUrl}/api/device/start`, {
    device_name: params.deviceName,
    platform: params.platform,
  });
  return {
    deviceCode: assertString(data.device_code, "device_code"),
    userCode: assertString(data.user_code, "user_code"),
    verificationUrl: assertString(data.verification_url, "verification_url"),
    expiresAt: assertString(data.expires_at, "expires_at"),
    pollIntervalSeconds: Number(data.poll_interval_seconds || 3),
  };
}

export async function pollDeviceFlow(serverUrl: string, deviceCode: string): Promise<DevicePollResponse> {
  const data = await postJson(`${serverUrl}/api/device/poll`, { device_code: deviceCode });
  const status = assertString(data.status, "status");
  if (status !== "pending" && status !== "approved") throw new Error(`Unexpected device status: ${status}`);
  return {
    status,
    token: typeof data.token === "string" ? data.token : undefined,
    deviceId: typeof data.device_id === "string" ? data.device_id : undefined,
  };
}

export async function ingestUsage(params: {
  serverUrl: string;
  uploadToken?: string;
  deviceToken?: string;
  deviceName?: string;
  platform?: string;
  buckets: UsageBucket[];
  replaceDailyBuckets?: DailyReplacementScope[];
  replaceUnknownBuckets?: UnknownReplacementScope[];
  chunkSize?: number;
}): Promise<{ inserted: number; updated: number; accepted: number; supersededDaily: number }> {
  const token = params.uploadToken || params.deviceToken;
  if (!token) throw new Error("Missing upload token");
  const chunkSize = params.chunkSize || INGEST_CHUNK_SIZE;
  if (chunkSize < 1) throw new Error("chunkSize must be at least 1");
  const replacementScopes = params.replaceUnknownBuckets || unknownReplacementScopesForBuckets(params.buckets);
  let inserted = 0;
  let updated = 0;
  let accepted = 0;
  let supersededDaily = 0;
  for (const buckets of chunks(params.buckets, chunkSize)) {
    const chunkScopeKeys = new Set(buckets.map((bucket) => replacementScopeKey(bucket.agent, bucket.bucketStart)));
    const replaceUnknownBuckets = replacementScopes.filter((scope) =>
      chunkScopeKeys.has(replacementScopeKey(scope.agent, scope.bucket_start)),
    );
    const payload = toIngestPayload(buckets, {
      deviceName: params.deviceName,
      platform: params.platform,
      replaceUnknownBuckets,
    });
    const data = await postJson(`${params.serverUrl}/api/ingest`, payload, token);
    inserted += Number(data.inserted || 0);
    updated += Number(data.updated || 0);
    accepted += data.accepted === undefined ? Number(data.inserted || 0) + Number(data.updated || 0) : Number(data.accepted);
  }
  const finalUnknownReplacements = replacementScopes.filter((scope) => scope.granularity === "day");
  for (const cleanup of cleanupChunks(params.replaceDailyBuckets || [], finalUnknownReplacements, chunkSize)) {
    const payload = toIngestPayload([], {
      deviceName: params.deviceName,
      platform: params.platform,
      replaceDailyBuckets: cleanup.replaceDailyBuckets,
      replaceUnknownBuckets: cleanup.replaceUnknownBuckets,
    });
    const data = await postJson(`${params.serverUrl}/api/ingest`, payload, token);
    supersededDaily += Number(data.superseded_daily || 0);
  }
  return { inserted, updated, accepted, supersededDaily };
}

export async function syncPing(
  serverUrl: string,
  uploadToken: string,
  metadata: { deviceName?: string; platform?: string } = {},
): Promise<void> {
  await postJson(
    `${serverUrl}/api/sync-ping`,
    {
      ...(metadata.deviceName ? { device_name: metadata.deviceName } : {}),
      ...(metadata.platform ? { platform: metadata.platform } : {}),
    },
    uploadToken,
  );
}

export async function getDeviceStatus(serverUrl: string, deviceToken: string): Promise<RemoteDeviceStatus> {
  const data = await getJson(`${serverUrl}/api/device/status`, deviceToken);
  return data as unknown as RemoteDeviceStatus;
}

export async function getApiTokenStatus(serverUrl: string, apiToken: string): Promise<RemoteApiTokenStatus> {
  const data = await getJson(`${serverUrl}/api/me`, apiToken);
  const user = objectField(data.user, "user");
  const scope = assertApiKeyScope(user.api_key_scope);
  return {
    authenticated: true,
    account: {
      id: assertString(user.id, "user.id"),
      email: typeof user.email === "string" && user.email.trim() ? user.email : null,
      name: typeof user.name === "string" && user.name.trim() ? user.name : null,
    },
    scope,
  };
}

export async function getUploadApiTokenStatus(serverUrl: string, apiToken: string): Promise<RemoteApiTokenStatus> {
  const status = await getApiTokenStatus(serverUrl, apiToken);
  if (status.scope !== "read_write") {
    throw new Error("Read-write API key required for uploads");
  }
  return status;
}

async function getJson(url: string, bearerToken?: string): Promise<Record<string, unknown>> {
  return requestJson(url, "GET", undefined, bearerToken);
}

async function postJson(url: string, body: unknown, bearerToken?: string): Promise<Record<string, unknown>> {
  return requestJson(url, "POST", body, bearerToken);
}

async function requestJson(
  url: string,
  method: "GET" | "POST",
  body?: unknown,
  bearerToken?: string,
): Promise<Record<string, unknown>> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await requestJsonOnce(url, method, body, bearerToken);
    } catch (error) {
      if (!(error instanceof TokenUsageNetworkError) || attempt >= REQUEST_RETRY_DELAYS_MS.length) throw error;
      await sleep(REQUEST_RETRY_DELAYS_MS[attempt]);
    }
  }
}

async function requestJsonOnce(
  url: string,
  method: "GET" | "POST",
  body?: unknown,
  bearerToken?: string,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetchWithTimeout(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    throw new TokenUsageNetworkError(url, error);
  }
  const text = await response.text();
  const data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!response.ok) {
    const message = typeof data.error === "string" ? data.error : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return data;
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const timeoutMs = requestTimeoutMs();
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) throw new Error(`timed out after ${timeoutMs}ms`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function requestTimeoutMs(): number {
  const value = Number(process.env.TOKENUSAGE_REQUEST_TIMEOUT_MS || REQUEST_TIMEOUT_MS);
  if (!Number.isFinite(value) || value < 1_000) return REQUEST_TIMEOUT_MS;
  return Math.floor(value);
}

class TokenUsageNetworkError extends Error {
  constructor(url: string, cause: unknown) {
    super(`Unable to reach TokenUsage server at ${url}: ${errorDetail(cause)}`);
    this.name = "TokenUsageNetworkError";
    this.cause = cause;
  }
}

function errorDetail(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const cause = error && typeof error === "object" && "cause" in error ? (error as { cause?: unknown }).cause : undefined;
  if (cause instanceof Error && cause.message && cause.message !== message) return `${message}: ${cause.message}`;
  if (typeof cause === "string" && cause && cause !== message) return `${message}: ${cause}`;
  return message;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Missing ${field}`);
  return value;
}

function objectField(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Missing ${field}`);
  return value as Record<string, unknown>;
}

function assertApiKeyScope(value: unknown): "read_only" | "read_write" {
  if (value === "read_only" || value === "read_write") return value;
  throw new Error("Missing user.api_key_scope");
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}

function cleanupChunks(
  replaceDailyBuckets: DailyReplacementScope[],
  replaceUnknownBuckets: UnknownReplacementScope[],
  size: number,
): Array<{ replaceDailyBuckets: DailyReplacementScope[]; replaceUnknownBuckets: UnknownReplacementScope[] }> {
  const out: Array<{ replaceDailyBuckets: DailyReplacementScope[]; replaceUnknownBuckets: UnknownReplacementScope[] }> = [];
  let dailyIndex = 0;
  let unknownIndex = 0;
  while (dailyIndex < replaceDailyBuckets.length || unknownIndex < replaceUnknownBuckets.length) {
    const daily = replaceDailyBuckets.slice(dailyIndex, dailyIndex + size);
    dailyIndex += daily.length;
    const remaining = size - daily.length;
    const unknown = remaining > 0 ? replaceUnknownBuckets.slice(unknownIndex, unknownIndex + remaining) : [];
    unknownIndex += unknown.length;
    out.push({ replaceDailyBuckets: daily, replaceUnknownBuckets: unknown });
  }
  return out;
}
