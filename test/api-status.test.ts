import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { getApiTokenStatus, getUploadApiTokenStatus } from "../src/api.js";

let server: http.Server | null = null;

afterEach(async () => {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server?.close((error) => (error ? reject(error) : resolve()));
  });
  server = null;
});

describe("API token remote status", () => {
  it("reads account and scope from the server /api/me endpoint", async () => {
    const requests: Array<{ url: string | undefined; auth: string | undefined }> = [];
    server = http.createServer((request, response) => {
      requests.push({ url: request.url, auth: request.headers.authorization });
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          authenticated: true,
          user: {
            id: "usr_123",
            email: "user@example.com",
            name: "Chunqiu",
            api_key_scope: "read_write",
          },
        }),
      );
    });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing server address");

    const status = await getApiTokenStatus(`http://127.0.0.1:${address.port}`, "tu_api_test");

    expect(requests).toEqual([{ url: "/api/me", auth: "Bearer tu_api_test" }]);
    expect(status).toEqual({
      authenticated: true,
      account: {
        id: "usr_123",
        email: "user@example.com",
        name: "Chunqiu",
      },
      scope: "read_write",
    });
  });

  it("rejects read-only API tokens for upload configuration", async () => {
    server = http.createServer((_request, response) => {
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          authenticated: true,
          user: {
            id: "usr_123",
            email: "user@example.com",
            name: "Chunqiu",
            api_key_scope: "read_only",
          },
        }),
      );
    });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing server address");

    await expect(getUploadApiTokenStatus(`http://127.0.0.1:${address.port}`, "tu_api_readonly")).rejects.toThrow(
      "Read-write API key required for uploads",
    );
  });

  it("includes the target server URL when a request cannot be reached", async () => {
    await expect(getApiTokenStatus("http://127.0.0.1:9", "tu_api_test")).rejects.toThrow(
      "Unable to reach TokenFlow server at http://127.0.0.1:9/api/me",
    );
  });
});
