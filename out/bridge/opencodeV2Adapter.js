"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatServeErrorBody = formatServeErrorBody;
exports.createOpencodeV2AdapterState = createOpencodeV2AdapterState;
exports.requestOpencodeV2Json = requestOpencodeV2Json;
exports.requestOpencodeV2NoContent = requestOpencodeV2NoContent;
exports.normalizeSessionMessages = normalizeSessionMessages;
const opencodeDirectory_1 = require("./opencodeDirectory");
const OAUTH_POLL_INTERVAL_MS = 500;
const OAUTH_AUTO_TIMEOUT_MS = 10 * 60000;
const OAUTH_CODE_TIMEOUT_MS = 120000;
const EMPTY_PROVIDER_CACHE_TTL_MS = 1000;
const PROVIDER_CACHE_TTL_MS = 5000;
const PROVIDER_SETTLE_RETRY_DELAYS_MS = [150, 300, 600];
const ANSI_ESCAPE_PATTERN = new RegExp('\\x1b\\[[0-?]*[ -/]*[@-~]', 'g');
/**
 * V2 encodes failures as `{_tag, message, kind, field}` JSON. Surfacing that
 * body verbatim turns every error toast into a JSON snippet, so prefer the
 * human-readable `message` and fall back to the tag or the raw text.
 */
function formatServeErrorBody(text, status) {
    const stripped = text.replace(ANSI_ESCAPE_PATTERN, '').trim();
    const fallback = `OpenCode serve 请求失败（${String(status)}）。`;
    if (stripped.length === 0) {
        return fallback;
    }
    try {
        const record = readRecord(JSON.parse(stripped));
        if (record) {
            const message = readString(record, 'message');
            const field = readString(record, 'field');
            const tag = readString(record, '_tag');
            if (message) {
                return field ? `${message}（${field}）` : message;
            }
            if (tag) {
                return stripped;
            }
        }
    }
    catch {
        // Not JSON: the body is already human-readable text.
    }
    return stripped;
}
function createOpencodeV2AdapterState() {
    return {
        oauthAttempts: new Map(),
        providerCache: new Map()
    };
}
async function requestOpencodeV2Json(state, fetcher, endpoint, pathname, options, defaultCwd) {
    const method = (options?.method ?? 'GET').toUpperCase();
    const url = parseInternalPath(pathname);
    const path = url.pathname;
    const query = url.searchParams;
    const request = createRawRequest(fetcher, endpoint, options, defaultCwd, requiresProviderLocation(path));
    if (path === '/global/health' && method === 'GET') {
        const info = await request.json('/api/info');
        return {
            healthy: true,
            ...(readString(info, 'version') ? { version: readString(info, 'version') } : {})
        };
    }
    if (path === '/path' && method === 'GET') {
        const location = await request.json('/api/location');
        return { directory: readNestedString(location, 'directory') };
    }
    if (path === '/config/reload' && method === 'POST') {
        return request.noContent('/api/location/reload', { method: 'POST' });
    }
    if (path === '/session/status' && method === 'GET') {
        const payload = await request.json('/api/session/active');
        const data = readRecord(payload)?.data;
        if (!isRecord(data)) {
            return {};
        }
        return Object.fromEntries(Object.entries(data).flatMap(([sessionID, value]) => {
            const type = readString(value, 'type');
            return type === 'running' ? [[sessionID, { type: 'busy' }]] : [];
        }));
    }
    if (path === '/session' && method === 'GET') {
        return listSessions(request, options, defaultCwd);
    }
    if (path === '/session' && method === 'POST') {
        const body = parseBody(options?.body);
        const directory = options?.includeCwd === false ? undefined : options?.cwd ?? defaultCwd;
        const payload = await request.json('/api/session', {
            method: 'POST',
            body: JSON.stringify({
                ...body,
                ...(body.location === undefined && directory
                    ? { location: { directory } }
                    : {})
            })
        });
        return normalizeSessionInfo(readData(payload));
    }
    const sessionMatch = /^\/session\/([^/]+)$/.exec(path);
    if (sessionMatch && method === 'GET') {
        const payload = await request.json(`/api/session/${encodeURIComponent(decodeURIComponent(sessionMatch[1]))}`);
        return normalizeSessionInfo(readData(payload));
    }
    if (sessionMatch && method === 'DELETE') {
        return request.json(`/api/session/${encodeURIComponent(decodeURIComponent(sessionMatch[1]))}`, { method: 'DELETE' });
    }
    const messagesMatch = /^\/session\/([^/]+)\/message$/.exec(path);
    if (messagesMatch && method === 'GET') {
        const sessionID = decodeURIComponent(messagesMatch[1]);
        return requestAllMessages(request, sessionID);
    }
    const exportMatch = /^\/session\/([^/]+)\/export$/.exec(path);
    if (exportMatch && method === 'GET') {
        const sessionID = decodeURIComponent(exportMatch[1]);
        const payload = await request.json(`/api/experimental/session/${encodeURIComponent(sessionID)}/export?sanitize=false`);
        const transfer = readData(payload);
        return {
            info: normalizeSessionInfo(readNested(transfer, 'info')),
            messages: normalizeSessionMessages(readArray(readNested(transfer, 'messages')), sessionID)
        };
    }
    const diffMatch = /^\/session\/([^/]+)\/diff$/.exec(path);
    if (diffMatch && method === 'GET') {
        const sessionID = decodeURIComponent(diffMatch[1]);
        const params = new URLSearchParams();
        const from = query.get('messageID') ?? query.get('from');
        const to = query.get('to');
        const context = query.get('context');
        if (from)
            params.set('from', from);
        if (to)
            params.set('to', to);
        if (context)
            params.set('context', context);
        const payload = await request.json(`/api/session/${encodeURIComponent(sessionID)}/diff${queryString(params)}`);
        return normalizeFileDiffs(readData(payload));
    }
    const revertMatch = /^\/session\/([^/]+)\/revert$/.exec(path);
    if (revertMatch && method === 'POST') {
        const sessionID = decodeURIComponent(revertMatch[1]);
        const body = parseBody(options?.body);
        await request.json(`/api/session/${encodeURIComponent(sessionID)}/revert/stage`, {
            method: 'POST',
            body: JSON.stringify({
                messageID: body.messageID,
                files: true
            })
        });
        const updated = await request.json(`/api/session/${encodeURIComponent(sessionID)}`);
        return normalizeSessionInfo(readData(updated));
    }
    const unrevertMatch = /^\/session\/([^/]+)\/unrevert$/.exec(path);
    if (unrevertMatch && method === 'POST') {
        const sessionID = decodeURIComponent(unrevertMatch[1]);
        await request.noContent(`/api/session/${encodeURIComponent(sessionID)}/revert`, {
            method: 'DELETE'
        });
        const updated = await request.json(`/api/session/${encodeURIComponent(sessionID)}`);
        return normalizeSessionInfo(readData(updated));
    }
    const forkMatch = /^\/session\/([^/]+)\/fork$/.exec(path);
    if (forkMatch && method === 'POST') {
        const sessionID = decodeURIComponent(forkMatch[1]);
        const body = parseBody(options?.body);
        const payload = await request.json(`/api/session/${encodeURIComponent(sessionID)}/fork`, {
            method: 'POST',
            body: JSON.stringify(isNonEmptyString(body.messageID) ? { before: body.messageID } : {})
        });
        return normalizeSessionInfo(readData(payload));
    }
    const abortMatch = /^\/session\/([^/]+)\/abort$/.exec(path);
    if (abortMatch && method === 'POST') {
        const sessionID = decodeURIComponent(abortMatch[1]);
        return request.json(`/api/session/${encodeURIComponent(sessionID)}/interrupt`, {
            method: 'POST'
        });
    }
    const promptMatch = /^\/session\/([^/]+)\/prompt_async$/.exec(path);
    if (promptMatch && method === 'POST') {
        const sessionID = decodeURIComponent(promptMatch[1]);
        const body = parseBody(options?.body);
        await applyPromptSelection(request, sessionID, body);
        const prompt = promptFromV1Body(body);
        return request.json(`/api/session/${encodeURIComponent(sessionID)}/prompt`, {
            method: 'POST',
            body: JSON.stringify(prompt)
        });
    }
    const commandMatch = /^\/session\/([^/]+)\/command$/.exec(path);
    if (commandMatch && method === 'POST') {
        const sessionID = decodeURIComponent(commandMatch[1]);
        const body = parseBody(options?.body);
        await applyPromptSelection(request, sessionID, body);
        const prompt = promptFromV1Body(body);
        return request.json(`/api/session/${encodeURIComponent(sessionID)}/command`, {
            method: 'POST',
            body: JSON.stringify({
                name: body.command,
                text: isNonEmptyString(body.arguments) ? body.arguments : prompt.text,
                ...(prompt.files.length > 0 ? { files: prompt.files } : {}),
                delivery: isNonEmptyString(body.messageID) ? 'queue' : 'steer'
            })
        });
    }
    if (path === '/permission' && method === 'GET') {
        const payload = await request.json('/api/permission/request');
        return readArray(readNested(payload, 'data')).map(normalizePermissionRequest);
    }
    const permissionReplyMatch = /^\/permission\/([^/]+)\/reply$/.exec(path);
    if (permissionReplyMatch && method === 'POST') {
        const permissionID = decodeURIComponent(permissionReplyMatch[1]);
        const body = parseBody(options?.body);
        const sessionID = query.get('sessionID') ??
            body.sessionID ??
            (await findPermissionSession(request, permissionID));
        if (!isNonEmptyString(sessionID)) {
            throw new Error(`OpenCode V2 could not resolve the session for permission ${permissionID}.`);
        }
        return request.json(`/api/session/${encodeURIComponent(sessionID)}/permission/${encodeURIComponent(permissionID)}/reply`, {
            method: 'POST',
            body: JSON.stringify({
                decision: body.reply,
                ...(isNonEmptyString(body.message) ? { message: body.message } : {})
            })
        });
    }
    if (path === '/question' && method === 'GET') {
        const payload = await request.json('/api/form');
        const questions = [];
        for (const value of readArray(readNested(payload, 'data'))) {
            const form = normalizeQuestionForm(value);
            if (readArray(form.questions).length > 0) {
                questions.push(form);
                continue;
            }
            // V2 surfaces non-interactive forms too (external OAuth URLs, shell
            // hand-offs). Nothing here can answer them, and leaving one pending
            // blocks the tool that asked, so cancel it instead of hiding it.
            await cancelUnanswerableForm(request, form);
        }
        return questions;
    }
    const questionReplyMatch = /^\/question\/([^/]+)\/reply$/.exec(path);
    if (questionReplyMatch && method === 'POST') {
        const formID = decodeURIComponent(questionReplyMatch[1]);
        const sessionID = query.get('sessionID');
        if (!sessionID) {
            throw new Error(`OpenCode V2 could not resolve the session for form ${formID}.`);
        }
        const detailPayload = await request.json(`/api/session/${encodeURIComponent(sessionID)}/form/${encodeURIComponent(formID)}`);
        const detail = readData(detailPayload);
        const body = parseBody(options?.body);
        return request.json(`/api/session/${encodeURIComponent(sessionID)}/form/${encodeURIComponent(formID)}/reply`, {
            method: 'POST',
            body: JSON.stringify({
                answer: answerQuestionForm(detail, body.answers)
            })
        });
    }
    const questionRejectMatch = /^\/question\/([^/]+)\/reject$/.exec(path);
    if (questionRejectMatch && method === 'POST') {
        const formID = decodeURIComponent(questionRejectMatch[1]);
        const sessionID = query.get('sessionID');
        if (!sessionID) {
            throw new Error(`OpenCode V2 could not resolve the session for form ${formID}.`);
        }
        const params = new URLSearchParams();
        const message = query.get('message');
        if (message)
            params.set('message', message);
        return request.json(`/api/session/${encodeURIComponent(sessionID)}/form/${encodeURIComponent(formID)}${queryString(params)}`, { method: 'DELETE' });
    }
    if (path === '/provider' && method === 'GET') {
        return providerPayload(await loadProviderSnapshot(state, request, options, defaultCwd, options?.forceRefresh === true));
    }
    if (path === '/provider/auth' && method === 'GET') {
        return providerAuthPayload(await loadProviderSnapshot(state, request, options, defaultCwd, options?.forceRefresh === true));
    }
    if (path === '/auth' && method === 'GET') {
        return connectionEntries(await loadProviderSnapshot(state, request, options, defaultCwd, options?.forceRefresh === true));
    }
    const authMatch = /^\/auth\/([^/]+)$/.exec(path);
    if (authMatch && method === 'PUT') {
        const providerID = decodeURIComponent(authMatch[1]);
        const snapshot = await loadProviderSnapshot(state, request, options, defaultCwd, true);
        const integration = findProviderIntegration(snapshot, providerID);
        if (!integration) {
            throw new Error(`OpenCode V2 integration ${providerID} was not found.`);
        }
        const method = readIntegrationMethods(integration).find((entry) => entry.type === 'key');
        if (!method) {
            throw new Error(`OpenCode V2 integration ${providerID} does not support API-key authentication.`);
        }
        const body = parseBody(options?.body);
        const key = readString(body, 'key');
        if (!key) {
            throw new Error('OpenCode V2 API-key authentication requires a key.');
        }
        const result = await request.json(`/api/integration/${encodeURIComponent(readRequiredString(integration, 'id'))}/connect/key`, {
            method: 'POST',
            body: JSON.stringify({
                key,
                ...(isRecord(body.metadata) ? { answer: body.metadata } : {}),
                label: 'API key'
            })
        });
        clearProviderSnapshot(state);
        return result;
    }
    if (authMatch && method === 'DELETE') {
        const providerID = decodeURIComponent(authMatch[1]);
        const snapshot = await loadProviderSnapshot(state, request, options, defaultCwd, true);
        const integration = findProviderIntegration(snapshot, providerID);
        if (!integration) {
            return undefined;
        }
        const connectionIDs = readArray(integration.connections).flatMap((connection) => {
            const record = readRecord(connection);
            return record?.type === 'credential' && isNonEmptyString(record.id) ? [record.id] : [];
        });
        for (const connectionID of connectionIDs) {
            await request.noContent(`/api/credential/${encodeURIComponent(connectionID)}`, {
                method: 'DELETE'
            });
        }
        clearProviderSnapshot(state);
        return undefined;
    }
    const oauthAuthorizeMatch = /^\/provider\/([^/]+)\/oauth\/authorize$/.exec(path);
    if (oauthAuthorizeMatch && method === 'POST') {
        const providerID = decodeURIComponent(oauthAuthorizeMatch[1]);
        const snapshot = await loadProviderSnapshot(state, request, options, defaultCwd, true);
        const integration = findProviderIntegration(snapshot, providerID);
        if (!integration) {
            throw new Error(`OpenCode V2 integration ${providerID} was not found.`);
        }
        const body = parseBody(options?.body);
        const methodIndex = typeof body.method === 'number' ? body.method : 0;
        const method = readProviderAuthMethods(integration)[methodIndex];
        if (!method || method.type !== 'oauth' || !isNonEmptyString(method.id)) {
            throw new Error(`OpenCode V2 OAuth method ${String(methodIndex)} was not found.`);
        }
        const payload = await request.json(`/api/integration/${encodeURIComponent(readRequiredString(integration, 'id'))}/connect/oauth`, {
            method: 'POST',
            body: JSON.stringify({
                methodID: method.id,
                ...(isRecord(body.inputs) ? { answer: body.inputs } : {})
            })
        });
        const attempt = readData(payload);
        const attemptID = readRequiredString(attempt, 'attemptID');
        state.oauthAttempts.set(oauthAttemptKey(providerID, methodIndex), {
            integrationID: readRequiredString(integration, 'id'),
            attemptID
        });
        return {
            url: readRequiredString(attempt, 'url'),
            instructions: readString(attempt, 'instructions'),
            method: readString(attempt, 'mode') === 'code' ? 'code' : 'auto'
        };
    }
    const oauthCallbackMatch = /^\/provider\/([^/]+)\/oauth\/callback$/.exec(path);
    if (oauthCallbackMatch && method === 'POST') {
        const providerID = decodeURIComponent(oauthCallbackMatch[1]);
        const body = parseBody(options?.body);
        const methodIndex = typeof body.method === 'number' ? body.method : 0;
        const attempt = state.oauthAttempts.get(oauthAttemptKey(providerID, methodIndex));
        if (!attempt) {
            throw new Error('OpenCode V2 OAuth attempt was not found. Start authorization again.');
        }
        const basePath = `/api/integration/${encodeURIComponent(attempt.integrationID)}` +
            `/connect/oauth/${encodeURIComponent(attempt.attemptID)}`;
        const code = isNonEmptyString(body.code) ? body.code : undefined;
        if (code) {
            await request.json(`${basePath}/complete`, {
                method: 'POST',
                body: JSON.stringify({ code })
            });
        }
        const attemptKey = oauthAttemptKey(providerID, methodIndex);
        const deadline = Date.now() + (code ? OAUTH_CODE_TIMEOUT_MS : OAUTH_AUTO_TIMEOUT_MS);
        let lastStatus = 'pending';
        while (Date.now() < deadline) {
            if (options?.signal?.aborted) {
                await cancelOAuthAttempt(request, basePath);
                state.oauthAttempts.delete(attemptKey);
                throw new Error('OpenCode OAuth authorization was cancelled.');
            }
            const payload = await request.json(basePath);
            const detail = readData(payload);
            const status = readNestedString(detail, 'status');
            if (status === 'complete') {
                state.oauthAttempts.delete(attemptKey);
                clearProviderSnapshot(state);
                return true;
            }
            if (status === 'failed') {
                state.oauthAttempts.delete(attemptKey);
                throw new Error(readNestedString(detail, 'message') ||
                    'OpenCode OAuth authorization failed.');
            }
            if (status === 'expired') {
                state.oauthAttempts.delete(attemptKey);
                throw new Error('OpenCode OAuth authorization expired. Start authorization again.');
            }
            lastStatus = status || lastStatus;
            await delay(OAUTH_POLL_INTERVAL_MS);
        }
        await cancelOAuthAttempt(request, basePath);
        state.oauthAttempts.delete(attemptKey);
        throw new Error(`OpenCode OAuth authorization timed out while ${lastStatus}.`);
    }
    if (path === '/model' && method === 'GET') {
        const payload = await request.json('/api/model');
        return readRecords(readNested(payload, 'data')).map(normalizeModelEntry);
    }
    if (path === '/agent' && method === 'GET') {
        const payload = await request.json('/api/agent');
        return readArray(readNested(payload, 'data')).flatMap((agent) => {
            const record = readRecord(agent);
            const id = readString(record, 'id') || readString(record, 'name');
            if (!id || record?.hidden === true) {
                return [];
            }
            return [
                {
                    id,
                    name: id,
                    displayName: readString(record, 'name'),
                    isPrimary: readString(record, 'mode') !== 'subagent',
                    description: readString(record, 'description')
                }
            ];
        });
    }
    if (path === '/command' && method === 'GET') {
        const payload = await request.json('/api/command');
        return readArray(readNested(payload, 'data'));
    }
    if (path === '/skill' && method === 'GET') {
        const payload = await request.json('/api/skill');
        return readArray(readNested(payload, 'data')).map((skill) => ({
            name: readString(skill, 'name') || readString(skill, 'id'),
            description: readString(skill, 'description'),
            location: readString(skill, 'path')
        }));
    }
    if (path === '/mcp' && method === 'GET') {
        const payload = await request.json('/api/mcp');
        return Object.fromEntries(readArray(readNested(payload, 'data')).flatMap((server) => {
            const name = readString(server, 'name');
            if (!name)
                return [];
            const status = readNestedRecord(server, 'status');
            return [
                [
                    name,
                    {
                        status: readString(status, 'status') || 'unknown',
                        ...(isNonEmptyString(status?.error) ? { error: status.error } : {})
                    }
                ]
            ];
        }));
    }
    const mcpMatch = /^\/mcp\/([^/]+)\/(connect|disconnect)$/.exec(path);
    if (mcpMatch && method === 'POST') {
        const server = decodeURIComponent(mcpMatch[1]);
        return request.json(`/api/experimental/mcp/${encodeURIComponent(server)}/${mcpMatch[2]}`, { method: 'POST' });
    }
    throw new Error(`Unsupported OpenCode V2 adapter request: ${method} ${pathname}`);
}
async function requestOpencodeV2NoContent(state, fetcher, endpoint, pathname, options, defaultCwd) {
    await requestOpencodeV2Json(state, fetcher, endpoint, pathname, options, defaultCwd);
}
function normalizeSessionMessages(value, sessionID) {
    const result = [];
    let currentUserMessageID;
    for (const item of value) {
        const message = readRecord(item);
        if (!message) {
            continue;
        }
        const type = readString(message, 'type');
        const id = readString(message, 'id');
        if (!id) {
            continue;
        }
        const time = readNestedRecord(message, 'time') ?? { created: 0 };
        const completed = readFinite(time.completed);
        if (type === 'user') {
            currentUserMessageID = id;
            result.push({
                info: {
                    id,
                    sessionID,
                    role: 'user',
                    time
                },
                parts: userMessageParts(message, sessionID)
            });
            continue;
        }
        if (type === 'assistant') {
            const model = readNestedRecord(message, 'model');
            const content = readArray(message.content);
            const parts = content.map((part, index) => assistantMessagePart(part, id, sessionID, index));
            const errorMessage = structuredErrorMessage(message.error);
            if (parts.length === 0 && errorMessage) {
                parts.push({
                    id: `${id}-error`,
                    type: 'text',
                    text: `\n\n运行错误：${errorMessage}`,
                    sessionID,
                    messageID: id
                });
            }
            if (parts.length === 0) {
                continue;
            }
            result.push({
                info: {
                    id,
                    sessionID,
                    role: 'assistant',
                    ...(currentUserMessageID ? { parentID: currentUserMessageID } : {}),
                    agent: readString(message, 'agent'),
                    ...(model?.id ? { modelID: readString(model, 'id') } : {}),
                    ...(model?.providerID ? { providerID: readString(model, 'providerID') } : {}),
                    finish: readString(message, 'finish'),
                    cost: typeof message.cost === 'number' ? message.cost : 0,
                    tokens: readRecord(message.tokens) ?? {},
                    ...(isRecord(message.error) ? { error: message.error } : {}),
                    time: {
                        ...time,
                        ...(completed !== undefined ? { completed } : {})
                    }
                },
                parts
            });
            continue;
        }
        if (type === 'shell') {
            result.push({
                info: {
                    id,
                    sessionID,
                    role: 'assistant',
                    ...(currentUserMessageID ? { parentID: currentUserMessageID } : {}),
                    time
                },
                parts: [
                    {
                        id,
                        sessionID,
                        messageID: id,
                        type: 'tool',
                        tool: 'shell',
                        state: {
                            status: readString(message, 'status') || 'unknown',
                            input: { command: readString(message, 'command') },
                            output: shellOutput(message)
                        }
                    }
                ]
            });
        }
    }
    return result;
}
function createRawRequest(fetcher, endpoint, options, defaultCwd, forceCwd = false) {
    const cwd = forceCwd
        ? options?.cwd ?? defaultCwd
        : options?.includeCwd === false
            ? undefined
            : options?.cwd ?? defaultCwd;
    const signal = options?.signal;
    const execute = async (pathname, init = {}) => {
        const headers = {
            'Content-Type': 'application/json'
        };
        if (init.accept) {
            headers.Accept = init.accept;
        }
        if (cwd) {
            headers['x-opencode-directory'] = (0, opencodeDirectory_1.encodeOpencodeDirectory)(cwd);
        }
        if (endpoint.password) {
            headers.authorization = `Basic ${Buffer.from(`opencode:${endpoint.password}`).toString('base64')}`;
        }
        const response = await fetcher(`${endpoint.baseUrl}${pathname}`, {
            ...(init.method ? { method: init.method } : {}),
            headers,
            ...(init.body !== undefined ? { body: init.body } : {}),
            ...(signal ? { signal } : {})
        });
        if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw new Error(formatServeErrorBody(text, response.status));
        }
        return response;
    };
    return {
        async json(pathname, init = {}) {
            const response = await execute(pathname, init);
            if (response.status === 204) {
                return undefined;
            }
            const text = await response.text();
            if (!text.trim()) {
                return undefined;
            }
            try {
                return JSON.parse(text);
            }
            catch {
                throw new Error(`OpenCode V2 returned invalid JSON for ${pathname}.`);
            }
        },
        async noContent(pathname, init = {}) {
            const response = await execute(pathname, init);
            await response.body?.cancel().catch(() => undefined);
        }
    };
}
async function listSessions(request, options, defaultCwd) {
    const directory = options?.includeCwd === false ? undefined : options?.cwd ?? defaultCwd;
    const sessions = [];
    let cursor;
    for (let page = 0; page < 1000; page += 1) {
        const params = new URLSearchParams({
            limit: '200',
            archived: 'false'
        });
        if (!cursor) {
            params.set('order', 'desc');
        }
        else {
            params.set('cursor', cursor);
        }
        if (directory) {
            params.set('directory', directory);
        }
        const payload = await request.json(`/api/session?${params.toString()}`);
        sessions.push(...readRecords(readRecord(payload)?.data));
        cursor = readNestedString(readRecord(payload)?.cursor, 'next');
        if (!cursor) {
            break;
        }
    }
    return sessions.map((session) => {
        const info = normalizeSessionInfo(session);
        return {
            ...info,
            projectId: info.projectID,
            directory: info.directory,
            updated: timestampToIso(readNestedRecord(session, 'time')?.updated),
            created: timestampToIso(readNestedRecord(session, 'time')?.created)
        };
    });
}
async function requestAllMessages(request, sessionID) {
    const messages = [];
    let cursor;
    for (let page = 0; page < 1000; page += 1) {
        const params = new URLSearchParams({ limit: '200' });
        if (cursor) {
            params.set('cursor', cursor);
        }
        else {
            params.set('order', 'desc');
        }
        const payload = await request.json(`/api/session/${encodeURIComponent(sessionID)}/message?${params.toString()}`);
        messages.push(...readRecords(readRecord(payload)?.data));
        cursor = readNestedString(readRecord(payload)?.cursor, 'next');
        if (!cursor) {
            break;
        }
    }
    messages.reverse();
    return normalizeSessionMessages(messages, sessionID);
}
function normalizeSessionInfo(value) {
    const info = readRecord(value) ?? {};
    const time = readNestedRecord(info, 'time') ?? {};
    const location = readNestedRecord(info, 'location');
    return {
        ...info,
        id: readString(info, 'id'),
        title: readString(info, 'title') || readString(info, 'id'),
        directory: readString(location, 'directory'),
        time: {
            created: readFinite(time.created),
            updated: readFinite(time.updated),
            ...(readFinite(time.idle) !== undefined ? { idle: readFinite(time.idle) } : {})
        }
    };
}
function normalizeFileDiffs(value) {
    return readArray(value).flatMap((item) => {
        const diff = readRecord(item);
        if (!diff || !isNonEmptyString(diff.file) || !isNonEmptyString(diff.patch)) {
            return [];
        }
        return [
            {
                file: diff.file,
                patch: diff.patch,
                additions: readFinite(diff.additions) ?? 0,
                deletions: readFinite(diff.deletions) ?? 0,
                status: readString(diff, 'status')
            }
        ];
    });
}
function userMessageParts(message, sessionID) {
    const id = readRequiredString(message, 'id');
    const parts = [];
    const files = readArray(message.files);
    files.forEach((value, index) => {
        const file = readRecord(value);
        const url = readString(file, 'uri');
        if (!url)
            return;
        parts.push({
            id: `${id}-file-${String(index)}`,
            type: 'file',
            url,
            filename: readString(file, 'name') || fileNameFromURI(url),
            mime: guessMimeType(url),
            sessionID,
            messageID: id
        });
    });
    parts.push({
        id: `${id}-text`,
        type: 'text',
        text: readString(message, 'text'),
        sessionID,
        messageID: id
    });
    return parts;
}
function assistantMessagePart(value, messageID, sessionID, ordinal) {
    const part = readRecord(value) ?? {};
    const type = readString(part, 'type');
    const id = `${messageID}-${type || 'part'}-${String(ordinal)}`;
    if (type === 'text') {
        return {
            id,
            type: 'text',
            text: readString(part, 'text'),
            sessionID,
            messageID
        };
    }
    if (type === 'reasoning') {
        return {
            id,
            type: 'reasoning',
            text: readString(part, 'text'),
            time: readRecord(part.time) ?? {},
            sessionID,
            messageID
        };
    }
    if (type === 'tool') {
        const state = readRecord(part.state) ?? {};
        return {
            id,
            type: 'tool',
            tool: readString(part, 'name') || 'tool',
            callID: readString(part, 'id'),
            state: {
                ...state,
                ...(contentToText(state.content) !== undefined
                    ? { output: contentToText(state.content) }
                    : {})
            },
            time: readRecord(part.time) ?? {},
            sessionID,
            messageID
        };
    }
    return {
        id,
        type,
        ...part,
        sessionID,
        messageID
    };
}
function shellOutput(message) {
    const output = readRecord(message.output);
    if (output) {
        return readString(output, 'text') || contentToText(output) || '';
    }
    return typeof message.output === 'string' ? message.output : '';
}
function promptFromV1Body(body) {
    const parts = readArray(body.parts);
    const text = parts
        .filter((part) => readString(part, 'type') === 'text')
        .map((part) => readString(part, 'text'))
        .join('');
    const files = parts.flatMap((value) => {
        const part = readRecord(value);
        if (!part)
            return [];
        const uri = readString(part, 'url');
        if (!uri)
            return [];
        return [
            {
                uri,
                ...(isNonEmptyString(part.filename) ? { name: part.filename } : {}),
                ...(isNonEmptyString(part.mime) ? { description: part.mime } : {})
            }
        ];
    });
    return {
        ...(isNonEmptyString(body.messageID) ? { id: body.messageID } : {}),
        text,
        files,
        delivery: isNonEmptyString(body.messageID) ? 'queue' : 'steer'
    };
}
async function applyPromptSelection(request, sessionID, body) {
    if (isNonEmptyString(body.agent)) {
        await request.noContent(`/api/session/${encodeURIComponent(sessionID)}/agent`, {
            method: 'POST',
            body: JSON.stringify({ agent: body.agent })
        });
    }
    const model = readRecord(body.model);
    const providerID = readString(model, 'providerID');
    const modelID = readString(model, 'modelID') || readString(model, 'id');
    if (providerID && modelID) {
        await request.noContent(`/api/session/${encodeURIComponent(sessionID)}/model`, {
            method: 'POST',
            body: JSON.stringify({
                model: {
                    providerID,
                    id: modelID,
                    ...(isNonEmptyString(body.variant) ? { variant: body.variant } : {})
                }
            })
        });
    }
}
async function findPermissionSession(request, permissionID) {
    const payload = await request.json('/api/permission/request');
    const match = readArray(readNested(payload, 'data')).find((item) => readString(item, 'id') === permissionID);
    return readString(match, 'sessionID') || undefined;
}
function normalizePermissionRequest(value) {
    const request = readRecord(value) ?? {};
    return {
        ...request,
        permission: readString(request, 'action') || 'tool',
        patterns: readArray(request.resources).filter((item) => typeof item === 'string')
    };
}
function normalizeQuestionForm(value) {
    const form = readRecord(value) ?? {};
    const metadata = readNestedRecord(form, 'metadata');
    const questions = readArray(form.fields).flatMap((value) => {
        const field = readRecord(value);
        if (!field ||
            field.type === 'external' ||
            field.type === 'boolean' ||
            field.hidden === true) {
            return [];
        }
        const options = readArray(field.options).flatMap((value) => {
            const option = readRecord(value);
            const label = readString(option, 'label') || readString(option, 'value');
            return label
                ? [
                    {
                        label,
                        description: readString(option, 'description') || label
                    }
                ]
                : [];
        });
        return [
            {
                header: readString(field, 'title') || readString(field, 'key'),
                question: readString(field, 'description') ||
                    readString(field, 'title') ||
                    readString(field, 'key'),
                options,
                multiple: field.type === 'multiselect',
                custom: field.custom !== false
            }
        ];
    });
    return {
        id: readString(form, 'id'),
        sessionID: readString(form, 'sessionID'),
        title: readString(form, 'title'),
        metadata: {
            ...(metadata ?? {}),
            kind: readString(metadata, 'kind') || 'question'
        },
        questions
    };
}
async function cancelUnanswerableForm(request, form) {
    const formID = readString(form, 'id');
    const sessionID = readString(form, 'sessionID');
    if (!formID || !sessionID) {
        return;
    }
    const params = new URLSearchParams({
        message: 'opencode-ui cannot answer this form, so it was cancelled.'
    });
    try {
        await request.noContent(`/api/session/${encodeURIComponent(sessionID)}/form/${encodeURIComponent(formID)}${queryString(params)}`, { method: 'DELETE' });
    }
    catch {
        // The next blocker poll retries; a failed cancel must not break the run.
    }
}
function answerQuestionForm(detail, answersValue) {
    const form = readRecord(detail) ?? {};
    const fields = readArray(form.fields).filter(isRecord);
    const answers = readArray(answersValue);
    const answer = {};
    let answerIndex = 0;
    fields.forEach((field) => {
        if (field.type === 'external' ||
            field.type === 'boolean' ||
            field.hidden === true) {
            return;
        }
        const key = readString(field, 'key');
        const values = readArray(answers[answerIndex])
            .filter((item) => typeof item === 'string')
            .map((value) => formOptionValue(field, value));
        answerIndex += 1;
        if (!key || !formFieldConditionsHold(field, answer))
            return;
        answer[key] = field.type === 'multiselect' ? values : values[0] ?? '';
    });
    return answer;
}
/**
 * The sidebar answers with the option label it rendered. V2 options carry a
 * separate `value` (for example websearch.provider uses "allow"/"disable" with
 * long labels), and the server matches on the value.
 */
function formOptionValue(field, value) {
    for (const option of readArray(field.options)) {
        const record = readRecord(option);
        if (!record || readString(record, 'label') !== value) {
            continue;
        }
        const optionValue = readString(record, 'value');
        if (optionValue) {
            return optionValue;
        }
    }
    return value;
}
function formFieldConditionsHold(field, answers) {
    return readArray(field.when).every((value) => {
        const condition = readRecord(value);
        const key = readString(condition, 'key');
        const op = readString(condition, 'op');
        if (!key || (op !== 'eq' && op !== 'neq') || !condition) {
            return false;
        }
        const current = answers[key];
        if (current === undefined) {
            return false;
        }
        const matches = Array.isArray(current)
            ? current.some((item) => item === condition.value)
            : current === condition.value;
        return op === 'eq' ? matches : !matches;
    });
}
async function loadProviderSnapshot(state, request, options, defaultCwd, force = false) {
    const scopedCwd = options?.cwd ?? defaultCwd;
    const cacheKey = `location:${scopedCwd ?? ''}`;
    const cached = state.providerCache.get(cacheKey);
    const cacheTtl = cached?.empty
        ? EMPTY_PROVIDER_CACHE_TTL_MS
        : PROVIDER_CACHE_TTL_MS;
    if (!force && cached && Date.now() - cached.loadedAt < cacheTtl) {
        return cached.promise;
    }
    const initial = Promise.all([
        request.json('/api/provider'),
        request.json('/api/model'),
        request.json('/api/integration')
    ]).then(async ([providerPayload, modelPayload, integrationPayload]) => {
        let providers = readRecords(readNested(providerPayload, 'data'));
        const models = readRecords(readNested(modelPayload, 'data'));
        for (const waitMs of PROVIDER_SETTLE_RETRY_DELAYS_MS) {
            if (providers.length > 0) {
                break;
            }
            await delay(waitMs);
            const retriedProviderPayload = await request.json('/api/provider');
            providers = readRecords(readNested(retriedProviderPayload, 'data'));
        }
        return {
            providers,
            models,
            integrations: readRecords(readNested(integrationPayload, 'data'))
        };
    });
    const promise = initial.then((snapshot) => {
        const empty = snapshot.providers.length === 0;
        state.providerCache.set(cacheKey, {
            loadedAt: Date.now(),
            promise: Promise.resolve(snapshot),
            empty
        });
        return snapshot;
    });
    state.providerCache.set(cacheKey, {
        loadedAt: Date.now(),
        promise,
        empty: false
    });
    // A transient provider/model/integration failure must not be cached: the
    // rejected promise would otherwise fail every provider read for the TTL.
    promise.catch(() => {
        if (state.providerCache.get(cacheKey)?.promise === promise) {
            state.providerCache.delete(cacheKey);
        }
    });
    return promise;
}
function clearProviderSnapshot(state) {
    state.providerCache.clear();
}
function providerPayload(snapshot) {
    const modelsByProvider = groupModels(snapshot.models);
    return {
        all: snapshot.providers.map((provider) => {
            const id = readString(provider, 'id');
            const settings = readNestedRecord(provider, 'settings');
            return {
                id,
                name: readString(provider, 'name') || id,
                source: isNonEmptyString(readString(provider, 'integrationID'))
                    ? 'builtin'
                    : 'config',
                npm: readString(provider, 'package'),
                api: readString(settings, 'baseURL'),
                models: Object.fromEntries((modelsByProvider.get(id) ?? []).map((model) => [
                    readString(model, 'id'),
                    providerModelDefinition(model)
                ]))
            };
        }),
        connected: snapshot.providers.flatMap((provider) => {
            const id = readString(provider, 'id');
            const integration = findProviderIntegration(snapshot, id);
            return id && readArray(integration?.connections).length > 0 ? [id] : [];
        })
    };
}
function providerAuthPayload(snapshot) {
    return Object.fromEntries(snapshot.providers.flatMap((provider) => {
        const providerID = readString(provider, 'id');
        // V2 creates integrations for custom providers too, so only built-in
        // providers (those with an integrationID) may expose auth methods here.
        if (!isNonEmptyString(readString(provider, 'integrationID'))) {
            return [];
        }
        const integration = findProviderIntegration(snapshot, providerID);
        if (!providerID || !integration)
            return [];
        const methods = readProviderAuthMethods(integration).flatMap((method) => {
            if (method.type === 'key') {
                return [
                    {
                        type: 'api',
                        label: readString(method, 'label') || 'API key',
                        prompts: authPrompts(method)
                    }
                ];
            }
            if (method.type === 'oauth') {
                return [
                    {
                        type: 'oauth',
                        label: readString(method, 'label') || 'OAuth',
                        prompts: authPrompts(method)
                    }
                ];
            }
            return [];
        });
        return methods.length > 0 ? [[providerID, methods]] : [];
    }));
}
function connectionEntries(snapshot) {
    return snapshot.providers.flatMap((provider) => {
        const providerID = readString(provider, 'id');
        const integration = findProviderIntegration(snapshot, providerID);
        return readArray(integration?.connections).flatMap((value) => {
            const connection = readRecord(value);
            if (connection?.type !== 'credential')
                return [];
            return [
                {
                    id: providerID,
                    label: readString(provider, 'name') || providerID,
                    type: readString(connection, 'method') === 'oauth' ? 'oauth' : 'api'
                }
            ];
        });
    });
}
function findProviderIntegration(snapshot, providerID) {
    const provider = snapshot.providers.find((item) => readString(item, 'id') === providerID);
    const integrationID = readString(provider, 'integrationID');
    return snapshot.integrations.find((integration) => {
        const id = readString(integration, 'id');
        return ((integrationID && id === integrationID) ||
            id === providerID ||
            readString(provider, 'canonical') === id);
    });
}
function readIntegrationMethods(integration) {
    return readRecords(integration.methods);
}
function readProviderAuthMethods(integration) {
    return readIntegrationMethods(integration).filter((method) => method.type === 'key' || method.type === 'oauth');
}
function groupModels(models) {
    const result = new Map();
    for (const model of models) {
        const providerID = readString(model, 'providerID');
        if (!providerID)
            continue;
        const list = result.get(providerID) ?? [];
        list.push(model);
        result.set(providerID, list);
    }
    return result;
}
function providerModelDefinition(model) {
    const capabilities = readNestedRecord(model, 'capabilities') ?? {};
    const compatibility = readNestedRecord(model, 'compatibility') ?? {};
    const cost = readArray(model.cost)[0];
    const limit = readNestedRecord(model, 'limit') ?? {};
    return {
        name: readString(model, 'name') || readString(model, 'id'),
        family: readString(model, 'family'),
        release_date: timestampToIso(readNestedRecord(model, 'time')?.released),
        status: readString(model, 'status'),
        capabilities: {
            toolcall: capabilities.tools === true,
            attachment: readArray(capabilities.input).includes('image'),
            reasoning: readString(compatibility, 'reasoningField').length > 0 ||
                readArray(model.variants).length > 0,
            temperature: capabilities.temperature
        },
        modalities: {
            input: readArray(capabilities.input),
            output: readArray(capabilities.output)
        },
        cost: normalizeModelCost(cost),
        limit: {
            context: readFinite(limit.context),
            output: readFinite(limit.output)
        },
        variants: normalizeModelVariants(model.variants)
    };
}
function normalizeModelVariants(value) {
    const variants = {};
    for (const rawVariant of readArray(value)) {
        const variant = readRecord(rawVariant);
        const id = readString(variant, 'id');
        if (!variant || !id)
            continue;
        variants[id] = {
            ...(readRecord(variant.settings) ?? {}),
            ...(readRecord(variant.headers) ? { headers: variant.headers } : {}),
            ...(readRecord(variant.body) ? { options: variant.body } : {})
        };
    }
    return variants;
}
function normalizeModelCost(value) {
    const cost = readRecord(value);
    if (!cost)
        return undefined;
    const cache = readNestedRecord(cost, 'cache');
    return {
        input: readFinite(cost.input),
        output: readFinite(cost.output),
        cache_read: readFinite(cache?.read),
        cache_write: readFinite(cache?.write)
    };
}
function normalizeModelEntry(model) {
    const providerID = readString(model, 'providerID');
    const id = readString(model, 'id');
    const compatibility = readNestedRecord(model, 'compatibility');
    return {
        name: `${providerID}/${id}`,
        providerID,
        variants: readArray(model.variants).flatMap((variant) => {
            const variantID = readString(variant, 'id');
            return variantID ? [variantID] : [];
        }),
        supportsThinking: readString(compatibility, 'reasoningField').length > 0 ||
            readArray(model.variants).length > 0,
        contextWindow: readFinite(readNestedRecord(model, 'limit')?.context)
    };
}
function authPrompts(method) {
    return readArray(method.form).flatMap((value) => {
        const field = readRecord(value);
        const key = readString(field, 'key');
        if (!field ||
            !key ||
            field.type === 'external' ||
            field.type === 'boolean' ||
            field.hidden === true) {
            return [];
        }
        const options = readArray(field.options).flatMap((value) => {
            const option = readRecord(value);
            if (!option)
                return [];
            const optionValue = readString(option, 'value');
            return optionValue
                ? [
                    {
                        label: readString(option, 'label') || optionValue,
                        value: optionValue,
                        ...(isNonEmptyString(option.description) ? { hint: option.description } : {})
                    }
                ]
                : [];
        });
        const when = readArray(field.when)[0];
        return [
            {
                type: options.length > 0 ? 'select' : 'text',
                key,
                message: readString(field, 'description') || readString(field, 'title') || key,
                ...(isNonEmptyString(field.placeholder) ? { placeholder: field.placeholder } : {}),
                ...(options.length > 0 ? { options } : {}),
                ...(isRecord(when)
                    ? {
                        when: {
                            key: readString(when, 'key'),
                            op: readString(when, 'op'),
                            value: when.value
                        }
                    }
                    : {})
            }
        ];
    });
}
function oauthAttemptKey(providerID, methodIndex) {
    return `${providerID}:${String(methodIndex)}`;
}
function requiresProviderLocation(pathname) {
    return (pathname === '/provider' ||
        pathname === '/provider/auth' ||
        pathname === '/auth' ||
        /^\/auth\/[^/]+$/.test(pathname) ||
        /^\/provider\/[^/]+\/oauth\/(?:authorize|callback)$/.test(pathname));
}
async function cancelOAuthAttempt(request, basePath) {
    try {
        await request.noContent(basePath, { method: 'DELETE' });
    }
    catch {
        // The attempt expires server-side even when cancellation cannot be sent.
    }
}
function parseInternalPath(pathname) {
    return new URL(pathname, 'http://opencode.local');
}
function queryString(params) {
    const value = params.toString();
    return value ? `?${value}` : '';
}
function parseBody(value) {
    if (!value?.trim())
        return {};
    try {
        return readRecord(JSON.parse(value)) ?? {};
    }
    catch {
        throw new Error('OpenCode V2 request body must be valid JSON.');
    }
}
function readData(value) {
    return readRecord(value)?.data;
}
function readNested(value, key) {
    return readRecord(value)?.[key];
}
function readNestedRecord(value, key) {
    return readRecord(readNested(value, key));
}
function readNestedString(value, key) {
    return readString(value, key) || '';
}
function readRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value
        : undefined;
}
function readArray(value) {
    return Array.isArray(value) ? value : [];
}
function readRecords(value) {
    const result = [];
    for (const item of readArray(value)) {
        const record = readRecord(item);
        if (record)
            result.push(record);
    }
    return result;
}
function readString(value, key) {
    const record = readRecord(value);
    return record && typeof record[key] === 'string' ? record[key] : '';
}
function readRequiredString(value, key) {
    const result = readString(value, key);
    if (!result) {
        throw new Error(`OpenCode V2 response is missing ${key}.`);
    }
    return result;
}
function readFinite(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
function isRecord(value) {
    return readRecord(value) !== undefined;
}
function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}
function timestampToIso(value) {
    if (typeof value === 'string') {
        const parsed = Date.parse(value);
        return Number.isFinite(parsed) ? new Date(parsed).toISOString() : value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return new Date(value).toISOString();
    }
    return new Date(0).toISOString();
}
function fileNameFromURI(uri) {
    try {
        const pathname = new URL(uri).pathname;
        return decodeURIComponent(pathname.split('/').pop() ?? 'attachment');
    }
    catch {
        return uri.split(/[\\/]/).pop() || 'attachment';
    }
}
function guessMimeType(uri) {
    const name = fileNameFromURI(uri).toLowerCase();
    if (name.endsWith('.png'))
        return 'image/png';
    if (name.endsWith('.jpg') || name.endsWith('.jpeg'))
        return 'image/jpeg';
    if (name.endsWith('.gif'))
        return 'image/gif';
    if (name.endsWith('.webp'))
        return 'image/webp';
    return 'text/plain';
}
function contentToText(value) {
    if (typeof value === 'string') {
        return value;
    }
    const parts = readArray(value);
    if (parts.length === 0) {
        return undefined;
    }
    return parts
        .map((part) => readString(part, 'text'))
        .filter(Boolean)
        .join('\n');
}
function structuredErrorMessage(value) {
    if (typeof value === 'string' && value.trim()) {
        return value.trim();
    }
    if (!isRecord(value)) {
        return undefined;
    }
    const message = readString(value, 'message') || readString(value, 'type');
    return message.trim() || undefined;
}
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
//# sourceMappingURL=opencodeV2Adapter.js.map