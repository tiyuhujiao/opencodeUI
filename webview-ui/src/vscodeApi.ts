export type VsCodeApi = {
  postMessage(message: unknown): void;
  getState<T = unknown>(): T | undefined;
  setState<T>(state: T): T;
};

type WebviewState = {
  selectedSessionId?: string | null;
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

export function readPersistedSessionId(api: VsCodeApi | undefined): string | null {
  try {
    const state = api?.getState<WebviewState>();
    const sessionId = state?.selectedSessionId;
    return typeof sessionId === 'string' && sessionId.trim().length > 0 ? sessionId : null;
  } catch {
    return null;
  }
}

export function persistSessionId(api: VsCodeApi | undefined, sessionId: string | null): void {
  try {
    const current = api?.getState<WebviewState>() ?? {};
    api?.setState({ ...current, selectedSessionId: sessionId });
  } catch {
    // A constrained host may not expose webview state; the live UI remains usable.
  }
}
