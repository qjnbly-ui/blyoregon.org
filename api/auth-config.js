function getSupabaseUrl() {
  return String(process.env.SUPABASE_URL || "https://mgxdiolwevcgwgzhzttd.supabase.co").replace(/\/+$/, "");
}

function getSiteUrl(req) {
  const explicit = String(process.env.PUBLIC_SITE_URL || "").trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  const host = req.headers?.host || "blyoregon.org";
  const protocol = host.includes("localhost") || host.startsWith("127.0.0.1") ? "http" : "https";
  return `${protocol}://${host}`.replace(/\/+$/, "");
}

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  const anonKey = String(process.env.SUPABASE_ANON_KEY || "").trim();
  if (!anonKey) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Missing SUPABASE_ANON_KEY" }));
    return;
  }

  res.statusCode = 200;
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=3600");
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({
      siteUrl: getSiteUrl(req),
      supabaseUrl: getSupabaseUrl(),
      supabaseAnonKey: anonKey,
    })
  );
};
