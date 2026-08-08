export const WEBVIEW_REQUEST_WHITELIST = [
  'webview.ready',
  'sessions.list',
  'session.export',
  'session.export.markdown',
  'subtask.transcript',
  'session.timeline',
  'session.undo',
  'session.revert',
  'session.redo',
  'session.fork',
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
  'provider.settings.get',
  'provider.settings.models',
  'provider.settings.upstreamModels',
  'provider.settings.save',
  'provider.settings.delete',
  'provider.settings.openConfig',
  'provider.auth.api',
  'provider.auth.oauth.authorize',
  'provider.auth.oauth.callback',
  'provider.auth.disconnect',
  'provider.auth.openExternal',
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

export type SessionRevertRequest = {
  type: 'session.revert';
  requestId: string;
  payload: {
    sessionId: string;
    messageId: string;
  };
};

export type SessionRedoRequest = {
  type: 'session.redo';
  requestId: string;
  payload: {
    sessionId: string;
  };
};

export type SessionForkRequest = {
  type: 'session.fork';
  requestId: string;
  payload: {
    sessionId: string;
    messageId: string;
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

export type ProviderSettingsGetRequest = {
  type: 'provider.settings.get';
  requestId: string;
  payload: {
    scope: ProviderSettingsScope;
    forceRefresh?: boolean;
  };
};

export type ProviderSettingsModelsRequest = {
  type: 'provider.settings.models';
  requestId: string;
  payload: {
    providerId: string;
    forceRefresh?: boolean;
  };
};

export type ProviderSettingsUpstreamModelsRequest = {
  type: 'provider.settings.upstreamModels';
  requestId: string;
  payload: {
    scope: ProviderSettingsScope;
    draft: ProviderSettingsDraft;
    endpoint: string;
  };
};

export type ProviderSettingsSaveRequest = {
  type: 'provider.settings.save';
  requestId: string;
  payload: {
    scope: ProviderSettingsScope;
    revision: string;
    draft: ProviderSettingsDraft;
  };
};

export type ProviderSettingsDeleteRequest = {
  type: 'provider.settings.delete';
  requestId: string;
  payload: {
    scope: ProviderSettingsScope;
    revision: string;
    providerId: string;
  };
};

export type ProviderSettingsOpenConfigRequest = {
  type: 'provider.settings.openConfig';
  requestId: string;
  payload: {
    scope: ProviderSettingsScope;
  };
};

export type ProviderAuthApiRequest = {
  type: 'provider.auth.api';
  requestId: string;
  payload: {
    providerId: string;
    key: string;
    metadata: Record<string, string>;
  };
};

export type ProviderAuthOAuthAuthorizeRequest = {
  type: 'provider.auth.oauth.authorize';
  requestId: string;
  payload: {
    providerId: string;
    method: number;
    inputs: Record<string, string>;
  };
};

export type ProviderAuthOAuthCallbackRequest = {
  type: 'provider.auth.oauth.callback';
  requestId: string;
  payload: {
    providerId: string;
    method: number;
    code?: string;
  };
};

export type ProviderAuthDisconnectRequest = {
  type: 'provider.auth.disconnect';
  requestId: string;
  payload: {
    providerId: string;
  };
};

export type ProviderAuthOpenExternalRequest = {
  type: 'provider.auth.openExternal';
  requestId: string;
  payload: {
    url: string;
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
  | SessionRevertRequest
  | SessionRedoRequest
  | SessionForkRequest
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
  | ProviderSettingsGetRequest
  | ProviderSettingsModelsRequest
  | ProviderSettingsUpstreamModelsRequest
  | ProviderSettingsSaveRequest
  | ProviderSettingsDeleteRequest
  | ProviderSettingsOpenConfigRequest
  | ProviderAuthApiRequest
  | ProviderAuthOAuthAuthorizeRequest
  | ProviderAuthOAuthCallbackRequest
  | ProviderAuthDisconnectRequest
  | ProviderAuthOpenExternalRequest
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

export type HostKind =
  | 'local-windows'
  | 'local-linux'
  | 'local-macos'
  | 'wsl'
  | 'remote-ssh-linux'
  | 'remote-linux'
  | 'remote-ssh-macos'
  | 'remote-macos'
  | 'unsupported';

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
  id?: string;
  created?: number;
  completed?: number;
  finish?: string;
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

export type SessionRevertResponseMessage = {
  type: 'session.revert.response';
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

export type SessionForkResponseMessage = {
  type: 'session.fork.response';
  requestId: string;
  ok: true;
  payload: {
    sourceSessionId: string;
    sessionId: string;
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

export type ProviderSettingsScope = 'workspace' | 'global';

export type ProviderCredentialMode = 'store' | 'env' | 'config' | 'none';

export type ProviderSettingsHeader = {
  name: string;
  value: string;
  hasStoredValue: boolean;
};

export type ProviderSettingsCostDraft = {
  input: number | null;
  output: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
};

export type ProviderSettingsModelDraft = {
  id: string;
  apiModelId: string;
  name: string;
  description: string;
  api: string;
  npm: string;
  family: string;
  releaseDate: string;
  status: '' | 'alpha' | 'beta' | 'deprecated' | 'active';
  experimental: boolean | null;
  attachment: boolean | null;
  reasoning: boolean | null;
  temperature: boolean | null;
  toolCall: boolean | null;
  interleaved: boolean | string | { field: string } | null;
  limit: {
    context: number | null;
    input: number | null;
    output: number | null;
  };
  cost: ProviderSettingsCostDraft & {
    contextOver200k: ProviderSettingsCostDraft;
  };
  modalities: {
    input: Array<'text' | 'audio' | 'image' | 'video' | 'pdf'> | null;
    output: Array<'text' | 'audio' | 'image' | 'video' | 'pdf'> | null;
  };
  headers: ProviderSettingsHeader[];
  optionsJson: string;
  variantsJson: string;
  extrasJson: string;
};

export type ProviderSettingsDraft = {
  originalId: string | null;
  id: string;
  configId: string;
  custom: boolean;
  name: string;
  api: string;
  npm: string;
  env: string[];
  whitelist: string[];
  blacklist: string[];
  baseURL: string;
  enterpriseUrl: string;
  setCacheKey: boolean | null;
  timeout: number | false | null;
  headerTimeout: number | false | null;
  chunkTimeout: number | null;
  headers: ProviderSettingsHeader[];
  credential: {
    mode: ProviderCredentialMode;
    initialMode: ProviderCredentialMode;
    value: string;
    env: string;
    hasConfigValue: boolean;
    hasStoreValue: boolean;
    connected: boolean;
  };
  optionExtrasJson: string;
  providerExtrasJson: string;
  models: ProviderSettingsModelDraft[];
};

export type ProviderSettingsAuthPromptWhen = {
  key: string;
  op: 'eq' | 'neq';
  value: string;
};

export type ProviderSettingsAuthPrompt =
  | {
      type: 'text';
      key: string;
      message: string;
      placeholder?: string;
      when?: ProviderSettingsAuthPromptWhen;
    }
  | {
      type: 'select';
      key: string;
      message: string;
      options: Array<{ label: string; value: string; hint?: string }>;
      when?: ProviderSettingsAuthPromptWhen;
    };

export type ProviderSettingsAuthMethod = {
  type: 'oauth' | 'api';
  label: string;
  prompts: ProviderSettingsAuthPrompt[];
};

export type ProviderSettingsCatalogEntry = {
  id: string;
  label: string;
  source: string;
  api: string;
  npm: string;
  builtIn: boolean;
  connected: boolean;
  credentialStored: boolean;
  credentialType: 'api' | 'oauth' | null;
  configuredInScope: boolean;
  env: string[];
  modelCount: number;
  authMethods: ProviderSettingsAuthMethod[];
};

export type ProviderSettingsCatalogModel = ProviderSettingsModelDraft;

export type ProviderUpstreamModel = {
  id: string;
  name: string;
  description: string;
  ownedBy: string;
  createdAt: string;
  contextWindow: number | null;
  maxOutputTokens: number | null;
};

export type ProviderSettingsSnapshot = {
  scope: ProviderSettingsScope;
  path: string;
  exists: boolean;
  revision: string;
  workspaceAvailable: boolean;
  customConfigPath?: string;
  catalog: ProviderSettingsCatalogEntry[];
  configured: ProviderSettingsDraft[];
};

export type ProvidersListResponseMessage = {
  type: 'providers.list.response';
  requestId: string;
  ok: true;
  payload: {
    providers: ProviderSummary[];
  };
};

export type ProviderSettingsGetResponseMessage = {
  type: 'provider.settings.get.response';
  requestId: string;
  ok: true;
  payload: ProviderSettingsSnapshot;
};

export type ProviderSettingsModelsResponseMessage = {
  type: 'provider.settings.models.response';
  requestId: string;
  ok: true;
  payload: {
    providerId: string;
    models: ProviderSettingsCatalogModel[];
  };
};

export type ProviderSettingsUpstreamModelsResponseMessage = {
  type: 'provider.settings.upstreamModels.response';
  requestId: string;
  ok: true;
  payload: {
    providerId: string;
    endpoint: string;
    models: ProviderUpstreamModel[];
  };
};

export type ProviderSettingsSaveResponseMessage = {
  type: 'provider.settings.save.response';
  requestId: string;
  ok: true;
  payload: ProviderSettingsSnapshot;
};

export type ProviderSettingsDeleteResponseMessage = {
  type: 'provider.settings.delete.response';
  requestId: string;
  ok: true;
  payload: ProviderSettingsSnapshot;
};

export type ProviderSettingsOpenConfigResponseMessage = {
  type: 'provider.settings.openConfig.response';
  requestId: string;
  ok: true;
  payload: {
    scope: ProviderSettingsScope;
    path: string;
  };
};

export type ProviderAuthAuthorization = {
  url: string;
  method: 'auto' | 'code';
  instructions: string;
};

export type ProviderAuthApiResponseMessage = {
  type: 'provider.auth.api.response';
  requestId: string;
  ok: true;
  payload: { providerId: string };
};

export type ProviderAuthOAuthAuthorizeResponseMessage = {
  type: 'provider.auth.oauth.authorize.response';
  requestId: string;
  ok: true;
  payload: {
    providerId: string;
    method: number;
    authorization: ProviderAuthAuthorization;
  };
};

export type ProviderAuthOAuthCallbackResponseMessage = {
  type: 'provider.auth.oauth.callback.response';
  requestId: string;
  ok: true;
  payload: { providerId: string };
};

export type ProviderAuthDisconnectResponseMessage = {
  type: 'provider.auth.disconnect.response';
  requestId: string;
  ok: true;
  payload: { providerId: string };
};

export type ProviderAuthOpenExternalResponseMessage = {
  type: 'provider.auth.openExternal.response';
  requestId: string;
  ok: true;
  payload: { url: string };
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
  | SessionRevertResponseMessage
  | SessionRedoResponseMessage
  | SessionForkResponseMessage
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
  | ProviderSettingsGetResponseMessage
  | ProviderSettingsModelsResponseMessage
  | ProviderSettingsUpstreamModelsResponseMessage
  | ProviderSettingsSaveResponseMessage
  | ProviderSettingsDeleteResponseMessage
  | ProviderSettingsOpenConfigResponseMessage
  | ProviderAuthApiResponseMessage
  | ProviderAuthOAuthAuthorizeResponseMessage
  | ProviderAuthOAuthCallbackResponseMessage
  | ProviderAuthDisconnectResponseMessage
  | ProviderAuthOpenExternalResponseMessage
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
  'session.revert.response',
  'session.redo.response',
  'session.fork.response',
  'session.delete.response',
  'file.open.response',
  'inlineDiff.open.response',
  'inlineDiff.dismiss.response',
  'inlineDiff.state',
  'tempfile.write.response',
  'providers.list.response',
  'models.list.response',
  'provider.settings.get.response',
  'provider.settings.models.response',
  'provider.settings.upstreamModels.response',
  'provider.settings.save.response',
  'provider.settings.delete.response',
  'provider.settings.openConfig.response',
  'provider.auth.api.response',
  'provider.auth.oauth.authorize.response',
  'provider.auth.oauth.callback.response',
  'provider.auth.disconnect.response',
  'provider.auth.openExternal.response',
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

function isProviderSettingsScope(value: unknown): value is ProviderSettingsScope {
  return value === 'workspace' || value === 'global';
}

function isBoundedString(value: unknown, maxLength = 100_000): value is string {
  return typeof value === 'string' && value.length <= maxLength;
}

function isStringArray(value: unknown, maxItems = 500, maxItemLength = 2048): value is string[] {
  return Array.isArray(value)
    && value.length <= maxItems
    && value.every((item) => isBoundedString(item, maxItemLength));
}

function isStringRecord(
  value: unknown,
  maxEntries = 50,
  maxKeyLength = 256,
  maxValueLength = 16_384
): value is Record<string, string> {
  return isObject(value)
    && Object.entries(value).length <= maxEntries
    && Object.entries(value).every(([key, entry]) => key.length <= maxKeyLength && isBoundedString(entry, maxValueLength));
}

function isProviderSettingsAuthPromptWhen(value: unknown): value is ProviderSettingsAuthPromptWhen {
  return isObject(value)
    && isBoundedString(value.key, 256)
    && (value.op === 'eq' || value.op === 'neq')
    && isBoundedString(value.value, 2048);
}

function isProviderSettingsAuthPrompt(value: unknown): value is ProviderSettingsAuthPrompt {
  if (
    !isObject(value)
    || (value.type !== 'text' && value.type !== 'select')
    || !isBoundedString(value.key, 256)
    || !isBoundedString(value.message, 4096)
    || (value.when !== undefined && !isProviderSettingsAuthPromptWhen(value.when))
  ) {
    return false;
  }
  if (value.type === 'text') {
    return value.placeholder === undefined || isBoundedString(value.placeholder, 4096);
  }
  return Array.isArray(value.options)
    && value.options.length <= 100
    && value.options.every((option) => isObject(option)
      && isBoundedString(option.label, 2048)
      && isBoundedString(option.value, 2048)
      && (option.hint === undefined || isBoundedString(option.hint, 2048)));
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}

function isProviderSettingsHeader(value: unknown): value is ProviderSettingsHeader {
  return isObject(value)
    && isBoundedString(value.name, 512)
    && isBoundedString(value.value, 16_384)
    && typeof value.hasStoredValue === 'boolean';
}

function isProviderSettingsHeaders(value: unknown): value is ProviderSettingsHeader[] {
  return Array.isArray(value)
    && value.length <= 100
    && value.every(isProviderSettingsHeader);
}

function isProviderSettingsModelDraft(value: unknown): value is ProviderSettingsModelDraft {
  if (!isObject(value)) {
    return false;
  }

  for (const key of ['id', 'apiModelId', 'name', 'description', 'api', 'npm', 'family', 'releaseDate', 'optionsJson', 'variantsJson', 'extrasJson'] as const) {
    if (!isBoundedString(value[key], key.endsWith('Json') ? 200_000 : 2048)) {
      return false;
    }
  }

  if (!['', 'alpha', 'beta', 'deprecated', 'active'].includes(String(value.status))) {
    return false;
  }

  for (const key of ['experimental', 'attachment', 'reasoning', 'temperature', 'toolCall'] as const) {
    if (value[key] !== null && typeof value[key] !== 'boolean') {
      return false;
    }
  }

  if (
    value.interleaved !== null
    && typeof value.interleaved !== 'boolean'
    && !isBoundedString(value.interleaved, 512)
    && !(isObject(value.interleaved) && isBoundedString(value.interleaved.field, 512))
  ) {
    return false;
  }

  if (!isObject(value.limit) || !isObject(value.cost) || !isObject(value.modalities)) {
    return false;
  }

  for (const key of ['context', 'input', 'output'] as const) {
    if (!isNullableFiniteNumber(value.limit[key])) {
      return false;
    }
  }
  for (const key of ['input', 'output', 'cacheRead', 'cacheWrite'] as const) {
    if (!isNullableFiniteNumber(value.cost[key])) {
      return false;
    }
  }
  if (!isObject(value.cost.contextOver200k)) {
    return false;
  }
  for (const key of ['input', 'output', 'cacheRead', 'cacheWrite'] as const) {
    if (!isNullableFiniteNumber(value.cost.contextOver200k[key])) {
      return false;
    }
  }

  const modalitySet = new Set(['text', 'audio', 'image', 'video', 'pdf']);
  for (const key of ['input', 'output'] as const) {
    const list = value.modalities[key];
    if (list !== null && (!Array.isArray(list) || list.length > 5 || !list.every((item) => typeof item === 'string' && modalitySet.has(item)))) {
      return false;
    }
  }

  return isProviderSettingsHeaders(value.headers);
}

function isProviderSettingsDraft(value: unknown): value is ProviderSettingsDraft {
  if (!isObject(value)) {
    return false;
  }
  if (value.originalId !== null && !isBoundedString(value.originalId, 256)) {
    return false;
  }

  for (const key of ['id', 'configId', 'name', 'api', 'npm', 'baseURL', 'enterpriseUrl'] as const) {
    if (!isBoundedString(value[key], 4096)) {
      return false;
    }
  }
  if (!isBoundedString(value.optionExtrasJson, 200_000) || !isBoundedString(value.providerExtrasJson, 200_000)) {
    return false;
  }
  if (typeof value.custom !== 'boolean' || !isStringArray(value.env) || !isStringArray(value.whitelist) || !isStringArray(value.blacklist)) {
    return false;
  }
  if (value.setCacheKey !== null && typeof value.setCacheKey !== 'boolean') {
    return false;
  }
  for (const key of ['timeout', 'headerTimeout'] as const) {
    const candidate = value[key];
    if (candidate !== null && candidate !== false && (typeof candidate !== 'number' || !Number.isFinite(candidate))) {
      return false;
    }
  }
  if (!isNullableFiniteNumber(value.chunkTimeout) || !isProviderSettingsHeaders(value.headers)) {
    return false;
  }

  if (!isObject(value.credential)) {
    return false;
  }
  if (!['store', 'env', 'config', 'none'].includes(String(value.credential.mode))) {
    return false;
  }
  if (!['store', 'env', 'config', 'none'].includes(String(value.credential.initialMode))) {
    return false;
  }
  if (
    !isBoundedString(value.credential.value, 32_768)
    || !isBoundedString(value.credential.env, 512)
    || typeof value.credential.hasConfigValue !== 'boolean'
    || typeof value.credential.hasStoreValue !== 'boolean'
    || typeof value.credential.connected !== 'boolean'
  ) {
    return false;
  }

  return Array.isArray(value.models)
    && value.models.length <= 200
    && value.models.every(isProviderSettingsModelDraft);
}

function isProviderSettingsCatalogEntry(value: unknown): value is ProviderSettingsCatalogEntry {
  return isObject(value)
    && isNonEmptyString(value.id)
    && isBoundedString(value.label, 2048)
    && isBoundedString(value.source, 128)
    && isBoundedString(value.api, 4096)
    && isBoundedString(value.npm, 4096)
    && typeof value.builtIn === 'boolean'
    && typeof value.connected === 'boolean'
    && typeof value.credentialStored === 'boolean'
    && (value.credentialType === null || value.credentialType === 'api' || value.credentialType === 'oauth')
    && typeof value.configuredInScope === 'boolean'
    && isStringArray(value.env, 100, 512)
    && isNonNegativeInteger(value.modelCount)
    && Array.isArray(value.authMethods)
    && value.authMethods.length <= 20
    && value.authMethods.every((method) => isObject(method)
      && (method.type === 'api' || method.type === 'oauth')
      && isBoundedString(method.label, 2048)
      && Array.isArray(method.prompts)
      && method.prompts.length <= 50
      && method.prompts.every(isProviderSettingsAuthPrompt));
}

function isProviderSettingsCatalogModel(value: unknown): value is ProviderSettingsCatalogModel {
  return isProviderSettingsModelDraft(value);
}

function isProviderUpstreamModel(value: unknown): value is ProviderUpstreamModel {
  return isObject(value)
    && isNonEmptyString(value.id)
    && isBoundedString(value.id, 512)
    && isBoundedString(value.name, 1024)
    && isBoundedString(value.description, 4096)
    && isBoundedString(value.ownedBy, 512)
    && isBoundedString(value.createdAt, 128)
    && (value.contextWindow === null || (isNonNegativeInteger(value.contextWindow) && value.contextWindow > 0))
    && (value.maxOutputTokens === null || (isNonNegativeInteger(value.maxOutputTokens) && value.maxOutputTokens > 0));
}

function isProviderSettingsSnapshot(value: unknown): value is ProviderSettingsSnapshot {
  return isObject(value)
    && isProviderSettingsScope(value.scope)
    && isBoundedString(value.path, 16_384)
    && typeof value.exists === 'boolean'
    && isBoundedString(value.revision, 256)
    && typeof value.workspaceAvailable === 'boolean'
    && (value.customConfigPath === undefined || isBoundedString(value.customConfigPath, 16_384))
    && Array.isArray(value.catalog)
    && value.catalog.length <= 1000
    && value.catalog.every(isProviderSettingsCatalogEntry)
    && Array.isArray(value.configured)
    && value.configured.length <= 500
    && value.configured.every(isProviderSettingsDraft);
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

  if (message.type === 'session.revert.response') {
    return message.ok === true
      && isObject(message.payload)
      && typeof message.payload.changed === 'boolean'
      && isNonEmptyString(message.payload.sessionId)
      && (typeof message.payload.revertMessageId === 'undefined' || isNonEmptyString(message.payload.revertMessageId))
      && (typeof message.payload.composerText === 'undefined' || isBoundedString(message.payload.composerText));
  }

  if (message.type === 'session.fork.response') {
    return message.ok === true
      && isObject(message.payload)
      && isNonEmptyString(message.payload.sourceSessionId)
      && isNonEmptyString(message.payload.sessionId);
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

  if (
    message.type === 'provider.settings.get.response'
    || message.type === 'provider.settings.save.response'
    || message.type === 'provider.settings.delete.response'
  ) {
    return message.ok === true && isProviderSettingsSnapshot(message.payload);
  }

  if (message.type === 'provider.settings.models.response') {
    return message.ok === true
      && isObject(message.payload)
      && isNonEmptyString(message.payload.providerId)
      && Array.isArray(message.payload.models)
      && message.payload.models.length <= 1000
      && message.payload.models.every(isProviderSettingsCatalogModel);
  }

  if (message.type === 'provider.settings.upstreamModels.response') {
    return message.ok === true
      && isObject(message.payload)
      && isNonEmptyString(message.payload.providerId)
      && isBoundedString(message.payload.endpoint, 16_384)
      && Array.isArray(message.payload.models)
      && message.payload.models.length <= 5_000
      && message.payload.models.every(isProviderUpstreamModel);
  }

  if (message.type === 'provider.settings.openConfig.response') {
    return message.ok === true
      && isObject(message.payload)
      && isProviderSettingsScope(message.payload.scope)
      && isBoundedString(message.payload.path, 16_384);
  }

  if (
    message.type === 'provider.auth.api.response'
    || message.type === 'provider.auth.oauth.callback.response'
    || message.type === 'provider.auth.disconnect.response'
  ) {
    return message.ok === true
      && isObject(message.payload)
      && isNonEmptyString(message.payload.providerId);
  }

  if (message.type === 'provider.auth.oauth.authorize.response') {
    return message.ok === true
      && isObject(message.payload)
      && isNonEmptyString(message.payload.providerId)
      && isNonNegativeInteger(message.payload.method)
      && isObject(message.payload.authorization)
      && isBoundedString(message.payload.authorization.url, 16_384)
      && (message.payload.authorization.method === 'auto' || message.payload.authorization.method === 'code')
      && isBoundedString(message.payload.authorization.instructions, 16_384);
  }

  if (message.type === 'provider.auth.openExternal.response') {
    return message.ok === true
      && isObject(message.payload)
      && isBoundedString(message.payload.url, 16_384);
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

    if (!isNonEmptyString(message.payload.sessionId) || !isBoundedString(message.payload.filename, 4096)) {
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

    if (!message.payload.openWithoutSaving && message.payload.filename.trim().length === 0) {
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

  if (message.type === 'session.revert' || message.type === 'session.fork') {
    if (!isObject(message.payload)) {
      return false;
    }

    if (!isNonEmptyString(message.payload.sessionId) || !isNonEmptyString(message.payload.messageId)) {
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

  if (message.type === 'provider.settings.get') {
    if (!isObject(message.payload) || !isProviderSettingsScope(message.payload.scope)) {
      return false;
    }
    if (message.payload.forceRefresh !== undefined && typeof message.payload.forceRefresh !== 'boolean') {
      return false;
    }
  }

  if (message.type === 'provider.settings.models') {
    if (!isObject(message.payload) || !isNonEmptyString(message.payload.providerId)) {
      return false;
    }
    if (message.payload.forceRefresh !== undefined && typeof message.payload.forceRefresh !== 'boolean') {
      return false;
    }
  }

  if (message.type === 'provider.settings.upstreamModels') {
    if (
      !isObject(message.payload)
      || !isProviderSettingsScope(message.payload.scope)
      || !isProviderSettingsDraft(message.payload.draft)
      || !isNonEmptyString(message.payload.endpoint)
      || !isBoundedString(message.payload.endpoint, 16_384)
    ) {
      return false;
    }
  }

  if (message.type === 'provider.settings.save') {
    if (
      !isObject(message.payload)
      || !isProviderSettingsScope(message.payload.scope)
      || !isBoundedString(message.payload.revision, 256)
      || !isProviderSettingsDraft(message.payload.draft)
    ) {
      return false;
    }
  }

  if (message.type === 'provider.settings.delete') {
    if (
      !isObject(message.payload)
      || !isProviderSettingsScope(message.payload.scope)
      || !isBoundedString(message.payload.revision, 256)
      || !isNonEmptyString(message.payload.providerId)
    ) {
      return false;
    }
  }

  if (message.type === 'provider.settings.openConfig') {
    if (!isObject(message.payload) || !isProviderSettingsScope(message.payload.scope)) {
      return false;
    }
  }

  if (message.type === 'provider.auth.api') {
    if (
      !isObject(message.payload)
      || !isNonEmptyString(message.payload.providerId)
      || !isBoundedString(message.payload.key, 32_768)
      || message.payload.key.trim().length === 0
      || !isStringRecord(message.payload.metadata)
    ) {
      return false;
    }
  }

  if (message.type === 'provider.auth.oauth.authorize') {
    if (
      !isObject(message.payload)
      || !isNonEmptyString(message.payload.providerId)
      || !isNonNegativeInteger(message.payload.method)
      || message.payload.method > 100
      || !isStringRecord(message.payload.inputs)
    ) {
      return false;
    }
  }

  if (message.type === 'provider.auth.oauth.callback') {
    if (
      !isObject(message.payload)
      || !isNonEmptyString(message.payload.providerId)
      || !isNonNegativeInteger(message.payload.method)
      || message.payload.method > 100
      || (message.payload.code !== undefined && !isBoundedString(message.payload.code, 16_384))
    ) {
      return false;
    }
  }

  if (message.type === 'provider.auth.disconnect') {
    if (!isObject(message.payload) || !isNonEmptyString(message.payload.providerId)) {
      return false;
    }
  }

  if (message.type === 'provider.auth.openExternal') {
    if (!isObject(message.payload) || !isBoundedString(message.payload.url, 16_384)) {
      return false;
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
