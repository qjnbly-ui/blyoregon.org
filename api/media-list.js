const DEFAULT_SUPABASE_URL = "https://mgxdiolwevcgwgzhzttd.supabase.co";
const IMAGE_EXTENSIONS = /\.(avif|gif|jpe?g|png|webp)$/i;

function getHeaderValue(req, name) {
  const value = req.headers?.[name];
  return Array.isArray(value) ? value[0] : value;
}

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  const requestUrl = new URL(req.url, `https://${getHeaderValue(req, "host") || "blyoregon.org"}`);
  const bucket = String(requestUrl.searchParams.get("bucket") || "").trim();
  const prefix = String(requestUrl.searchParams.get("prefix") || "").trim();
  const limitParam = Number(requestUrl.searchParams.get("limit") || 1000);
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 1000) : 1000;

  if (!bucket) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Missing bucket" }));
    return;
  }

  const supabaseUrl = String(process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/+$/, "");
  const apiKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "";
  const headers = {
    "Content-Type": "application/json",
  };

  if (apiKey) {
    headers.apikey = apiKey;
    headers.Authorization = `Bearer ${apiKey}`;
  }

  try {
    const response = await fetch(`${supabaseUrl}/storage/v1/object/list/${encodeURIComponent(bucket)}`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        limit,
        offset: 0,
        prefix,
        sortBy: {
          column: "name",
          order: "asc",
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      res.statusCode = response.status;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: errorText || "Supabase list request failed" }));
      return;
    }

    const items = await response.json();
    const files = Array.isArray(items)
      ? items
          .map((item) => String(item?.name || "").trim())
          .filter((name) => name && IMAGE_EXTENSIONS.test(name))
      : [];

    res.statusCode = 200;
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=3600");
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(files));
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: error.message || "Server error" }));
  }
};
