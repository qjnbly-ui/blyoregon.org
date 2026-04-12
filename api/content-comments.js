const DEFAULT_SUPABASE_URL = "https://mgxdiolwevcgwgzhzttd.supabase.co";
const MAX_COMMENT_LENGTH = 1200;
const ENTITY_TYPES = new Set(["oral_history", "article"]);

function getSupabaseUrl() {
  return String(process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/+$/, "");
}

function getAnonKey() {
  return String(process.env.SUPABASE_ANON_KEY || "").trim();
}

function getServiceRoleKey() {
  return String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
}

function getHeaderValue(req, name) {
  const value = req.headers?.[name];
  return Array.isArray(value) ? value[0] : value;
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

function buildPublicHeaders() {
  const apiKey = getServiceRoleKey() || getAnonKey();
  if (!apiKey) throw new Error("Missing Supabase API key");
  return {
    "Content-Type": "application/json",
    apikey: apiKey,
    Authorization: `Bearer ${apiKey}`,
  };
}

function buildUserHeaders(token) {
  const anonKey = getAnonKey();
  if (!anonKey || !token) throw new Error("Missing Supabase auth configuration");
  return {
    "Content-Type": "application/json",
    apikey: anonKey,
    Authorization: `Bearer ${token}`,
  };
}

function normalizeText(value, maxLength) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, maxLength);
}

function normalizeEntityType(value) {
  const entityType = String(value || "").trim().toLowerCase();
  if (!ENTITY_TYPES.has(entityType)) throw new Error("Unsupported content type");
  return entityType;
}

function normalizeEntitySlug(value) {
  const slug = String(value || "").trim().toLowerCase();
  if (!slug) throw new Error("Missing content slug");
  if (!/^[a-z0-9][a-z0-9/-]*[a-z0-9]$/.test(slug)) throw new Error("Invalid content slug");
  return slug;
}

async function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 250_000) reject(new Error("Request body too large"));
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

async function authenticateRequest(req) {
  const authHeader = getHeaderValue(req, "authorization");
  const token = String(authHeader || "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return { session: null, token: null };

  const anonKey = getAnonKey();
  if (!anonKey) throw new Error("Missing Supabase auth configuration");

  const response = await fetch(`${getSupabaseUrl()}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
    },
  });

  if (response.status === 401) return { session: null, token };
  if (!response.ok) throw new Error("Unable to validate Supabase session");
  return { session: await response.json(), token };
}

async function fetchProfile(session, token) {
  const query = new URLSearchParams({
    select: "id,email,display_name,role,can_review_articles,can_publish_articles",
    id: `eq.${session.id}`,
    limit: "1",
  });
  const response = await fetch(`${getSupabaseUrl()}/rest/v1/profiles?${query.toString()}`, {
    headers: buildUserHeaders(token),
  });
  if (!response.ok) throw new Error("Unable to load account profile");
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

function viewerFromProfile(profile, session) {
  const role = String(profile?.role || "").toLowerCase();
  return {
    signedIn: Boolean(session?.id),
    userId: String(session?.id || ""),
    displayName: String(profile?.display_name || session?.email || ""),
    canModerate: Boolean(role === "admin" || role === "moderator" || profile?.can_review_articles || profile?.can_publish_articles),
  };
}

function serializeComment(comment) {
  return {
    id: String(comment?.id || ""),
    entityType: String(comment?.entity_type || ""),
    entitySlug: String(comment?.entity_slug || ""),
    parentId: String(comment?.parent_id || ""),
    authorId: String(comment?.author_id || ""),
    authorName: String(comment?.author_name || "Bly member"),
    body: String(comment?.body || ""),
    status: String(comment?.status || "published"),
    createdAt: String(comment?.created_at || ""),
    updatedAt: String(comment?.updated_at || ""),
  };
}

async function fetchComments(entityType, entitySlug) {
  const query = new URLSearchParams({
    select: "id,entity_type,entity_slug,parent_id,author_id,author_name,body,status,created_at,updated_at",
    entity_type: `eq.${entityType}`,
    entity_slug: `eq.${entitySlug}`,
    status: "eq.published",
    order: "created_at.asc",
  });
  const response = await fetch(`${getSupabaseUrl()}/rest/v1/content_comments?${query.toString()}`, {
    headers: buildPublicHeaders(),
  });
  if (!response.ok) throw new Error("Unable to load comments");
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows.map(serializeComment) : [];
}

async function createComment(session, token, body) {
  const profile = await fetchProfile(session, token);
  const entityType = normalizeEntityType(body?.entityType);
  const entitySlug = normalizeEntitySlug(body?.entitySlug);
  const commentBody = normalizeText(body?.body, MAX_COMMENT_LENGTH);
  const parentId = String(body?.parentId || "").trim() || null;

  if (!commentBody) throw new Error("Write a comment before posting.");
  if (parentId) throw new Error("Replies are not enabled yet.");

  const payload = {
    entity_type: entityType,
    entity_slug: entitySlug,
    parent_id: null,
    author_id: session.id,
    author_name: normalizeText(profile?.display_name || session.email || "Bly member", 120) || "Bly member",
    body: commentBody,
    status: "published",
  };

  const response = await fetch(`${getSupabaseUrl()}/rest/v1/content_comments`, {
    method: "POST",
    headers: {
      ...buildUserHeaders(token),
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });

  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows?.message || rows?.error || "Unable to publish comment");
  return serializeComment(Array.isArray(rows) ? rows[0] : payload);
}

module.exports = async (req, res) => {
  try {
    const url = new URL(req.url, `https://${getHeaderValue(req, "host") || "blyoregon.org"}`);
    const { session, token } = await authenticateRequest(req);
    const profile = session && token ? await fetchProfile(session, token) : null;
    const viewer = viewerFromProfile(profile, session);

    if (req.method === "GET") {
      const entityType = normalizeEntityType(url.searchParams.get("entityType"));
      const entitySlug = normalizeEntitySlug(url.searchParams.get("entitySlug"));
      const comments = await fetchComments(entityType, entitySlug);
      sendJson(res, 200, { comments, viewer });
      return;
    }

    if (req.method === "POST") {
      if (!session || !token) {
        sendJson(res, 401, { error: "You need an account to comment." });
        return;
      }
      const body = await parseJsonBody(req);
      const comment = await createComment(session, token, body);
      sendJson(res, 201, { comment, viewer });
      return;
    }

    sendJson(res, 405, { error: "Method not allowed" });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Server error" });
  }
};
