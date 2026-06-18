export const WEBVIEW_REQUEST_WHITELIST = [
  'webview.ready',
  'sessions.list',
  'session.export',
  'session.timeline',
  'session.undo',
  'session.redo',
  'session.delete',
  'permission.reply',
  'question.reply',
  'question.reject',
  'file.open',
  'tempfile.write',
  'providers.list',
  'models.list',
  'models.list.byProvider',
  'agents.list',
  'selfcheck.run',
  'run.start',
  'run.stop'
] as const;

export type WebviewRequestType = (typeof WEBVIEW_REQUEST_WHITELIST)[number];

export type WebviewReadyRequest = {
  type: 'webview.ready';
  requestId: string;
};

export type SessionsListRequest = {
  type: 'sessions.list';
  requestId: string;
};

export type SessionExportRequest = {
  type: 'session.export';
  requestId: string;
  payload: {
    sessionId: string;
  };
};

export type SessionDeleteRequest = {
  type: 'session.delete';
  requestId: string;
  payload: {
    sessionId: string;
  };
};

export type SessionTimelineRequest = {
  type: 'session.timeline';
  requestId: string;
  payload: {
    sessionId: string;
  };
};

export type SessionUndoRequest = {
  type: 'session.undo';
  requestId: string;
  payload: {
    sessionId: string;
  };
};

export type SessionRedoRequest = {
  type: 'session.redo';
  requestId: string;
  payload: {
    sessionId: string;
  };
};

export type TempfileWriteRequest = {
  type: 'tempfile.write';
  requestId: string;
  payload: {
    fileName: string;
    bytesBase64: string;
    mimeType?: string;
  };
};

export type ProvidersListRequest = {
  type: 'providers.list';
  requestId: string;
  payload?: {
    forceRefresh?: boolean;
  };
};

export type ModelsListRequest = {
  type: 'models.list';
  requestId: string;
  payload?: {
    forceRefresh?: boolean;
  };
};

export type ModelsListByProviderRequest = {
  type: 'models.list.byProvider';
  requestId: string;
  payload: {
    providerId: string;
    forceRefresh?: boolean;
  };
};

export type AgentsListRequest = {
  type: 'agents.list';
  requestId: string;
};

export type SelfcheckRunRequest = {
  type: 'selfcheck.run';
  requestId: string;
};

export type RunStartRequest = {
  type: 'run.start';
  requestId: string;
  payload: {
    message: string;
    model: string;
    agent: string;
    sessionId?: string;
    title?: string;
    thinking?: boolean;
    variant?: string;
    files?: string[];
  };
};

export type RunStopRequest = {
  type: 'run.stop';
  requestId: string;
};

export type WebviewRequestMessage =
  | WebviewReadyRequest
  | SessionsListRequest
  | SessionExportRequest
  | SessionTimelineRequest
  | SessionUndoRequest
  | SessionRedoRequest
  | SessionDeleteRequest
  | PermissionReplyRequest
  | QuestionReplyRequest
  | QuestionRejectRequest
  | FileOpenRequest
  | TempfileWriteRequest
  | ProvidersListRequest
  | ModelsListRequest
  | ModelsListByProviderRequest
  | AgentsListRequest
  | SelfcheckRunRequest
  | RunStartRequest
  | RunStopRequest;

export type SessionSummary = {
  id: string;
  title: string;
  updated: string;
};

export type HostKind = 'local-windows' | 'local-linux' | 'wsl' | 'remote-ssh-linux' | 'remote-linux' | 'unsupported';

export type OpencodeCompatibility = {
  binary: string;
  minimumVersion: string;
  isCompatible: boolean;
  version?: string;
  warning?: string;
};

export type WebviewReadyAckMessage = {
  type: 'webview.ready.ack';
  requestId: string;
  ok: true;
  payload: {
    hostKind: HostKind;
    isSupportedHost: boolean;
    remoteName?: string;
    workspaceFolderPath?: string;
    lastSelectedModel?: string;
    lastSelectedAgent?: string;
    opencode?: OpencodeCompatibility;
  };
};

export type WebviewErrorMessage = {
  type: 'webview.error';
  requestId: string;
  ok: false;
  error: string;
};

export type SessionsListResponseMessage = {
  type: 'sessions.list.response';
  requestId: string;
  ok: true;
  payload: {
    sessions: SessionSummary[];
  };
};

export type TranscriptRole = 'user' | 'assistant' | 'unknown';

export type TranscriptPartText = {
  type: 'text';
  text: string;
};

export type TranscriptPartReasoning = {
  type: 'reasoning';
  text: string;
  raw?: unknown;
};

export type TranscriptPartTool = {
  type: 'tool';
  toolName: string;
  status: string;
  raw: unknown;
};

export type TranscriptPartImage = {
  type: 'image';
  src: string;
  alt?: string;
};

export type TranscriptPartUnknown = {
  type: 'unknown';
  raw: unknown;
};

export type TranscriptPart =
  | TranscriptPartText
  | TranscriptPartReasoning
  | TranscriptPartTool
  | TranscriptPartImage
  | TranscriptPartUnknown;

export type TranscriptMessage = {
  role: TranscriptRole;
  parts: TranscriptPart[];
};

export type SessionExportResponseMessage = {
  type: 'session.export.response';
  requestId: string;
  ok: true;
  payload: {
    messages: TranscriptMessage[];
  };
};

export type SessionDeleteResponseMessage = {
  type: 'session.delete.response';
  requestId: string;
  ok: true;
  payload: {
    deleted: boolean;
  };
};

export type SessionTimelineItem = {
  messageId: string;
  created: number;
  text: string;
  assistantText: string;
  toolCount: number;
  reasoningCount: number;
  stepCount: number;
};

export type SessionTimelineResponseMessage = {
  type: 'session.timeline.response';
  requestId: string;
  ok: true;
  payload: {
    sessionId: string;
    revertMessageId?: string;
    items: SessionTimelineItem[];
  };
};

export type SessionUndoResponseMessage = {
  type: 'session.undo.response';
  requestId: string;
  ok: true;
  payload: {
    changed: boolean;
    sessionId: string;
    revertMessageId?: string;
    composerText?: string;
  };
};

export type SessionRedoResponseMessage = {
  type: 'session.redo.response';
  requestId: string;
  ok: true;
  payload: {
    changed: boolean;
    sessionId: string;
    revertMessageId?: string;
    composerText?: string;
  };
};

export type TempfileWriteResponseMessage = {
  type: 'tempfile.write.response';
  requestId: string;
  ok: true;
  payload: {
    filePath: string;
  };
};

export type ModelSummary = {
  name: string;
  variants?: string[];
  supportsThinking?: boolean;
};

export type ProviderSummary = {
  id: string;
  label: string;
};

export type ProvidersListResponseMessage = {
  type: 'providers.list.response';
  requestId: string;
  ok: true;
  payload: {
    providers: ProviderSummary[];
  };
};

export type AgentSummary = {
  name: string;
  isPrimary: boolean;
};

export type ModelsListResponseMessage = {
  type: 'models.list.response';
  requestId: string;
  ok: true;
  payload: {
    models: ModelSummary[];
  };
};

export type AgentsListResponseMessage = {
  type: 'agents.list.response';
  requestId: string;
  ok: true;
  payload: {
    agents: AgentSummary[];
  };
};

export type RunStartResponseMessage = {
  type: 'run.start.response';
  requestId: string;
  ok: true;
};

export type RunStopResponseMessage = {
  type: 'run.stop.response';
  requestId: string;
  ok: true;
  payload: {
    stopped: boolean;
  };
};

export type RunStreamEvent =
  | {
      type: 'part';
      part: TranscriptPart;
    }
  | {
      type: 'permission';
      permissionId: string;
      sessionId: string;
      toolName: string;
      patterns: string[];
      message?: string;
    }
  | {
      type: 'question';
      questionId: string;
      sessionId: string;
      questions: QuestionInfo[];
    }
  | {
      type: 'session';
      sessionId: string;
    }
  | {
      type: 'error';
      error: string;
    }
  | {
      type: 'done' | 'stopped';
    };

export type RunEventMessage = {
  type: 'run.event';
  requestId: string;
  ok: true;
  payload: {
    event: RunStreamEvent;
  };
};

export type PermissionReplyRequest = {
  type: 'permission.reply';
  requestId: string;
  payload: {
    permissionId: string;
    reply: 'once' | 'always' | 'reject';
    message?: string;
  };
};

export type QuestionOption = {
  label: string;
  description: string;
};

export type QuestionInfo = {
  header: string;
  question: string;
  options: QuestionOption[];
  multiple?: boolean;
  custom?: boolean;
};

export type QuestionReplyRequest = {
  type: 'question.reply';
  requestId: string;
  payload: {
    questionId: string;
    answers: string[][];
  };
};

export type QuestionRejectRequest = {
  type: 'question.reject';
  requestId: string;
  payload: {
    questionId: string;
  };
};

export type FileOpenRequest = {
  type: 'file.open';
  requestId: string;
  payload: {
    path: string;
  };
};

export type FileOpenResponseMessage = {
  type: 'file.open.response';
  requestId: string;
  ok: true;
  payload: {
    path: string;
  };
};

export type PermissionReplyResponseMessage = {
  type: 'permission.reply.response';
  requestId: string;
  ok: true;
  payload: {
    permissionId: string;
    reply: 'once' | 'always' | 'reject';
  };
};

export type QuestionReplyResponseMessage = {
  type: 'question.reply.response';
  requestId: string;
  ok: true;
  payload: {
    questionId: string;
  };
};

export type QuestionRejectResponseMessage = {
  type: 'question.reject.response';
  requestId: string;
  ok: true;
  payload: {
    questionId: string;
  };
};

export type SelfcheckResponseMessage = {
  type: 'selfcheck.response';
  requestId: string;
  ok: true;
  payload: {
    hostKind: HostKind;
    isSupportedHost: boolean;
    remoteName?: string;
    opencodeBinary: string;
    opencode?: OpencodeCompatibility;
    sessions: { ok: true; count: number } | { ok: false; error: string };
    models: { ok: true; count: number } | { ok: false; error: string };
    agents: { ok: true; count: number } | { ok: false; error: string };
  };
};

export type ExtensionResponseMessage =
  | WebviewReadyAckMessage
  | SessionsListResponseMessage
  | SessionExportResponseMessage
  | SessionTimelineResponseMessage
  | SessionUndoResponseMessage
  | SessionRedoResponseMessage
  | SessionDeleteResponseMessage
  | PermissionReplyResponseMessage
  | QuestionReplyResponseMessage
  | QuestionRejectResponseMessage
  | FileOpenResponseMessage
  | TempfileWriteResponseMessage
  | ProvidersListResponseMessage
  | ModelsListResponseMessage
  | AgentsListResponseMessage
  | SelfcheckResponseMessage
  | RunStartResponseMessage
  | RunStopResponseMessage
  | RunEventMessage
  | WebviewErrorMessage;

export type SidebarMessage = WebviewRequestMessage | ExtensionResponseMessage;

const WEBVIEW_REQUEST_WHITELIST_SET = new Set<string>(WEBVIEW_REQUEST_WHITELIST);
const EXTENSION_RESPONSE_TYPE_SET = new Set<string>([
  'webview.ready.ack',
  'sessions.list.response',
  'session.export.response',
  'session.timeline.response',
  'session.undo.response',
  'session.redo.response',
  'session.delete.response',
  'file.open.response',
  'tempfile.write.response',
  'providers.list.response',
  'models.list.response',
  'agents.list.response',
  'run.start.response',
  'run.stop.response',
  'permission.reply.response',
  'question.reply.response',
  'question.reject.response',
  'run.event',
  'selfcheck.response',
  'webview.error'
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isWhitelistedWebviewRequestType(type: unknown): type is WebviewRequestType {
  return typeof type === 'string' && WEBVIEW_REQUEST_WHITELIST_SET.has(type);
}

export function getRequestIdFromUnknown(message: unknown): string | undefined {
  if (!isObject(message)) {
    return undefined;
  }

  return typeof message.requestId === 'string' ? message.requestId : undefined;
}

export function isExtensionResponseMessage(message: unknown): message is ExtensionResponseMessage {
  if (!isObject(message)) {
    return false;
  }

  if (typeof message.type !== 'string' || !EXTENSION_RESPONSE_TYPE_SET.has(message.type)) {
    return false;
  }

  if (typeof message.requestId !== 'string' || message.requestId.length === 0) {
    return false;
  }

  if (typeof message.ok !== 'boolean') {
    return false;
  }

  return true;
}

export function isWebviewRequestMessage(message: unknown): message is WebviewRequestMessage {
  if (!isObject(message)) {
    return false;
  }

  if (!isWhitelistedWebviewRequestType(message.type)) {
    return false;
  }

  if (typeof message.requestId !== 'string' || message.requestId.length === 0) {
    return false;
  }

  if (message.type === 'session.export') {
    if (!isObject(message.payload)) {
      return false;
    }

    if (typeof message.payload.sessionId !== 'string' || message.payload.sessionId.trim().length === 0) {
      return false;
    }
  }

   if (message.type === 'session.timeline' || message.type === 'session.undo' || message.type === 'session.redo') {
    if (!isObject(message.payload)) {
      return false;
    }

    if (typeof message.payload.sessionId !== 'string' || message.payload.sessionId.trim().length === 0) {
      return false;
    }
  }

  if (message.type === 'session.delete') {
    if (!isObject(message.payload)) {
      return false;
    }

    if (typeof message.payload.sessionId !== 'string' || message.payload.sessionId.trim().length === 0) {
      return false;
    }
  }

  if (message.type === 'permission.reply') {
    if (!isObject(message.payload)) {
      return false;
    }

    if (typeof message.payload.permissionId !== 'string' || message.payload.permissionId.trim().length === 0) {
      return false;
    }

    if (!['once', 'always', 'reject'].includes(String(message.payload.reply))) {
      return false;
    }

    if (typeof message.payload.message !== 'undefined' && typeof message.payload.message !== 'string') {
      return false;
    }
  }

  if (message.type === 'question.reply') {
    if (!isObject(message.payload)) {
      return false;
    }

    if (typeof message.payload.questionId !== 'string' || message.payload.questionId.trim().length === 0) {
      return false;
    }

    if (!Array.isArray(message.payload.answers)) {
      return false;
    }

    if (!message.payload.answers.every((answer) => Array.isArray(answer) && answer.every((item) => typeof item === 'string'))) {
      return false;
    }
  }

  if (message.type === 'question.reject') {
    if (!isObject(message.payload)) {
      return false;
    }

    if (typeof message.payload.questionId !== 'string' || message.payload.questionId.trim().length === 0) {
      return false;
    }
  }

  if (message.type === 'file.open') {
    if (!isObject(message.payload)) {
      return false;
    }

    if (typeof message.payload.path !== 'string' || message.payload.path.trim().length === 0) {
      return false;
    }
  }

  if (message.type === 'tempfile.write') {
    if (!isObject(message.payload)) {
      return false;
    }

    if (typeof message.payload.fileName !== 'string' || message.payload.fileName.trim().length === 0) {
      return false;
    }

    if (typeof message.payload.bytesBase64 !== 'string' || message.payload.bytesBase64.trim().length === 0) {
      return false;
    }

    if (typeof message.payload.mimeType !== 'undefined' && typeof message.payload.mimeType !== 'string') {
      return false;
    }
  }

  if (message.type === 'providers.list' || message.type === 'models.list') {
    if (typeof message.payload !== 'undefined') {
      if (!isObject(message.payload)) {
        return false;
      }

      if (typeof message.payload.forceRefresh !== 'undefined' && typeof message.payload.forceRefresh !== 'boolean') {
        return false;
      }
    }
  }

  if (message.type === 'run.start') {
    if (!isObject(message.payload)) {
      return false;
    }

    if (Array.isArray(message.payload.files)) {
      for (const file of message.payload.files) {
        if (typeof file !== 'string' || file.trim().length === 0) {
          return false;
        }
      }
    }
  }

  if (message.type === 'models.list.byProvider') {
    if (!isObject(message.payload)) {
      return false;
    }

    if (typeof message.payload.providerId !== 'string' || message.payload.providerId.trim().length === 0) {
      return false;
    }

    if (typeof message.payload.forceRefresh !== 'undefined' && typeof message.payload.forceRefresh !== 'boolean') {
      return false;
    }
  }

  if (message.type === 'run.start') {
    if (!isObject(message.payload)) {
      return false;
    }

    if (typeof message.payload.message !== 'string' || message.payload.message.trim().length === 0) {
      return false;
    }

    if (typeof message.payload.model !== 'string' || message.payload.model.trim().length === 0) {
      return false;
    }

    if (typeof message.payload.agent !== 'string' || message.payload.agent.trim().length === 0) {
      return false;
    }

    if (typeof message.payload.sessionId !== 'undefined') {
      if (typeof message.payload.sessionId !== 'string' || message.payload.sessionId.trim().length === 0) {
        return false;
      }
    }

    if (typeof message.payload.title !== 'undefined') {
      if (typeof message.payload.title !== 'string') {
        return false;
      }
    }

    if (typeof message.payload.thinking !== 'undefined') {
      if (typeof message.payload.thinking !== 'boolean') {
        return false;
      }
    }

    if (typeof message.payload.variant !== 'undefined') {
      if (typeof message.payload.variant !== 'string') {
        return false;
      }
    }
  }

  return true;
}
