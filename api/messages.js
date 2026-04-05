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

function buildServiceHeaders() {
  const serviceKey = getServiceRoleKey();
  if (!serviceKey) return null;
  return {
    "Content-Type": "application/json",
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
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

function summarizeText(value, maxLength = 160) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1).trim()}…`;
}

function sortUserPair(a, b) {
  return [String(a || "").trim(), String(b || "").trim()].sort((left, right) => left.localeCompare(right));
}

function avatarUrl(path) {
  const cleaned = String(path || "").trim();
  return cleaned ? `/media/profile-photos/${cleaned}` : "";
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

async function fetchProfileById(userId, token = "") {
  const headers = buildServiceHeaders() || buildUserHeaders(token);
  const query = new URLSearchParams({
    select: "id,email,display_name,avatar_path,bio,show_name_in_messages,notify_direct_messages_internal,notify_direct_messages_email",
    id: `eq.${userId}`,
    limit: "1",
  });
  const response = await fetch(`${getSupabaseUrl()}/rest/v1/profiles?${query.toString()}`, {
    headers,
  });
  if (!response.ok) throw new Error("Unable to load member profile");
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function fetchProfilesByIds(ids, token = "") {
  const normalizedIds = Array.from(new Set((ids || []).map((id) => String(id || "").trim()).filter(Boolean)));
  if (!normalizedIds.length) return new Map();
  const headers = buildServiceHeaders() || buildUserHeaders(token);
  const query = new URLSearchParams({
    select: "id,email,display_name,avatar_path,bio,show_name_in_messages,notify_direct_messages_internal,notify_direct_messages_email",
    id: `in.(${normalizedIds.join(",")})`,
  });
  const response = await fetch(`${getSupabaseUrl()}/rest/v1/profiles?${query.toString()}`, {
    headers,
  });
  if (!response.ok) throw new Error("Unable to load member profiles");
  const rows = await response.json().catch(() => []);
  return new Map((Array.isArray(rows) ? rows : []).map((row) => [String(row.id || ""), row]));
}

async function fetchVisibleMessageMembers(userId, token = "") {
  const headers = buildServiceHeaders() || buildUserHeaders(token);
  const query = new URLSearchParams({
    select: "id,display_name,avatar_path,bio,show_name_in_messages",
    id: `neq.${userId}`,
    order: "display_name.asc.nullslast",
  });
  const response = await fetch(`${getSupabaseUrl()}/rest/v1/profiles?${query.toString()}`, {
    headers,
  });
  if (!response.ok) throw new Error("Unable to load members");
  const rows = await response.json().catch(() => []);
  const profiles = Array.isArray(rows) ? rows : [];
  const publishedAuthorIds = await fetchPublishedArticleAuthorIds(profiles.map((profile) => profile.id), token);
  return profiles
    .filter((profile) => publishedAuthorIds.has(String(profile.id || "").trim()) || profile.show_name_in_messages !== false)
    .map((profile) => serializeMember(profile, {
      hasPublishedArticles: publishedAuthorIds.has(String(profile.id || "").trim()),
    }));
}

async function fetchPublishedArticleAuthorIds(ids, token = "") {
  const normalizedIds = Array.from(new Set((ids || []).map((id) => String(id || "").trim()).filter(Boolean)));
  if (!normalizedIds.length) return new Set();
  const headers = buildServiceHeaders() || buildUserHeaders(token);
  const query = new URLSearchParams({
    select: "author_id",
    status: "eq.published",
    author_id: `in.(${normalizedIds.join(",")})`,
  });
  const response = await fetch(`${getSupabaseUrl()}/rest/v1/articles?${query.toString()}`, {
    headers,
  });
  if (!response.ok) throw new Error("Unable to load published article authors");
  const rows = await response.json().catch(() => []);
  return new Set((Array.isArray(rows) ? rows : []).map((row) => String(row.author_id || "").trim()).filter(Boolean));
}

function resolveMessageDisplay(profile, hasPublishedArticles = false) {
  if (!profile) {
    return {
      displayName: "Bly member",
      bio: "",
      nameVisibleInMessages: false,
    };
  }
  const nameVisibleInMessages = hasPublishedArticles || profile.show_name_in_messages !== false;
  return {
    displayName: nameVisibleInMessages ? (profile.display_name || "Bly member") : "Bly member",
    bio: nameVisibleInMessages ? (profile.bio || "") : "",
    nameVisibleInMessages,
  };
}

function serializeMember(profile, options = {}) {
  const resolved = resolveMessageDisplay(profile, options.hasPublishedArticles);
  return {
    id: profile?.id || "",
    displayName: resolved.displayName,
    avatarPath: profile?.avatar_path || "",
    avatarUrl: avatarUrl(profile?.avatar_path),
    bio: resolved.bio,
    nameVisibleInMessages: resolved.nameVisibleInMessages,
  };
}

async function fetchThreadByParticipants(userId, otherUserId, token = "") {
  const [userOneId, userTwoId] = sortUserPair(userId, otherUserId);
  const headers = buildServiceHeaders() || buildUserHeaders(token);
  const query = new URLSearchParams({
    select: "id,user_one_id,user_two_id,created_at,updated_at,last_message_at",
    user_one_id: `eq.${userOneId}`,
    user_two_id: `eq.${userTwoId}`,
    limit: "1",
  });
  const response = await fetch(`${getSupabaseUrl()}/rest/v1/direct_threads?${query.toString()}`, {
    headers,
  });
  if (!response.ok) throw new Error("Unable to load message thread");
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function createThread(userId, otherUserId) {
  const headers = buildServiceHeaders();
  if (!headers) throw new Error("Missing service role configuration");
  const [userOneId, userTwoId] = sortUserPair(userId, otherUserId);
  const payload = {
    user_one_id: userOneId,
    user_two_id: userTwoId,
    updated_at: new Date().toISOString(),
    last_message_at: new Date().toISOString(),
  };
  const response = await fetch(`${getSupabaseUrl()}/rest/v1/direct_threads`, {
    method: "POST",
    headers: {
      ...headers,
      Prefer: "return=representation,resolution=merge-duplicates",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("Unable to create message thread");
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) && rows.length ? rows[0] : fetchThreadByParticipants(userId, otherUserId);
}

async function fetchThreadsForUser(userId, token = "") {
  const headers = buildServiceHeaders() || buildUserHeaders(token);
  const query = new URLSearchParams({
    select: "id,user_one_id,user_two_id,created_at,updated_at,last_message_at",
    or: `(user_one_id.eq.${userId},user_two_id.eq.${userId})`,
    order: "last_message_at.desc",
  });
  const response = await fetch(`${getSupabaseUrl()}/rest/v1/direct_threads?${query.toString()}`, {
    headers,
  });
  if (!response.ok) throw new Error("Unable to load messages");
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function fetchMessagesForThread(threadId, token = "") {
  const headers = buildServiceHeaders() || buildUserHeaders(token);
  const query = new URLSearchParams({
    select: "id,thread_id,sender_id,recipient_id,body,read_at,created_at",
    thread_id: `eq.${threadId}`,
    order: "created_at.asc",
  });
  const response = await fetch(`${getSupabaseUrl()}/rest/v1/direct_messages?${query.toString()}`, {
    headers,
  });
  if (!response.ok) throw new Error("Unable to load messages");
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function fetchUnreadCountsForThreads(userId, threadIds, token = "") {
  const normalized = Array.from(new Set((threadIds || []).map((id) => String(id || "").trim()).filter(Boolean)));
  if (!normalized.length) return new Map();
  const headers = buildServiceHeaders() || buildUserHeaders(token);
  const query = new URLSearchParams({
    select: "thread_id",
    recipient_id: `eq.${userId}`,
    read_at: "is.null",
    thread_id: `in.(${normalized.join(",")})`,
  });
  const response = await fetch(`${getSupabaseUrl()}/rest/v1/direct_messages?${query.toString()}`, {
    headers,
  });
  if (!response.ok) throw new Error("Unable to load unread messages");
  const rows = await response.json().catch(() => []);
  const counts = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const key = String(row.thread_id || "").trim();
    counts.set(key, Number(counts.get(key) || 0) + 1);
  });
  return counts;
}

async function insertMessage({ threadId, senderId, recipientId, body }) {
  const headers = buildServiceHeaders();
  if (!headers) throw new Error("Missing service role configuration");
  const response = await fetch(`${getSupabaseUrl()}/rest/v1/direct_messages`, {
    method: "POST",
    headers: {
      ...headers,
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      thread_id: threadId,
      sender_id: senderId,
      recipient_id: recipientId,
      body,
    }),
  });
  if (!response.ok) throw new Error("Unable to send message");
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function updateThreadTimestamp(threadId, timestamp) {
  const headers = buildServiceHeaders();
  if (!headers) throw new Error("Missing service role configuration");
  const query = new URLSearchParams({ id: `eq.${threadId}` });
  const response = await fetch(`${getSupabaseUrl()}/rest/v1/direct_threads?${query.toString()}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      updated_at: timestamp,
      last_message_at: timestamp,
    }),
  });
  if (!response.ok) throw new Error("Unable to update thread");
}

async function markThreadRead(threadId, userId, token = "") {
  const headers = buildServiceHeaders() || buildUserHeaders(token);
  const query = new URLSearchParams({
    thread_id: `eq.${threadId}`,
    recipient_id: `eq.${userId}`,
    read_at: "is.null",
  });
  const response = await fetch(`${getSupabaseUrl()}/rest/v1/direct_messages?${query.toString()}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      read_at: new Date().toISOString(),
    }),
  });
  if (!response.ok) throw new Error("Unable to update message thread");
}

async function insertNotifications(rows) {
  if (!rows.length) return;
  const headers = buildServiceHeaders();
  if (!headers) return;
  const response = await fetch(`${getSupabaseUrl()}/rest/v1/notifications`, {
    method: "POST",
    headers: {
      ...headers,
      Prefer: "return=minimal",
    },
    body: JSON.stringify(rows),
  });
  if (!response.ok) throw new Error("Unable to store notifications");
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
  if (!response.ok) throw new Error("Unable to send email");
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

function serializeMessage(row) {
  return {
    id: row.id,
    threadId: row.thread_id || "",
    senderId: row.sender_id || "",
    recipientId: row.recipient_id || "",
    body: row.body || "",
    readAt: row.read_at || null,
    createdAt: row.created_at || null,
  };
}

async function buildThreadsPayload(userId, token = "") {
  const threads = await fetchThreadsForUser(userId, token);
  const threadIds = threads.map((thread) => String(thread.id || "").trim()).filter(Boolean);
  const counterpartIds = threads.map((thread) => {
    const userOneId = String(thread.user_one_id || "").trim();
    const userTwoId = String(thread.user_two_id || "").trim();
    return userOneId === userId ? userTwoId : userOneId;
  }).filter(Boolean);
  const [profiles, unreadCounts] = await Promise.all([
    fetchProfilesByIds(counterpartIds, token),
    fetchUnreadCountsForThreads(userId, threadIds, token),
  ]);
  const publishedAuthorIds = await fetchPublishedArticleAuthorIds(counterpartIds, token);
  const latestMessages = new Map();
  await Promise.all(
    threads.map(async (thread) => {
      const rows = await fetchMessagesForThread(thread.id, token);
      latestMessages.set(String(thread.id || ""), rows.length ? rows[rows.length - 1] : null);
    })
  );

  return threads.map((thread) => {
    const threadId = String(thread.id || "").trim();
    const userOneId = String(thread.user_one_id || "").trim();
    const userTwoId = String(thread.user_two_id || "").trim();
    const counterpartId = userOneId === userId ? userTwoId : userOneId;
    const counterpart = profiles.get(counterpartId) || null;
    const latest = latestMessages.get(threadId);
    return {
      id: threadId,
      counterpart: serializeMember(counterpart, {
        hasPublishedArticles: publishedAuthorIds.has(counterpartId),
      }),
      preview: summarizeText(latest?.body || ""),
      unreadCount: Number(unreadCounts.get(threadId) || 0),
      updatedAt: thread.last_message_at || thread.updated_at || thread.created_at || null,
      latestMessageAt: latest?.created_at || thread.last_message_at || null,
    };
  });
}

module.exports = async (req, res) => {
  try {
    const { session, token } = await authenticateRequest(req);
    if (!session || !token) {
      sendJson(res, 401, { error: "Unauthorized" });
      return;
    }

    if (req.method === "GET") {
      const url = new URL(req.url, `https://${getHeaderValue(req, "host") || "blyoregon.org"}`);
      const counterpartId = String(url.searchParams.get("with") || "").trim();
      const threadIdParam = String(url.searchParams.get("thread") || "").trim();
      const [threads, availableMembers] = await Promise.all([
        buildThreadsPayload(session.id, token),
        fetchVisibleMessageMembers(session.id, token),
      ]);

      let activeThread = null;
      let activeMessages = [];
      let counterpartProfile = null;
      let publishedAuthorIds = new Set();

      if (counterpartId) {
        if (counterpartId === session.id) {
          sendJson(res, 400, { error: "You cannot message yourself" });
          return;
        }
        counterpartProfile = await fetchProfileById(counterpartId, token);
        if (!counterpartProfile) {
          sendJson(res, 404, { error: "Member not found" });
          return;
        }
        publishedAuthorIds = await fetchPublishedArticleAuthorIds([counterpartId], token);
        const existing = await fetchThreadByParticipants(session.id, counterpartId, token);
        if (existing) {
          activeThread = existing;
          activeMessages = await fetchMessagesForThread(existing.id, token);
        } else {
          activeThread = {
            id: "",
            counterpart: serializeMember(counterpartProfile, {
              hasPublishedArticles: publishedAuthorIds.has(counterpartId),
            }),
          };
        }
      } else if (threadIdParam) {
        const activeSummary = threads.find((thread) => thread.id === threadIdParam);
        if (activeSummary) {
          activeThread = {
            id: activeSummary.id,
            user_one_id: activeSummary.counterpart.id === session.id ? "" : session.id,
            user_two_id: activeSummary.counterpart.id,
          };
          counterpartProfile = await fetchProfileById(activeSummary.counterpart.id, token);
          publishedAuthorIds = await fetchPublishedArticleAuthorIds([activeSummary.counterpart.id], token);
          activeMessages = await fetchMessagesForThread(threadIdParam, token);
        }
      } else if (threads.length) {
        const firstThread = threads[0];
        counterpartProfile = await fetchProfileById(firstThread.counterpart.id, token);
        publishedAuthorIds = await fetchPublishedArticleAuthorIds([firstThread.counterpart.id], token);
        activeMessages = await fetchMessagesForThread(firstThread.id, token);
        activeThread = {
          id: firstThread.id,
          user_one_id: session.id,
          user_two_id: firstThread.counterpart.id,
        };
      }

      const senderIds = Array.from(new Set(activeMessages.map((message) => String(message.sender_id || "").trim()).filter(Boolean)));
      const senderProfiles = await fetchProfilesByIds(senderIds, token);
      const senderPublishedIds = await fetchPublishedArticleAuthorIds(senderIds, token);

      sendJson(res, 200, {
        threads,
        activeThread: activeThread
          ? {
              id: String(activeThread.id || "").trim(),
              counterpart: activeThread.counterpart || serializeMember(counterpartProfile, {
                hasPublishedArticles: publishedAuthorIds.has(String(counterpartProfile?.id || "").trim()),
              }),
            }
          : null,
        messages: activeMessages.map((message) => {
          const serialized = serializeMessage(message);
          const senderId = String(message.sender_id || "").trim();
          const senderProfile = senderProfiles.get(senderId) || null;
          const senderDisplay = resolveMessageDisplay(senderProfile, senderPublishedIds.has(senderId));
          return {
            ...serialized,
            senderName: senderId === session.id ? "You" : senderDisplay.displayName,
          };
        }),
        availableMembers,
        unreadCount: threads.reduce((sum, thread) => sum + Number(thread.unreadCount || 0), 0),
      });
      return;
    }

    if (req.method === "POST") {
      const body = await parseJsonBody(req);
      const recipientId = String(body?.recipientId || "").trim();
      const messageBody = String(body?.body || "").trim().slice(0, 4000);
      if (!recipientId || !messageBody) {
        sendJson(res, 400, { error: "Recipient and message are required" });
        return;
      }
      if (recipientId === session.id) {
        sendJson(res, 400, { error: "You cannot message yourself" });
        return;
      }

      const [senderProfile, recipientProfile] = await Promise.all([
        fetchProfileById(session.id, token),
        fetchProfileById(recipientId, token),
      ]);
      if (!senderProfile || !recipientProfile) {
        sendJson(res, 404, { error: "Member not found" });
        return;
      }

      const existingThread = await fetchThreadByParticipants(session.id, recipientId, token);
      const thread = existingThread || await createThread(session.id, recipientId);
      const message = await insertMessage({
        threadId: thread.id,
        senderId: session.id,
        recipientId,
        body: messageBody,
      });
      const timestamp = message?.created_at || new Date().toISOString();
      await updateThreadTimestamp(thread.id, timestamp);

      const siteUrl = getSiteUrl(req);
      const messageUrl = `${siteUrl}/account/messages/?thread=${encodeURIComponent(thread.id)}`;
      const publishedAuthorIds = await fetchPublishedArticleAuthorIds([session.id, recipientId], token);
      const senderName = resolveMessageDisplay(senderProfile, publishedAuthorIds.has(session.id)).displayName || senderProfile.email || "A Bly member";
      const recipientPrefs = {
        internal: recipientProfile.notify_direct_messages_internal !== false,
        email: recipientProfile.notify_direct_messages_email !== false,
      };

      if (recipientPrefs.internal) {
        try {
          await insertNotifications([{
            user_id: recipientId,
            actor_id: session.id,
            type: "direct_message",
            title: "New message",
            body: `${senderName} sent you a message: ${summarizeText(messageBody, 120)}`,
            link: `/account/messages/?thread=${encodeURIComponent(thread.id)}`,
            entity_type: "direct_thread",
            entity_id: thread.id,
            metadata: {
              threadId: thread.id,
              senderId: session.id,
            },
          }]);
        } catch (error) {
          console.warn(error);
        }
      }

      if (recipientPrefs.email && recipientProfile.email && getEnv("RESEND_API_KEY")) {
        try {
          await sendEmail({
            to: [recipientProfile.email],
            from: getEnv("RESEND_FROM_EMAIL", "noreply@blyoregon.org"),
            subject: `[Bly, Oregon] New message from ${senderName}`,
            html: renderEmailShell({
              eyebrow: "Direct message",
              title: "You received a new message",
              intro: `${escapeHtml(senderName)} sent you a direct message through Bly, Oregon.`,
              bodyHtml: `<p>${escapeHtml(summarizeText(messageBody, 280))}</p>`,
              actionLabel: "Open messages",
              actionUrl: messageUrl,
            }),
            text: `${senderName} sent you a message:\n\n${summarizeText(messageBody, 280)}\n\nOpen messages: ${messageUrl}`,
          });
        } catch (error) {
          console.warn(error);
        }
      }

      const messages = await fetchMessagesForThread(thread.id, token);
      sendJson(res, 200, {
        ok: true,
        thread: {
          id: String(thread.id || "").trim(),
          counterpart: serializeMember(recipientProfile, {
            hasPublishedArticles: publishedAuthorIds.has(recipientId),
          }),
        },
        messages: messages.map((row) => {
          const serialized = serializeMessage(row);
          const senderId = String(row.sender_id || "").trim();
          const profile = senderId === session.id ? senderProfile : recipientProfile;
          const senderDisplay = resolveMessageDisplay(profile, publishedAuthorIds.has(senderId));
          return {
            ...serialized,
            senderName: senderId === session.id ? "You" : senderDisplay.displayName,
          };
        }),
      });
      return;
    }

    if (req.method === "PATCH") {
      const body = await parseJsonBody(req);
      const action = String(body?.action || "").trim();
      if (action !== "mark_thread_read") {
        sendJson(res, 400, { error: "Invalid action" });
        return;
      }
      const threadId = String(body?.threadId || "").trim();
      if (!threadId) {
        sendJson(res, 400, { error: "Missing thread id" });
        return;
      }
      await markThreadRead(threadId, session.id, token);
      sendJson(res, 200, { ok: true });
      return;
    }

    sendJson(res, 405, { error: "Method not allowed" });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Server error" });
  }
};
