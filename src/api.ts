import { toIngestPayload } from "./ingest-payload.js";
import type { RemoteDeviceStatus } from "./status.js";
import type { UsageBucket } from "./types.js";

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
}): Promise<{ inserted: number; updated: number }> {
  const token = params.uploadToken || params.deviceToken;
  if (!token) throw new Error("Missing upload token");
  const payload = toIngestPayload(params.buckets, { deviceName: params.deviceName, platform: params.platform });
  const data = await postJson(`${params.serverUrl}/api/ingest`, payload, token);
  return {
    inserted: Number(data.inserted || 0),
    updated: Number(data.updated || 0),
  };
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
  const response = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  const data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!response.ok) {
    const message = typeof data.error === "string" ? data.error : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return data;
}

function assertString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Missing ${field}`);
  return value;
}
