export interface FetchProgress {
  totalRequests: number;
  completedRequests: number;
  failedRequests: number;
  activeRequests: number;
  receivedBytes: number;
  totalBytes: number | null;
  percent: number;
}

/** Measures actual HTTP responses; compressed/unknown lengths use completed request counts. */
export class NetworkProgress {
  private requests: Array<{
    bytes: number;
    total: number | null;
    done: boolean;
    failed: boolean;
  }> = [];
  private active = 0;
  private lastEmission = 0;
  constructor(private changed: (progress: FetchProgress) => void) {}

  async fetch(
    input: string | URL | Request,
    init: RequestInit | undefined,
    fetcher: typeof fetch,
  ): Promise<Response> {
    if (!this.active) this.requests = [];
    const item = {
      bytes: 0,
      total: null as number | null,
      done: false,
      failed: false,
    };
    this.requests.push(item);
    this.active++;
    this.emit(true);
    try {
      const response = await fetcher(input, init);
      const length = response.headers.get("content-length");
      if (
        length !== null &&
        !response.headers.get("content-encoding") &&
        /^\d+$/.test(length)
      )
        item.total = Number(length);
      const chunks: Uint8Array[] = [];
      if (response.body) {
        const reader = response.body.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            const firstChunk = item.bytes === 0;
            chunks.push(value);
            item.bytes += value.byteLength;
            this.emit(firstChunk);
          }
        } finally {
          reader.releaseLock();
        }
      }
      item.failed = !response.ok && response.status !== 304;
      const result = new Response(
        [204, 205, 304].includes(response.status) || init?.method === "HEAD"
          ? null
          : Buffer.concat(chunks),
        {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        },
      );
      Object.defineProperties(result, {
        url: { value: response.url },
        redirected: { value: response.redirected },
      });
      return result;
    } catch (error) {
      item.failed = true;
      throw error;
    } finally {
      item.done = true;
      this.active--;
      this.emit(true);
    }
  }

  private emit(force = false): void {
    if (!force && Date.now() - this.lastEmission < 100) return;
    this.lastEmission = Date.now();
    const totalRequests = this.requests.length;
    const completedRequests = this.requests.filter((item) => item.done).length;
    const receivedBytes = this.requests.reduce(
      (sum, item) => sum + item.bytes,
      0,
    );
    const known = this.requests.every(
      (item) => item.total !== null && !item.failed,
    );
    const totalBytes = known
      ? this.requests.reduce((sum, item) => sum + item.total!, 0)
      : null;
    const fraction = totalBytes
      ? receivedBytes / totalBytes
      : completedRequests / totalRequests;
    this.changed({
      totalRequests,
      completedRequests,
      activeRequests: this.active,
      failedRequests: this.requests.filter((item) => item.failed).length,
      receivedBytes,
      totalBytes,
      percent: Math.max(0, Math.min(this.active ? 99.9 : 100, fraction * 100)),
    });
  }
}
