type VsCodeApi = {
  postMessage(message: unknown): void;
};

declare global {
  interface Window {
    acquireVsCodeApi?: () => VsCodeApi;
  }
}

let cachedApi: VsCodeApi | undefined;

export function getVsCodeApi(): VsCodeApi | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }

  if (cachedApi) {
    return cachedApi;
  }

  if (typeof window.acquireVsCodeApi !== 'function') {
    return undefined;
  }

  try {
    cachedApi = window.acquireVsCodeApi();
    return cachedApi;
  } catch {
    // VS Code webviews allow acquiring API only once.
    return cachedApi;
  }
}

export function createRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
