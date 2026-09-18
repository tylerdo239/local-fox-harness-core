// Thin client for cordis-gateway (x-packages/bundle/cordis-app/src/gateway.ts).
// Relative paths only — this app is always served same-origin with the
// gateway (P1's serveStatic route + P2's /api/v1), so the browser's cookie
// (from dsh-client-connection's token exchange) rides along automatically.

export interface SessionSummary {
  readonly sessionId: string
  readonly cwd?: string
  readonly seq: number
  readonly createdAt: number
  readonly title: string | null
}

// Mirrors the real dsh-session SessionEvent shape closely enough for
// rendering; gateway.ts passes the logged event through verbatim.
export interface SessionEvent {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data: Record<string, unknown>
}

export interface PendingApproval {
  readonly callId: string
  readonly sessionId: string
  readonly toolName: string
  readonly reason?: string
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  })
  const body: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    const message = body !== undefined && typeof body === 'object' && body !== null && 'error' in body
      ? String((body as { error: unknown }).error)
      : `request to ${path} failed with ${String(response.status)}`
    throw new Error(message)
  }
  return body as T
}

export function createSession(cwd?: string): Promise<{ sessionId: string; cwd: string }> {
  return request('/sessions', { method: 'POST', body: JSON.stringify(cwd === undefined ? {} : { cwd }) })
}

export function listSessions(): Promise<{ sessions: SessionSummary[] }> {
  return request('/sessions')
}

// UI clone plan Đợt 2 Phase I — verb-suffixed POST routes, not PATCH/DELETE:
// ctx.connection.fetch.register() only accepts GET/HEAD/POST (real framework
// constraint, confirmed in gateway.ts's own comment), same convention as
// /session-interrupt and /session-fork.

export function renameSession(sessionId: string, title: string): Promise<{ title: string }> {
  return request('/session-rename', { method: 'POST', body: JSON.stringify({ sessionId, title }) })
}

export function deleteSession(sessionId: string): Promise<{ ok: true }> {
  return request('/session-delete', { method: 'POST', body: JSON.stringify({ sessionId }) })
}

export function getEvents(sessionId: string, since = 0): Promise<{ events: SessionEvent[]; cursor: number }> {
  return request(`/session-events?id=${encodeURIComponent(sessionId)}&since=${String(since)}`)
}

export function sendMessage(sessionId: string, text: string): Promise<{ ok: true }> {
  return request('/session-messages', { method: 'POST', body: JSON.stringify({ sessionId, text }) })
}

export function forkSession(sessionId: string): Promise<{ sessionId: string }> {
  return request('/session-fork', { method: 'POST', body: JSON.stringify({ sessionId }) })
}

export function listApprovals(sessionId: string): Promise<{ approvals: PendingApproval[] }> {
  return request(`/session-approvals?id=${encodeURIComponent(sessionId)}`)
}

export function respondApproval(callId: string, outcome: 'allowed-once' | 'rejected'): Promise<{ ok: true }> {
  return request('/session-approval-respond', { method: 'POST', body: JSON.stringify({ callId, outcome }) })
}

export function streamUrl(sessionId: string): string {
  return `/api/v1/session-stream?id=${encodeURIComponent(sessionId)}`
}

// P3 — credential settings (mirrors ctx.credentials shape on the gateway;
// see gateway.ts's /credentials route). The default model itself is a
// fixed, operator-set value (Đợt 6 — set once via the same /model REST
// route the old Settings UI used to expose, now deploy-time-only) with no
// end-user-facing picker, so getModel/setModel/listModelProviders/
// listModelCatalog were removed along with that tab — nothing in the UI
// calls them anymore.

export interface CredentialInfo {
  readonly ref: string
  readonly configured: boolean
  readonly source?: string
  readonly writable: boolean
}

export function listCredentials(): Promise<{ credentials: CredentialInfo[] }> {
  return request('/credentials')
}

export function setCredential(ref: string, value: string): Promise<CredentialInfo> {
  return request('/credentials', { method: 'POST', body: JSON.stringify({ ref, value }) })
}

export function unsetCredential(ref: string): Promise<CredentialInfo> {
  return request('/credentials', { method: 'POST', body: JSON.stringify({ ref, unset: true }) })
}

// P4/P6 — n8n automations dashboard (mirrors gateway's n8n.ts /automations*
// routes; read-only — the agent, not the browser, creates/activates/runs
// workflows through its own n8n_* tools during a conversation).

export interface AutomationTag {
  readonly id: string
  readonly name: string
}

export interface Automation {
  readonly id: string
  readonly name: string
  readonly active: boolean
  readonly tags?: readonly AutomationTag[]
  // Direct link to this workflow's own editor page in n8n's real web UI —
  // computed server-side (cordis-n8n's own baseURL/editorBaseURL config),
  // never guessed on the frontend, since the browser-reachable n8n origin
  // can differ from the one core itself calls (docker-compose's internal
  // `http://n8n:5678` vs the loopback-published `http://127.0.0.1:5678`).
  readonly editorUrl?: string
}

export function listAutomations(): Promise<{ workflows: Automation[] }> {
  return request('/automations')
}

export interface AutomationExecution {
  readonly id: string
  readonly status: string
  readonly mode: string
  readonly startedAt?: string
  readonly stoppedAt?: string
}

export function listAutomationExecutions(workflowId: string): Promise<{ data: AutomationExecution[] }> {
  return request(`/automations-executions?workflowId=${encodeURIComponent(workflowId)}`)
}

// UI clone plan Phase A/C — auth.ts's login/status/logout bridge. Single
// fixed admin account, no registration (confirmed decision).

export function getAuthStatus(): Promise<{ ok: true }> {
  return request('/auth/status')
}

// Phase H — SkillsDialog, view-only at first: mirrors dsh-skill's own
// SkillSummary shape (gateway.ts's /skills route passes ctx.skills.list()
// through verbatim) — no content field, that's SkillDefinition
// (ctx.skills.get()).
//
// Đợt 5 — real create/update/delete added, once @cordis-app/tool-create-skill
// proved the exact real write target ($DSH_HOME/skills/<name>/SKILL.md) via
// a live boot test. `source === 'user-dsh'` is what "editable" means here —
// every other source (bundled, project-dsh, ...) is read-only in this UI.

export interface SkillInvocationPolicy {
  readonly modelInvocable: boolean
  readonly userInvocable: boolean
}

export interface SkillSummary {
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  readonly invocation: SkillInvocationPolicy
  readonly source: string
  readonly provider: string
}

export interface SkillContent {
  readonly name: string
  readonly description: string
  readonly content: string
  readonly source: string
}

export function listSkills(): Promise<{ skills: SkillSummary[] }> {
  return request('/skills')
}

export function getSkillContent(name: string): Promise<SkillContent> {
  return request(`/skill-content?name=${encodeURIComponent(name)}`)
}

export interface SkillInput {
  readonly name: string
  readonly description: string
  readonly content: string
}

export function createSkill(input: SkillInput): Promise<{ name: string }> {
  return request('/skill-create', { method: 'POST', body: JSON.stringify(input) })
}

export function updateSkill(input: SkillInput): Promise<{ name: string }> {
  return request('/skill-update', { method: 'POST', body: JSON.stringify(input) })
}

export function deleteSkill(name: string): Promise<{ ok: true }> {
  return request('/skill-delete', { method: 'POST', body: JSON.stringify({ name }) })
}

export function interruptSession(sessionId: string): Promise<{ ok: true }> {
  return request('/session-interrupt', { method: 'POST', body: JSON.stringify({ sessionId }) })
}

export function login(username: string, password: string): Promise<{ redirectUrl: string }> {
  return request('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) })
}

export function logout(): Promise<{ ok: true }> {
  return request('/auth/logout', { method: 'POST' })
}

export interface WorkspaceFile {
  readonly path: string
  readonly size: number
  readonly modified: number
}

export function listWorkspaceFiles(sessionId: string): Promise<{ files: WorkspaceFile[] }> {
  return request(`/workspace-files?id=${encodeURIComponent(sessionId)}`)
}

/** Same-origin URL the browser opens directly — the file is bytes, not JSON, so it never goes through `request`. */
export function workspaceFileUrl(sessionId: string, path: string): string {
  return `/api/v1/workspace-file?id=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(path)}`
}
