const DEFAULT_SUPABASE_URL = "https://mgxdiolwevcgwgzhzttd.supabase.co";

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

async function authenticateRequest(req) {
  const authHeader = getHeaderValue(req, "authorization");
  const token = String(authHeader || "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return { session: null, token: null };

  const apiKey = getAnonKey() || getServiceRoleKey();
  if (!apiKey) throw new Error("Missing Supabase API key");

  const response = await fetch(`${getSupabaseUrl()}/auth/v1/user`, {
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${token}`,
    },
  });

  if (response.status === 401) return { session: null, token };
  if (!response.ok) throw new Error("Unable to validate Supabase session");
  return { session: await response.json(), token };
}

function buildServiceHeaders() {
  const serviceKey = getServiceRoleKey();
  if (!serviceKey) return null;
  return {
    "Content-Type": "application/json",
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
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

function serializeNotification(row) {
  return {
    id: row.id,
    type: row.type || "",
    title: row.title || "",
    body: row.body || "",
    link: row.link || "",
    entityType: row.entity_type || "",
    entityId: row.entity_id || "",
    metadata: row.metadata && typeof row.metadata === "object" ? row.metadata : {},
    actorId: row.actor_id || "",
    readAt: row.read_at || null,
    createdAt: row.created_at || null,
  };
}

async function fetchNotifications(userId, token, { unreadOnly = false, limit = 50 } = {}) {
  const query = new URLSearchParams({
    select: "id,user_id,actor_id,type,title,body,link,entity_type,entity_id,metadata,read_at,created_at",
    user_id: `eq.${userId}`,
    order: "created_at.desc",
    limit: String(limit),
  });
  if (unreadOnly) {
    query.set("read_at", "is.null");
  }

  const response = await fetch(`${getSupabaseUrl()}/rest/v1/notifications?${query.toString()}`, {
    headers: buildServiceHeaders() || buildUserHeaders(token),
  });
  if (!response.ok) throw new Error("Unable to load notifications");
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function fetchUnreadCount(userId, token) {
  const query = new URLSearchParams({
    select: "id",
    user_id: `eq.${userId}`,
    read_at: "is.null",
  });

  const response = await fetch(`${getSupabaseUrl()}/rest/v1/notifications?${query.toString()}`, {
    headers: {
      ...(buildServiceHeaders() || buildUserHeaders(token)),
      Prefer: "count=exact",
      Range: "0-0",
    },
  });
  if (!response.ok) throw new Error("Unable to load unread notification count");
  const contentRange = String(response.headers.get("content-range") || "");
  const total = Number(contentRange.split("/")[1]);
  return Number.isFinite(total) ? total : 0;
}

async function markNotificationsRead(userId, token, ids) {
  const uniqueIds = Array.from(new Set((Array.isArray(ids) ? ids : []).map((id) => String(id || "").trim()).filter(Boolean)));
  if (!uniqueIds.length) return;

  const query = new URLSearchParams({
    user_id: `eq.${userId}`,
    id: `in.(${uniqueIds.join(",")})`,
  });

  const response = await fetch(`${getSupabaseUrl()}/rest/v1/notifications?${query.toString()}`, {
    method: "PATCH",
    headers: buildServiceHeaders() || buildUserHeaders(token),
    body: JSON.stringify({
      read_at: new Date().toISOString(),
    }),
  });
  if (!response.ok) throw new Error("Unable to update notifications");
}

async function markAllNotificationsRead(userId, token) {
  const query = new URLSearchParams({
    user_id: `eq.${userId}`,
    read_at: "is.null",
  });

  const response = await fetch(`${getSupabaseUrl()}/rest/v1/notifications?${query.toString()}`, {
    method: "PATCH",
    headers: buildServiceHeaders() || buildUserHeaders(token),
    body: JSON.stringify({
      read_at: new Date().toISOString(),
    }),
  });
  if (!response.ok) throw new Error("Unable to update notifications");
}

async function deleteNotifications(userId, token, ids) {
  const uniqueIds = Array.from(new Set((Array.isArray(ids) ? ids : []).map((id) => String(id || "").trim()).filter(Boolean)));
  if (!uniqueIds.length) return;

  const query = new URLSearchParams({
    user_id: `eq.${userId}`,
    id: `in.(${uniqueIds.join(",")})`,
  });

  const response = await fetch(`${getSupabaseUrl()}/rest/v1/notifications?${query.toString()}`, {
    method: "DELETE",
    headers: buildServiceHeaders() || buildUserHeaders(token),
  });
  if (!response.ok) throw new Error("Unable to delete notifications");
}

async function deleteAllNotifications(userId, token) {
  const query = new URLSearchParams({
    user_id: `eq.${userId}`,
  });

  const response = await fetch(`${getSupabaseUrl()}/rest/v1/notifications?${query.toString()}`, {
    method: "DELETE",
    headers: buildServiceHeaders() || buildUserHeaders(token),
  });
  if (!response.ok) throw new Error("Unable to clear inbox");
}

module.exports = async (req, res) => {
  try {
    const { session, token } = await authenticateRequest(req);
    if (!session) {
      sendJson(res, 401, { error: "Unauthorized" });
      return;
    }

    if (req.method === "GET") {
      const unreadOnly = String(new URL(req.url, `https://${getHeaderValue(req, "host") || "blyoregon.org"}`).searchParams.get("unread") || "").trim() === "true";
      const [rows, unreadCount] = await Promise.all([
        fetchNotifications(session.id, token, { unreadOnly, limit: unreadOnly ? 20 : 50 }),
        fetchUnreadCount(session.id, token),
      ]);
      sendJson(res, 200, {
        notifications: rows.map(serializeNotification),
        unreadCount,
      });
      return;
    }

    if (req.method === "PATCH") {
      let body = {};
      if (req.body && typeof req.body === "object") {
        body = req.body;
      } else {
        const buffers = [];
        for await (const chunk of req) buffers.push(chunk);
        const raw = buffers.length ? Buffer.concat(buffers).toString("utf8") : "{}";
        body = JSON.parse(raw);
      }

      const action = String(body?.action || "").trim();
      if (action === "mark_read") {
        await markNotificationsRead(session.id, token, [body?.id]);
      } else if (action === "mark_all_read") {
        await markAllNotificationsRead(session.id, token);
      } else if (action === "delete") {
        await deleteNotifications(session.id, token, [body?.id]);
      } else if (action === "clear_inbox") {
        await deleteAllNotifications(session.id, token);
      } else {
        sendJson(res, 400, { error: "Invalid action" });
        return;
      }

      const unreadCount = await fetchUnreadCount(session.id, token);
      sendJson(res, 200, { ok: true, unreadCount });
      return;
    }

    sendJson(res, 405, { error: "Method not allowed" });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Server error" });
  }
};
