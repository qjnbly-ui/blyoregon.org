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
    `${getSupabaseUrl()}/rest/v1/profiles?select=id,email,display_name,bio,role,can_upload_photos,created_at&id=eq.${encodeURIComponent(session.id)}`,
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

    const sections = [
      {
        heading: "Profile",
        body: profile?.bio
          ? profile.bio
          : "Your public profile is set up. You can add a short bio and other details later.",
      },
      {
        heading: "Access",
        body: canUploadPhotos
          ? "This account has permission to send in photo submissions."
          : "Photo submissions are not enabled for this account right now.",
      },
      {
        heading: "Next features",
        body: "This account will be used for submissions, profile details, and other site participation features.",
      },
    ];

    if (admin) {
      sections.push(
        {
          heading: "Admin section",
          body: "Your account has administrative access for site management, review, and publishing tools.",
        },
        {
          heading: "Admin scope",
          body: "Administrative tools can include reviewing submissions, updating site content, and managing elevated permissions.",
        }
      );
    }

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
          bio: profile?.bio || "",
          createdAt: profile?.created_at || null,
          displayName,
          role,
        },
        sections,
      })
    );
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: error.message || "Server error" }));
  }
};
