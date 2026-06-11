import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { main } from "../src/cli.js";

const originalEnv = { ...process.env };

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...originalEnv };
});

describe("device name CLI settings", () => {
  it("stores the init device name without starting login", async () => {
    const root = await prepareHome("tokenflow-init-device-name-");
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await main(["init", "--device-name", "Private Mac", "--no-login", "--no-auto-sync"]);

    const config = JSON.parse(await fs.readFile(path.join(root, "tokenflow", "config.json"), "utf8")) as {
      deviceName?: string;
    };
    expect(config.deviceName).toBe("Private Mac");
  });

  it("renames the local device and remote current device when requested", async () => {
    const root = await prepareHome("tokenflow-device-name-");
    const server = await startRenameServer();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await fs.mkdir(path.join(root, "tokenflow"), { recursive: true });
    await fs.writeFile(
      path.join(root, "tokenflow", "config.json"),
      `${JSON.stringify({
        serverUrl: server.url,
        deviceToken: "tu_dev_test",
        deviceId: "dev_test",
        deviceName: "Old Mac",
        installedAt: "2026-06-11T00:00:00.000Z",
      })}\n`,
    );

    try {
      await main(["device-name", "Private Mac", "--remote"]);
    } finally {
      await server.close();
    }

    const config = JSON.parse(await fs.readFile(path.join(root, "tokenflow", "config.json"), "utf8")) as {
      deviceName?: string;
    };
    expect(config.deviceName).toBe("Private Mac");
    expect(server.renameCalls).toEqual([{ device_name: "Private Mac" }]);
  });
});

async function prepareHome(prefix: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  process.env.TOKENFLOW_HOME = path.join(root, "tokenflow");
  return root;
}

async function startRenameServer(): Promise<{
  url: string;
  renameCalls: Array<Record<string, unknown>>;
  close: () => Promise<void>;
}> {
  const renameCalls: Array<Record<string, unknown>> = [];
  const server = createServer(async (request, response) => {
    if (request.method === "PATCH" && request.url === "/api/device") {
      renameCalls.push(await readJson(request));
      return json(response, { ok: true, device_id: "dev_test", device_name: "Private Mac" });
    }

    response.statusCode = 404;
    return json(response, { error: "not found" });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("HTTP server did not bind to a TCP port");

  return {
    url: `http://127.0.0.1:${address.port}`,
    renameCalls,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of request) {
    raw += String(chunk);
  }
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

function json(response: ServerResponse, body: Record<string, unknown>): void {
  response.writeHead(response.statusCode === 404 ? 404 : 200, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}
