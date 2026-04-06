const DEFAULT_SUPABASE_URL = "https://mgxdiolwevcgwgzhzttd.supabase.co";

const CATEGORY_ORDER = [
  "Community & Government",
  "Food & Drink",
  "Shopping",
  "Services & Trades",
  "Health & Wellness",
  "Lodging",
  "Education",
  "Faith & Churches",
  "Utilities",
  "Recreation & Community Space",
  "Other",
];

function getSupabaseUrl() {
  return String(process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/+$/, "");
}

function getAnonKey() {
  return String(process.env.SUPABASE_ANON_KEY || "").trim();
}

function getServiceRoleKey() {
  return String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
}

function getServiceHeaders() {
  const serviceKey = getServiceRoleKey();
  if (!serviceKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return {
    "Content-Type": "application/json",
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
  };
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

function summarizeText(value, maxLength = 180) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1).trim()}…`;
}

async function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 500_000) reject(new Error("Request body too large"));
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
  if (!anonKey) throw new Error("Missing SUPABASE_ANON_KEY");

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

async function fetchProfile(userId) {
  if (!userId) return null;
  const query = new URLSearchParams({
    select: "id,email,display_name,role,can_review_articles,can_publish_articles,notify_admin_article_queue_internal,notify_admin_article_queue_email,notify_business_updates_internal,notify_business_updates_email,notify_admin_business_queue_internal,notify_admin_business_queue_email",
    id: `eq.${userId}`,
    limit: "1",
  });
  const response = await fetch(`${getSupabaseUrl()}/rest/v1/profiles?${query.toString()}`, {
    headers: getServiceHeaders(),
  });
  if (!response.ok) throw new Error("Unable to load account profile");
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function fetchProfileByEmail(email) {
  const normalized = normalizeText(email, 200).toLowerCase();
  if (!normalized) return null;
  const query = new URLSearchParams({
    select: "id,email,display_name,role,can_review_articles,can_publish_articles,notify_admin_article_queue_internal,notify_admin_article_queue_email,notify_business_updates_internal,notify_business_updates_email,notify_admin_business_queue_internal,notify_admin_business_queue_email",
    email: `eq.${normalized}`,
    limit: "1",
  });
  const response = await fetch(`${getSupabaseUrl()}/rest/v1/profiles?${query.toString()}`, {
    headers: getServiceHeaders(),
  });
  if (!response.ok) return null;
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

function getReviewPermissions(profile) {
  const role = String(profile?.role || "").toLowerCase();
  const admin = role === "admin";
  const moderator = role === "moderator";
  return {
    admin,
    canReviewBusinesses: Boolean(admin || moderator || profile?.can_review_articles || profile?.can_publish_articles),
    canPublishBusinesses: Boolean(admin || moderator || profile?.can_publish_articles),
  };
}

function normalizeText(value, maxLength = 500) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizeBusinessCategory(value) {
  const raw = normalizeText(value, 80);
  if (!raw) return "Other";
  const match = CATEGORY_ORDER.find((entry) => entry.toLowerCase() === raw.toLowerCase());
  return match || raw;
}

function sanitizeFilename(value) {
  return String(value || "image")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function businessImagePublicUrl(path) {
  const cleanPath = String(path || "").trim().replace(/^\/+/, "");
  if (!cleanPath) return "";
  return `${getSupabaseUrl()}/storage/v1/object/public/business-images/${cleanPath.split("/").map((part) => encodeURIComponent(part)).join("/")}`;
}

function extractBusinessImagePath(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const directPath = raw.match(/^business-images\/(.+)$/i)?.[1];
  if (directPath) return directPath.replace(/^\/+/, "");
  const publicPath = raw.match(/\/storage\/v1\/object\/public\/business-images\/(.+)$/i)?.[1];
  if (publicPath) return decodeURIComponent(publicPath);
  return "";
}

function serializeBusiness(row) {
  return {
    id: row.id,
    authorId: row.author_id || null,
    claimedBy: row.claimed_by || null,
    claimedByEmail: row.claimed_by_email || "",
    claimedByName: row.claimed_by_name || "",
    submitterName: row.submitter_name || "",
    submitterEmail: row.submitter_email || "",
    businessName: row.business_name || "",
    businessCategory: row.business_category || "Other",
    description: row.description || "",
    contactName: row.contact_name || "",
    phone: row.phone || "",
    businessEmail: row.business_email || "",
    address: row.address || "",
    imagePath: row.image_path || "",
    imageUrl: row.image_url || "",
    websiteUrl: row.website_url || "",
    hours: row.hours || "",
    notes: row.notes || "",
    reviewNotes: row.review_notes || "",
    status: row.status || "submitted",
    sortOrder: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : 0,
    submittedAt: row.submitted_at || null,
    reviewedAt: row.reviewed_at || null,
    reviewedBy: row.reviewed_by || null,
    publishedAt: row.published_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

async function attachClaimProfileDetails(rows) {
  const ids = Array.from(new Set((Array.isArray(rows) ? rows : []).map((row) => String(row?.claimed_by || "").trim()).filter(Boolean)));
  if (!ids.length) return rows;

  const query = new URLSearchParams({
    select: "id,email,display_name",
    id: `in.(${ids.map((id) => `"${id}"`).join(",")})`,
  });
  const response = await fetch(`${getSupabaseUrl()}/rest/v1/profiles?${query.toString()}`, {
    headers: getServiceHeaders(),
  });
  if (!response.ok) return rows;
  const profiles = await response.json().catch(() => []);
  const map = new Map((Array.isArray(profiles) ? profiles : []).map((profile) => [String(profile.id), profile]));
  return rows.map((row) => {
    const profile = map.get(String(row.claimed_by || ""));
    return {
      ...row,
      claimed_by_email: profile?.email || "",
      claimed_by_name: profile?.display_name || "",
    };
  });
}

async function fetchBusinesses(params) {
  const query = new URLSearchParams(params);
  const response = await fetch(`${getSupabaseUrl()}/rest/v1/businesses?${query.toString()}`, {
    headers: getServiceHeaders(),
  });
  if (!response.ok) throw new Error("Unable to load businesses");
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function fetchBusinessById(id) {
  const rows = await fetchBusinesses({
    select: "id,author_id,claimed_by,submitter_name,submitter_email,business_name,business_category,description,contact_name,phone,business_email,address,image_path,image_url,website_url,hours,notes,submitted_at,reviewed_at,reviewed_by,review_notes,status,published_at,sort_order,created_at,updated_at",
    id: `eq.${id}`,
    limit: "1",
  });
  return rows[0] || null;
}

async function fetchBusinessClaimRequests(params) {
  const query = new URLSearchParams(params);
  const response = await fetch(`${getSupabaseUrl()}/rest/v1/business_claim_requests?${query.toString()}`, {
    headers: getServiceHeaders(),
  });
  if (!response.ok) throw new Error("Unable to load business claim requests");
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function fetchBusinessClaimRequestById(id) {
  const rows = await fetchBusinessClaimRequests({
    select: "id,business_id,requester_id,status,created_at,reviewed_at,reviewed_by",
    id: `eq.${id}`,
    limit: "1",
  });
  return rows[0] || null;
}

async function insertBusinessClaimRequest(payload) {
  const response = await fetch(`${getSupabaseUrl()}/rest/v1/business_claim_requests`, {
    method: "POST",
    headers: {
      ...getServiceHeaders(),
      Prefer: "return=representation,resolution=merge-duplicates",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result?.message || result?.error || "Unable to create claim request");
  }
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function updateBusinessClaimRequest(id, payload) {
  const query = new URLSearchParams({ id: `eq.${id}`, select: "*" });
  const response = await fetch(`${getSupabaseUrl()}/rest/v1/business_claim_requests?${query.toString()}`, {
    method: "PATCH",
    headers: {
      ...getServiceHeaders(),
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result?.message || result?.error || "Unable to update claim request");
  }
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function insertBusiness(payload) {
  const response = await fetch(`${getSupabaseUrl()}/rest/v1/businesses`, {
    method: "POST",
    headers: {
      ...getServiceHeaders(),
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result?.message || result?.error || "Unable to create business listing");
  }
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function updateBusiness(id, payload) {
  const query = new URLSearchParams({ id: `eq.${id}`, select: "*" });
  const response = await fetch(`${getSupabaseUrl()}/rest/v1/businesses?${query.toString()}`, {
    method: "PATCH",
    headers: {
      ...getServiceHeaders(),
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result?.message || result?.error || "Unable to update business listing");
  }
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function deleteBusinessImagesFromStorage(paths) {
  const uniquePaths = Array.from(new Set((Array.isArray(paths) ? paths : []).map((path) => String(path || "").trim().replace(/^\/+/, "")).filter(Boolean)));
  if (!uniquePaths.length) return;
  const apiKey = getPublicApiKey();
  if (!apiKey) return;
  const response = await fetch(`${getSupabaseUrl()}/storage/v1/object/business-images`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ prefixes: uniquePaths }),
  });
  if (!response.ok) throw new Error("Unable to remove business images from storage");
}

async function createBusinessImageUploadToken(path) {
  const cleanPath = String(path || "").trim().replace(/^\/+/, "");
  const headers = getServiceHeaders();
  if (!cleanPath) throw new Error("Unable to prepare business image upload");
  const response = await fetch(`${getSupabaseUrl()}/storage/v1/object/upload/sign/business-images/${cleanPath}`, {
    method: "POST",
    headers,
    body: JSON.stringify({}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || payload.error || "Unable to prepare business image upload");
  }
  const signedUrl = String(payload.url || payload.signedURL || "").trim();
  const parsedToken = signedUrl ? new URL(signedUrl, getSupabaseUrl()).searchParams.get("token") : "";
  const token = String(payload.token || parsedToken || "").trim();
  if (!token) throw new Error("Missing upload token");
  return {
    path: cleanPath,
    token,
    publicUrl: businessImagePublicUrl(cleanPath),
    uploadUrl: signedUrl || `${getSupabaseUrl()}/storage/v1/object/upload/sign/business-images/${cleanPath}?token=${encodeURIComponent(token)}`,
  };
}

async function fetchBusinessModerators() {
  const query = new URLSearchParams({
    select: "id,email,display_name,notify_admin_article_queue_internal,notify_admin_article_queue_email,notify_admin_business_queue_internal,notify_admin_business_queue_email,role,can_review_articles,can_publish_articles",
    or: "(role.eq.admin,can_review_articles.eq.true,can_publish_articles.eq.true)",
  });
  const response = await fetch(`${getSupabaseUrl()}/rest/v1/profiles?${query.toString()}`, {
    headers: getServiceHeaders(),
  });
  if (!response.ok) return [];
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function attachRequesterDetails(rows) {
  const ids = Array.from(new Set((Array.isArray(rows) ? rows : []).map((row) => String(row?.requester_id || "").trim()).filter(Boolean)));
  if (!ids.length) return rows;
  const query = new URLSearchParams({
    select: "id,email,display_name",
    id: `in.(${ids.map((id) => `"${id}"`).join(",")})`,
  });
  const response = await fetch(`${getSupabaseUrl()}/rest/v1/profiles?${query.toString()}`, {
    headers: getServiceHeaders(),
  });
  if (!response.ok) return rows;
  const profiles = await response.json().catch(() => []);
  const map = new Map((Array.isArray(profiles) ? profiles : []).map((profile) => [String(profile.id), profile]));
  return rows.map((row) => {
    const profile = map.get(String(row.requester_id || ""));
    return {
      ...row,
      requester_email: profile?.email || "",
      requester_name: profile?.display_name || "",
    };
  });
}

async function insertNotifications(rows) {
  if (!Array.isArray(rows) || !rows.length) return;
  const response = await fetch(`${getSupabaseUrl()}/rest/v1/notifications`, {
    method: "POST",
    headers: {
      ...getServiceHeaders(),
      Prefer: "return=minimal",
    },
    body: JSON.stringify(rows),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result?.message || result?.error || "Unable to store notifications");
  }
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
    ? `<p style="margin:24px 0 0"><a href="${escapeHtml(actionUrl)}" style="display:inline-block;background:#143227;background-color:#143227;color:#ffffff;text-decoration:none;font-weight:700;font-family:Arial,sans-serif;padding:12px 18px;border-radius:999px;border:1px solid #143227">${escapeHtml(actionLabel)}</a></p>`
    : "";

  return (
    `<div style="margin:0;padding:24px;background:#f7f2ea;background-color:#f7f2ea;font-family:Arial,sans-serif;color:#1e1f1c">` +
      `<div style="max-width:640px;margin:0 auto;background:#fffdf9;background-color:#fffdf9;border:1px solid #d9ddd9;border-radius:24px;overflow:hidden">` +
        `<div style="padding:28px 28px 22px;background:#214437;background-color:#214437;color:#ffffff">` +
          `<div style="text-transform:uppercase;letter-spacing:0.18em;font-size:12px;font-weight:700;color:#dbe7df">${escapeHtml(eyebrow)}</div>` +
          `<h1 style="margin:10px 0 0;font-size:32px;line-height:1.08;font-weight:700;font-family:Georgia,'Times New Roman',serif;color:#ffffff">Bly, Oregon</h1>` +
          `<p style="margin:10px 0 0;font-family:Arial,sans-serif;font-size:16px;line-height:1.6;color:#eef6f1">${escapeHtml(intro)}</p>` +
        `</div>` +
        `<div style="padding:28px;background:#fffdf9;background-color:#fffdf9">` +
          `<h2 style="margin:0 0 14px;font-size:28px;line-height:1.2;font-family:Georgia,'Times New Roman',serif;color:#143227">${escapeHtml(title)}</h2>` +
          `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.7;color:#33443b">${bodyHtml}</div>` +
          `${actionBlock}` +
        `</div>` +
      `</div>` +
    `</div>`
  );
}

function getBusinessNotificationPreferences(profile) {
  return {
    businessUpdatesInternal: profile?.notify_business_updates_internal !== false,
    businessUpdatesEmail: profile?.notify_business_updates_email !== false,
    adminBusinessQueueInternal: profile?.notify_admin_business_queue_internal !== false,
    adminBusinessQueueEmail: profile?.notify_admin_business_queue_email !== false,
  };
}

async function fetchProfilesByIds(ids) {
  const normalizedIds = Array.from(new Set((Array.isArray(ids) ? ids : []).map((id) => String(id || "").trim()).filter(Boolean)));
  if (!normalizedIds.length) return new Map();
  const query = new URLSearchParams({
    select: "id,email,display_name,role,can_review_articles,can_publish_articles,notify_admin_article_queue_internal,notify_admin_article_queue_email,notify_business_updates_internal,notify_business_updates_email,notify_admin_business_queue_internal,notify_admin_business_queue_email",
    id: `in.(${normalizedIds.map((id) => `"${id}"`).join(",")})`,
  });
  const response = await fetch(`${getSupabaseUrl()}/rest/v1/profiles?${query.toString()}`, {
    headers: getServiceHeaders(),
  });
  if (!response.ok) throw new Error("Unable to load account profiles");
  const rows = await response.json().catch(() => []);
  return new Map((Array.isArray(rows) ? rows : []).map((row) => [String(row.id || ""), row]));
}

async function notifyModeratorsOfSubmission(business, actorId = null) {
  const moderators = await fetchBusinessModerators();
  const notifications = moderators
    .filter((row) => getBusinessNotificationPreferences(row).adminBusinessQueueInternal)
    .map((row) => ({
      user_id: row.id,
      actor_id: actorId || null,
      type: "business_review_needed",
      title: "Business listing waiting in review",
      body: `${business.business_name || "A business listing"} was submitted for review.`,
      link: "/account/businesses/review/",
      entity_type: "business",
      entity_id: business.id,
      metadata: {
        status: business.status || "submitted",
        category: business.business_category || "Other",
      },
    }));
  await insertNotifications(notifications);
}

async function notifyModeratorsOfClaimRequest(business, requesterId) {
  const moderators = await fetchBusinessModerators();
  const notifications = moderators
    .filter((row) => getBusinessNotificationPreferences(row).adminBusinessQueueInternal)
    .map((row) => ({
      user_id: row.id,
      actor_id: requesterId || null,
      type: "business_claim_requested",
      title: "Business claim request waiting in review",
      body: `${business.business_name || "A business listing"} has a new ownership request.`,
      link: "/account/businesses/review/",
      entity_type: "business",
      entity_id: business.id,
      metadata: {
        status: "pending",
        claimRequest: true,
      },
    }));
  await insertNotifications(notifications);
}

async function emailBusinessModerators({ req, business, actorProfile, subject, eyebrow, title, intro, bodyHtml }) {
  const moderators = await fetchBusinessModerators();
  const actorEmail = String(actorProfile?.email || "").trim();
  const recipientPayloads = moderators
    .filter((row) => getBusinessNotificationPreferences(row).adminBusinessQueueEmail)
    .map((row) => String(row?.email || "").trim())
    .filter((email) => email && email !== actorEmail)
    .map((email) => ({
      to: [email],
      from: getEnv("RESEND_FROM_EMAIL", "noreply@blyoregon.org"),
      reply_to: actorEmail || undefined,
      subject,
      html: renderEmailShell({
        eyebrow,
        title,
        intro,
        bodyHtml,
        actionLabel: "Open business review",
        actionUrl: `${getSiteUrl(req)}/account/businesses/review/`,
      }),
      text: `${title}\n\n${summarizeText(bodyHtml.replace(/<[^>]+>/g, " "), 280)}\n\nOpen review: ${getSiteUrl(req)}/account/businesses/review/`,
    }));

  for (const payload of recipientPayloads) {
    try {
      await sendEmail(payload);
    } catch (error) {
      console.warn(error);
    }
  }
}

async function notifyBusinessMembers({ req, business, actorProfile, type, title, body, emailSubject, emailTitle, emailIntro, emailBodyHtml, linkPath = "/account/businesses/" }) {
  const participantIds = Array.from(
    new Set([
      String(business?.author_id || "").trim(),
      String(business?.claimed_by || "").trim(),
    ].filter(Boolean))
  );
  if (!participantIds.length) return;

  const participantProfiles = await fetchProfilesByIds(participantIds);
  const storedNotifications = [];
  const siteUrl = getSiteUrl(req);
  const actionUrl = `${siteUrl}${linkPath}`;

  participantIds.forEach((userId) => {
    const profile = participantProfiles.get(userId);
    const prefs = getBusinessNotificationPreferences(profile);
    if (!prefs.businessUpdatesInternal) return;
    storedNotifications.push({
      user_id: userId,
      actor_id: actorProfile?.id || null,
      type,
      title,
      body,
      link: linkPath,
      entity_type: "business",
      entity_id: business.id || null,
      metadata: {
        businessId: business.id || null,
        status: business.status || "",
      },
    });
  });

  await insertNotifications(storedNotifications).catch((error) => {
    console.warn(error);
  });

  for (const userId of participantIds) {
    const profile = participantProfiles.get(userId);
    const prefs = getBusinessNotificationPreferences(profile);
    const email = String(profile?.email || "").trim();
    if (!prefs.businessUpdatesEmail || !email) continue;
    try {
      await sendEmail({
        to: [email],
        from: getEnv("RESEND_FROM_EMAIL", "noreply@blyoregon.org"),
        subject: emailSubject,
        html: renderEmailShell({
          eyebrow: "Business listing",
          title: emailTitle,
          intro: emailIntro,
          bodyHtml: emailBodyHtml,
          actionLabel: "Open my businesses",
          actionUrl,
        }),
        text: `${emailTitle}\n\n${summarizeText(emailBodyHtml.replace(/<[^>]+>/g, " "), 280)}\n\nOpen: ${actionUrl}`,
      });
    } catch (error) {
      console.warn(error);
    }
  }
}

module.exports = async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    const businessId = String(url.searchParams.get("id") || "").trim();
    const scope = String(url.searchParams.get("scope") || "").trim().toLowerCase();

    if (req.method === "GET") {
      if (scope === "review") {
        const { session } = await authenticateRequest(req);
        if (!session) {
          sendJson(res, 401, { error: "Unauthorized" });
          return;
        }

        const profile = await fetchProfile(session.id);
        const permissions = getReviewPermissions(profile);
        if (!(permissions.canReviewBusinesses || permissions.canPublishBusinesses || permissions.admin)) {
          sendJson(res, 403, { error: "Forbidden" });
          return;
        }

        const rows = await attachClaimProfileDetails(await fetchBusinesses({
          select: "id,author_id,claimed_by,submitter_name,submitter_email,business_name,business_category,description,contact_name,phone,business_email,address,image_path,image_url,website_url,hours,notes,submitted_at,reviewed_at,reviewed_by,review_notes,status,published_at,sort_order,created_at,updated_at",
          order: "status.asc,published_at.desc.nullslast,submitted_at.desc.nullslast,updated_at.desc",
        }));
        const claimRequests = await attachRequesterDetails(await fetchBusinessClaimRequests({
          select: "id,business_id,requester_id,status,created_at,reviewed_at,reviewed_by",
          order: "created_at.desc",
        }));
        sendJson(res, 200, {
          businesses: rows.map(serializeBusiness),
          claimRequests: claimRequests.map((row) => ({
            id: row.id,
            businessId: row.business_id,
            requesterId: row.requester_id,
            requesterEmail: row.requester_email || "",
            requesterName: row.requester_name || "",
            status: row.status || "pending",
            createdAt: row.created_at || null,
            reviewedAt: row.reviewed_at || null,
            reviewedBy: row.reviewed_by || null,
          })),
          permissions,
        });
        return;
      }

      if (scope === "mine") {
        const { session } = await authenticateRequest(req);
        if (!session) {
          sendJson(res, 401, { error: "Unauthorized" });
          return;
        }

        const rows = await attachClaimProfileDetails(await fetchBusinesses({
          select: "id,author_id,claimed_by,submitter_name,submitter_email,business_name,business_category,description,contact_name,phone,business_email,address,image_path,image_url,website_url,hours,notes,submitted_at,reviewed_at,reviewed_by,review_notes,status,published_at,sort_order,created_at,updated_at",
          claimed_by: `eq.${session.id}`,
          order: "published_at.desc.nullslast,business_name.asc",
        }));
        const pendingClaimRequests = await fetchBusinessClaimRequests({
          select: "id,business_id,requester_id,status,created_at,reviewed_at,reviewed_by",
          requester_id: `eq.${session.id}`,
          status: "eq.pending",
          order: "created_at.desc",
        }).catch(() => []);
        const requestedBusinessIds = Array.from(new Set((Array.isArray(pendingClaimRequests) ? pendingClaimRequests : []).map((row) => String(row.business_id || "")).filter(Boolean)));
        const requestedBusinesses = requestedBusinessIds.length
          ? await attachClaimProfileDetails(await fetchBusinesses({
              select: "id,author_id,claimed_by,submitter_name,submitter_email,business_name,business_category,description,contact_name,phone,business_email,address,image_path,image_url,website_url,hours,notes,submitted_at,reviewed_at,reviewed_by,review_notes,status,published_at,sort_order,created_at,updated_at",
              id: `in.(${requestedBusinessIds.map((id) => `"${id}"`).join(",")})`,
              order: "business_name.asc",
            })).catch(() => [])
          : [];
        const requestMap = new Map((Array.isArray(pendingClaimRequests) ? pendingClaimRequests : []).map((row) => [String(row.business_id || ""), row]));
        sendJson(res, 200, {
          businesses: rows.map(serializeBusiness),
          pendingClaims: (Array.isArray(requestedBusinesses) ? requestedBusinesses : []).map((row) => ({
            ...serializeBusiness(row),
            claimRequestId: requestMap.get(String(row.id || ""))?.id || null,
            claimRequestedAt: requestMap.get(String(row.id || ""))?.created_at || null,
            claimRequestStatus: requestMap.get(String(row.id || ""))?.status || "pending",
          })),
        });
        return;
      }

      const { session } = await authenticateRequest(req);
      const rows = await fetchBusinesses({
        select: "id,claimed_by,business_name,business_category,description,contact_name,phone,business_email,address,image_path,image_url,website_url,hours,notes,status,published_at,sort_order,created_at,updated_at",
        status: "eq.published",
        order: "business_category.asc,sort_order.asc,business_name.asc",
      });
      let requestedBusinessIds = new Set();
      if (session?.id) {
        const ownRequests = await fetchBusinessClaimRequests({
          select: "business_id,status",
          requester_id: `eq.${session.id}`,
          status: "eq.pending",
        }).catch(() => []);
        requestedBusinessIds = new Set((Array.isArray(ownRequests) ? ownRequests : []).map((row) => String(row.business_id || "")));
      }
      sendJson(res, 200, {
        businesses: rows.map((row) => ({
          ...serializeBusiness(row),
          canRequestClaim: Boolean(session?.id),
          claimRequestedByViewer: requestedBusinessIds.has(String(row.id || "")),
        })),
        categories: CATEGORY_ORDER,
      });
      return;
    }

    if (req.method === "POST") {
      const { session } = await authenticateRequest(req);
      const actorProfile = session?.id ? await fetchProfile(session.id).catch(() => null) : null;
      const body = await parseJsonBody(req);
      const requestAction = String(body?.action || "").trim().toLowerCase();

      if (requestAction === "prepare_image_upload") {
        if (!session) {
          sendJson(res, 401, { error: "Unauthorized" });
          return;
        }
        const targetBusinessId = String(body?.id || "").trim();
        if (!targetBusinessId) {
          sendJson(res, 400, { error: "Missing business id" });
          return;
        }
        const profile = actorProfile || await fetchProfile(session.id);
        const permissions = getReviewPermissions(profile);
        const existing = await fetchBusinessById(targetBusinessId);
        if (!existing) {
          sendJson(res, 404, { error: "Business listing not found" });
          return;
        }
        const isClaimedOwner = existing.claimed_by === session.id;
        const canModerate = permissions.canReviewBusinesses || permissions.canPublishBusinesses || permissions.admin;
        if (!(isClaimedOwner || canModerate)) {
          sendJson(res, 403, { error: "Forbidden" });
          return;
        }
        const rawFilename = String(body?.filename || "image").trim();
        const extension = (rawFilename.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]+/g, "");
        const basename = sanitizeFilename(rawFilename.replace(/\.[^.]+$/, "")) || "image";
        const path = `${existing.id}/${Date.now()}-${basename}.${extension || "jpg"}`;
        const upload = await createBusinessImageUploadToken(path);
        sendJson(res, 200, { ok: true, upload });
        return;
      }

      if (requestAction === "request_claim") {
        if (!session) {
          sendJson(res, 401, { error: "Unauthorized" });
          return;
        }
        const targetBusinessId = String(body?.businessId || "").trim();
        if (!targetBusinessId) {
          sendJson(res, 400, { error: "Missing business id" });
          return;
        }
        const business = await fetchBusinessById(targetBusinessId);
        if (!business) {
          sendJson(res, 404, { error: "Business listing not found" });
          return;
        }
        if (business.claimed_by) {
          sendJson(res, 409, { error: "This listing is already claimed." });
          return;
        }
        const existingRequests = await fetchBusinessClaimRequests({
          select: "id,business_id,requester_id,status,created_at,reviewed_at,reviewed_by",
          business_id: `eq.${targetBusinessId}`,
          requester_id: `eq.${session.id}`,
          limit: "1",
        }).catch(() => []);
        let claimRequest = Array.isArray(existingRequests) && existingRequests.length ? existingRequests[0] : null;
        if (claimRequest?.status === "pending") {
          sendJson(res, 200, {
            ok: true,
            claimRequest: {
              id: claimRequest.id,
              businessId: claimRequest.business_id,
              requesterId: claimRequest.requester_id,
              status: claimRequest.status,
            },
          });
          return;
        }
        if (claimRequest) {
          claimRequest = await updateBusinessClaimRequest(claimRequest.id, {
            status: "pending",
            reviewed_at: null,
            reviewed_by: null,
          });
        } else {
          claimRequest = await insertBusinessClaimRequest({
            business_id: targetBusinessId,
            requester_id: session.id,
            status: "pending",
          });
        }
        try {
          await notifyModeratorsOfClaimRequest(business, session.id);
          await emailBusinessModerators({
            req,
            business,
            actorProfile: actorProfile || { id: session.id },
            subject: `[Bly, Oregon] Business claim request: ${business.business_name || "Business listing"}`,
            eyebrow: "Business claim",
            title: "A member requested ownership",
            intro: `${escapeHtml(actorProfile?.display_name || actorProfile?.email || "A Bly member")} requested ownership of a business listing.`,
            bodyHtml: `<p><strong>${escapeHtml(business.business_name || "Business listing")}</strong> now has a claim request waiting in the business review queue.</p>`,
          });
        } catch (error) {
          console.error("Business claim notification failed:", error);
        }
        sendJson(res, 200, {
          ok: true,
          claimRequest: claimRequest ? {
            id: claimRequest.id,
            businessId: claimRequest.business_id,
            requesterId: claimRequest.requester_id,
            status: claimRequest.status,
          } : null,
        });
        return;
      }

      const submitterName = normalizeText(body?.submitter_name, 120);
      const submitterEmail = normalizeText(body?.submitter_email, 200);
      const businessName = normalizeText(body?.business_name, 160);
      const description = normalizeText(body?.description, 2000);
      const businessCategory = normalizeBusinessCategory(body?.business_category);
      const selfClaimRequested = body?.self_claim === true || String(body?.self_claim || "").toLowerCase() === "yes";

      if (!submitterName || !submitterEmail || !businessName || !description) {
        sendJson(res, 400, { error: "Missing required fields" });
        return;
      }

      const inserted = await insertBusiness({
        author_id: session?.id || null,
        claimed_by: session?.id && selfClaimRequested ? session.id : null,
        submitter_name: submitterName,
        submitter_email: submitterEmail,
        business_name: businessName,
        business_category: businessCategory,
        description,
        contact_name: normalizeText(body?.contact, 160) || null,
        phone: normalizeText(body?.phone, 80) || null,
        business_email: normalizeText(body?.business_email, 200) || null,
        address: normalizeText(body?.address, 300) || null,
        image_url: normalizeText(body?.image_url, 1000) || null,
        website_url: normalizeText(body?.website, 500) || null,
        hours: normalizeText(body?.hours, 200) || null,
        notes: normalizeText(body?.notes, 1000) || null,
        status: "submitted",
        submitted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      try {
        if (inserted) {
          await notifyModeratorsOfSubmission(inserted, session?.id || null);
          await emailBusinessModerators({
            req,
            business: inserted,
            actorProfile: actorProfile || { id: session?.id || null, email: submitterEmail, display_name: submitterName },
            subject: `[Bly, Oregon] Business submitted: ${inserted.business_name || "Business listing"}`,
            eyebrow: "Business review",
            title: "A business listing is waiting in review",
            intro: `${escapeHtml(actorProfile?.display_name || submitterName || "A Bly member")} submitted a business listing for review.`,
            bodyHtml:
              `<p><strong>${escapeHtml(inserted.business_name || "Business listing")}</strong> was submitted to the business directory.</p>` +
              `<p>Category: ${escapeHtml(inserted.business_category || "Other")}</p>`,
          });
          if (session?.id) {
            await notifyBusinessMembers({
              req,
              business: inserted,
              actorProfile: actorProfile || { id: session.id, email: submitterEmail, display_name: submitterName },
              type: "business_submitted",
              title: "Business listing submitted",
              body: `${inserted.business_name || "Your business listing"} was submitted for review.`,
              emailSubject: `[Bly, Oregon] Business submitted: ${inserted.business_name || "Business listing"}`,
              emailTitle: "Your business listing is in review",
              emailIntro: "A business listing was submitted from your Bly account.",
              emailBodyHtml:
                `<p><strong>${escapeHtml(inserted.business_name || "Business listing")}</strong> was submitted for approval.</p>` +
                `<p>You can track business ownership and edits from your account.</p>`,
            });
          }
        }
      } catch (error) {
        console.error("Business submission notification failed:", error);
      }

      sendJson(res, 200, {
        ok: true,
        business: inserted ? serializeBusiness(inserted) : null,
      });
      return;
    }

    if (req.method === "PATCH") {
      const { session } = await authenticateRequest(req);
      if (!session) {
        sendJson(res, 401, { error: "Unauthorized" });
        return;
      }

      const profile = await fetchProfile(session.id);
      const permissions = getReviewPermissions(profile);
      const actorProfile = profile || { id: session.id };
      const body = await parseJsonBody(req);
      const requestAction = String(body?.action || "").trim().toLowerCase();

      if (requestAction === "approve_claim" || requestAction === "reject_claim") {
        if (!(permissions.canReviewBusinesses || permissions.canPublishBusinesses || permissions.admin)) {
          sendJson(res, 403, { error: "Forbidden" });
          return;
        }
        const claimRequestId = String(body?.claimRequestId || "").trim();
        if (!claimRequestId) {
          sendJson(res, 400, { error: "Missing claim request id" });
          return;
        }
        const claimRequest = await fetchBusinessClaimRequestById(claimRequestId);
        if (!claimRequest) {
          sendJson(res, 404, { error: "Claim request not found" });
          return;
        }
        const business = await fetchBusinessById(claimRequest.business_id);
        if (!business) {
          sendJson(res, 404, { error: "Business listing not found" });
          return;
        }
        if (requestAction === "approve_claim") {
          const approvedBusiness = await updateBusiness(business.id, {
            claimed_by: claimRequest.requester_id,
            updated_at: new Date().toISOString(),
          });
          await updateBusinessClaimRequest(claimRequest.id, {
            status: "approved",
            reviewed_at: new Date().toISOString(),
            reviewed_by: session.id,
          });
          const competingRequests = await fetchBusinessClaimRequests({
            select: "id",
            business_id: `eq.${business.id}`,
            status: "eq.pending",
          }).catch(() => []);
          await Promise.all(
            (Array.isArray(competingRequests) ? competingRequests : [])
              .filter((row) => String(row.id || "") && row.id !== claimRequest.id)
              .map((row) => updateBusinessClaimRequest(row.id, {
                status: "rejected",
                reviewed_at: new Date().toISOString(),
                reviewed_by: session.id,
              }).catch(() => null))
          );
          try {
            await notifyBusinessMembers({
              req,
              business: approvedBusiness || { ...business, claimed_by: claimRequest.requester_id },
              actorProfile,
              type: "business_claim_approved",
              title: "Business claim approved",
              body: `${business.business_name || "A business listing"} was linked to your account.`,
              emailSubject: `[Bly, Oregon] Claim approved: ${business.business_name || "Business listing"}`,
              emailTitle: "You now manage a business listing",
              emailIntro: "An admin approved your business ownership request.",
              emailBodyHtml:
                `<p><strong>${escapeHtml(business.business_name || "Business listing")}</strong> is now linked to your account.</p>` +
                `<p>You can edit it anytime from your account.</p>`,
            });
          } catch (error) {
            console.warn(error);
          }
        } else {
          await updateBusinessClaimRequest(claimRequest.id, {
            status: "rejected",
            reviewed_at: new Date().toISOString(),
            reviewed_by: session.id,
          });
          try {
            await notifyBusinessMembers({
              req,
              business: { ...business, author_id: claimRequest.requester_id },
              actorProfile,
              type: "business_claim_rejected",
              title: "Business claim rejected",
              body: `${business.business_name || "A business listing"} was not linked to your account.`,
              emailSubject: `[Bly, Oregon] Claim update: ${business.business_name || "Business listing"}`,
              emailTitle: "Your claim request was reviewed",
              emailIntro: "An admin reviewed your business claim request.",
              emailBodyHtml:
                `<p>Your request to claim <strong>${escapeHtml(business.business_name || "this business listing")}</strong> was not approved.</p>`,
            });
          } catch (error) {
            console.warn(error);
          }
        }
        sendJson(res, 200, { ok: true });
        return;
      }

      const targetId = String(body?.id || businessId || "").trim();
      if (!targetId) {
        sendJson(res, 400, { error: "Missing business id" });
        return;
      }

      const existing = await fetchBusinessById(targetId);
      if (!existing) {
        sendJson(res, 404, { error: "Business listing not found" });
        return;
      }

      const isClaimedOwner = existing.claimed_by === session.id;

      const action = requestAction || "save";
      const claimedAccountEmail = normalizeText(body?.claimedAccountEmail, 200).toLowerCase();
      let claimedProfile = null;
      if (claimedAccountEmail) {
        claimedProfile = await fetchProfileByEmail(claimedAccountEmail);
        if (!claimedProfile) {
          sendJson(res, 404, { error: "Claimed account email does not match a Bly account." });
          return;
        }
      }

      const canOwnerEdit = isClaimedOwner;
      const canModerate = permissions.canReviewBusinesses || permissions.canPublishBusinesses || permissions.admin;
      if (!(canOwnerEdit || canModerate)) {
        sendJson(res, 403, { error: "Forbidden" });
        return;
      }

      const payload = {
        business_name: normalizeText(body?.businessName, 160) || existing.business_name,
        business_category: normalizeBusinessCategory(body?.businessCategory || existing.business_category),
        description: normalizeText(body?.description, 2000) || existing.description,
        contact_name: normalizeText(body?.contactName, 160) || null,
        phone: normalizeText(body?.phone, 80) || null,
        business_email: normalizeText(body?.businessEmail, 200) || null,
        address: normalizeText(body?.address, 300) || null,
        website_url: normalizeText(body?.websiteUrl, 500) || null,
        hours: normalizeText(body?.hours, 200) || null,
        notes: normalizeText(body?.notes, 1000) || null,
        review_notes: normalizeText(body?.reviewNotes, 2000) || null,
        sort_order: Number.isFinite(Number(body?.sortOrder)) ? Number(body.sortOrder) : Number(existing.sort_order || 0),
        updated_at: new Date().toISOString(),
      };

      const submittedImageUrl = normalizeText(body?.imageUrl, 1000);
      const explicitImagePath = normalizeText(body?.imagePath, 1000);
      const derivedImagePath = extractBusinessImagePath(submittedImageUrl);
      const nextImagePath = derivedImagePath || (
        explicitImagePath && submittedImageUrl === businessImagePublicUrl(explicitImagePath)
          ? explicitImagePath
          : ""
      );

      Object.assign(payload, {
        image_path: nextImagePath || null,
        image_url: submittedImageUrl || null,
      });

      if (canModerate) {
        payload.claimed_by = claimedProfile ? claimedProfile.id : (body?.claimedAccountEmail === "" ? null : existing.claimed_by);
      }

      if (action === "publish") {
        if (!(permissions.canPublishBusinesses || permissions.admin)) {
          sendJson(res, 403, { error: "Forbidden" });
          return;
        }
        payload.status = "published";
        payload.published_at = new Date().toISOString();
        payload.reviewed_at = new Date().toISOString();
        payload.reviewed_by = session.id;
      } else if (action === "request_changes") {
        if (!canModerate) {
          sendJson(res, 403, { error: "Forbidden" });
          return;
        }
        payload.status = "changes_requested";
        payload.reviewed_at = new Date().toISOString();
        payload.reviewed_by = session.id;
      } else if (action === "archive") {
        if (!(permissions.canPublishBusinesses || permissions.admin)) {
          sendJson(res, 403, { error: "Forbidden" });
          return;
        }
        payload.status = "archived";
      } else if (action === "unpublish") {
        if (!(permissions.canPublishBusinesses || permissions.admin)) {
          sendJson(res, 403, { error: "Forbidden" });
          return;
        }
        payload.status = "submitted";
        payload.published_at = null;
      } else if (action !== "save") {
        sendJson(res, 400, { error: "Invalid action" });
        return;
      }

      if (canOwnerEdit && !canModerate) {
        delete payload.claimed_by;
        delete payload.reviewed_by;
        delete payload.reviewed_at;
        delete payload.review_notes;
        delete payload.sort_order;
        if (action !== "save") {
          sendJson(res, 403, { error: "Claimed business owners can only save listing updates." });
          return;
        }
        payload.status = existing.status === "archived" ? "archived" : (existing.status || "published");
        payload.published_at = existing.published_at || null;
      }

      if (payload.image_path && !payload.image_url) {
        payload.image_url = businessImagePublicUrl(payload.image_path);
      }

      const previousImagePath = String(existing.image_path || "").trim();
      const persistedImagePath = String(payload.image_path || "").trim();
      const previousClaimedBy = String(existing.claimed_by || "").trim();
      const updated = await updateBusiness(targetId, payload);
      if (previousImagePath && previousImagePath !== persistedImagePath) {
        try {
          await deleteBusinessImagesFromStorage([previousImagePath]);
        } catch (error) {
          console.error(`Business image cleanup failed for ${targetId}:`, error);
        }
      }
      try {
        const businessForNotifications = updated || existing;
        if (action === "publish") {
          await notifyBusinessMembers({
            req,
            business: businessForNotifications,
            actorProfile,
            type: "business_published",
            title: "Business listing published",
            body: `${businessForNotifications.business_name || "Your business listing"} is now live on the site.`,
            emailSubject: `[Bly, Oregon] Published: ${businessForNotifications.business_name || "Business listing"}`,
            emailTitle: "Your business listing is live",
            emailIntro: "A business listing tied to your account was published.",
            emailBodyHtml: `<p><strong>${escapeHtml(businessForNotifications.business_name || "Business listing")}</strong> is now live in the Bly business directory.</p>`,
          });
        } else if (action === "request_changes") {
          await notifyBusinessMembers({
            req,
            business: businessForNotifications,
            actorProfile,
            type: "business_changes_requested",
            title: "Changes requested on a business listing",
            body: payload.review_notes
              ? `${businessForNotifications.business_name || "Your business listing"} needs updates: ${summarizeText(payload.review_notes, 140)}`
              : `${businessForNotifications.business_name || "Your business listing"} needs updates before it can go live.`,
            emailSubject: `[Bly, Oregon] Changes requested: ${businessForNotifications.business_name || "Business listing"}`,
            emailTitle: "Changes were requested",
            emailIntro: "An admin reviewed a business listing tied to your account.",
            emailBodyHtml:
              `<p><strong>${escapeHtml(businessForNotifications.business_name || "Business listing")}</strong> needs updates before it can move forward.</p>` +
              (payload.review_notes ? `<p>Review notes: ${escapeHtml(payload.review_notes)}</p>` : ""),
          });
        } else if (action === "unpublish") {
          await notifyBusinessMembers({
            req,
            business: businessForNotifications,
            actorProfile,
            type: "business_unpublished",
            title: "Business listing unpublished",
            body: `${businessForNotifications.business_name || "Your business listing"} was removed from the live directory.`,
            emailSubject: `[Bly, Oregon] Unpublished: ${businessForNotifications.business_name || "Business listing"}`,
            emailTitle: "Your business listing was unpublished",
            emailIntro: "An admin removed a business listing tied to your account from the live directory.",
            emailBodyHtml: `<p><strong>${escapeHtml(businessForNotifications.business_name || "Business listing")}</strong> is no longer live in the business directory.</p>`,
          });
        } else if (action === "archive") {
          await notifyBusinessMembers({
            req,
            business: businessForNotifications,
            actorProfile,
            type: "business_archived",
            title: "Business listing archived",
            body: `${businessForNotifications.business_name || "Your business listing"} was archived.`,
            emailSubject: `[Bly, Oregon] Archived: ${businessForNotifications.business_name || "Business listing"}`,
            emailTitle: "Your business listing was archived",
            emailIntro: "An admin archived a business listing tied to your account.",
            emailBodyHtml: `<p><strong>${escapeHtml(businessForNotifications.business_name || "Business listing")}</strong> was archived and is no longer part of the active directory workflow.</p>`,
          });
        } else if (action === "save" && previousClaimedBy !== String(updated?.claimed_by || "").trim()) {
          const assignedUserId = String(updated?.claimed_by || "").trim();
          if (assignedUserId) {
            await notifyBusinessMembers({
              req,
              business: updated,
              actorProfile,
              type: "business_owner_assigned",
              title: "Business listing linked to your account",
              body: `${updated.business_name || "A business listing"} is now linked to your account.`,
              emailSubject: `[Bly, Oregon] Business linked: ${updated.business_name || "Business listing"}`,
              emailTitle: "You can now manage a business listing",
              emailIntro: "An admin linked a business listing to your Bly account.",
              emailBodyHtml: `<p><strong>${escapeHtml(updated.business_name || "Business listing")}</strong> is now linked to your account and available in My businesses.</p>`,
            });
          }
        }
      } catch (error) {
        console.warn(error);
      }
      sendJson(res, 200, {
        ok: true,
        business: updated ? serializeBusiness(updated) : null,
        permissions,
      });
      return;
    }

    sendJson(res, 405, { error: "Method not allowed" });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Server error" });
  }
};
