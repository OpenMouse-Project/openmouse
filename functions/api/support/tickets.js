import { json, requireSession } from "./_session.js";
import { supabase } from "./_supabase.js";

const VALID_STATUS = ["OPEN", "IN_PROGRESS", "WAITING_FOR_USER", "RESOLVED", "CLOSED"];
const VALID_PRIORITY = ["LOW", "NORMAL", "HIGH", "URGENT"];

/**
 * GET /api/support/tickets
 * Query params:
 *   status     — one of the valid statuses, or "all"
 *   filter     — "all" | "unassigned" | "mine" | "open" | ... (see below)
 *   q          — search text (number, subject, username, id, device, category)
 *   priority   — optional priority filter
 *   category   — optional category filter
 *   sort       — "created" | "updated" | "priority" (default "updated")
 *   dir        — "asc" | "desc"
 *   page       — 1-based page
 *   pageSize   — rows per page
 */
export async function onRequest({ request, env }) {
  if (request.method !== "GET") return json({ message: "Method not allowed." }, 405);
  const session = await requireSession(request, env);
  if (!session) return json({ message: "Not authenticated." }, 401);

  const db = supabase(env);
  const url = new URL(request.url);
  const params = url.searchParams;

  const filter = params.get("filter") ?? "all";
  const status = params.get("status") ?? "all";
  const q = (params.get("q") ?? "").trim();
  const priority = params.get("priority") ?? "";
  const category = params.get("category") ?? "";
  const sort = params.get("sort") ?? "updated";
  const dir = params.get("dir") === "asc" ? "asc" : "desc";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(params.get("pageSize")) || 25));

  const reserved = ["OPEN", "IN_PROGRESS", "WAITING_FOR_USER"];

  // Compose status predicate from 'status' and 'filter'.
  let statusIn = null; // array of statuses to match
  if (status !== "all") {
    statusIn = [status];
  } else {
    switch (filter) {
      case "unassigned":
        statusIn = reserved;
        break;
      case "mine":
        statusIn = reserved;
        break;
      case "resolved":
        statusIn = ["RESOLVED"];
        break;
      case "closed":
        statusIn = ["CLOSED"];
        break;
      default:
        statusIn = null; // all statuses
    }
  }

  const filters = [];
  const orParts = [];

  if (statusIn) filters.push(`status=in.(${statusIn.map((s) => `"${s}"`).join(",")})`);

  if (filter === "unassigned") {
    filters.push("assigned_to=is.null");
  } else if (filter === "mine") {
    filters.push(`assigned_to=eq.${session.discordId}`);
  }

  if (priority && VALID_PRIORITY.includes(priority)) filters.push(`priority=eq.${priority}`);
  if (category) filters.push(`category=ilike.*${encodeURIComponent(category)}*`);

  // Search across number, subject, user id, username, device.
  if (q) {
    const numMatch = q.match(/^om-?0*([0-9]+)$/i);
    if (numMatch) {
      filters.push(`number=eq.${Number(numMatch[1])}`);
    } else {
      orParts.push(`subject=ilike.*${encodeURIComponent(q)}*`);
      orParts.push(`user_discord_username=ilike.*${encodeURIComponent(q)}*`);
      orParts.push(`user_discord_id=eq.${encodeURIComponent(q.split(" ")[0])}`);
      orParts.push(`device_model=ilike.*${encodeURIComponent(q)}*`);
      orParts.push(`category=ilike.*${encodeURIComponent(q)}*`);
      // public_number search
      if (/^om-?[0-9]+$/i.test(q)) {
        orParts.push(`public_number=ilike.*${encodeURIComponent(q)}*`);
      }
      filters.push(`or=(${orParts.join(",")})`);
    }
  }

  const where = filters.join("&");

  // Sort column mapping.
  const sortCol = sort === "priority" ? "last_activity_at" : sort === "created" ? "created_at" : "last_activity_at";
  // For priority we sort in-app (LOW..URGENT isn't lexicographic); Postgrest sorts the rest.
  const postgresOrder = sort !== "priority" ? `&order=${sortCol}.${dir}` : "";

  // For priority sort, fetch a larger slice and sort in-app.
  const fetchLimit = sort === "priority" ? 500 : pageSize;

  // Count total matching rows (exclude pagination).
  const [countRes] = await db.select(
    "support_tickets",
    `select=id${where ? `&${where}` : ""}`,
  );
  const total = Array.isArray(countRes.body) ? countRes.body.length : 0;

  const [dataRes] = await db.select(
    "support_tickets",
    `select=*,assigned:support_staff!support_tickets_assigned_to_fkey(discord_id,display_name,discord_username)&limit=${fetchLimit}${postgresOrder}${where ? `&${where}` : ""}`,
  );

  let rows = Array.isArray(dataRes.body) ? dataRes.body : [];

  // In-app priority sort (LOW < NORMAL < HIGH < URGENT).
  if (sort === "priority") {
    const rank = { LOW: 0, NORMAL: 1, HIGH: 2, URGENT: 3 };
    const factor = dir === "asc" ? 1 : -1;
    rows.sort((a, b) => (rank[a.priority] - rank[b.priority]) * factor);
  }

  // Apply pagination after in-app sort.
  const start = (page - 1) * pageSize;
  const paged = rows.slice(start, start + pageSize);

  return json({
    total,
    page,
    pageSize,
    rows: paged,
  });
}
