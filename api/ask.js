const fs = require("fs/promises");
const path = require("path");

const MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const MAX_CONTEXT_TOKENS = 100000;
const MAX_CONTEXT_WORDS = Math.floor(MAX_CONTEXT_TOKENS / 1.3);
const DATA_DIR = path.join(__dirname, "..", "askbly", "site_text_data");

let cachedContext = null;

async function loadSiteContext() {
  if (cachedContext) return cachedContext;

  const entries = await fs.readdir(DATA_DIR);
  const files = entries.filter((name) => name.endsWith(".md")).sort();

  const chunks = [];
  for (const file of files) {
    const filePath = path.join(DATA_DIR, file);
    const content = await fs.readFile(filePath, "utf8");
    chunks.push(`\n\n---\n\nFile: ${file}\n${content}`);
  }

  let context = chunks.join("").trim();
  const words = context.split(/\s+/);
  if (words.length > MAX_CONTEXT_WORDS) {
    context = `${words.slice(0, MAX_CONTEXT_WORDS).join(" ")}\n\n[Context truncated for length]`;
  }

  cachedContext = context;
  return context;
}

function buildSystemPrompt(siteContext) {
  return (
    "You are a friendly guide for Bly, Oregon.\n\n" +
    "Full site content (history, businesses, community, recreation, etc.):\n" +
    `${siteContext}\n\n` +
    "Answer questions based ONLY on this content unless asked otherwise. " +
    "If the user asks for a person's contact details, look for the exact name in the content and respond with what is listed. " +
    "If something isn't covered, say so clearly and ask one helpful follow-up question. " +
    "Default to a natural narrative voice instead of bullet lists; use lists only if the user asks."
  );
}

function sanitizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((entry) => entry && typeof entry.content === "string")
    .map((entry) => ({
      role: entry.role === "user" ? "user" : "assistant",
      content: entry.content.slice(0, 1200),
    }))
    .slice(-12);
}

async function askGroq(messages) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("Missing GROQ_API_KEY");
  }

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.4,
      max_tokens: 2000,
      messages,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Groq API error: ${response.status} ${text}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || "";
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const rawMessages = sanitizeMessages(body.messages);
    const questionFromMessages = rawMessages
      .slice()
      .reverse()
      .find((entry) => entry.role === "user")?.content;
    const question = String(questionFromMessages || body.question || "").trim();

    if (!question && !rawMessages.length) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Missing question" }));
      return;
    }

    const siteContext = await loadSiteContext();
    const systemPrompt = buildSystemPrompt(siteContext);

    const conversation = rawMessages.length
      ? rawMessages
      : [{ role: "user", content: question }];

    const answer = await askGroq([
      { role: "system", content: systemPrompt },
      ...conversation,
    ]);

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ answer: answer || "" }));
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: error.message || "Server error" }));
  }
};
