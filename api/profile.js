function getSupabaseUrl() {
  return String(process.env.SUPABASE_URL || "https://mgxdiolwevcgwgzhzttd.supabase.co").replace(/\/+$/, "");
}

function getAnonKey() {
  return String(process.env.SUPABASE_ANON_KEY || "").trim();
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

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body too large"));
      }
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

async function updateProfile(session, token, input) {
  const payload = {
    display_name: input.displayName,
    avatar_path: input.avatarPath,
    bio: input.bio,
    notify_article_submissions_internal: input.notificationPreferences.articleSubmissionsInternal,
    notify_article_submissions_email: input.notificationPreferences.articleSubmissionsEmail,
    notify_article_review_internal: input.notificationPreferences.articleReviewInternal,
    notify_article_review_email: input.notificationPreferences.articleReviewEmail,
    notify_article_publishing_internal: input.notificationPreferences.articlePublishingInternal,
    notify_article_publishing_email: input.notificationPreferences.articlePublishingEmail,
    notify_admin_article_queue_internal: input.notificationPreferences.adminArticleQueueInternal,
    notify_admin_article_queue_email: input.notificationPreferences.adminArticleQueueEmail,
    notify_direct_messages_internal: input.notificationPreferences.directMessagesInternal,
    notify_direct_messages_email: input.notificationPreferences.directMessagesEmail,
    show_name_in_messages: input.showNameInMessages,
    onboarding_complete: input.onboardingComplete,
  };

  const response = await fetch(
    `${getSupabaseUrl()}/rest/v1/profiles?id=eq.${encodeURIComponent(session.id)}`,
    {
      method: "PATCH",
      headers: {
        apikey: getAnonKey(),
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(payload),
    }
  );

  if (!response.ok) {
    throw new Error("Unable to save profile");
  }

  const rows = await response.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function hasPublishedArticles(session, token) {
  const response = await fetch(
    `${getSupabaseUrl()}/rest/v1/articles?select=id&author_id=eq.${encodeURIComponent(session.id)}&status=eq.published&limit=1`,
    {
      headers: {
        apikey: getAnonKey(),
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (!response.ok) return false;
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) && rows.length > 0;
}

module.exports = async (req, res) => {
  if (req.method !== "PATCH") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  try {
    const { session, token } = await authenticateRequest(req);
    if (!session || !token) {
      sendJson(res, 401, { error: "Unauthorized" });
      return;
    }

    const body = await parseJsonBody(req);
    const displayName = String(body?.displayName || "").trim().slice(0, 80);
    const bio = String(body?.bio || "").trim().slice(0, 500);
    const avatarPath = body?.avatarPath == null ? null : String(body.avatarPath).trim().slice(0, 255);
    const notificationPreferences = {
      articleSubmissionsInternal: body?.notificationPreferences?.articleSubmissionsInternal !== false,
      articleSubmissionsEmail: body?.notificationPreferences?.articleSubmissionsEmail !== false,
      articleReviewInternal: body?.notificationPreferences?.articleReviewInternal !== false,
      articleReviewEmail: body?.notificationPreferences?.articleReviewEmail !== false,
      articlePublishingInternal: body?.notificationPreferences?.articlePublishingInternal !== false,
      articlePublishingEmail: body?.notificationPreferences?.articlePublishingEmail !== false,
      adminArticleQueueInternal: body?.notificationPreferences?.adminArticleQueueInternal !== false,
      adminArticleQueueEmail: body?.notificationPreferences?.adminArticleQueueEmail !== false,
      directMessagesInternal: body?.notificationPreferences?.directMessagesInternal !== false,
      directMessagesEmail: body?.notificationPreferences?.directMessagesEmail !== false,
      showNameInMessages: body?.notificationPreferences?.showNameInMessages !== false,
    };
    const onboardingComplete = body?.onboardingComplete === true;

    if (!displayName) {
      sendJson(res, 400, { error: "Public name is required" });
      return;
    }

    const publishedArticles = await hasPublishedArticles(session, token);
    const profile = await updateProfile(session, token, {
      displayName,
      bio,
      avatarPath,
      notificationPreferences,
      showNameInMessages: publishedArticles ? true : notificationPreferences.showNameInMessages,
      onboardingComplete,
    });
    sendJson(res, 200, {
      ok: true,
      profile: {
        avatarPath: profile?.avatar_path || "",
        avatarUrl: profile?.avatar_path ? `/media/profile-photos/${profile.avatar_path}` : "",
        displayName: profile?.display_name || displayName,
        bio: profile?.bio || "",
        hasPublishedArticles: publishedArticles,
        onboardingComplete: profile?.onboarding_complete !== false,
        showNameInMessages: publishedArticles ? true : profile?.show_name_in_messages !== false,
        notificationPreferences: {
          ...notificationPreferences,
          showNameInMessages: publishedArticles ? true : profile?.show_name_in_messages !== false,
        },
      },
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Server error" });
  }
};
