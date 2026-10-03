import fs from "node:fs/promises";
import path from "node:path";
import { makeUsageEvent } from "./ccusage-common.js";
import {
  archivedSqliteSnapshot,
  sourceRoots,
  sqliteRows,
  storeFiles,
  tableColumns,
} from "./store-io.js";
import type { UsageEvent } from "../types.js";

type Field = number | bigint | Buffer;
type Fields = Map<number, Field[]>;

export function decodeProto(bytes: Buffer): Fields {
  const fields: Fields = new Map();
  let position = 0;
  const varint = () => {
    let value = 0n;
    for (let shift = 0n; shift < 70n; shift += 7n) {
      if (position >= bytes.length)
        throw new Error("Truncated Antigravity protobuf varint");
      const byte = bytes[position++];
      value |= BigInt(byte & 127) << shift;
      if (!(byte & 128)) {
        return value;
      }
    }
    throw new Error("Invalid Antigravity protobuf varint");
  };
  while (position < bytes.length) {
    const rawTag = varint();
    if (rawTag > BigInt(Number.MAX_SAFE_INTEGER))
      throw new Error("Invalid Antigravity protobuf tag");
    const tag = Number(rawTag);
    const field = Math.floor(tag / 8);
    const wire = tag & 7;
    if (!field) throw new Error("Invalid Antigravity protobuf field");
    let value: Field;
    if (wire === 0) {
      const scalar = varint();
      value =
        scalar <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(scalar) : scalar;
    } else if ([1, 2, 5].includes(wire)) {
      const length = wire === 2 ? Number(varint()) : wire === 1 ? 8 : 4;
      if (position + length > bytes.length)
        throw new Error("Truncated Antigravity protobuf field");
      value = bytes.subarray(position, position + length);
      position += length;
      if (wire !== 2) continue;
    } else
      throw new Error(`Unsupported Antigravity protobuf wire type ${wire}`);
    fields.set(field, [...(fields.get(field) || []), value]);
  }
  return fields;
}

const number = (fields: Fields, key: number) => {
  const value = fields.get(key)?.[0];
  if (typeof value === "bigint")
    throw new Error(`Antigravity field ${key} exceeds safe integer range`);
  return typeof value === "number" ? value : 0;
};
const bytes = (fields: Fields, key: number) =>
  fields.get(key)?.find(Buffer.isBuffer) as Buffer | undefined;
const text = (fields: Fields, key: number) =>
  bytes(fields, key)?.toString("utf8").trim() || undefined;
const nested = (fields: Fields, key: number) =>
  decodeProto(bytes(fields, key) || Buffer.alloc(0));
const timestamp = (fields: Fields) =>
  number(fields, 1) > 0
    ? new Date(
        number(fields, 1) * 1000 + Math.floor(number(fields, 2) / 1e6),
      ).toISOString()
    : undefined;

const MODEL_IDS: Record<number, string> = {
  246: "gemini-2.5-pro",
  312: "gemini-2.5-flash",
  313: "gemini-2.5-flash-thinking",
  329: "gemini-2.5-flash-thinking",
  330: "gemini-2.5-flash-lite",
  281: "claude-4-sonnet",
  282: "claude-4-sonnet",
  290: "claude-4-opus",
  291: "claude-4-opus",
  333: "claude-4.5-sonnet",
  334: "claude-4.5-sonnet",
  340: "claude-4.5-haiku",
  341: "claude-4.5-haiku",
  342: "gpt-oss-120b-medium",
  1318: "gemini-3.8-flash-high",
  1319: "gemini-3.8-flash-medium",
  1320: "gemini-3.8-flash-low",
  1298: "gemini-3.7-flash-high",
  1299: "gemini-3.7-flash-medium",
  1300: "gemini-3.7-flash-low",
  1071: "gemini-3.6-flash-high",
  1072: "gemini-3.6-flash-medium",
  1073: "gemini-3.6-flash-low",
  1026: "claude-opus-4-6",
  1035: "claude-sonnet-4-6",
  1036: "gemini-3.1-pro",
  1037: "gemini-3.1-pro",
  1016: "gemini-3.1-pro",
  1018: "gemini-3-flash-preview",
  1084: "gemini-3-flash-preview",
  1047: "gemini-3-flash-preview",
  1132: "gemini-3.5-flash-high",
  1133: "gemini-3.5-flash-high",
  1187: "gemini-3.5-flash-extra-low",
  1020: "gemini-3.5-flash-medium",
};

function modelName(id: number): string | undefined {
  return id
    ? MODEL_IDS[id] ||
        (id >= 1000
          ? `model_placeholder_m${id - 1000}`
          : `antigravity-model-${id}`)
    : undefined;
}

function normalizeModel(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const placeholder = /^model_placeholder_m(\d+)$/.exec(raw);
  if (placeholder) return modelName(Number(placeholder[1]) + 1000);
  const effort = /^gemini (3\.[678]) flash \((high|medium|low)\)$/i.exec(raw);
  if (effort) return `gemini-${effort[1]}-flash-${effort[2].toLowerCase()}`;
  const cleaned = raw.toLowerCase().split("(")[0].trim().replaceAll(" ", "-");
  const aliases: Record<string, string> = {
    "gemini-pro-default": "gemini-3.1-pro",
    "gemini-pro-agent": "gemini-3.1-pro",
    "gemini-3.1-pro-high": "gemini-3.1-pro",
    "gemini-3.1-pro-low": "gemini-3.1-pro",
    "gemini-3-flash-agent": "gemini-3.5-flash-high",
    "gemini-3-flash-agent-a": "gemini-3.5-flash-high",
    "gemini-3-flash-agent-b": "gemini-3.5-flash-high",
    "gemini-3-flash-a": "gemini-3.5-flash-high",
    "gemini-3-flash-b": "gemini-3.5-flash-high",
    "gemini-3-flash-c": "gemini-3-flash-preview",
    "gemini-3-flash": "gemini-3-flash-preview",
    "gemini-3.5-flash-low": "gemini-3.5-flash-medium",
  };
  return aliases[cleaned] || cleaned.replace(/-thinking$/, "");
}

interface Metadata {
  model?: string;
  time?: string;
  provider: number;
  usages: Fields[];
}
export function parseAntigravityMetadata(hex: string, step: boolean): Metadata {
  const root = decodeProto(Buffer.from(hex, "hex"));
  const fields = step ? root : nested(root, 1);
  if (!step && !bytes(root, 1))
    throw new Error("Antigravity metadata has no chat model");
  const info = step ? nested(fields, 24) : fields;
  const usage = bytes(fields, step ? 9 : 4);
  const retries = (fields.get(step ? 28 : 17) || [])
    .filter(Buffer.isBuffer)
    .map((retry) => bytes(decodeProto(retry), 2))
    .filter((retry): retry is Buffer => !!retry);
  return {
    model: normalizeModel(
      step
        ? text(info, 12) || text(info, 8) || modelName(number(info, 1))
        : text(fields, 19) || text(fields, 21) || modelName(number(fields, 3)),
    ),
    time: step
      ? timestamp(nested(fields, bytes(fields, 8) ? 8 : 1))
      : timestamp(nested(nested(fields, 9), 4)),
    provider: step ? number(info, 7) : 0,
    usages: [...(usage ? [usage] : []), ...retries].map(decodeProto),
  };
}

interface IdentifiedUsage {
  event: UsageEvent;
  identities: string[];
  rank: number;
}
export function mergeAntigravityUsage(rows: IdentifiedUsage[]): UsageEvent[] {
  const slots: Array<IdentifiedUsage | null> = [];
  const indexes = new Map<string, number>();
  for (const row of rows) {
    const matches = [
      ...new Set(
        row.identities
          .map((id) => indexes.get(id))
          .filter((index): index is number => index !== undefined),
      ),
    ].sort((a, b) => a - b);
    const index = matches[0] ?? slots.length;
    const target = slots[index] || row;
    for (const duplicate of [...matches.slice(1).map((i) => slots[i]!), row]) {
      if (duplicate === target) continue;
      for (const key of [
        "inputTokens",
        "cachedInputTokens",
        "cacheCreationTokens",
        "outputTokens",
        "reasoningOutputTokens",
      ] as const)
        target.event[key] = Math.max(target.event[key], duplicate.event[key]);
      if (
        duplicate.rank > target.rank ||
        (duplicate.rank === target.rank &&
          duplicate.event.timestamp < target.event.timestamp)
      ) {
        target.event.timestamp = duplicate.event.timestamp;
        target.event.bucketStart = duplicate.event.bucketStart;
        target.rank = duplicate.rank;
      }
      if (target.event.model === "gemini-internal-model")
        target.event.model = duplicate.event.model;
      target.identities.push(...duplicate.identities);
    }
    for (const i of matches.slice(1)) slots[i] = null;
    target.event.totalTokens =
      target.event.inputTokens +
      target.event.cachedInputTokens +
      target.event.cacheCreationTokens +
      target.event.outputTokens +
      target.event.reasoningOutputTokens;
    slots[index] = target;
    for (const id of target.identities) indexes.set(id, index);
  }
  return slots
    .filter((row): row is IdentifiedUsage => !!row)
    .map((row) => row.event);
}

export async function collectAntigravity(home: string) {
  const roots = sourceRoots("ANTIGRAVITY_DATA_DIR", home, [
    ".gemini/antigravity/conversations",
    ".gemini/antigravity-cli/conversations",
    ".gemini/antigravity-ide/conversations",
    ".gemini/antigravity-backup/conversations",
    ".config/antigravity/conversations",
  ]);
  const files = [
    ...new Set(
      (
        await Promise.all(
          roots.map((root) => storeFiles(root, (file) => file.endsWith(".db"))),
        )
      ).flat(),
    ),
  ];
  const parsed: IdentifiedUsage[] = [];
  for (const file of files) {
    const stat = await fs.stat(file);
    if (!stat.size) continue;
    const snapshot = await archivedSqliteSnapshot(file);
    try {
      const database = snapshot.path;
      if (!(await tableColumns(database, "gen_metadata")).has("data")) continue;
      const generation = (
        await sqliteRows<{ hex: string }>(
          database,
          "SELECT hex(data) AS hex FROM gen_metadata ORDER BY idx;",
        )
      ).map((row) => parseAntigravityMetadata(row.hex, false));
      const stepColumns = await tableColumns(database, "steps");
      const steps = stepColumns.has("metadata")
        ? (
            await sqliteRows<{ hex: string }>(
              database,
              "SELECT hex(metadata) AS hex FROM steps WHERE metadata IS NOT NULL ORDER BY idx;",
            )
          ).map((row) => parseAntigravityMetadata(row.hex, true))
        : [];
      const trajectoryColumns = await tableColumns(
        database,
        "trajectory_metadata_blob",
      );
      const trajectories = trajectoryColumns.has("data")
        ? await sqliteRows<{ hex: string }>(
            database,
            "SELECT hex(data) AS hex FROM trajectory_metadata_blob ORDER BY rowid;",
          )
        : [];
      const trajectoryTime = trajectories
        .map((row) =>
          timestamp(nested(decodeProto(Buffer.from(row.hex, "hex")), 2)),
        )
        .find(Boolean);
      const generationModel = [...generation]
        .reverse()
        .find((row) => row.model)?.model;
      let currentModel: string | undefined;
      for (const meta of [...steps, ...generation]) {
        if (meta === generation[0]) currentModel = undefined;
        currentModel = meta.model || currentModel;
        for (const usage of meta.usages) {
          const identities = (
            [
              [11, "response"],
              [12, "provider"],
              [7, "message"],
            ] as const
          ).flatMap(([field, name]) =>
            text(usage, field) ? [`${name}:${text(usage, field)}`] : [],
          );
          const output = Math.max(
            number(usage, 3),
            number(usage, 10) + number(usage, 9),
          );
          const visible = Math.max(
            number(usage, 10),
            output - number(usage, 9),
          );
          const time = meta.time || trajectoryTime || stat.mtime.toISOString();
          const event = makeUsageEvent({
            agent: "antigravity",
            model:
              normalizeModel(modelName(number(usage, 1))) ||
              currentModel ||
              (steps.includes(meta) ? generationModel : undefined) ||
              "gemini-internal-model",
            sourcePath: file,
            sessionId: path.basename(file, ".db"),
            timestamp: time,
            inputTokens: number(usage, 2),
            cachedInputTokens: number(usage, 5),
            cacheCreationTokens: number(usage, 4),
            outputTokens: visible,
            reasoningOutputTokens: output - visible,
          });
          if (event)
            parsed.push({
              event,
              identities,
              rank: meta.time ? 3 : trajectoryTime ? 1 : 0,
            });
        }
      }
    } finally {
      await snapshot.close();
    }
  }
  return {
    events: mergeAntigravityUsage(parsed),
    source: {
      agent: "antigravity",
      path: roots.join(","),
      files: files.length,
      exists: files.length > 0,
    },
  };
}
