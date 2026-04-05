function getSupabaseUrl() {
  return String(process.env.SUPABASE_URL || "https://mgxdiolwevcgwgzhzttd.supabase.co").replace(/\/+$/, "");
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

const AVAILABLE_BUCKETS = [
  { id: "churchfirephotos", label: "Church Fire Photos" },
  { id: "standingstonechurchconstructionphotos", label: "Standing Stone Construction Photos" },
];
const AVAILABLE_ROLES = new Set(["member", "moderator", "admin"]);

function parseJsonBody(req) {
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

async function fetchOwnProfile(session, token) {
  const response = await fetch(
    `${getSupabaseUrl()}/rest/v1/profiles?select=id,role,can_upload_photos,can_manage_media,media_buckets,can_edit_media_details,can_rename_media,can_delete_media,can_submit_articles,can_self_publish_articles,can_self_publish_article_edits,can_review_articles,can_publish_articles&id=eq.${encodeURIComponent(session.id)}`,
    {
      headers: {
        apikey: getAnonKey(),
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (!response.ok) throw new Error("Unable to load account profile");
  const rows = await response.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function fetchPublishedArticleAuthorIds(token, userIds = []) {
  const normalizedIds = Array.from(new Set((userIds || []).map((id) => String(id || "").trim()).filter(Boolean)));
  if (!normalizedIds.length) return new Set();

  const response = await fetch(
    `${getSupabaseUrl()}/rest/v1/articles?select=author_id&status=eq.published&author_id=in.(${normalizedIds.join(",")})`,
    {
      headers: {
        apikey: getAnonKey(),
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (!response.ok) return new Set();
  const rows = await response.json().catch(() => []);
  return new Set((Array.isArray(rows) ? rows : []).map((row) => String(row?.author_id || "").trim()).filter(Boolean));
}

async function listProfiles(token) {
  const response = await fetch(
    `${getSupabaseUrl()}/rest/v1/profiles?select=id,email,display_name,bio,role,can_upload_photos,can_manage_media,media_buckets,can_edit_media_details,can_rename_media,can_delete_media,can_submit_articles,can_self_publish_articles,can_self_publish_article_edits,can_review_articles,can_publish_articles,notify_article_submissions_internal,notify_article_submissions_email,notify_article_review_internal,notify_article_review_email,notify_article_publishing_internal,notify_article_publishing_email,notify_admin_article_queue_internal,notify_admin_article_queue_email,notify_direct_messages_internal,notify_direct_messages_email,show_name_in_messages&order=display_name.asc.nullslast,email.asc`,
    {
      headers: {
        apikey: getAnonKey(),
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (!response.ok) throw new Error("Unable to load profiles");
  return response.json();
}

function sanitizeBuckets(input) {
  const allowed = new Set(AVAILABLE_BUCKETS.map((bucket) => bucket.id));
  return Array.isArray(input)
    ? [...new Set(input.map((bucket) => String(bucket || "").trim()).filter((bucket) => allowed.has(bucket)))]
    : [];
}

function applyRolePreset(role, options = {}) {
  const normalizedRole = AVAILABLE_ROLES.has(String(role || "").trim().toLowerCase())
    ? String(role).trim().toLowerCase()
    : "member";

  if (normalizedRole === "admin") {
    return {
      role: "admin",
      canUploadPhotos: true,
      canManageMedia: true,
      canEditMediaDetails: true,
      canRenameMedia: true,
      canDeleteMedia: true,
      canSubmitArticles: true,
      canSelfPublishArticles: true,
      canSelfPublishArticleEdits: true,
      canReviewArticles: true,
      canPublishArticles: true,
      notifyAdminArticleQueueInternal: true,
      notifyAdminArticleQueueEmail: true,
    };
  }

  if (normalizedRole === "moderator") {
    return {
      role: "moderator",
      canUploadPhotos: Boolean(options?.canUploadPhotos),
      canManageMedia: Boolean(options?.canManageMedia),
      canEditMediaDetails: Boolean(options?.canEditMediaDetails),
      canRenameMedia: Boolean(options?.canRenameMedia),
      canDeleteMedia: Boolean(options?.canDeleteMedia),
      canSubmitArticles: true,
      canSelfPublishArticles: true,
      canSelfPublishArticleEdits: true,
      canReviewArticles: true,
      canPublishArticles: true,
      notifyAdminArticleQueueInternal: true,
      notifyAdminArticleQueueEmail: true,
    };
  }

  return {
    role: "member",
    canUploadPhotos: Boolean(options?.canUploadPhotos),
    canManageMedia: Boolean(options?.canManageMedia),
    canEditMediaDetails: Boolean(options?.canEditMediaDetails),
    canRenameMedia: Boolean(options?.canRenameMedia),
    canDeleteMedia: Boolean(options?.canDeleteMedia),
    canSubmitArticles: true,
    canSelfPublishArticles: false,
    canSelfPublishArticleEdits: true,
    canReviewArticles: false,
    canPublishArticles: false,
    notifyAdminArticleQueueInternal: false,
    notifyAdminArticleQueueEmail: false,
  };
}

async function updateMediaAccess(token, userId, options) {
  const rolePreset = applyRolePreset(options?.role, options);
  const role = rolePreset.role;
  const mediaBuckets = sanitizeBuckets(options?.mediaBuckets);
  const canUploadPhotos = Boolean(rolePreset.canUploadPhotos);
  const canManageMedia = Boolean(rolePreset.canManageMedia || mediaBuckets.length > 0 || role === "admin");
  const canEditMediaDetails = Boolean(rolePreset.canEditMediaDetails || role === "admin");
  const canRenameMedia = Boolean(rolePreset.canRenameMedia || role === "admin");
  const canDeleteMedia = Boolean(rolePreset.canDeleteMedia || role === "admin");
  const canSubmitArticles = Boolean(rolePreset.canSubmitArticles || role === "admin");
  const canSelfPublishArticles = Boolean(rolePreset.canSelfPublishArticles || role === "admin");
  const canSelfPublishArticleEdits = Boolean(rolePreset.canSelfPublishArticleEdits || role === "admin");
  const canReviewArticles = Boolean(rolePreset.canReviewArticles || role === "admin");
  const canPublishArticles = Boolean(rolePreset.canPublishArticles || role === "admin");
  const notifyArticleSubmissionsInternal = Boolean(options?.notifyArticleSubmissionsInternal !== false);
  const notifyArticleSubmissionsEmail = Boolean(options?.notifyArticleSubmissionsEmail !== false);
  const notifyArticleReviewInternal = Boolean(options?.notifyArticleReviewInternal !== false);
  const notifyArticleReviewEmail = Boolean(options?.notifyArticleReviewEmail !== false);
  const notifyArticlePublishingInternal = Boolean(options?.notifyArticlePublishingInternal !== false);
  const notifyArticlePublishingEmail = Boolean(options?.notifyArticlePublishingEmail !== false);
  const notifyAdminArticleQueueInternal = Boolean(rolePreset.notifyAdminArticleQueueInternal);
  const notifyAdminArticleQueueEmail = Boolean(rolePreset.notifyAdminArticleQueueEmail);
  const notifyDirectMessagesInternal = Boolean(options?.notifyDirectMessagesInternal !== false);
  const notifyDirectMessagesEmail = Boolean(options?.notifyDirectMessagesEmail !== false);
  const publishedAuthorIds = await fetchPublishedArticleAuthorIds(token, [userId]);
  const hasPublishedArticles = publishedAuthorIds.has(userId);
  const showNameInMessages = hasPublishedArticles ? true : Boolean(options?.showNameInMessages !== false);
  const response = await fetch(
    `${getSupabaseUrl()}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`,
    {
      method: "PATCH",
      headers: {
        apikey: getAnonKey(),
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        role,
        can_upload_photos: canUploadPhotos,
        can_manage_media: canManageMedia,
        can_edit_media_details: canEditMediaDetails,
        can_rename_media: canRenameMedia,
        can_delete_media: canDeleteMedia,
        can_submit_articles: canSubmitArticles,
        can_self_publish_articles: canSelfPublishArticles,
        can_self_publish_article_edits: canSelfPublishArticleEdits,
        can_review_articles: canReviewArticles,
        can_publish_articles: canPublishArticles,
        notify_article_submissions_internal: notifyArticleSubmissionsInternal,
        notify_article_submissions_email: notifyArticleSubmissionsEmail,
        notify_article_review_internal: notifyArticleReviewInternal,
        notify_article_review_email: notifyArticleReviewEmail,
        notify_article_publishing_internal: notifyArticlePublishingInternal,
        notify_article_publishing_email: notifyArticlePublishingEmail,
        notify_admin_article_queue_internal: notifyAdminArticleQueueInternal,
        notify_admin_article_queue_email: notifyAdminArticleQueueEmail,
        notify_direct_messages_internal: notifyDirectMessagesInternal,
        notify_direct_messages_email: notifyDirectMessagesEmail,
        show_name_in_messages: showNameInMessages,
        media_buckets: mediaBuckets,
      }),
    }
  );

  if (!response.ok) throw new Error("Unable to update media access");
  const rows = await response.json();
  const profile = Array.isArray(rows) && rows.length ? rows[0] : null;
  return {
    profile,
    hasPublishedArticles,
  };
}

async function deleteUserAccount(userId) {
  const serviceKey = getServiceRoleKey();
  if (!serviceKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

  const response = await fetch(`${getSupabaseUrl()}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: "DELETE",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.msg || payload?.error_description || payload?.error || "Unable to delete user");
  }
}

module.exports = async (req, res) => {
  try {
    const { session, token } = await authenticateRequest(req);
    if (!session || !token) {
      sendJson(res, 401, { error: "Unauthorized" });
      return;
    }

    const ownProfile = await fetchOwnProfile(session, token);
    const isAdmin = String(ownProfile?.role || "").toLowerCase() === "admin";
    if (!isAdmin) {
      sendJson(res, 403, { error: "Forbidden" });
      return;
    }

    if (req.method === "GET") {
      const profiles = await listProfiles(token);
      const publishedAuthorIds = await fetchPublishedArticleAuthorIds(
        token,
        Array.isArray(profiles) ? profiles.map((profile) => profile.id) : []
      );
      sendJson(res, 200, {
        availableBuckets: AVAILABLE_BUCKETS,
        profiles: Array.isArray(profiles)
          ? profiles.map((profile) => ({
              id: profile.id,
              email: profile.email || "",
              displayName: profile.display_name || "",
              bio: profile.bio || "",
              role: String(profile.role || "member").toLowerCase(),
              canUploadPhotos: Boolean(profile.can_upload_photos || String(profile.role || "").toLowerCase() === "admin"),
              canManageMedia: Boolean(profile.can_manage_media || String(profile.role || "").toLowerCase() === "admin"),
              canEditMediaDetails: Boolean(profile.can_edit_media_details || String(profile.role || "").toLowerCase() === "admin"),
              canRenameMedia: Boolean(profile.can_rename_media || String(profile.role || "").toLowerCase() === "admin"),
              canDeleteMedia: Boolean(profile.can_delete_media || String(profile.role || "").toLowerCase() === "admin"),
              canSubmitArticles: Boolean(profile.can_submit_articles || String(profile.role || "").toLowerCase() === "admin"),
              canSelfPublishArticles: Boolean(profile.can_self_publish_articles || String(profile.role || "").toLowerCase() === "admin"),
              canSelfPublishArticleEdits: Boolean(profile.can_self_publish_article_edits || String(profile.role || "").toLowerCase() === "admin"),
              canReviewArticles: Boolean(profile.can_review_articles || profile.can_publish_articles || String(profile.role || "").toLowerCase() === "admin"),
              canPublishArticles: Boolean(profile.can_publish_articles || String(profile.role || "").toLowerCase() === "admin"),
              hasPublishedArticles: publishedAuthorIds.has(String(profile.id || "").trim()),
              notificationPreferences: {
                articleSubmissionsInternal: profile.notify_article_submissions_internal !== false,
                articleSubmissionsEmail: profile.notify_article_submissions_email !== false,
                articleReviewInternal: profile.notify_article_review_internal !== false,
                articleReviewEmail: profile.notify_article_review_email !== false,
                articlePublishingInternal: profile.notify_article_publishing_internal !== false,
                articlePublishingEmail: profile.notify_article_publishing_email !== false,
                adminArticleQueueInternal: profile.notify_admin_article_queue_internal !== false,
                adminArticleQueueEmail: profile.notify_admin_article_queue_email !== false,
                directMessagesInternal: profile.notify_direct_messages_internal !== false,
                directMessagesEmail: profile.notify_direct_messages_email !== false,
              },
              showNameInMessages: publishedAuthorIds.has(String(profile.id || "").trim())
                ? true
                : profile.show_name_in_messages !== false,
              mediaBuckets: Array.isArray(profile.media_buckets) ? profile.media_buckets : [],
            }))
          : [],
      });
      return;
    }

    if (req.method === "PATCH") {
      const body = await parseJsonBody(req);
      const userId = String(body?.userId || "").trim();
      const mediaBuckets = sanitizeBuckets(body?.mediaBuckets);
      const canUploadPhotos = Boolean(body?.canUploadPhotos);
      const canManageMedia = Boolean(body?.canManageMedia || mediaBuckets.length > 0);
      const canEditMediaDetails = Boolean(body?.canEditMediaDetails);
      const canRenameMedia = Boolean(body?.canRenameMedia);
      const canDeleteMedia = Boolean(body?.canDeleteMedia);
      const role = String(body?.role || "member").trim().toLowerCase();
      const canSubmitArticles = Boolean(body?.canSubmitArticles);
      const canSelfPublishArticles = Boolean(body?.canSelfPublishArticles);
      const canSelfPublishArticleEdits = Boolean(body?.canSelfPublishArticleEdits);
      const canReviewArticles = Boolean(body?.canReviewArticles || body?.canPublishArticles);
      const canPublishArticles = Boolean(body?.canPublishArticles);
      const notifyArticleSubmissionsInternal = Boolean(body?.notifyArticleSubmissionsInternal !== false);
      const notifyArticleSubmissionsEmail = Boolean(body?.notifyArticleSubmissionsEmail !== false);
      const notifyArticleReviewInternal = Boolean(body?.notifyArticleReviewInternal !== false);
      const notifyArticleReviewEmail = Boolean(body?.notifyArticleReviewEmail !== false);
      const notifyArticlePublishingInternal = Boolean(body?.notifyArticlePublishingInternal !== false);
      const notifyArticlePublishingEmail = Boolean(body?.notifyArticlePublishingEmail !== false);
      const notifyAdminArticleQueueInternal = Boolean(body?.notifyAdminArticleQueueInternal !== false);
      const notifyAdminArticleQueueEmail = Boolean(body?.notifyAdminArticleQueueEmail !== false);
      const notifyDirectMessagesInternal = Boolean(body?.notifyDirectMessagesInternal !== false);
      const notifyDirectMessagesEmail = Boolean(body?.notifyDirectMessagesEmail !== false);
      const showNameInMessages = Boolean(body?.showNameInMessages !== false);

      if (!userId) {
        sendJson(res, 400, { error: "Missing userId" });
        return;
      }

      const result = await updateMediaAccess(token, userId, {
        mediaBuckets,
        role,
        canUploadPhotos,
        canManageMedia,
        canEditMediaDetails,
        canRenameMedia,
        canDeleteMedia,
        canSubmitArticles,
        canSelfPublishArticles,
        canSelfPublishArticleEdits,
        canReviewArticles,
        canPublishArticles,
        notifyArticleSubmissionsInternal,
        notifyArticleSubmissionsEmail,
        notifyArticleReviewInternal,
        notifyArticleReviewEmail,
        notifyArticlePublishingInternal,
        notifyArticlePublishingEmail,
        notifyAdminArticleQueueInternal,
        notifyAdminArticleQueueEmail,
        notifyDirectMessagesInternal,
        notifyDirectMessagesEmail,
        showNameInMessages,
      });
      const updated = result?.profile || null;
      sendJson(res, 200, {
        ok: true,
        profile: {
          id: updated?.id || userId,
          email: updated?.email || "",
          displayName: updated?.display_name || "",
          bio: updated?.bio || "",
          role: String(updated?.role || "member").toLowerCase(),
          canUploadPhotos: Boolean(updated?.can_upload_photos || String(updated?.role || "").toLowerCase() === "admin"),
          canManageMedia: Boolean(updated?.can_manage_media || String(updated?.role || "").toLowerCase() === "admin"),
          canEditMediaDetails: Boolean(updated?.can_edit_media_details || String(updated?.role || "").toLowerCase() === "admin"),
          canRenameMedia: Boolean(updated?.can_rename_media || String(updated?.role || "").toLowerCase() === "admin"),
          canDeleteMedia: Boolean(updated?.can_delete_media || String(updated?.role || "").toLowerCase() === "admin"),
          canSubmitArticles: Boolean(updated?.can_submit_articles || String(updated?.role || "").toLowerCase() === "admin"),
          canSelfPublishArticles: Boolean(updated?.can_self_publish_articles || String(updated?.role || "").toLowerCase() === "admin"),
          canSelfPublishArticleEdits: Boolean(updated?.can_self_publish_article_edits || String(updated?.role || "").toLowerCase() === "admin"),
          canReviewArticles: Boolean(updated?.can_review_articles || updated?.can_publish_articles || String(updated?.role || "").toLowerCase() === "admin"),
          canPublishArticles: Boolean(updated?.can_publish_articles || String(updated?.role || "").toLowerCase() === "admin"),
          hasPublishedArticles: Boolean(result?.hasPublishedArticles),
          notificationPreferences: {
            articleSubmissionsInternal: updated?.notify_article_submissions_internal !== false,
            articleSubmissionsEmail: updated?.notify_article_submissions_email !== false,
            articleReviewInternal: updated?.notify_article_review_internal !== false,
            articleReviewEmail: updated?.notify_article_review_email !== false,
            articlePublishingInternal: updated?.notify_article_publishing_internal !== false,
            articlePublishingEmail: updated?.notify_article_publishing_email !== false,
            adminArticleQueueInternal: updated?.notify_admin_article_queue_internal !== false,
            adminArticleQueueEmail: updated?.notify_admin_article_queue_email !== false,
            directMessagesInternal: updated?.notify_direct_messages_internal !== false,
            directMessagesEmail: updated?.notify_direct_messages_email !== false,
          },
          showNameInMessages: result?.hasPublishedArticles ? true : updated?.show_name_in_messages !== false,
          mediaBuckets: Array.isArray(updated?.media_buckets) ? updated.media_buckets : mediaBuckets,
        },
      });
      return;
    }

    if (req.method === "DELETE") {
      const body = await parseJsonBody(req);
      const userId = String(body?.userId || "").trim();

      if (!userId) {
        sendJson(res, 400, { error: "Missing userId" });
        return;
      }

      if (userId === String(session.id || "").trim()) {
        sendJson(res, 400, { error: "You cannot delete your own account from this screen." });
        return;
      }

      const profiles = await listProfiles(token);
      const targetProfile = Array.isArray(profiles)
        ? profiles.find((profile) => String(profile?.id || "").trim() === userId)
        : null;

      if (!targetProfile) {
        sendJson(res, 404, { error: "That member could not be found." });
        return;
      }

      if (String(targetProfile.role || "").toLowerCase() === "admin") {
        sendJson(res, 400, { error: "Admins cannot be deleted from this screen." });
        return;
      }

      await deleteUserAccount(userId);
      sendJson(res, 200, { ok: true });
      return;
    }

    sendJson(res, 405, { error: "Method not allowed" });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Server error" });
  }
};
