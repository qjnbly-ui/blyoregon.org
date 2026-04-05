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

async function authenticateRequest(req) {
  const authHeader = getHeaderValue(req, "authorization");
  const token = String(authHeader || "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return { session: null, token: null };

  const anonKey = getAnonKey();
  if (!anonKey) {
    throw new Error("Missing SUPABASE_ANON_KEY");
  }

  const response = await fetch(`${getSupabaseUrl()}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
    },
  });

  if (response.status === 401) return { session: null, token };
  if (!response.ok) {
    throw new Error("Unable to validate Supabase session");
  }

  return { session: await response.json(), token };
}

async function fetchProfile(session, token) {
  const response = await fetch(
    `${getSupabaseUrl()}/rest/v1/profiles?select=id,email,display_name,avatar_path,bio,role,can_manage_media,media_buckets,can_upload_photos,can_edit_media_details,can_rename_media,can_delete_media,can_submit_articles,can_self_publish_articles,can_self_publish_article_edits,can_review_articles,can_publish_articles,notify_article_submissions_internal,notify_article_submissions_email,notify_article_review_internal,notify_article_review_email,notify_article_publishing_internal,notify_article_publishing_email,notify_admin_article_queue_internal,notify_admin_article_queue_email,notify_direct_messages_internal,notify_direct_messages_email,show_name_in_messages,onboarding_complete,created_at&id=eq.${encodeURIComponent(session.id)}`,
    {
      headers: {
        apikey: getAnonKey(),
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error("Unable to load account profile");
  }

  const rows = await response.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function fetchUnreadNotificationCount(userId, token) {
  const serviceKey = getServiceRoleKey();
  if (!userId) return 0;

  const query = new URLSearchParams({
    select: "id",
    user_id: `eq.${userId}`,
    read_at: "is.null",
  });

  const headers = serviceKey
    ? {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Prefer: "count=exact",
        Range: "0-0",
      }
    : {
        apikey: getAnonKey(),
        Authorization: `Bearer ${token}`,
        Prefer: "count=exact",
        Range: "0-0",
      };

  const response = await fetch(`${getSupabaseUrl()}/rest/v1/notifications?${query.toString()}`, {
    headers,
  });

  if (!response.ok) return 0;
  const contentRange = String(response.headers.get("content-range") || "");
  const total = Number(contentRange.split("/")[1]);
  return Number.isFinite(total) ? total : 0;
}

async function fetchUnreadMessageCount(userId, token) {
  const serviceKey = getServiceRoleKey();
  if (!userId) return 0;

  const query = new URLSearchParams({
    select: "id",
    recipient_id: `eq.${userId}`,
    read_at: "is.null",
  });

  const headers = serviceKey
    ? {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Prefer: "count=exact",
        Range: "0-0",
      }
    : {
        apikey: getAnonKey(),
        Authorization: `Bearer ${token}`,
        Prefer: "count=exact",
        Range: "0-0",
      };

  const response = await fetch(`${getSupabaseUrl()}/rest/v1/direct_messages?${query.toString()}`, {
    headers,
  });

  if (!response.ok) return 0;
  const contentRange = String(response.headers.get("content-range") || "");
  const total = Number(contentRange.split("/")[1]);
  return Number.isFinite(total) ? total : 0;
}

async function fetchHasPublishedArticles(userId, token) {
  if (!userId) return false;
  const serviceKey = getServiceRoleKey();
  const headers = serviceKey
    ? {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      }
    : {
        apikey: getAnonKey(),
        Authorization: `Bearer ${token}`,
      };

  const response = await fetch(
    `${getSupabaseUrl()}/rest/v1/articles?select=id&author_id=eq.${encodeURIComponent(userId)}&status=eq.published&limit=1`,
    { headers }
  );
  if (!response.ok) return false;
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) && rows.length > 0;
}

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  try {
    const { session, token } = await authenticateRequest(req);
    if (!session || !token) {
      res.statusCode = 401;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    const [profile, unreadNotificationCount, unreadMessageCount, hasPublishedArticles] = await Promise.all([
      fetchProfile(session, token),
      fetchUnreadNotificationCount(session.id, token),
      fetchUnreadMessageCount(session.id, token),
      fetchHasPublishedArticles(session.id, token),
    ]);
    const email = String(profile?.email || session.email || "");
    const displayName = String(
      profile?.display_name || session.user_metadata?.full_name || email || session.id
    );
    const role = String(profile?.role || "member").toLowerCase();
    const admin = role === "admin";
    const mediaBuckets = Array.isArray(profile?.media_buckets)
      ? profile.media_buckets.filter((bucket) => typeof bucket === "string" && bucket.trim())
      : [];
    const canManageMedia = Boolean(admin || (profile?.can_manage_media && mediaBuckets.length));
    const canUploadPhotos = Boolean(profile?.can_upload_photos || admin);
    const canEditMediaDetails = Boolean(profile?.can_edit_media_details || admin);
    const canRenameMedia = Boolean(profile?.can_rename_media || admin);
    const canDeleteMedia = Boolean(profile?.can_delete_media || admin);
    const canSubmitArticles = Boolean(profile?.can_submit_articles || admin);
    const canSelfPublishArticles = Boolean(profile?.can_self_publish_articles || admin);
    const canSelfPublishArticleEdits = Boolean(profile?.can_self_publish_article_edits || admin);
    const canReviewArticles = Boolean(profile?.can_review_articles || profile?.can_publish_articles || admin);
    const canPublishArticles = Boolean(profile?.can_publish_articles || admin);
    const notificationPreferences = {
      articleSubmissionsInternal: profile?.notify_article_submissions_internal !== false,
      articleSubmissionsEmail: profile?.notify_article_submissions_email !== false,
      articleReviewInternal: profile?.notify_article_review_internal !== false,
      articleReviewEmail: profile?.notify_article_review_email !== false,
      articlePublishingInternal: profile?.notify_article_publishing_internal !== false,
      articlePublishingEmail: profile?.notify_article_publishing_email !== false,
      adminArticleQueueInternal: profile?.notify_admin_article_queue_internal !== false,
      adminArticleQueueEmail: profile?.notify_admin_article_queue_email !== false,
      directMessagesInternal: profile?.notify_direct_messages_internal !== false,
      directMessagesEmail: profile?.notify_direct_messages_email !== false,
      showNameInMessages: hasPublishedArticles ? true : profile?.show_name_in_messages !== false,
    };

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        title: "My Account",
        intro: `Signed in as ${displayName}.`,
        admin,
        canManageMedia,
        canUploadPhotos,
        canEditMediaDetails,
        canRenameMedia,
        canDeleteMedia,
        canSubmitArticles,
        canSelfPublishArticles,
        canSelfPublishArticleEdits,
        canReviewArticles,
        canPublishArticles,
        unreadNotificationCount,
        unreadMessageCount,
        email,
        profile: {
          avatarPath: profile?.avatar_path || "",
          avatarUrl: profile?.avatar_path ? `/media/profile-photos/${profile.avatar_path}` : "",
          bio: profile?.bio || "",
          canManageMedia,
          createdAt: profile?.created_at || null,
          displayName,
          mediaBuckets,
          mediaPermissions: {
            canDeleteMedia,
            canEditMediaDetails,
            canRenameMedia,
            canUploadPhotos,
          },
          articlePermissions: {
            canPublishArticles,
            canReviewArticles,
            canSelfPublishArticleEdits,
            canSelfPublishArticles,
            canSubmitArticles,
          },
          notificationPreferences,
          onboardingComplete: profile?.onboarding_complete !== false,
          hasPublishedArticles,
          showNameInMessages: hasPublishedArticles ? true : profile?.show_name_in_messages !== false,
          unreadMessageCount,
          unreadNotificationCount,
          role,
        },
      })
    );
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: error.message || "Server error" }));
  }
};
