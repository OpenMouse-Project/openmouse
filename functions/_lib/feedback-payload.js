function text(value, max) {
  if (typeof value !== "string" || value.length > max) throw new Error("Invalid text");
  return value;
}

export function feedbackPayload(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid payload");
  const payload = { allowed_mentions: { parse: [] } };
  if (input.content !== undefined) payload.content = text(input.content, 2000);
  if (input.embeds !== undefined) {
    if (!Array.isArray(input.embeds) || input.embeds.length > 10) throw new Error("Invalid embeds");
    let total = 0;
    payload.embeds = input.embeds.map((embed) => {
      if (!embed || typeof embed !== "object" || Array.isArray(embed)) throw new Error("Invalid embed");
      const result = {};
      for (const [key, limit] of [["title", 256], ["description", 4096]]) {
        if (embed[key] !== undefined) { result[key] = text(embed[key], limit); total += result[key].length; }
      }
      if (embed.color !== undefined) {
        if (!Number.isInteger(embed.color) || embed.color < 0 || embed.color > 0xffffff) throw new Error("Invalid color");
        result.color = embed.color;
      }
      if (embed.fields !== undefined) {
        if (!Array.isArray(embed.fields) || embed.fields.length > 25) throw new Error("Invalid fields");
        result.fields = embed.fields.map((field) => {
          const name = text(field?.name, 256);
          const value = text(field?.value, 1024);
          total += name.length + value.length;
          return { name, value, ...(typeof field.inline === "boolean" ? { inline: field.inline } : {}) };
        });
      }
      if (embed.footer !== undefined) {
        const value = text(embed.footer?.text, 2048);
        total += value.length;
        result.footer = { text: value };
      }
      if (embed.timestamp !== undefined) {
        const value = text(embed.timestamp, 64);
        if (!Number.isFinite(Date.parse(value))) throw new Error("Invalid timestamp");
        result.timestamp = value;
      }
      return result;
    });
    if (total > 6000) throw new Error("Embeds too long");
  }
  if (!payload.content && !payload.embeds?.length) throw new Error("Empty feedback");
  return payload;
}
