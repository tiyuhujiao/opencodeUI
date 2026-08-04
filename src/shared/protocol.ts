export const WEBVIEW_REQUEST_WHITELIST = [
  'webview.ready',
  'sessions.list',
  'session.export',
  'session.export.markdown',
  'subtask.transcript',
  'session.timeline',
  'session.undo',
  'session.redo',
  'session.delete',
  'permission.reply',
  'question.reply',
  'question.reject',
  'file.open',
  'inlineDiff.open',
  'inlineDiff.dismiss',
  'tempfile.write',
  'providers.list',
  'models.list',
  'models.list.byProvider',
  'agents.list',
  'composer.resources.list',
  'mcp.setEnabled',
  'workspace.resources.search',
  'workspace.resources.resolve',
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

export type SessionMarkdownExportRequest = {
  type: 'session.export.markdown';
  requestId: string;
  payload: {
    sessionId: string;
    filename: string;
    includeThinking: boolean;
    includeToolDetails: boolean;
    includeAssistantMetadata: boolean;
    openWithoutSaving: boolean;
  };
};

export type SubtaskTranscriptRequest = {
  type: 'subtask.transcript';
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

export type ComposerResourcesListRequest = {
  type: 'composer.resources.list';
  requestId: string;
};

export type McpSetEnabledRequest = {
  type: 'mcp.setEnabled';
  requestId: string;
  payload: {
    name: string;
    enabled: boolean;
  };
};

export type WorkspaceResourcesSearchRequest = {
  type: 'workspace.resources.search';
  requestId: string;
  payload: {
    query: string;
  };
};

export type WorkspaceResourcesResolveRequest = {
  type: 'workspace.resources.resolve';
  requestId: string;
  payload: {
    values: string[];
  };
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
    command?: {
      name: string;
      arguments: string;
    };
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
  | SessionMarkdownExportRequest
  | SubtaskTranscriptRequest
  | SessionTimelineRequest
  | SessionUndoRequest
  | SessionRedoRequest
  | SessionDeleteRequest
  | PermissionReplyRequest
  | QuestionReplyRequest
  | QuestionRejectRequest
  | FileOpenRequest
  | InlineDiffOpenRequest
  | InlineDiffDismissRequest
  | TempfileWriteRequest
  | ProvidersListRequest
  | ModelsListRequest
  | ModelsListByProviderRequest
  | AgentsListRequest
  | ComposerResourcesListRequest
  | McpSetEnabledRequest
  | WorkspaceResourcesSearchRequest
  | WorkspaceResourcesResolveRequest
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
  contextUsage?: ContextUsage;
};

export type ContextUsage = {
  usedTokens: number;
  model?: string;
};

export type SessionExportResponseMessage = {
  type: 'session.export.response';
  requestId: string;
  ok: true;
  payload: {
    messages: TranscriptMessage[];
  };
};

export type SessionMarkdownExportResponseMessage = {
  type: 'session.export.markdown.response';
  requestId: string;
  ok: true;
  payload: {
    opened: true;
    filePath?: string;
  };
};

export type SubtaskTranscriptResponseMessage = {
  type: 'subtask.transcript.response';
  requestId: string;
  ok: true;
  payload: {
    sessionId: string;
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
  contextWindow?: number;
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

export type ComposerCommandSummary = {
  name: string;
  description?: string;
  source?: 'command' | 'mcp' | 'skill';
  hints: string[];
};

export type ComposerSkillSummary = {
  name: string;
  description?: string;
};

export type ComposerMcpServerSummary = {
  name: string;
  status: string;
  enabled: boolean;
  error?: string;
};

export type WorkspaceResourceSummary = {
  kind: 'file' | 'folder';
  path: string;
  absolutePath: string;
};

export type ComposerResourcesListResponseMessage = {
  type: 'composer.resources.list.response';
  requestId: string;
  ok: true;
  payload: {
    commands: ComposerCommandSummary[];
    skills: ComposerSkillSummary[];
    mcpServers: ComposerMcpServerSummary[];
    mcpError?: string;
  };
};

export type McpSetEnabledResponseMessage = {
  type: 'mcp.setEnabled.response';
  requestId: string;
  ok: true;
  payload: {
    server: ComposerMcpServerSummary;
  };
};

export type WorkspaceResourcesSearchResponseMessage = {
  type: 'workspace.resources.search.response';
  requestId: string;
  ok: true;
  payload: {
    query: string;
    resources: WorkspaceResourceSummary[];
  };
};

export type WorkspaceResourcesResolveResponseMessage = {
  type: 'workspace.resources.resolve.response';
  requestId: string;
  ok: true;
  payload: {
    resources: WorkspaceResourceSummary[];
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
      type: 'context.usage';
      usage: ContextUsage;
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
    line?: number;
    column?: number;
  };
};

export type InlineDiffOpenRequest = {
  type: 'inlineDiff.open';
  requestId: string;
  payload: {
    fileId: string;
  };
};

export type InlineDiffDismissRequest = {
  type: 'inlineDiff.dismiss';
  requestId: string;
  payload: {
    fileId: string;
  };
};

export type FileOpenResponseMessage = {
  type: 'file.open.response';
  requestId: string;
  ok: true;
  payload: {
    path: string;
    line?: number;
    column?: number;
  };
};

export type InlineDiffFileStatus = 'pending' | 'stale' | 'unavailable';

export type InlineDiffFileSummary = {
  fileId: string;
  path: string;
  displayPath: string;
  additions: number;
  deletions: number;
  hunks: number;
  status: InlineDiffFileStatus;
  reason?: string;
};

export type InlineDiffOpenResponseMessage = {
  type: 'inlineDiff.open.response';
  requestId: string;
  ok: true;
  payload: {
    fileId: string;
  };
};

export type InlineDiffDismissResponseMessage = {
  type: 'inlineDiff.dismiss.response';
  requestId: string;
  ok: true;
  payload: {
    fileId: string;
  };
};

export type InlineDiffStateMessage = {
  type: 'inlineDiff.state';
  requestId: string;
  ok: true;
  payload: {
    revision: number;
    files: InlineDiffFileSummary[];
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
    health: { ok: true; version?: string } | { ok: false; error: string };
    sessions: { ok: true; count: number } | { ok: false; error: string };
    models: { ok: true; count: number } | { ok: false; error: string };
    agents: { ok: true; count: number } | { ok: false; error: string };
  };
};

export type ExtensionResponseMessage =
  | WebviewReadyAckMessage
  | SessionsListResponseMessage
  | SessionExportResponseMessage
  | SessionMarkdownExportResponseMessage
  | SubtaskTranscriptResponseMessage
  | SessionTimelineResponseMessage
  | SessionUndoResponseMessage
  | SessionRedoResponseMessage
  | SessionDeleteResponseMessage
  | PermissionReplyResponseMessage
  | QuestionReplyResponseMessage
  | QuestionRejectResponseMessage
  | FileOpenResponseMessage
  | InlineDiffOpenResponseMessage
  | InlineDiffDismissResponseMessage
  | InlineDiffStateMessage
  | TempfileWriteResponseMessage
  | ProvidersListResponseMessage
  | ModelsListResponseMessage
  | AgentsListResponseMessage
  | ComposerResourcesListResponseMessage
  | McpSetEnabledResponseMessage
  | WorkspaceResourcesSearchResponseMessage
  | WorkspaceResourcesResolveResponseMessage
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
  'session.export.markdown.response',
  'subtask.transcript.response',
  'session.timeline.response',
  'session.undo.response',
  'session.redo.response',
  'session.delete.response',
  'file.open.response',
  'inlineDiff.open.response',
  'inlineDiff.dismiss.response',
  'inlineDiff.state',
  'tempfile.write.response',
  'providers.list.response',
  'models.list.response',
  'agents.list.response',
  'composer.resources.list.response',
  'mcp.setEnabled.response',
  'workspace.resources.search.response',
  'workspace.resources.resolve.response',
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

  if (message.type === 'subtask.transcript.response') {
    return message.ok === true
      && isObject(message.payload)
      && isNonEmptyString(message.payload.sessionId)
      && Array.isArray(message.payload.messages);
  }

  if (message.type === 'inlineDiff.open.response' || message.type === 'inlineDiff.dismiss.response') {
    return message.ok === true && isObject(message.payload) && isNonEmptyString(message.payload.fileId);
  }

  if (message.type === 'inlineDiff.state') {
    if (message.ok !== true || !isObject(message.payload) || !isNonNegativeInteger(message.payload.revision) || !Array.isArray(message.payload.files)) {
      return false;
    }

    return message.payload.files.every(isInlineDiffFileSummary);
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

  if (message.type === 'session.export' || message.type === 'subtask.transcript') {
    if (!isObject(message.payload)) {
      return false;
    }

    if (typeof message.payload.sessionId !== 'string' || message.payload.sessionId.trim().length === 0) {
      return false;
    }
  }

  if (message.type === 'session.export.markdown') {
    if (!isObject(message.payload)) {
      return false;
    }

    if (!isNonEmptyString(message.payload.sessionId) || !isNonEmptyString(message.payload.filename)) {
      return false;
    }

    if (
      typeof message.payload.includeThinking !== 'boolean'
      || typeof message.payload.includeToolDetails !== 'boolean'
      || typeof message.payload.includeAssistantMetadata !== 'boolean'
      || typeof message.payload.openWithoutSaving !== 'boolean'
    ) {
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

    for (const key of ['line', 'column'] as const) {
      const value = message.payload[key];
      if (typeof value !== 'undefined' && (typeof value !== 'number' || !Number.isInteger(value) || value < 1)) {
        return false;
      }
    }
  }

  if (message.type === 'mcp.setEnabled') {
    if (!isObject(message.payload) || !isNonEmptyString(message.payload.name) || typeof message.payload.enabled !== 'boolean') {
      return false;
    }
  }

  if (message.type === 'workspace.resources.search') {
    if (!isObject(message.payload) || typeof message.payload.query !== 'string' || message.payload.query.length > 256) {
      return false;
    }
  }

  if (message.type === 'workspace.resources.resolve') {
    if (!isObject(message.payload) || !Array.isArray(message.payload.values) || message.payload.values.length > 32) {
      return false;
    }
    if (!message.payload.values.every((value) => typeof value === 'string' && value.trim().length > 0 && value.length <= 4096)) {
      return false;
    }
  }

  if (message.type === 'inlineDiff.open' || message.type === 'inlineDiff.dismiss') {
    if (!isObject(message.payload) || !isNonEmptyString(message.payload.fileId)) {
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

    if (typeof message.payload.command !== 'undefined') {
      if (!isObject(message.payload.command)) {
        return false;
      }

      if (!isNonEmptyString(message.payload.command.name) || typeof message.payload.command.arguments !== 'string') {
        return false;
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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isInlineDiffFileSummary(value: unknown): value is InlineDiffFileSummary {
  if (!isObject(value)) {
    return false;
  }

  return isNonEmptyString(value.fileId)
    && isNonEmptyString(value.path)
    && isNonEmptyString(value.displayPath)
    && isNonNegativeInteger(value.additions)
    && isNonNegativeInteger(value.deletions)
    && isNonNegativeInteger(value.hunks)
    && ['pending', 'stale', 'unavailable'].includes(String(value.status))
    && (typeof value.reason === 'undefined' || typeof value.reason === 'string');
}
