export type RequestStatus = "submitted" | "reviewing" | "planned" | "supported" | "declined";

export interface SupportRequest {
  id: string;
  manufacturer: string;
  model: string;
  connection: string;
  features: string[];
  can_test: boolean;
  status: RequestStatus;
  vote_count: number;
  created_at: string;
}

export interface NewSupportRequest {
  manufacturer: string;
  model: string;
  connection: string;
}

/**
 * Emergency kill switch. Both public RPCs accept caller-supplied UUIDs, and
 * submit_mouse_request also adds a vote, so both paths must remain closed
 * until voting is moved behind server-issued identities and rate limiting.
 */
export const SUPPORT_REQUEST_WRITES_ENABLED = false;

function requireSupportRequestWrites(): void {
  if (!SUPPORT_REQUEST_WRITES_ENABLED) {
    throw new Error("Mouse requests and voting are temporarily paused while abuse protection is added.");
  }
}

function configuration(): { url: string; key: string } {
  const url = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, "");
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Mouse requests are not configured for this build.");
  return { url, key };
}

export async function decodeResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!response.ok) {
    let detail: { message?: string } | null = null;
    try { detail = text ? JSON.parse(text) as { message?: string } : null; } catch { /* use the HTTP fallback */ }
    throw new Error(detail?.message ?? `Request service returned ${response.status}.`);
  }
  return (text ? JSON.parse(text) : undefined) as T;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const { url, key } = configuration();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...init?.headers },
  });
  return decodeResponse<T>(response);
}

export function voterToken(storage: Storage): string {
  const key = "openmouse.support-request-voter";
  const stored = storage.getItem(key);
  if (stored) return stored;
  const value = crypto.randomUUID();
  storage.setItem(key, value);
  return value;
}

export async function listSupportRequests(): Promise<SupportRequest[]> {
  return request<SupportRequest[]>("mouse_request_catalog?select=*&order=vote_count.desc,created_at.desc");
}

export async function submitSupportRequest(input: NewSupportRequest, token: string): Promise<SupportRequest> {
  requireSupportRequestWrites();
  const rows = await request<SupportRequest[]>("rpc/submit_mouse_request", {
    method: "POST",
    body: JSON.stringify({
      p_manufacturer: input.manufacturer,
      p_model: input.model,
      p_connection: input.connection,
      p_features: [],
      p_can_test: false,
      p_voter_token: token,
    }),
  });
  if (!rows[0]) throw new Error("The request was accepted but no record was returned.");
  return rows[0];
}

export async function voteForRequest(id: string, turnstileToken: string): Promise<void> {
  if (!turnstileToken) throw new Error("Complete the anti-spam check before voting.");
  const response = await fetch("/api/mouse-vote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requestId: id, turnstileToken }),
  });
  await decodeResponse<unknown>(response);
}

export async function votingSiteKey(): Promise<string> {
  const response = await fetch("/api/voting-config", { headers: { Accept: "application/json" } });
  const config = await decodeResponse<{ siteKey?: string }>(response);
  if (!config.siteKey) throw new Error("Voting protection is not configured.");
  return config.siteKey;
}

export async function contributeDiagnostics(id: string, bundle: unknown, token: string): Promise<void> {
  requireSupportRequestWrites();
  await request<unknown>("rpc/contribute_mouse_diagnostics", {
    method: "POST",
    body: JSON.stringify({ p_request_id: id, p_voter_token: token, p_bundle: bundle }),
  });
}
