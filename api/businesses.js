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

function getHeaderValue(req, name) {
  const value = req.headers?.[name];
  return Array.isArray(value) ? value[0] : value;
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
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
    select: "id,email,display_name,role,can_review_articles,can_publish_articles,notify_admin_article_queue_internal",
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
    select: "id,email,display_name,role,can_review_articles,can_publish_articles,notify_admin_article_queue_internal",
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
    select: "id,author_id,claimed_by,submitter_name,submitter_email,business_name,business_category,description,contact_name,phone,business_email,address,website_url,hours,notes,submitted_at,reviewed_at,reviewed_by,review_notes,status,published_at,sort_order,created_at,updated_at",
    id: `eq.${id}`,
    limit: "1",
  });
  return rows[0] || null;
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

async function fetchBusinessModerators() {
  const query = new URLSearchParams({
    select: "id,notify_admin_article_queue_internal,role,can_review_articles,can_publish_articles",
    or: "(role.eq.admin,can_review_articles.eq.true,can_publish_articles.eq.true)",
  });
  const response = await fetch(`${getSupabaseUrl()}/rest/v1/profiles?${query.toString()}`, {
    headers: getServiceHeaders(),
  });
  if (!response.ok) return [];
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows : [];
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

async function notifyModeratorsOfSubmission(business, actorId = null) {
  const moderators = await fetchBusinessModerators();
  const notifications = moderators
    .filter((row) => row?.notify_admin_article_queue_internal !== false)
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
          select: "id,author_id,claimed_by,submitter_name,submitter_email,business_name,business_category,description,contact_name,phone,business_email,address,website_url,hours,notes,submitted_at,reviewed_at,reviewed_by,review_notes,status,published_at,sort_order,created_at,updated_at",
          order: "status.asc,published_at.desc.nullslast,submitted_at.desc.nullslast,updated_at.desc",
        }));
        sendJson(res, 200, {
          businesses: rows.map(serializeBusiness),
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
          select: "id,author_id,claimed_by,submitter_name,submitter_email,business_name,business_category,description,contact_name,phone,business_email,address,website_url,hours,notes,submitted_at,reviewed_at,reviewed_by,review_notes,status,published_at,sort_order,created_at,updated_at",
          claimed_by: `eq.${session.id}`,
          order: "published_at.desc.nullslast,business_name.asc",
        }));
        sendJson(res, 200, {
          businesses: rows.map(serializeBusiness),
        });
        return;
      }

      const rows = await fetchBusinesses({
        select: "id,business_name,business_category,description,contact_name,phone,business_email,address,website_url,hours,notes,status,published_at,sort_order,created_at,updated_at",
        status: "eq.published",
        order: "business_category.asc,sort_order.asc,business_name.asc",
      });
      sendJson(res, 200, {
        businesses: rows.map(serializeBusiness),
        categories: CATEGORY_ORDER,
      });
      return;
    }

    if (req.method === "POST") {
      const { session } = await authenticateRequest(req);
      const body = await parseJsonBody(req);

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
        website_url: normalizeText(body?.website, 500) || null,
        hours: normalizeText(body?.hours, 200) || null,
        notes: normalizeText(body?.notes, 1000) || null,
        status: "submitted",
        submitted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      try {
        if (inserted) await notifyModeratorsOfSubmission(inserted, session?.id || null);
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
      if (!(permissions.canReviewBusinesses || permissions.canPublishBusinesses || permissions.admin)) {
        sendJson(res, 403, { error: "Forbidden" });
        return;
      }

      const body = await parseJsonBody(req);
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

      const action = String(body?.action || "save").trim().toLowerCase();
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

      const updated = await updateBusiness(targetId, payload);
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
