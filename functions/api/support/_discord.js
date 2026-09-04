// Minimal Discord REST client for the dashboard Functions.
//
// Discord is the source of truth for the ticket *conversation*. Staff replies
// are posted into the *existing* ticket thread via the bot token (never a new
// thread, never into #support), and the conversation is read back from Discord
// via the same bot token. Server-side only.

export async function discordRequest(env, method, path, body = undefined) {
  const response = await fetch(`https://discord.com/api/v10${path}`, {
    method,
    headers: {
      Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { response, json };
}

/** Posts a text message into an existing thread channel. Returns the new message id. */
export async function postToThread(env, threadId, { content, embeds }) {
  const { response, json } = await discordRequest(env, "POST", `/channels/${threadId}/messages`, {
    content,
    embeds,
  });
  if (!response.ok) {
    throw new Error(`Discord post failed (${response.status}): ${JSON.stringify(json)}`);
  }
  return json.id;
}

/**
 * Reads up to 100 messages from a thread. Discord returns them NEWEST-first and
 * pages by message id (not timestamp). Callers pass `after` to get messages
 * newer than an id, `before` to page back into history, or `around` for context.
 */
export async function getMessages(env, threadId, { after, before, around, limit = 100 } = {}) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (after) params.set("after", after);
  if (before) params.set("before", before);
  if (around) params.set("around", around);
  const { response, json } = await discordRequest(env, "GET", `/channels/${threadId}/messages?${params}`);
  if (!response.ok) {
    throw new Error(`Discord get-messages failed (${response.status}): ${JSON.stringify(json)}`);
  }
  return Array.isArray(json) ? json : [];
}

/** Creates a public thread inside a channel and returns the new thread id. */
export async function createPublicThread(env, channelId, { name }) {
  const { response, json } = await discordRequest(env, "POST", `/channels/${channelId}/threads`, {
    name,
    type: 11, // GUILD_PUBLIC_THREAD
    auto_archive_duration: 10080, // 7 days
  });
  if (!response.ok) {
    throw new Error(`Discord create-thread failed (${response.status}): ${JSON.stringify(json)}`);
  }
  return json.id;
}

/** Adds a user as a member of a thread. */
export async function addThreadMember(env, threadId, userId) {
  return discordRequest(env, "PUT", `/channels/${threadId}/members/${userId}`);
}

/**
 * Follows up on an interaction (after a type 5 deferred ack) by POSTing to the
 * interaction webhook. Returns the raw {response,json}.
 */
export async function interactionFollowUp(env, applicationId, interactionToken, payload) {
  return discordRequest(env, "POST", `/webhooks/${applicationId}/${interactionToken}`, payload);
}

/** Messages newer than the given message id (NEWEST-first). Convenience wrapper. */
export async function getMessagesAfter(env, threadId, afterId) {
  return getMessages(env, threadId, { after: afterId });
}

/** Resolves a thread/private thread/public thread channel; null if it no longer exists. */
export async function getThread(env, threadId) {
  const { response, json } = await discordRequest(env, "GET", `/channels/${threadId}`);
  if (!response.ok) return null;
  return json;
}

/**
 * Maps a raw Discord message object into the shape the dashboard UI expects
 * (identical to the fields it previously received from the mirror table).
 * `isStaffAuthor(authorId)` decides whether to mark it as a staff message.
 */
export function mapDiscordMessage(message, isStaffAuthor) {
  const author = message.author ?? {};
  const name = author.global_name || author.username || author.id || "Unknown";
  const attachments = (message.attachments ?? []).map((a) => ({
    id: a.id,
    url: a.url,
    name: a.filename || a.name || "attachment",
  }));
  return {
    id: message.id,
    content: message.content || "",
    message_type: isStaffAuthor(author.id) ? "STAFF" : "USER",
    source: "discord",
    author_discord_id: author.id || "",
    author_name: name,
    is_internal_note: false,
    attachments,
    created_at: message.timestamp || new Date().toISOString(),
  };
}
