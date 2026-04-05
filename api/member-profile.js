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

function getPublicApiKey() {
  return getServiceRoleKey() || getAnonKey();
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

  const apiKey = getAnonKey() || getPublicApiKey();
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

async function fetchProfileById(userId) {
  const apiKey = getPublicApiKey();
  if (!apiKey || !userId) return null;

  const query = new URLSearchParams({
    select: "id,display_name,avatar_path,bio,created_at",
    id: `eq.${userId}`,
    limit: "1",
  });
  const response = await fetch(`${getSupabaseUrl()}/rest/v1/profiles?${query.toString()}`, {
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
    },
  });
  if (!response.ok) throw new Error("Unable to load member profile");
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

function serializeProfile(profile) {
  return {
    id: profile?.id || "",
    displayName: profile?.display_name || "Bly member",
    avatarPath: profile?.avatar_path || "",
    avatarUrl: profile?.avatar_path ? `/media/profile-photos/${profile.avatar_path}` : "",
    bio: profile?.bio || "",
    createdAt: profile?.created_at || null,
  };
}

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  try {
    const { session } = await authenticateRequest(req);
    const url = new URL(req.url, `https://${getHeaderValue(req, "host") || "blyoregon.org"}`);
    const userId = String(url.searchParams.get("id") || "").trim();
    if (!userId) {
      sendJson(res, 400, { error: "Missing member id" });
      return;
    }

    const profile = await fetchProfileById(userId);
    if (!profile) {
      sendJson(res, 404, { error: "Member not found" });
      return;
    }

    sendJson(res, 200, {
      profile: serializeProfile(profile),
      viewer: {
        signedIn: Boolean(session?.id),
        isSelf: Boolean(session?.id && session.id === userId),
        canMessage: Boolean(session?.id && session.id !== userId),
      },
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Server error" });
  }
};
