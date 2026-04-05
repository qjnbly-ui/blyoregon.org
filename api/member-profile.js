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

async function fetchPublishedArticlesByAuthor(userId) {
  const apiKey = getPublicApiKey();
  if (!apiKey || !userId) return [];

  const query = new URLSearchParams({
    select: "id,slug,title,summary,published_at,created_at,cover_image_path",
    author_id: `eq.${userId}`,
    status: "eq.published",
    order: "published_at.desc.nullslast,created_at.desc",
  });
  const response = await fetch(`${getSupabaseUrl()}/rest/v1/articles?${query.toString()}`, {
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
    },
  });
  if (!response.ok) throw new Error("Unable to load member articles");
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function fetchPublishedCommunityPostsByAuthor(userId) {
  const apiKey = getPublicApiKey();
  if (!apiKey || !userId) return [];

  const query = new URLSearchParams({
    select: "id,body,image_path,image_alt,created_at,updated_at",
    author_id: `eq.${userId}`,
    status: "eq.published",
    order: "created_at.desc",
  });
  const response = await fetch(`${getSupabaseUrl()}/rest/v1/community_posts?${query.toString()}`, {
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
    },
  });
  if (!response.ok) throw new Error("Unable to load member community posts");
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows : [];
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

function serializeArticle(article) {
  const coverPath = String(article?.cover_image_path || "").trim();
  return {
    id: article?.id || "",
    slug: article?.slug || "",
    title: article?.title || "Untitled article",
    summary: article?.summary || "",
    publishedAt: article?.published_at || article?.created_at || null,
    coverImagePath: coverPath,
    coverImageUrl: coverPath ? `/media/article-images/${coverPath.split("/").map((part) => encodeURIComponent(part)).join("/")}` : "",
  };
}

function serializeCommunityPost(post) {
  const imagePath = String(post?.image_path || "").trim();
  return {
    id: String(post?.id || ""),
    body: String(post?.body || ""),
    imagePath,
    imageUrl: imagePath ? `${getSupabaseUrl()}/storage/v1/object/public/community-feed/${imagePath.split("/").map((part) => encodeURIComponent(part)).join("/")}` : "",
    imageAlt: String(post?.image_alt || ""),
    createdAt: post?.created_at || null,
    updatedAt: post?.updated_at || null,
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

    const [profile, publishedArticles, communityPosts] = await Promise.all([
      fetchProfileById(userId),
      fetchPublishedArticlesByAuthor(userId),
      fetchPublishedCommunityPostsByAuthor(userId),
    ]);
    if (!profile) {
      sendJson(res, 404, { error: "Member not found" });
      return;
    }

    sendJson(res, 200, {
      profile: serializeProfile(profile),
      articles: publishedArticles.map(serializeArticle),
      communityPosts: communityPosts.map(serializeCommunityPost),
      viewer: {
        signedIn: Boolean(session?.id),
        isSelf: Boolean(session?.id && session.id === userId),
        canMessage: Boolean(!session?.id || session.id !== userId),
      },
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Server error" });
  }
};
