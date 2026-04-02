const crypto = require("crypto");

let jwksCache = {
  expiresAt: 0,
  keys: [],
};

function getSupabaseUrl() {
  return String(process.env.SUPABASE_URL || "https://mgxdiolwevcgwgzhzttd.supabase.co").replace(/\/+$/, "");
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

function parseJwt(token) {
  const [encodedHeader, encodedPayload, signature] = String(token || "").split(".");
  if (!encodedHeader || !encodedPayload || !signature) return null;

  try {
    const header = JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8"));
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    return { encodedHeader, encodedPayload, signature, header, payload };
  } catch {
    return null;
  }
}

async function loadJwks() {
  if (jwksCache.expiresAt > Date.now() && jwksCache.keys.length) return jwksCache.keys;

  const response = await fetch(`${getSupabaseUrl()}/auth/v1/.well-known/jwks.json`);
  if (!response.ok) {
    throw new Error("Unable to load Supabase signing keys");
  }

  const data = await response.json();
  const keys = Array.isArray(data?.keys) ? data.keys : [];
  jwksCache = {
    keys,
    expiresAt: Date.now() + 60 * 60 * 1000,
  };
  return keys;
}

function findJwk(keys, kid) {
  return keys.find((key) => key?.kid === kid && key?.kty === "RSA");
}

async function verifyJwt(token) {
  const parsed = parseJwt(token);
  if (!parsed) return null;

  const keys = await loadJwks();
  const jwk = findJwk(keys, parsed.header?.kid);
  if (!jwk) return null;

  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(`${parsed.encodedHeader}.${parsed.encodedPayload}`);
  verifier.end();

  const publicKey = crypto.createPublicKey({ key: jwk, format: "jwk" });
  const isValid = verifier.verify(publicKey, Buffer.from(parsed.signature, "base64url"));
  if (!isValid) return null;

  const now = Math.floor(Date.now() / 1000);
  const issuer = `${getSupabaseUrl()}/auth/v1`;
  if (!parsed.payload?.sub) return null;
  if (parsed.payload.exp && parsed.payload.exp < now) return null;
  if (parsed.payload.nbf && parsed.payload.nbf > now) return null;
  if (parsed.payload.iss && parsed.payload.iss !== issuer) return null;

  return parsed.payload;
}

async function authenticateRequest(req) {
  const authHeader = getHeaderValue(req, "authorization");
  const token = String(authHeader || "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;
  return verifyJwt(token);
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
        title: "Members Area",
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
