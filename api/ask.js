const fs = require("fs/promises");
const path = require("path");

const MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const MAX_CONTEXT_TOKENS = 100000;
const MAX_CONTEXT_WORDS = Math.floor(MAX_CONTEXT_TOKENS / 1.3);
const DATA_DIR = path.join(__dirname, "..", "askbly", "site_text_data");
const MINUTES_INDEX_PATH = path.join(__dirname, "..", "community", "cat-minutes", "index-search.json");

let cachedContext = null;
let cachedBusinesses = null;
let cachedMinutes = null;

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
    "If the user asks for contact details, respond only for the specific place/person they mention (or the most recent place/person just discussed). " +
    "Do NOT list multiple entries unless the user explicitly asks for a list. " +
    "If the user asks for a person's contact details, look for the exact name in the content and respond with what is listed. " +
    "If the user asks about a phone number, list the entries that show that number and any contact name listed with it. " +
    "Only attach a contact name to a phone number when they appear together in the same entry; otherwise say no contact listed for that entry. " +
    "When a question asks for numbers (dates, counts, sizes), repeat the numbers exactly as written in the content. " +
    "Only mention the OC&E Woods Line State Trail if the user explicitly asks about trails, hiking, biking, horseback riding, or the OC&E. " +
    "If something isn't covered, say so clearly and ask one helpful follow-up question. " +
    "Default to a natural narrative voice instead of bullet lists; use lists only if the user asks."
  );
}

function buildMinutesPrompt(minutesContext) {
  return (
    "You are the Bly Community Action Team minutes assistant.\n\n" +
    "Answer questions using ONLY the meeting-minute excerpts provided below. " +
    "If the answer is not in the excerpts, say that clearly. " +
    "Do not invent dates, names, decisions, or project details. " +
    "When possible, mention the month and year of the minutes you are using. " +
    "Default to a natural narrative voice instead of bullet lists unless the user asks.\n\n" +
    "Relevant CAT meeting minutes:\n" +
    `${minutesContext}`
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

async function loadMinutesEntries() {
  if (cachedMinutes) return cachedMinutes;
  try {
    const content = await fs.readFile(MINUTES_INDEX_PATH, "utf8");
    const parsed = JSON.parse(content);
    cachedMinutes = Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    cachedMinutes = [];
  }
  return cachedMinutes;
}

function tokenizeQuery(text) {
  return String(text || "").toLowerCase().match(/[a-z0-9]{3,}/g) || [];
}

function scoreMinutesEntry(entry, tokens, normalizedQuestion) {
  const title = String(entry.title || "").toLowerCase();
  const text = String(entry.text || "").toLowerCase();
  let score = 0;

  tokens.forEach((token) => {
    if (title.includes(token)) score += 8;
    if (text.includes(token)) score += 2;
  });

  if (normalizedQuestion && title.includes(normalizedQuestion)) score += 12;
  return score;
}

function buildMinutesContext(entries, question, history) {
  const joinedQuestion = [question]
    .concat((history || []).filter((entry) => entry.role === "user").map((entry) => entry.content))
    .join(" ");
  const normalizedQuestion = joinedQuestion.trim().toLowerCase();
  const tokens = tokenizeQuery(joinedQuestion);

  const ranked = entries
    .map((entry) => ({ entry, score: scoreMinutesEntry(entry, tokens, normalizedQuestion) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.entry.year - a.entry.year || b.entry.month_num - a.entry.month_num)
    .slice(0, 6)
    .map((item) => item.entry);

  const selected = ranked.length
    ? ranked
    : entries
        .slice()
        .sort((a, b) => b.year - a.year || b.month_num - a.month_num)
        .slice(0, 3);

  let wordsUsed = 0;
  const maxWords = 12000;
  const contextParts = [];

  selected.forEach((entry) => {
    const text = String(entry.text || "").trim();
    if (!text) return;
    const words = text.split(/\s+/);
    const remaining = maxWords - wordsUsed;
    if (remaining <= 0) return;
    const excerpt = words.slice(0, remaining).join(" ");
    wordsUsed += Math.min(words.length, remaining);
    contextParts.push(`\n\n---\n\n${entry.title}\nSource file: ${entry.filename}\n${excerpt}`);
  });

  return contextParts.join("").trim();
}

function extractPhoneDigits(text) {
  const digits = String(text || "").replace(/\D/g, "");
  if (digits.length >= 10) return digits.slice(-10);
  return "";
}

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isPhoneLookup(question) {
  return /\b(phone|number|call|contact|who.*number)\b/i.test(question || "");
}

async function loadBusinessEntries() {
  if (cachedBusinesses) return cachedBusinesses;
  const filePath = path.join(DATA_DIR, "businesses.md");
  let content = "";
  try {
    content = await fs.readFile(filePath, "utf8");
  } catch (error) {
    cachedBusinesses = [];
    return cachedBusinesses;
  }

  const blocks = content.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
  const entries = [];
  const contactKeys = new Set(["address", "phone", "cell", "email", "website", "website/social", "contact", "fax"]);

  blocks.forEach((block) => {
    const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!lines.length) return;
    const name = lines[0];
    const fields = {};
    const description = [];

    for (let i = 1; i < lines.length; i += 1) {
      const line = lines[i];
      const match = line.match(/^([A-Za-z/&\s]+):\s*(.+)$/);
      if (match) {
        const key = match[1].trim().toLowerCase();
        fields[key] = match[2].trim();
      } else {
        description.push(line);
      }
    }

    const hasContactField = Object.keys(fields).some((key) => contactKeys.has(key));
    if (!hasContactField) return;

    entries.push({
      name,
      fields,
      description: description.join(" ").trim(),
      normalizedName: normalizeName(name),
    });
  });

  cachedBusinesses = entries;
  return cachedBusinesses;
}

function matchScore(normalizedText, entry) {
  if (!normalizedText) return 0;
  if (normalizedText.includes(entry.normalizedName)) return entry.normalizedName.split(" ").length + 2;
  const tokens = entry.normalizedName.split(" ").filter((token) => token.length >= 3);
  if (!tokens.length) return 0;
  let score = 0;
  tokens.forEach((token) => {
    if (normalizedText.includes(token)) score += 1;
  });
  return score;
}

function findBestEntry(text, entries) {
  const normalizedText = normalizeName(text);
  if (!normalizedText) return { entry: null, candidates: [] };
  let bestScore = 0;
  let candidates = [];

  entries.forEach((entry) => {
    const score = matchScore(normalizedText, entry);
    if (score > bestScore) {
      bestScore = score;
      candidates = [entry];
    } else if (score === bestScore && score > 0) {
      candidates.push(entry);
    }
  });

  if (bestScore === 0) return { entry: null, candidates: [] };
  if (candidates.length === 1) return { entry: candidates[0], candidates };
  return { entry: null, candidates };
}

function isContactLookup(question) {
  return /\b(contact|contact info|contact information|contact details|phone|number|call|email|website|address|how to reach)\b/i.test(
    question || ""
  );
}

function formatContactEntry(entry) {
  const parts = [];
  const fields = entry.fields || {};

  if (fields.address) parts.push(`Address: ${fields.address}`);
  if (fields.phone) parts.push(`Phone: ${fields.phone}`);
  if (fields.cell) parts.push(`Cell: ${fields.cell}`);
  if (fields.email) parts.push(`Email: ${fields.email}`);
  if (fields["website"]) parts.push(`Website: ${fields["website"]}`);
  if (fields["website/social"]) parts.push(`Website/Social: ${fields["website/social"]}`);
  if (fields.contact) parts.push(`Contact: ${fields.contact}`);
  if (fields.fax) parts.push(`Fax: ${fields.fax}`);

  if (!parts.length) return `${entry.name} — I don't see contact details listed.`;
  return `${entry.name} — ${parts.join(" | ")}`;
}

async function findPhoneMatches(phoneDigits, entries) {
  if (!phoneDigits) return [];
  const matches = [];
  entries.forEach((entry) => {
    const phoneLine = entry.fields.phone || entry.fields.cell || "";
    const phoneDigitsInEntry = extractPhoneDigits(phoneLine);
    if (!phoneDigitsInEntry || phoneDigitsInEntry !== phoneDigits) return;
    matches.push({
      name: entry.name,
      phone: phoneLine,
      contact: entry.fields.contact || "",
    });
  });
  return matches;
}

function formatPhoneLookup(matches, phoneDigits) {
  if (!matches.length) return "";
  const display = phoneDigits
    ? `(${phoneDigits.slice(0, 3)}) ${phoneDigits.slice(3, 6)}-${phoneDigits.slice(6)}`
    : "";
  const intro = display
    ? `Here’s where ${display} appears in the business directory:`
    : "Here’s where that number appears in the business directory:";
  const details = matches.map((entry) => {
    const contact = entry.contact ? ` Contact: ${entry.contact}.` : " Contact: not listed.";
    return `${entry.name} — ${entry.phone}.${contact}`;
  });
  return `${intro} ${details.join(" ")}`;
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
    const rawMessages = sanitizeMessages(body.messages || body.history);
    const questionFromMessages = rawMessages
      .slice()
      .reverse()
      .find((entry) => entry.role === "user")?.content;
    const question = String(questionFromMessages || body.question || "").trim();
    const scope = String(body.scope || "").trim().toLowerCase();

    if (!question && !rawMessages.length) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Missing question" }));
      return;
    }

    const businessEntries = await loadBusinessEntries();

    if (isPhoneLookup(question)) {
      const phoneDigits = extractPhoneDigits(question);
      if (phoneDigits) {
        const matches = await findPhoneMatches(phoneDigits, businessEntries);
        const response = formatPhoneLookup(matches, phoneDigits);
        if (response) {
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ answer: response }));
          return;
        }
      }
    }

    if (isContactLookup(question)) {
      let target = findBestEntry(question, businessEntries);
      if (!target.entry && !target.candidates.length && rawMessages.length) {
        for (let i = rawMessages.length - 1; i >= 0; i -= 1) {
          const { entry, candidates } = findBestEntry(rawMessages[i].content, businessEntries);
          if (entry) {
            target = { entry, candidates };
            break;
          }
          if (candidates.length) {
            target = { entry: null, candidates };
            break;
          }
        }
      }

      if (target.entry) {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ answer: formatContactEntry(target.entry) }));
        return;
      }

      if (target.candidates && target.candidates.length > 1) {
        const options = target.candidates.slice(0, 3).map((entry) => entry.name).join(", ");
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            answer: `Which place do you mean? I see ${options}.`,
          })
        );
        return;
      }

      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          answer: "Which place are you asking about? I can share the exact address, phone, and website.",
        })
      );
      return;
    }

    if (scope === "minutes") {
      const minutesEntries = await loadMinutesEntries();
      const minutesContext = buildMinutesContext(minutesEntries, question, rawMessages);

      if (!minutesContext) {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ answer: "I do not have the CAT minutes loaded right now. Please try again later." }));
        return;
      }

      const conversation = rawMessages.length
        ? rawMessages
        : [{ role: "user", content: question }];

      const answer = await askGroq([
        { role: "system", content: buildMinutesPrompt(minutesContext) },
        ...conversation,
      ]);

      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ answer: answer || "" }));
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
