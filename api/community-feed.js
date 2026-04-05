const DEFAULT_SUPABASE_URL = "https://mgxdiolwevcgwgzhzttd.supabase.co";
const COMMUNITY_BUCKET = "community-feed";
const MAX_POST_LENGTH = 3000;
const MAX_COMMENT_LENGTH = 1200;
const DEFAULT_LIMIT = 30;

function getSupabaseUrl() {
  return String(process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/+$/, "");
}

function getAnonKey() {
  return String(process.env.SUPABASE_ANON_KEY || "").trim();
}

function getServiceRoleKey() {
  return String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
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

function buildPublicHeaders() {
  const apiKey = getServiceRoleKey() || getAnonKey();
  if (!apiKey) throw new Error("Missing Supabase API key");
  return {
    "Content-Type": "application/json",
    apikey: apiKey,
    Authorization: `Bearer ${apiKey}`,
  };
}

function buildUserHeaders(token) {
  const anonKey = getAnonKey();
  if (!anonKey || !token) throw new Error("Missing Supabase auth configuration");
  return {
    "Content-Type": "application/json",
    apikey: anonKey,
    Authorization: `Bearer ${token}`,
  };
}

function normalizeText(value, maxLength) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, maxLength);
}

function normalizeImagePath(value) {
  const cleaned = String(value || "").trim().replace(/^\/+/, "");
  if (!cleaned) return "";
  if (cleaned.includes("..")) throw new Error("Invalid image path");
  return cleaned;
}

function buildStoragePublicUrl(path) {
  const cleaned = normalizeImagePath(path);
  if (!cleaned) return "";
  return `${getSupabaseUrl()}/storage/v1/object/public/${COMMUNITY_BUCKET}/${cleaned
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/")}`;
}

async function parseJsonBody(req) {
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
  if (!anonKey) throw new Error("Missing Supabase auth configuration");

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

async function fetchProfile(session, token) {
  const query = new URLSearchParams({
    select: "id,email,display_name",
    id: `eq.${session.id}`,
    limit: "1",
  });
  const response = await fetch(`${getSupabaseUrl()}/rest/v1/profiles?${query.toString()}`, {
    headers: buildUserHeaders(token),
  });
  if (!response.ok) throw new Error("Unable to load account profile");
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

function serializeComment(comment) {
  return {
    id: String(comment?.id || ""),
    postId: String(comment?.post_id || ""),
    authorName: String(comment?.author_name || "Bly member"),
    body: String(comment?.body || ""),
    createdAt: String(comment?.created_at || ""),
    updatedAt: String(comment?.updated_at || ""),
  };
}

function serializePost(post, comments) {
  const imagePath = String(post?.image_path || "");
  return {
    id: String(post?.id || ""),
    authorId: String(post?.author_id || ""),
    authorName: String(post?.author_name || "Bly member"),
    body: String(post?.body || ""),
    imagePath,
    imageUrl: imagePath ? buildStoragePublicUrl(imagePath) : "",
    imageAlt: String(post?.image_alt || ""),
    createdAt: String(post?.created_at || ""),
    updatedAt: String(post?.updated_at || ""),
    comments: Array.isArray(comments) ? comments.map(serializeComment) : [],
  };
}

async function fetchPostById(postId, token) {
  const query = new URLSearchParams({
    select: "id,author_id,author_name,body,image_path,image_alt,created_at,updated_at,status",
    id: `eq.${postId}`,
    limit: "1",
  });
  const response = await fetch(`${getSupabaseUrl()}/rest/v1/community_posts?${query.toString()}`, {
    headers: buildUserHeaders(token),
  });
  if (!response.ok) throw new Error("Unable to load post");
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function fetchPosts(limit) {
  const query = new URLSearchParams({
    select: "id,author_id,author_name,body,image_path,image_alt,created_at,updated_at",
    status: "eq.published",
    order: "created_at.desc",
    limit: String(limit),
  });
  const response = await fetch(`${getSupabaseUrl()}/rest/v1/community_posts?${query.toString()}`, {
    headers: buildPublicHeaders(),
  });
  if (!response.ok) throw new Error("Unable to load community posts");
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function fetchComments(postIds) {
  const normalizedIds = Array.from(new Set((postIds || []).map((value) => String(value || "").trim()).filter(Boolean)));
  if (!normalizedIds.length) return [];
  const query = new URLSearchParams({
    select: "id,post_id,author_name,body,created_at,updated_at",
    status: "eq.published",
    post_id: `in.(${normalizedIds.join(",")})`,
    order: "created_at.asc",
  });
  const response = await fetch(`${getSupabaseUrl()}/rest/v1/community_comments?${query.toString()}`, {
    headers: buildPublicHeaders(),
  });
  if (!response.ok) throw new Error("Unable to load community comments");
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function listFeed(limit = DEFAULT_LIMIT) {
  const safeLimit = Math.max(1, Math.min(60, Number(limit) || DEFAULT_LIMIT));
  const posts = await fetchPosts(safeLimit);
  const comments = await fetchComments(posts.map((post) => post.id));
  const commentsByPostId = new Map();

  for (const comment of comments) {
    const key = String(comment?.post_id || "");
    if (!commentsByPostId.has(key)) commentsByPostId.set(key, []);
    commentsByPostId.get(key).push(comment);
  }

  return posts.map((post) => serializePost(post, commentsByPostId.get(String(post.id || "")) || []));
}

async function createPost(session, token, body) {
  const profile = await fetchProfile(session, token);
  const displayName = normalizeText(profile?.display_name || session.user_metadata?.full_name || session.email || "Bly member", 120);
  const postBody = normalizeText(body?.body, MAX_POST_LENGTH);
  const imagePath = normalizeImagePath(body?.imagePath || "");
  const imageAlt = normalizeText(body?.imageAlt, 160);

  if (!postBody) throw new Error("Write something before posting.");

  const payload = {
    author_id: session.id,
    author_name: displayName || "Bly member",
    body: postBody,
    image_path: imagePath || null,
    image_alt: imageAlt,
    status: "published",
  };

  const response = await fetch(`${getSupabaseUrl()}/rest/v1/community_posts`, {
    method: "POST",
    headers: {
      ...buildUserHeaders(token),
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });

  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows?.message || "Unable to publish post");
  return serializePost(Array.isArray(rows) ? rows[0] : payload, []);
}

async function createComment(session, token, body) {
  const profile = await fetchProfile(session, token);
  const displayName = normalizeText(profile?.display_name || session.user_metadata?.full_name || session.email || "Bly member", 120);
  const postId = String(body?.postId || "").trim();
  const commentBody = normalizeText(body?.body, MAX_COMMENT_LENGTH);

  if (!postId) throw new Error("Post not found.");
  if (!commentBody) throw new Error("Write a comment before posting.");

  const payload = {
    post_id: postId,
    author_id: session.id,
    author_name: displayName || "Bly member",
    body: commentBody,
    status: "published",
  };

  const response = await fetch(`${getSupabaseUrl()}/rest/v1/community_comments`, {
    method: "POST",
    headers: {
      ...buildUserHeaders(token),
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });

  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows?.message || "Unable to publish comment");
  return serializeComment(Array.isArray(rows) ? rows[0] : payload);
}

async function updatePost(session, token, body) {
  const postId = String(body?.postId || "").trim();
  const postBody = normalizeText(body?.body, MAX_POST_LENGTH);
  const imageAlt = normalizeText(body?.imageAlt, 160);
  if (!postId) throw new Error("Post not found.");
  if (!postBody) throw new Error("Write something before saving.");

  const existing = await fetchPostById(postId, token);
  if (!existing) throw new Error("Post not found.");
  if (String(existing.author_id || "") !== String(session.id || "")) {
    throw new Error("You can only edit your own posts.");
  }

  const payload = {
    body: postBody,
    image_alt: imageAlt,
    updated_at: new Date().toISOString(),
  };
  const response = await fetch(`${getSupabaseUrl()}/rest/v1/community_posts?id=eq.${encodeURIComponent(postId)}`, {
    method: "PATCH",
    headers: {
      ...buildUserHeaders(token),
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows?.message || "Unable to update post");
  const updated = Array.isArray(rows) && rows.length ? rows[0] : null;
  return serializePost(updated || { ...existing, ...payload }, []);
}

async function deletePost(session, token, body) {
  const postId = String(body?.postId || "").trim();
  if (!postId) throw new Error("Post not found.");

  const existing = await fetchPostById(postId, token);
  if (!existing) throw new Error("Post not found.");
  if (String(existing.author_id || "") !== String(session.id || "")) {
    throw new Error("You can only delete your own posts.");
  }

  const response = await fetch(`${getSupabaseUrl()}/rest/v1/community_posts?id=eq.${encodeURIComponent(postId)}`, {
    method: "DELETE",
    headers: buildUserHeaders(token),
  });
  if (!response.ok) throw new Error("Unable to delete post");
  return {
    id: postId,
    imagePath: String(existing.image_path || ""),
  };
}

module.exports = async (req, res) => {
  try {
    if (req.method === "GET") {
      const feed = await listFeed(getHeaderValue(req, "x-feed-limit") || DEFAULT_LIMIT);
      const { session } = await authenticateRequest(req).catch(() => ({ session: null }));
      sendJson(res, 200, {
        posts: feed,
        viewer: {
          signedIn: Boolean(session?.id),
          userId: String(session?.id || ""),
        },
      });
      return;
    }

    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }

    const { session, token } = await authenticateRequest(req);
    if (!session || !token) {
      sendJson(res, 401, { error: "You need an account to post or comment." });
      return;
    }

    const body = await parseJsonBody(req);
    const action = String(body?.action || "").trim();

    if (action === "createPost") {
      const post = await createPost(session, token, body);
      sendJson(res, 201, { post });
      return;
    }

    if (action === "createComment") {
      const comment = await createComment(session, token, body);
      sendJson(res, 201, { comment });
      return;
    }

    if (action === "updatePost") {
      const post = await updatePost(session, token, body);
      sendJson(res, 200, { post });
      return;
    }

    if (action === "deletePost") {
      const deleted = await deletePost(session, token, body);
      sendJson(res, 200, { deleted });
      return;
    }

    sendJson(res, 400, { error: "Unsupported action" });
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : "Unexpected error" });
  }
};
