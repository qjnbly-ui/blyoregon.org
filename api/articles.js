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

function getEnv(name, fallback = "") {
  return String(process.env[name] || fallback).trim();
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

function buildServiceHeaders() {
  const serviceKey = getServiceRoleKey();
  if (!serviceKey) return null;
  return {
    "Content-Type": "application/json",
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
  };
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

function getSiteUrl(req) {
  const explicit = getEnv("PUBLIC_SITE_URL");
  if (explicit) return explicit.replace(/\/+$/, "");

  const host = req.headers?.host || "blyoregon.org";
  const protocol = host.includes("localhost") || host.startsWith("127.0.0.1") ? "http" : "https";
  return `${protocol}://${host}`.replace(/\/+$/, "");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function articlePublicUrl(siteUrl, article) {
  const slug = String(article?.slug || "").trim();
  if (!siteUrl || !slug) return "";
  return `${siteUrl}/history/articles/post/?slug=${encodeURIComponent(slug)}`;
}

function articleEditUrl(siteUrl, article) {
  const id = String(article?.id || "").trim();
  if (!siteUrl || !id) return "";
  return `${siteUrl}/account/articles/edit/?id=${encodeURIComponent(id)}`;
}

function reviewQueueUrl(siteUrl) {
  return siteUrl ? `${siteUrl}/account/articles/review/` : "";
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

async function fetchProfileById(userId) {
  const headers = buildServiceHeaders();
  if (!headers || !userId) return null;

  const query = new URLSearchParams({
    select: "id,email,display_name,role,can_submit_articles,can_review_articles,can_publish_articles",
    id: `eq.${userId}`,
    limit: "1",
  });
  const response = await fetch(`${getSupabaseUrl()}/rest/v1/profiles?${query.toString()}`, {
    headers,
  });
  if (!response.ok) return null;
  const rows = await response.json().catch(() => []);
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

async function fetchArticleModerators() {
  const headers = buildServiceHeaders();
  if (!headers) return [];

  const query = new URLSearchParams({
    select: "id,email,display_name,role,can_review_articles,can_publish_articles",
    or: "(role.eq.admin,can_review_articles.eq.true,can_publish_articles.eq.true)",
  });
  const response = await fetch(`${getSupabaseUrl()}/rest/v1/profiles?${query.toString()}`, {
    headers,
  });
  if (!response.ok) return [];
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

function getModeratorEmails(rows) {
  const envEmails = getEnv("ADMIN_EMAILS")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const rowEmails = (Array.isArray(rows) ? rows : [])
    .map((row) => String(row?.email || "").trim())
    .filter(Boolean);
  return Array.from(new Set([...envEmails, ...rowEmails]));
}

async function sendEmail(payload) {
  const resendKey = getEnv("RESEND_API_KEY");
  if (!resendKey) return false;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result?.message || result?.error || "Unable to send email");
  }
  return true;
}

function renderEmailShell({ eyebrow, title, intro, bodyHtml, actionLabel, actionUrl }) {
  const actionBlock = actionLabel && actionUrl
    ? `<p style="margin:24px 0 0"><a href="${escapeHtml(actionUrl)}" style="display:inline-block;background:#143227;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:999px">${escapeHtml(actionLabel)}</a></p>`
    : "";

  return (
    `<div style="margin:0;padding:24px;background:#f7f2ea;font-family:Georgia,'Times New Roman',serif;color:#1e1f1c">` +
      `<div style="max-width:640px;margin:0 auto;background:#fffdf9;border:1px solid rgba(31,64,48,0.12);border-radius:24px;overflow:hidden">` +
        `<div style="padding:28px 28px 22px;background:linear-gradient(140deg, rgba(20,50,39,0.96), rgba(33,68,55,0.88));color:#ffffff">` +
          `<div style="text-transform:uppercase;letter-spacing:0.18em;font-size:12px;font-weight:700;color:rgba(255,255,255,0.72)">${escapeHtml(eyebrow)}</div>` +
          `<h1 style="margin:10px 0 0;font-size:32px;line-height:1.08;font-weight:700">Bly, Oregon</h1>` +
          `<p style="margin:10px 0 0;font-family:Arial,sans-serif;font-size:16px;line-height:1.6;color:rgba(255,255,255,0.86)">${escapeHtml(intro)}</p>` +
        `</div>` +
        `<div style="padding:28px">` +
          `<h2 style="margin:0 0 14px;font-size:28px;line-height:1.2;color:#143227">${escapeHtml(title)}</h2>` +
          `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.7;color:#33443b">${bodyHtml}</div>` +
          `${actionBlock}` +
        `</div>` +
      `</div>` +
    `</div>`
  );
}

async function sendArticleNotifications({ req, article, actorProfile, action, reviewNotes = "" }) {
  const resendKey = getEnv("RESEND_API_KEY");
  if (!resendKey || !article) return;

  const siteUrl = getSiteUrl(req);
  const actorName = String(actorProfile?.display_name || actorProfile?.email || "A Bly member").trim();
  const authorProfile = actorProfile?.id === article.authorId
    ? actorProfile
    : await fetchProfileById(article.authorId);
  const authorEmail = String(authorProfile?.email || "").trim();
  const moderators = await fetchArticleModerators();
  const adminEmails = getModeratorEmails(moderators).filter((email) => email && email !== authorEmail);
  const safeTitle = escapeHtml(article.title || "Untitled article");
  const publicUrl = articlePublicUrl(siteUrl, article);
  const editUrl = articleEditUrl(siteUrl, article);
  const reviewUrl = reviewQueueUrl(siteUrl);
  const safeNotes = escapeHtml(reviewNotes).replace(/\n/g, "<br>");
  const publishedDate = formatDate(article.publishedAt);

  const authorPayloads = [];
  const adminPayloads = [];

  if (action === "submit") {
    if (authorEmail) {
      authorPayloads.push({
        to: [authorEmail],
        subject: `[Bly, Oregon] Article submitted: ${article.title || "Untitled article"}`,
        html: renderEmailShell({
          eyebrow: "Article submission",
          title: "Your article is in review",
          intro: "A dynamic article was submitted from your account.",
          bodyHtml:
            `<p><strong>${safeTitle}</strong> was submitted for approval.</p>` +
            `<p>You can keep track of it from your account while an admin reviews it.</p>`,
          actionLabel: "Open article",
          actionUrl: editUrl,
        }),
        text:
          `Your article "${article.title || "Untitled article"}" was submitted for approval.\n\nOpen article: ${editUrl}`,
      });
    }

    if (adminEmails.length) {
      adminPayloads.push({
        to: adminEmails,
        reply_to: authorEmail || undefined,
        subject: `[Bly, Oregon] Article awaiting review: ${article.title || "Untitled article"}`,
        html: renderEmailShell({
          eyebrow: "Review queue",
          title: "A member submitted an article",
          intro: `${escapeHtml(actorName)} submitted an article for review.`,
          bodyHtml:
            `<p><strong>${safeTitle}</strong> is waiting in the review queue.</p>` +
            `<p>Author: ${escapeHtml(article.authorName || actorName)}</p>`,
          actionLabel: "Open review queue",
          actionUrl: reviewUrl,
        }),
        text:
          `${actorName} submitted "${article.title || "Untitled article"}" for review.\n\nReview queue: ${reviewUrl}`,
      });
    }
  }

  if (action === "request_changes" && authorEmail) {
    authorPayloads.push({
      to: [authorEmail],
      subject: `[Bly, Oregon] Changes requested: ${article.title || "Untitled article"}`,
      html: renderEmailShell({
        eyebrow: "Article review",
        title: "Changes were requested",
        intro: `${escapeHtml(actorName)} reviewed your article.`,
        bodyHtml:
          `<p><strong>${safeTitle}</strong> was sent back for revision.</p>` +
          `${safeNotes ? `<p><strong>Review notes:</strong><br>${safeNotes}</p>` : ""}`,
        actionLabel: "Edit article",
        actionUrl: editUrl,
      }),
      text:
        `Changes were requested for "${article.title || "Untitled article"}".` +
        `${reviewNotes ? `\n\nReview notes:\n${reviewNotes}` : ""}` +
        `\n\nEdit article: ${editUrl}`,
    });
  }

  if (action === "publish") {
    if (authorEmail) {
      authorPayloads.push({
        to: [authorEmail],
        subject: `[Bly, Oregon] Article published: ${article.title || "Untitled article"}`,
        html: renderEmailShell({
          eyebrow: "Article published",
          title: "Your article is live",
          intro: `${escapeHtml(actorName)} published your article.`,
          bodyHtml:
            `<p><strong>${safeTitle}</strong> is now live on the site${publishedDate ? ` as of ${escapeHtml(publishedDate)}` : ""}.</p>`,
          actionLabel: "View public article",
          actionUrl: publicUrl || editUrl,
        }),
        text:
          `"${article.title || "Untitled article"}" is now live.\n\nPublic article: ${publicUrl || editUrl}`,
      });
    }

    if (adminEmails.length) {
      adminPayloads.push({
        to: adminEmails,
        subject: `[Bly, Oregon] Article published: ${article.title || "Untitled article"}`,
        html: renderEmailShell({
          eyebrow: "Publishing update",
          title: "An article was published",
          intro: `${escapeHtml(actorName)} published an article.`,
          bodyHtml:
            `<p><strong>${safeTitle}</strong> is now public.</p>` +
            `<p>Author: ${escapeHtml(article.authorName || "")}</p>`,
          actionLabel: publicUrl ? "View article" : "Open review queue",
          actionUrl: publicUrl || reviewUrl,
        }),
        text:
          `${actorName} published "${article.title || "Untitled article"}".\n\n${publicUrl || reviewUrl}`,
      });
    }
  }

  if (action === "unpublish") {
    if (authorEmail) {
      authorPayloads.push({
        to: [authorEmail],
        subject: `[Bly, Oregon] Article unpublished: ${article.title || "Untitled article"}`,
        html: renderEmailShell({
          eyebrow: "Article update",
          title: "Your article was moved back to draft",
          intro: "The public version is no longer visible on the site.",
          bodyHtml:
            `<p><strong>${safeTitle}</strong> is now back in draft status.</p>`,
          actionLabel: "Open article",
          actionUrl: editUrl,
        }),
        text:
          `"${article.title || "Untitled article"}" was moved back to draft.\n\nEdit article: ${editUrl}`,
      });
    }

    if (adminEmails.length) {
      adminPayloads.push({
        to: adminEmails,
        subject: `[Bly, Oregon] Article unpublished: ${article.title || "Untitled article"}`,
        html: renderEmailShell({
          eyebrow: "Publishing update",
          title: "An article was unpublished",
          intro: `${escapeHtml(actorName)} moved an article back to draft.`,
          bodyHtml:
            `<p><strong>${safeTitle}</strong> is no longer public.</p>`,
          actionLabel: "Open article",
          actionUrl: editUrl,
        }),
        text:
          `${actorName} unpublished "${article.title || "Untitled article"}".\n\nEdit article: ${editUrl}`,
      });
    }
  }

  if (action === "delete") {
    if (authorEmail) {
      authorPayloads.push({
        to: [authorEmail],
        subject: `[Bly, Oregon] Article deleted: ${article.title || "Untitled article"}`,
        html: renderEmailShell({
          eyebrow: "Article deleted",
          title: "Your article was deleted",
          intro: `${escapeHtml(actorName)} deleted the article record.`,
          bodyHtml:
            `<p><strong>${safeTitle}</strong> and its uploaded article images were removed from the dynamic article system.</p>`,
        }),
        text:
          `"${article.title || "Untitled article"}" was deleted from the dynamic article system.`,
      });
    }

    if (adminEmails.length) {
      adminPayloads.push({
        to: adminEmails,
        subject: `[Bly, Oregon] Article deleted: ${article.title || "Untitled article"}`,
        html: renderEmailShell({
          eyebrow: "Article deleted",
          title: "An article was deleted",
          intro: `${escapeHtml(actorName)} deleted an article.`,
          bodyHtml:
            `<p><strong>${safeTitle}</strong> was removed from the dynamic article workflow.</p>`,
        }),
        text:
          `${actorName} deleted "${article.title || "Untitled article"}".`,
      });
    }
  }

  const from = getEnv("RESEND_FROM_EMAIL", "noreply@blyoregon.org");
  const jobs = [...authorPayloads, ...adminPayloads].map((payload) =>
    sendEmail({
      from: `Bly, Oregon <${from}>`,
      ...payload,
    })
  );
  await Promise.all(jobs);
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
  const headers = buildServiceHeaders() || {
    ...buildHeaders(token),
    Prefer: "return=representation",
  };
  headers.Prefer = "return=representation";
  const response = await fetch(`${getSupabaseUrl()}/rest/v1/articles`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      author_id: profile.id,
      author_name: profile.display_name || profile.email || "Member",
      slug,
      title: "",
      summary: "",
      body_markdown: "",
      status: "draft",
    }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || payload.error || "Unable to create article draft");
  }
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
  const headers = buildServiceHeaders() || buildHeaders(token);
  const response = await fetch(`${getSupabaseUrl()}/rest/v1/articles?id=eq.${articleId}`, {
    method: "DELETE",
    headers,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || payload.error || "Unable to delete article");
  }
}

async function deleteArticleImagesFromStorage(paths) {
  const uniquePaths = Array.from(
    new Set(
      (Array.isArray(paths) ? paths : [])
        .map((path) => String(path || "").trim().replace(/^\/+/, ""))
        .filter(Boolean)
    )
  );
  if (!uniquePaths.length) return;

  const apiKey = getServiceRoleKey() || getPublicApiKey();
  if (!apiKey) return;

  const response = await fetch(`${getSupabaseUrl()}/storage/v1/object/article-images`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      prefixes: uniquePaths,
    }),
  });

  if (!response.ok) {
    throw new Error("Unable to remove article images from storage");
  }
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
      const serializedArticle = updated ? serializeArticle(updated, imageMap) : null;
      if (serializedArticle && ["submit", "request_changes", "publish", "unpublish"].includes(action)) {
        try {
          await sendArticleNotifications({
            req,
            article: serializedArticle,
            actorProfile: profile,
            action,
            reviewNotes,
          });
        } catch (error) {
          console.error(`Article email failed for ${existing.id} (${action}):`, error);
        }
      }
      sendJson(res, 200, {
        ok: true,
        article: serializedArticle,
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

      const imageMap = await fetchArticleImages([existing.id], token);
      const imagePaths = (imageMap.get(existing.id) || []).map((image) => image.storagePath);
      try {
        await deleteArticleImagesFromStorage(imagePaths);
      } catch (error) {
        console.error(`Article image cleanup failed for ${existing.id}:`, error);
      }

      const deletedArticle = serializeArticle(existing, imageMap);
      await deleteArticle(existing.id, token);
      try {
        await sendArticleNotifications({
          req,
          article: deletedArticle,
          actorProfile: profile,
          action: "delete",
        });
      } catch (error) {
        console.error(`Article email failed for ${existing.id} (delete):`, error);
      }
      sendJson(res, 200, { ok: true });
      return;
    }

    sendJson(res, 405, { error: "Method not allowed" });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Server error" });
  }
};
