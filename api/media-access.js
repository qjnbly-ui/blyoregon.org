function getSupabaseUrl() {
  return String(process.env.SUPABASE_URL || "https://mgxdiolwevcgwgzhzttd.supabase.co").replace(/\/+$/, "");
}

function getAnonKey() {
  return String(process.env.SUPABASE_ANON_KEY || "").trim();
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

const AVAILABLE_BUCKETS = [
  { id: "churchfirephotos", label: "Church Fire Photos" },
  { id: "standingstonechurchconstructionphotos", label: "Standing Stone Construction Photos" },
];

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) reject(new Error("Request body too large"));
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
    `${getSupabaseUrl()}/rest/v1/profiles?select=id,role,can_manage_media,media_buckets&id=eq.${encodeURIComponent(session.id)}`,
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

async function listProfiles(token) {
  const response = await fetch(
    `${getSupabaseUrl()}/rest/v1/profiles?select=id,email,display_name,role,can_manage_media,media_buckets&order=display_name.asc.nullslast,email.asc`,
    {
      headers: {
        apikey: getAnonKey(),
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (!response.ok) throw new Error("Unable to load profiles");
  return response.json();
}

function sanitizeBuckets(input) {
  const allowed = new Set(AVAILABLE_BUCKETS.map((bucket) => bucket.id));
  return Array.isArray(input)
    ? [...new Set(input.map((bucket) => String(bucket || "").trim()).filter((bucket) => allowed.has(bucket)))]
    : [];
}

async function updateMediaAccess(token, userId, mediaBuckets) {
  const response = await fetch(
    `${getSupabaseUrl()}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`,
    {
      method: "PATCH",
      headers: {
        apikey: getAnonKey(),
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        can_manage_media: mediaBuckets.length > 0,
        media_buckets: mediaBuckets,
      }),
    }
  );

  if (!response.ok) throw new Error("Unable to update media access");
  const rows = await response.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

module.exports = async (req, res) => {
  try {
    const { session, token } = await authenticateRequest(req);
    if (!session || !token) {
      sendJson(res, 401, { error: "Unauthorized" });
      return;
    }

    const ownProfile = await fetchOwnProfile(session, token);
    const isAdmin = String(ownProfile?.role || "").toLowerCase() === "admin";
    if (!isAdmin) {
      sendJson(res, 403, { error: "Forbidden" });
      return;
    }

    if (req.method === "GET") {
      const profiles = await listProfiles(token);
      sendJson(res, 200, {
        availableBuckets: AVAILABLE_BUCKETS,
        profiles: Array.isArray(profiles)
          ? profiles.map((profile) => ({
              id: profile.id,
              email: profile.email || "",
              displayName: profile.display_name || "",
              role: String(profile.role || "member").toLowerCase(),
              canManageMedia: Boolean(profile.can_manage_media || String(profile.role || "").toLowerCase() === "admin"),
              mediaBuckets: Array.isArray(profile.media_buckets) ? profile.media_buckets : [],
            }))
          : [],
      });
      return;
    }

    if (req.method === "PATCH") {
      const body = await parseJsonBody(req);
      const userId = String(body?.userId || "").trim();
      const mediaBuckets = sanitizeBuckets(body?.mediaBuckets);

      if (!userId) {
        sendJson(res, 400, { error: "Missing userId" });
        return;
      }

      const updated = await updateMediaAccess(token, userId, mediaBuckets);
      sendJson(res, 200, {
        ok: true,
        profile: {
          id: updated?.id || userId,
          email: updated?.email || "",
          displayName: updated?.display_name || "",
          role: String(updated?.role || "member").toLowerCase(),
          canManageMedia: Boolean(updated?.can_manage_media || String(updated?.role || "").toLowerCase() === "admin"),
          mediaBuckets: Array.isArray(updated?.media_buckets) ? updated.media_buckets : mediaBuckets,
        },
      });
      return;
    }

    sendJson(res, 405, { error: "Method not allowed" });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Server error" });
  }
};
