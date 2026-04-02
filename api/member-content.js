function getSupabaseUrl() {
  return String(process.env.SUPABASE_URL || "https://mgxdiolwevcgwgzhzttd.supabase.co").replace(/\/+$/, "");
}

function getAnonKey() {
  return String(process.env.SUPABASE_ANON_KEY || "").trim();
}

function getAdminEmails() {
  return String(process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function getHeaderValue(req, name) {
  const value = req.headers?.[name];
  return Array.isArray(value) ? value[0] : value;
}

async function authenticateRequest(req) {
  const authHeader = getHeaderValue(req, "authorization");
  const token = String(authHeader || "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;
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

  if (response.status === 401) return null;
  if (!response.ok) {
    throw new Error("Unable to validate Supabase session");
  }

  return response.json();
}

function isAdmin(session) {
  const email = String(session?.email || "").toLowerCase();
  const role = String(session?.app_metadata?.role || session?.user_metadata?.role || "").toLowerCase();
  return role === "admin" || getAdminEmails().includes(email);
}

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  try {
    const session = await authenticateRequest(req);
    if (!session) {
      res.statusCode = 401;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    const email = String(session.email || "");
    const displayName = String(session.user_metadata?.full_name || email || session.sub);
    const admin = isAdmin(session);
    const sections = [
      {
        heading: "Protected API content",
        body: "This payload is returned only after the API verifies the Supabase access token signature server-side.",
      },
      {
        heading: "Member roadmap",
        body: "Use Supabase tables and storage for photos, recommendations, articles, and user-submitted content. Let RLS decide who can read, create, edit, approve, or publish each item.",
      },
    ];

    if (admin) {
      sections.push(
        {
          heading: "Admin tools",
          body: "Your account is marked as admin. This is where moderation, publishing, storage management, and broader photo-library access should live.",
        },
        {
          heading: "Recommended admin scope",
          body: "Admins should be able to approve submissions, edit or unpublish content, manage featured photos, review recommendations, and grant or revoke elevated roles.",
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
        email,
        sections,
      })
    );
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: error.message || "Server error" }));
  }
};
