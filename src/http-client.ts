let configuredFetch: typeof fetch | undefined;

// Desktop uses Chromium networking so collection follows the OS proxy settings.
export function setHttpClient(client: typeof fetch): void { configuredFetch = client; }
export function tokenFlowFetch(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): ReturnType<typeof fetch> {
  return (configuredFetch || fetch)(input, init);
}
