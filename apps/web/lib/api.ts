// Thin client for cordis-gateway (x-packages/bundle/cordis-app/src/gateway.ts).
// Relative paths only — this app is always served same-origin with the
// gateway (P1's serveStatic route + P2's /api/v1), so the browser's cookie
// (from dsh-client-connection's token exchange) rides along automatically.

export interface SessionSummary {
  readonly sessionId: string
  readonly cwd?: string
  readonly seq: number
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

export function getEvents(sessionId: string, since = 0): Promise<{ events: SessionEvent[]; cursor: number }> {
  return request(`/session-events?id=${encodeURIComponent(sessionId)}&since=${String(since)}`)
}

export function sendMessage(sessionId: string, text: string): Promise<{ ok: true }> {
  return request('/session-messages', { method: 'POST', body: JSON.stringify({ sessionId, text }) })
}

export function interruptSession(sessionId: string): Promise<{ ok: true }> {
  return request('/session-interrupt', { method: 'POST', body: JSON.stringify({ sessionId }) })
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
