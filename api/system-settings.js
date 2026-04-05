function getSupabaseUrl() {
  return String(process.env.SUPABASE_URL || "https://mgxdiolwevcgwgzhzttd.supabase.co").replace(/\/+$/, "");
}

function getAnonKey() {
  return String(process.env.SUPABASE_ANON_KEY || "").trim();
}

function getEnv(name, fallback = "") {
  return String(process.env[name] || fallback).trim();
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

  const anonKey = getAnonKey();
  if (!anonKey) throw new Error("Missing SUPABASE_ANON_KEY");

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

async function fetchOwnProfile(session, token) {
  const response = await fetch(
    `${getSupabaseUrl()}/rest/v1/profiles?select=id,role,can_review_articles,can_publish_articles&id=eq.${encodeURIComponent(session.id)}`,
    {
      headers: {
        apikey: getAnonKey(),
        Authorization: `Bearer ${token}`,
      },
    }
  );
  if (!response.ok) throw new Error("Unable to load account profile");
  const rows = await response.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

function getSiteUrl(req) {
  const explicit = getEnv("PUBLIC_SITE_URL");
  if (explicit) return explicit.replace(/\/+$/, "");

  const host = req.headers?.host || "blyoregon.org";
  const protocol = host.includes("localhost") || host.startsWith("127.0.0.1") ? "http" : "https";
  return `${protocol}://${host}`.replace(/\/+$/, "");
}

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  try {
    const { session, token } = await authenticateRequest(req);
    if (!session || !token) {
      sendJson(res, 401, { error: "Unauthorized" });
      return;
    }

    const profile = await fetchOwnProfile(session, token);
    const role = String(profile?.role || "").toLowerCase();
    const isAdmin = role === "admin";
    if (!isAdmin) {
      sendJson(res, 403, { error: "Forbidden" });
      return;
    }

    const adminEmails = getEnv("ADMIN_EMAILS")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    sendJson(res, 200, {
      system: {
        siteUrl: getSiteUrl(req),
        emailDelivery: {
          enabled: Boolean(getEnv("RESEND_API_KEY")),
          fromEmail: getEnv("RESEND_FROM_EMAIL", "noreply@blyoregon.org"),
          adminRecipientCount: adminEmails.length,
        },
        internalNotifications: {
          enabled: true,
          source: "public.notifications",
        },
        articleWorkflow: {
          events: [
            "submission confirmations",
            "review queue alerts",
            "changes requested",
            "publish notifications",
            "unpublish notifications",
            "delete notifications",
          ],
          profileManagedControls: [
            "article submissions",
            "article review updates",
            "publishing updates",
            "admin review queue alerts",
          ],
          envManagedControls: [
            "RESEND_API_KEY",
            "RESEND_FROM_EMAIL",
            "ADMIN_EMAILS",
            "PUBLIC_SITE_URL",
          ],
        },
      },
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Server error" });
  }
};
