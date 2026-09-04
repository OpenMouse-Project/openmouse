// Tiny Supabase REST helper shared by the support dashboard Functions. Uses the
// service-role key exclusively (server-side). Never exposed to the browser.

export function supabase(env) {
  const base = env.SUPABASE_URL.replace(/\/$/, "");
  const authHeaders = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };

  async function request(path, options = {}) {
    const response = await fetch(`${base}/rest/v1/${path}`, {
      ...options,
      headers: { ...authHeaders, ...(options.headers ?? {}) },
    });
    return { response, body: response.status === 204 ? null : await response.json().catch(() => null) };
  }

  return {
    /** SELECT with optional query string. Returns [result] to match `const [r] = await db.select(...)`. */
    async select(table, query = "", options = {}) {
      const { response, body } = await request(`${table}${query ? `?${query}` : ""}`, options);
      return [{ response, body }];
    },
    /** INSERT, returns created rows. */
    async insert(table, rows, prefer = "return=representation") {
      const { response, body } = await request(table, {
        method: "POST",
        headers: { Prefer: prefer },
        body: JSON.stringify(rows),
      });
      return { response, body };
    },
    /** PATCH a single row matched by id equality. */
    async update(table, idColumn, id, patch) {
      const { response, body } = await request(`${table}?${idColumn}=eq.${id}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(patch),
      });
      return { response, body };
    },
    /** DELETE rows by a url-encoded predicate (e.g. "ticket_id=eq.x&discord_id=eq.y"). */
    async remove(table, predicate) {
      const { response, body } = await request(`${table}?${predicate}`, { method: "DELETE" });
      return { response, body };
    },
    /** POST an RPC and return parsed JSON. */
    async rpc(fn, args) {
      const response = await fetch(`${base}/rest/v1/rpc/${fn}`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(args ?? {}),
      });
      return { response, body: await response.json().catch(() => null) };
    },
  };
}
