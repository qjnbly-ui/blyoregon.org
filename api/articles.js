const DEFAULT_SUPABASE_URL = "https://mgxdiolwevcgwgzhzttd.supabase.co";

function getSupabaseUrl() {
  return String(process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/+$/, "");
}

function getServiceRoleKey() {
  return String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
}

function getAnonKey() {
  return String(process.env.SUPABASE_ANON_KEY || "").trim();
}

function getPublicApiKey() {
  return getServiceRoleKey() || getAnonKey();
}

function getHeaderValue(req, name) {
  const value = req.headers?.[name];
  return Array.isArray(value) ? value[0] : value;
}

function buildHeaders(token) {
  const apiKey = token ? (getAnonKey() || getPublicApiKey()) : getPublicApiKey();
  const headers = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers.apikey = apiKey;
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  } else if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

function articleImageUrl(path) {
  const cleaned = String(path || "").trim();
  if (!cleaned) return "";
  return `/media/article-images/${cleaned.split("/").map((part) => encodeURIComponent(part)).join("/")}`;
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function randomSlugSuffix() {
  return Math.random().toString(36).slice(2, 8);
}

function normalizeSlug(value, fallbackPrefix = "article") {
  const slug = slugify(value);
  return slug || `${fallbackPrefix}-${randomSlugSuffix()}`;
}

function summarizeText(value, maxLength = 220) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trim()}…`;
}

function normalizeImageInput(images) {
  if (!Array.isArray(images)) return [];
  const seen = new Set();
  return images
    .map((image, index) => {
      const storagePath = String(image?.storagePath || "").trim().replace(/^\/+/, "");
      if (!storagePath || seen.has(storagePath)) return null;
      seen.add(storagePath);
      return {
        storagePath,
        caption: String(image?.caption || "").trim().slice(0, 500),
        altText: String(image?.altText || "").trim().slice(0, 255),
        sortOrder: Number.isFinite(Number(image?.sortOrder)) ? Number(image.sortOrder) : index,
      };
    })
    .filter(Boolean);
}

async function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) reject(new Error("Request body too large"));
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

async function fetchProfile(session, token) {
  const query = new URLSearchParams({
    select: "id,email,display_name,role,can_submit_articles,can_review_articles,can_publish_articles",
    id: `eq.${session.id}`,
  });
  const response = await fetch(`${getSupabaseUrl()}/rest/v1/profiles?${query.toString()}`, {
    headers: buildHeaders(token),
  });
  if (!response.ok) throw new Error("Unable to load account profile");
  const rows = await response.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

function getArticlePermissions(profile) {
  const role = String(profile?.role || "").toLowerCase();
  const admin = role === "admin";
  return {
    admin,
    canSubmitArticles: Boolean(admin || profile?.can_submit_articles),
    canReviewArticles: Boolean(admin || profile?.can_review_articles || profile?.can_publish_articles),
    canPublishArticles: Boolean(admin || profile?.can_publish_articles),
  };
}

async function fetchArticles(params, token) {
  const query = new URLSearchParams(params);
  const response = await fetch(`${getSupabaseUrl()}/rest/v1/articles?${query.toString()}`, {
    headers: buildHeaders(token),
  });
  if (!response.ok) throw new Error("Unable to load articles");
  const rows = await response.json();
  return Array.isArray(rows) ? rows : [];
}

async function fetchArticleById(articleId, token) {
  const rows = await fetchArticles({
    select: "id,author_id,author_name,slug,title,summary,body_markdown,cover_image_path,status,submitted_at,reviewed_at,reviewed_by,review_notes,published_at,created_at,updated_at",
    id: `eq.${articleId}`,
    limit: "1",
  }, token);
  return rows[0] || null;
}

async function fetchArticleBySlug(slug, token) {
  const rows = await fetchArticles({
    select: "id,author_id,author_name,slug,title,summary,body_markdown,cover_image_path,status,submitted_at,reviewed_at,reviewed_by,review_notes,published_at,created_at,updated_at",
    slug: `eq.${slug}`,
    limit: "1",
  }, token);
  return rows[0] || null;
}

async function fetchArticleImages(articleIds, token) {
  if (!articleIds.length) return new Map();
  const query = new URLSearchParams({
    select: "id,article_id,storage_path,caption,alt_text,sort_order,created_at",
    article_id: `in.(${articleIds.join(",")})`,
    order: "sort_order.asc,created_at.asc",
  });
  const response = await fetch(`${getSupabaseUrl()}/rest/v1/article_images?${query.toString()}`, {
    headers: buildHeaders(token),
  });
  if (!response.ok) throw new Error("Unable to load article images");
  const rows = await response.json();
  const imageMap = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const key = String(row.article_id || "").trim();
    if (!key) return;
    const list = imageMap.get(key) || [];
    list.push({
      id: row.id,
      storagePath: row.storage_path || "",
      imageUrl: articleImageUrl(row.storage_path),
      caption: row.caption || "",
      altText: row.alt_text || "",
      sortOrder: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : 0,
      createdAt: row.created_at || null,
    });
    imageMap.set(key, list);
  });
  return imageMap;
}

function serializeArticle(article, imageMap) {
  const images = imageMap.get(article.id) || [];
  const coverImagePath = String(article.cover_image_path || images[0]?.storagePath || "").trim();
  return {
    id: article.id,
    slug: article.slug || "",
    title: article.title || "",
    summary: article.summary || "",
    bodyMarkdown: article.body_markdown || "",
    status: article.status || "draft",
    authorId: article.author_id || "",
    authorName: article.author_name || "",
    coverImagePath,
    coverImageUrl: articleImageUrl(coverImagePath),
    submittedAt: article.submitted_at || null,
    reviewedAt: article.reviewed_at || null,
    reviewNotes: article.review_notes || "",
    publishedAt: article.published_at || null,
    createdAt: article.created_at || null,
    updatedAt: article.updated_at || null,
    images,
  };
}

async function ensureUniqueSlug(candidate, articleId, token) {
  let slug = normalizeSlug(candidate);
  while (true) {
    const rows = await fetchArticles({
      select: "id",
      slug: `eq.${slug}`,
      limit: "1",
    }, token);
    const existing = rows[0] || null;
    if (!existing || existing.id === articleId) return slug;
    slug = `${normalizeSlug(candidate)}-${randomSlugSuffix()}`;
  }
}

async function createDraft(profile, token) {
  const baseSlug = `draft-${Date.now()}`;
  const slug = await ensureUniqueSlug(baseSlug, "", token);
  const response = await fetch(`${getSupabaseUrl()}/rest/v1/articles`, {
    method: "POST",
    headers: {
      ...buildHeaders(token),
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      author_id: profile.id,
      author_name: profile.display_name || profile.email || "Member",
      slug,
      title: "Untitled article",
      summary: "",
      body_markdown: "",
      status: "draft",
    }),
  });
  if (!response.ok) throw new Error("Unable to create article draft");
  const rows = await response.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function replaceArticleImages(articleId, images, token, userId) {
  const deleteQuery = new URLSearchParams({
    article_id: `eq.${articleId}`,
  });
  const deleteResponse = await fetch(`${getSupabaseUrl()}/rest/v1/article_images?${deleteQuery.toString()}`, {
    method: "DELETE",
    headers: buildHeaders(token),
  });
  if (!deleteResponse.ok) throw new Error("Unable to update article images");

  if (!images.length) return [];

  const insertResponse = await fetch(`${getSupabaseUrl()}/rest/v1/article_images`, {
    method: "POST",
    headers: {
      ...buildHeaders(token),
      Prefer: "return=representation",
    },
    body: JSON.stringify(
      images.map((image, index) => ({
        article_id: articleId,
        storage_path: image.storagePath,
        caption: image.caption,
        alt_text: image.altText,
        sort_order: Number.isFinite(Number(image.sortOrder)) ? Number(image.sortOrder) : index,
        created_by: userId,
      }))
    ),
  });
  if (!insertResponse.ok) throw new Error("Unable to save article images");
  const rows = await insertResponse.json();
  return Array.isArray(rows) ? rows : [];
}

async function updateArticle(articleId, payload, token) {
  const response = await fetch(`${getSupabaseUrl()}/rest/v1/articles?id=eq.${articleId}`, {
    method: "PATCH",
    headers: {
      ...buildHeaders(token),
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("Unable to update article");
  const rows = await response.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function deleteArticle(articleId, token) {
  const response = await fetch(`${getSupabaseUrl()}/rest/v1/articles?id=eq.${articleId}`, {
    method: "DELETE",
    headers: buildHeaders(token),
  });
  if (!response.ok) throw new Error("Unable to delete article");
}

module.exports = async (req, res) => {
  const requestUrl = new URL(req.url, `https://${getHeaderValue(req, "host") || "blyoregon.org"}`);
  const articleId = String(requestUrl.searchParams.get("id") || "").trim();
  const slug = String(requestUrl.searchParams.get("slug") || "").trim();
  const scope = String(requestUrl.searchParams.get("scope") || "public").trim().toLowerCase();

  try {
    if (req.method === "GET") {
      const { session, token } = await authenticateRequest(req);
      const profile = session && token ? await fetchProfile(session, token) : null;
      const perms = getArticlePermissions(profile);

      if (slug) {
        const article = await fetchArticleBySlug(slug, token || null);
        if (!article) {
          sendJson(res, 404, { error: "Article not found" });
          return;
        }
        const isOwner = Boolean(session && article.author_id === session.id);
        const canView = article.status === "published" || isOwner || perms.canReviewArticles || perms.canPublishArticles || perms.admin;
        if (!canView) {
          sendJson(res, 404, { error: "Article not found" });
          return;
        }
        const imageMap = await fetchArticleImages([article.id], token || null);
        sendJson(res, 200, { article: serializeArticle(article, imageMap) });
        return;
      }

      if (articleId) {
        if (!session || !token) {
          sendJson(res, 401, { error: "Unauthorized" });
          return;
        }
        const article = await fetchArticleById(articleId, token);
        if (!article) {
          sendJson(res, 404, { error: "Article not found" });
          return;
        }
        const isOwner = article.author_id === session.id;
        if (!(isOwner || perms.canReviewArticles || perms.canPublishArticles || perms.admin)) {
          sendJson(res, 403, { error: "Forbidden" });
          return;
        }
        const imageMap = await fetchArticleImages([article.id], token);
        sendJson(res, 200, { article: serializeArticle(article, imageMap), permissions: perms });
        return;
      }

      if (scope === "mine") {
        if (!session || !token) {
          sendJson(res, 401, { error: "Unauthorized" });
          return;
        }
        const rows = await fetchArticles({
          select: "id,author_id,author_name,slug,title,summary,body_markdown,cover_image_path,status,submitted_at,reviewed_at,review_notes,published_at,created_at,updated_at",
          author_id: `eq.${session.id}`,
          order: "updated_at.desc",
        }, token);
        const imageMap = await fetchArticleImages(rows.map((row) => row.id), token);
        sendJson(res, 200, { articles: rows.map((row) => serializeArticle(row, imageMap)), permissions: perms });
        return;
      }

      if (scope === "review") {
        if (!session || !token) {
          sendJson(res, 401, { error: "Unauthorized" });
          return;
        }
        if (!(perms.canReviewArticles || perms.canPublishArticles || perms.admin)) {
          sendJson(res, 403, { error: "Forbidden" });
          return;
        }
        const rows = await fetchArticles({
          select: "id,author_id,author_name,slug,title,summary,body_markdown,cover_image_path,status,submitted_at,reviewed_at,review_notes,published_at,created_at,updated_at",
          order: "submitted_at.desc.nullslast,updated_at.desc",
        }, token);
        const filtered = rows.filter((row) => row.status !== "draft");
        const imageMap = await fetchArticleImages(filtered.map((row) => row.id), token);
        sendJson(res, 200, { articles: filtered.map((row) => serializeArticle(row, imageMap)), permissions: perms });
        return;
      }

      const rows = await fetchArticles({
        select: "id,author_id,author_name,slug,title,summary,body_markdown,cover_image_path,status,published_at,created_at,updated_at",
        status: "eq.published",
        order: "published_at.desc.nullslast,updated_at.desc",
      }, null);
      const imageMap = await fetchArticleImages(rows.map((row) => row.id), null);
      sendJson(res, 200, {
        articles: rows.map((row) => {
          const article = serializeArticle(row, imageMap);
          return {
            ...article,
            bodyMarkdown: "",
            preview: article.summary || summarizeText(row.body_markdown || ""),
          };
        }),
      });
      return;
    }

    const { session, token } = await authenticateRequest(req);
    if (!session || !token) {
      sendJson(res, 401, { error: "Unauthorized" });
      return;
    }

    const profile = await fetchProfile(session, token);
    const perms = getArticlePermissions(profile);

    if (req.method === "POST") {
      if (!perms.canSubmitArticles) {
        sendJson(res, 403, { error: "Forbidden" });
        return;
      }
      const article = await createDraft(profile, token);
      const imageMap = await fetchArticleImages(article?.id ? [article.id] : [], token);
      sendJson(res, 200, { article: article ? serializeArticle(article, imageMap) : null, permissions: perms });
      return;
    }

    if (req.method === "PATCH") {
      const body = await parseJsonBody(req);
      const targetArticleId = String(body?.id || articleId || "").trim();
      if (!targetArticleId) {
        sendJson(res, 400, { error: "Missing article id" });
        return;
      }

      const existing = await fetchArticleById(targetArticleId, token);
      if (!existing) {
        sendJson(res, 404, { error: "Article not found" });
        return;
      }

      const isOwner = existing.author_id === session.id;
      const action = String(body?.action || "save").trim().toLowerCase();

      const status = String(existing.status || "");
      const canAuthorEdit = isOwner && perms.canSubmitArticles && ["draft", "changes_requested"].includes(status);
      const canAuthorManage = isOwner && perms.canSubmitArticles;
      const canReview = perms.canReviewArticles || perms.canPublishArticles || perms.admin;
      const canPublish = perms.canPublishArticles || perms.admin;

      if (!canAuthorManage && !canReview) {
        sendJson(res, 403, { error: "Forbidden" });
        return;
      }

      const nextTitle = String(body?.title || "").trim().slice(0, 160) || "Untitled article";
      const nextSummary = String(body?.summary || "").trim().slice(0, 500);
      const nextBody = String(body?.bodyMarkdown || "").trim().slice(0, 40000);
      const requestedSlug = String(body?.slug || nextTitle || existing.slug).trim();
      const nextSlug = await ensureUniqueSlug(requestedSlug, existing.id, token);
      const coverImagePath = String(body?.coverImagePath || "").trim().replace(/^\/+/, "");
      const reviewNotes = String(body?.reviewNotes || "").trim().slice(0, 3000);
      const images = normalizeImageInput(body?.images);

      const payload = {
        title: nextTitle,
        summary: nextSummary,
        body_markdown: nextBody,
        slug: nextSlug,
        cover_image_path: coverImagePath || null,
        updated_at: new Date().toISOString(),
      };

      if (action === "submit") {
        if (!canAuthorEdit) {
          sendJson(res, 403, { error: "Only the author can submit this article right now." });
          return;
        }
        payload.status = "submitted";
        payload.submitted_at = new Date().toISOString();
      } else if (action === "request_changes") {
        if (!canReview) {
          sendJson(res, 403, { error: "Forbidden" });
          return;
        }
        payload.status = "changes_requested";
        payload.reviewed_at = new Date().toISOString();
        payload.reviewed_by = session.id;
        payload.review_notes = reviewNotes;
      } else if (action === "publish") {
        if (!canPublish) {
          sendJson(res, 403, { error: "Forbidden" });
          return;
        }
        payload.status = "published";
        payload.published_at = new Date().toISOString();
        payload.reviewed_at = new Date().toISOString();
        payload.reviewed_by = session.id;
        payload.review_notes = reviewNotes;
      } else if (action === "archive") {
        if (!canPublish) {
          sendJson(res, 403, { error: "Forbidden" });
          return;
        }
        payload.status = "archived";
      } else if (action === "unpublish") {
        if (!(canAuthorManage || canPublish)) {
          sendJson(res, 403, { error: "Forbidden" });
          return;
        }
        payload.status = "draft";
        payload.published_at = null;
      } else if (action !== "save") {
        sendJson(res, 400, { error: "Invalid action" });
        return;
      }

      const updated = await updateArticle(existing.id, payload, token);
      await replaceArticleImages(existing.id, images, token, session.id);
      const imageMap = await fetchArticleImages([existing.id], token);
      sendJson(res, 200, {
        ok: true,
        article: updated ? serializeArticle(updated, imageMap) : null,
        permissions: perms,
      });
      return;
    }

    if (req.method === "DELETE") {
      const targetArticleId = String(articleId || "").trim();
      if (!targetArticleId) {
        sendJson(res, 400, { error: "Missing article id" });
        return;
      }

      const existing = await fetchArticleById(targetArticleId, token);
      if (!existing) {
        sendJson(res, 404, { error: "Article not found" });
        return;
      }

      const isOwner = existing.author_id === session.id;
      const canAuthorManage = isOwner && perms.canSubmitArticles;
      const canModerate = perms.canReviewArticles || perms.canPublishArticles || perms.admin;
      if (!(canAuthorManage || canModerate)) {
        sendJson(res, 403, { error: "Forbidden" });
        return;
      }

      await deleteArticle(existing.id, token);
      sendJson(res, 200, { ok: true });
      return;
    }

    sendJson(res, 405, { error: "Method not allowed" });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Server error" });
  }
};
