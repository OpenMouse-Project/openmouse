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

function configuration(): { url: string; key: string } {
  const url = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, "");
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Mouse requests are not configured for this build.");
  return { url, key };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const { url, key } = configuration();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(detail?.message ?? `Request service returned ${response.status}.`);
  }
  return await response.json() as T;
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

export async function voteForRequest(id: string, token: string): Promise<void> {
  await request<unknown>("rpc/vote_mouse_request", {
    method: "POST",
    body: JSON.stringify({ p_request_id: id, p_voter_token: token }),
  });
}

export async function contributeDiagnostics(id: string, bundle: unknown, token: string): Promise<void> {
  await request<unknown>("rpc/contribute_mouse_diagnostics", {
    method: "POST",
    body: JSON.stringify({ p_request_id: id, p_voter_token: token, p_bundle: bundle }),
  });
}
