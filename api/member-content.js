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

async function authenticateRequest(req) {
  const authHeader = getHeaderValue(req, "authorization");
  const token = String(authHeader || "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return { session: null, token: null };

  const anonKey = getAnonKey();
  if (!anonKey) {
    throw new Error("Missing SUPABASE_ANON_KEY");
  }

  const response = await fetch(`${getSupabaseUrl()}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
    },
  });

  if (response.status === 401) return { session: null, token };
  if (!response.ok) {
    throw new Error("Unable to validate Supabase session");
  }

  return { session: await response.json(), token };
}

async function fetchProfile(session, token) {
  const response = await fetch(
    `${getSupabaseUrl()}/rest/v1/profiles?select=id,email,display_name,avatar_path,bio,role,can_upload_photos,created_at&id=eq.${encodeURIComponent(session.id)}`,
    {
      headers: {
        apikey: getAnonKey(),
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error("Unable to load account profile");
  }

  const rows = await response.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  try {
    const { session, token } = await authenticateRequest(req);
    if (!session || !token) {
      res.statusCode = 401;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    const profile = await fetchProfile(session, token);
    const email = String(profile?.email || session.email || "");
    const displayName = String(
      profile?.display_name || session.user_metadata?.full_name || email || session.id
    );
    const role = String(profile?.role || "member").toLowerCase();
    const admin = role === "admin";
    const canUploadPhotos = Boolean(profile?.can_upload_photos || admin);

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        title: "My Account",
        intro: `Signed in as ${displayName}.`,
        admin,
        canUploadPhotos,
        email,
        profile: {
          avatarPath: profile?.avatar_path || "",
          avatarUrl: profile?.avatar_path ? `/media/profile-photos/${profile.avatar_path}` : "",
          bio: profile?.bio || "",
          createdAt: profile?.created_at || null,
          displayName,
          role,
        },
      })
    );
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: error.message || "Server error" }));
  }
};
