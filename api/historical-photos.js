const DEFAULT_SUPABASE_URL = "https://mgxdiolwevcgwgzhzttd.supabase.co";
const IMAGE_EXTENSIONS = /\.(avif|gif|jpe?g|png|webp)$/i;

function getHeaderValue(req, name) {
  const value = req.headers?.[name];
  return Array.isArray(value) ? value[0] : value;
}

function getSupabaseUrl() {
  return String(process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/+$/, "");
}

function getAnonKey() {
  return String(process.env.SUPABASE_ANON_KEY || "").trim();
}

function buildHeaders(token) {
  const anonKey = getAnonKey();
  const headers = {
    "Content-Type": "application/json",
  };
  if (anonKey) {
    headers.apikey = anonKey;
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  } else if (anonKey) {
    headers.Authorization = `Bearer ${anonKey}`;
  }
  return headers;
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

function deriveTitle(name) {
  return String(name || "")
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseTaggedPeople(input) {
  const rawValues = Array.isArray(input)
    ? input
    : String(input || "").split(",");
  const seen = new Set();
  const people = [];
  rawValues.forEach((value) => {
    const name = String(value || "").trim().replace(/\s+/g, " ");
    if (!name) return;
    const slug = slugify(name);
    if (!slug || seen.has(slug)) return;
    seen.add(slug);
    people.push({ slug, name });
  });
  return people;
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
  const query = new URLSearchParams({
    select: "id,role,can_manage_media,can_edit_media_details,media_buckets",
    id: `eq.${session.id}`,
  });

  const response = await fetch(`${getSupabaseUrl()}/rest/v1/profiles?${query.toString()}`, {
    headers: buildHeaders(token),
  });

  if (!response.ok) throw new Error("Unable to load account profile");
  const rows = await response.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

function canEditBucket(profile, bucket) {
  const role = String(profile?.role || "").toLowerCase();
  if (role === "admin") return true;
  const buckets = Array.isArray(profile?.media_buckets) ? profile.media_buckets : [];
  return Boolean(profile?.can_manage_media && profile?.can_edit_media_details && buckets.includes(bucket));
}

async function listBucketFiles(bucket) {
  const response = await fetch(`${getSupabaseUrl()}/storage/v1/object/list/${encodeURIComponent(bucket)}`, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify({
      limit: 1000,
      offset: 0,
      prefix: "",
      sortBy: {
        column: "name",
        order: "asc",
      },
    }),
  });

  if (!response.ok) {
    throw new Error("Unable to list historical photos");
  }

  const items = await response.json();
  return Array.isArray(items)
    ? items
        .map((item) => String(item?.name || "").trim())
        .filter((name) => name && IMAGE_EXTENSIONS.test(name))
    : [];
}

async function fetchPhotoMetadata(bucket) {
  const query = new URLSearchParams({
    select: "id,bucket_id,storage_path,title,caption,story,notes,source,photographer,location,taken_on,sort_order,published",
    bucket_id: `eq.${bucket}`,
    order: "sort_order.asc",
  });

  const response = await fetch(`${getSupabaseUrl()}/rest/v1/historical_photos?${query.toString()}`, {
    headers: buildHeaders(),
  });

  if (!response.ok) {
    return null;
  }

  const rows = await response.json();
  return Array.isArray(rows) ? rows : [];
}

async function fetchPhotoRecord(storagePath, token) {
  const query = new URLSearchParams({
    select: "id,bucket_id,storage_path,title,caption,story,notes,source,photographer,location,taken_on,sort_order,published",
    storage_path: `eq.${storagePath}`,
  });

  const response = await fetch(`${getSupabaseUrl()}/rest/v1/historical_photos?${query.toString()}`, {
    headers: buildHeaders(token),
  });

  if (!response.ok) throw new Error("Unable to load historical photo record");
  const rows = await response.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function fetchPhotoPeople(photoId, token) {
  const query = new URLSearchParams({
    select: "sort_order,label,person:historical_people(id,slug,name)",
    photo_id: `eq.${photoId}`,
    order: "sort_order.asc",
  });

  const response = await fetch(`${getSupabaseUrl()}/rest/v1/historical_photo_people?${query.toString()}`, {
    headers: buildHeaders(token),
  });

  if (!response.ok) throw new Error("Unable to load tagged people");
  const rows = await response.json();
  return Array.isArray(rows) ? rows : [];
}

async function ensurePeople(people, token) {
  const ensured = [];

  for (const person of people) {
    const selectQuery = new URLSearchParams({
      select: "id,slug,name",
      slug: `eq.${person.slug}`,
    });
    const existingResponse = await fetch(`${getSupabaseUrl()}/rest/v1/historical_people?${selectQuery.toString()}`, {
      headers: buildHeaders(token),
    });
    if (!existingResponse.ok) throw new Error("Unable to load tagged people");
    const existingRows = await existingResponse.json();
    if (Array.isArray(existingRows) && existingRows.length) {
      ensured.push(existingRows[0]);
      continue;
    }

    const createResponse = await fetch(`${getSupabaseUrl()}/rest/v1/historical_people`, {
      method: "POST",
      headers: {
        ...buildHeaders(token),
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        slug: person.slug,
        name: person.name,
      }),
    });
    if (!createResponse.ok) throw new Error("Unable to create tagged person");
    const createdRows = await createResponse.json();
    ensured.push(Array.isArray(createdRows) && createdRows.length ? createdRows[0] : { slug: person.slug, name: person.name });
  }

  return ensured;
}

async function replacePhotoPeople(photoId, people, token) {
  const deleteQuery = new URLSearchParams({
    photo_id: `eq.${photoId}`,
  });
  const deleteResponse = await fetch(`${getSupabaseUrl()}/rest/v1/historical_photo_people?${deleteQuery.toString()}`, {
    method: "DELETE",
    headers: buildHeaders(token),
  });
  if (!deleteResponse.ok) throw new Error("Unable to update tagged people");

  if (!people.length) return [];
  const ensuredPeople = await ensurePeople(people, token);
  const insertResponse = await fetch(`${getSupabaseUrl()}/rest/v1/historical_photo_people`, {
    method: "POST",
    headers: buildHeaders(token),
    body: JSON.stringify(
      ensuredPeople.map((person, index) => ({
        photo_id: photoId,
        person_id: person.id,
        sort_order: index,
      }))
    ),
  });
  if (!insertResponse.ok) throw new Error("Unable to save tagged people");
  return ensuredPeople;
}

async function upsertPhotoRecord(storagePath, input, token, userId) {
  const existing = await fetchPhotoRecord(storagePath, token);
  const payload = {
    bucket_id: input.bucket,
    storage_path: storagePath,
    title: input.title,
    caption: input.caption,
    story: input.story,
    notes: input.notes,
    source: input.source,
    photographer: input.photographer,
    location: input.location,
    taken_on: input.takenOn || null,
    sort_order: input.sortOrder,
    published: input.published,
    created_by: existing?.created_by || userId,
  };

  if (existing?.id) {
    const updateResponse = await fetch(`${getSupabaseUrl()}/rest/v1/historical_photos?id=eq.${existing.id}`, {
      method: "PATCH",
      headers: {
        ...buildHeaders(token),
        Prefer: "return=representation",
      },
      body: JSON.stringify(payload),
    });
    if (!updateResponse.ok) throw new Error("Unable to save historical photo");
    const rows = await updateResponse.json();
    return Array.isArray(rows) && rows.length ? rows[0] : existing;
  }

  const createResponse = await fetch(`${getSupabaseUrl()}/rest/v1/historical_photos`, {
    method: "POST",
    headers: {
      ...buildHeaders(token),
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });
  if (!createResponse.ok) throw new Error("Unable to create historical photo");
  const rows = await createResponse.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

function buildPublicPhoto(bucket, name, metadata, index) {
  return {
    id: metadata?.id || `${bucket}/${name}`,
    bucket,
    name,
    storagePath: `${bucket}/${name}`,
    imageUrl: `/media/${bucket}/${encodeURIComponent(name)}`,
    title: String(metadata?.title || deriveTitle(name) || "Historical photo"),
    caption: String(metadata?.caption || "").trim(),
    story: String(metadata?.story || "").trim(),
    notes: String(metadata?.notes || "").trim(),
    source: String(metadata?.source || "").trim(),
    photographer: String(metadata?.photographer || "").trim(),
    location: String(metadata?.location || "").trim(),
    takenOn: metadata?.taken_on || null,
    sortOrder: Number.isFinite(Number(metadata?.sort_order)) ? Number(metadata.sort_order) : 100000 + index,
  };
}

module.exports = async (req, res) => {
  const requestUrl = new URL(req.url, `https://${getHeaderValue(req, "host") || "blyoregon.org"}`);
  const bucket = String(requestUrl.searchParams.get("bucket") || "").trim();
  const name = String(requestUrl.searchParams.get("name") || "").trim();

  if (!bucket) {
    sendJson(res, 400, { error: "Missing bucket" });
    return;
  }

  if (req.method === "GET" && !name) {
    try {
      const [files, metadataRows] = await Promise.all([
        listBucketFiles(bucket),
        fetchPhotoMetadata(bucket),
      ]);

      const metadataByPath = new Map(
        Array.isArray(metadataRows)
          ? metadataRows.map((row) => [String(row.storage_path || "").trim(), row])
          : []
      );

      const photos = files
        .map((fileName, index) => {
          const storagePath = `${bucket}/${fileName}`;
          const metadata = metadataByPath.get(storagePath) || null;
          if (metadata && metadata.published === false) {
            return null;
          }
          return buildPublicPhoto(bucket, fileName, metadata, index);
        })
        .filter(Boolean)
        .sort((a, b) => {
          if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
          return a.name.localeCompare(b.name);
        });

      res.statusCode = 200;
      res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=3600");
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(photos));
      return;
    } catch (error) {
      sendJson(res, 500, { error: error.message || "Server error" });
      return;
    }
  }

  try {
    const { session, token } = await authenticateRequest(req);
    if (!session || !token) {
      sendJson(res, 401, { error: "Unauthorized" });
      return;
    }

    const ownProfile = await fetchOwnProfile(session, token);
    if (!canEditBucket(ownProfile, bucket)) {
      sendJson(res, 403, { error: "Forbidden" });
      return;
    }

    const storagePath = name ? `${bucket}/${name}` : "";

    if (req.method === "GET") {
      if (!name) {
        sendJson(res, 400, { error: "Missing name" });
        return;
      }

      const photo = await fetchPhotoRecord(storagePath, token);
      const taggedPeople = photo?.id ? await fetchPhotoPeople(photo.id, token) : [];

      sendJson(res, 200, {
        photo: {
          bucket,
          name,
          storagePath,
          imageUrl: `/media/${bucket}/${encodeURIComponent(name)}`,
          id: photo?.id || "",
          title: String(photo?.title || deriveTitle(name) || "Historical photo"),
          caption: String(photo?.caption || "").trim(),
          story: String(photo?.story || "").trim(),
          notes: String(photo?.notes || "").trim(),
          source: String(photo?.source || "").trim(),
          photographer: String(photo?.photographer || "").trim(),
          location: String(photo?.location || "").trim(),
          takenOn: photo?.taken_on || "",
          sortOrder: Number.isFinite(Number(photo?.sort_order)) ? Number(photo.sort_order) : 0,
          published: photo?.published !== false,
          taggedPeople: taggedPeople
            .map((row) => String(row?.person?.name || "").trim())
            .filter(Boolean),
        },
      });
      return;
    }

    if (req.method === "PATCH") {
      if (!name) {
        sendJson(res, 400, { error: "Missing name" });
        return;
      }

      const body = await parseJsonBody(req);
      const title = String(body?.title || "").trim().slice(0, 160);
      const caption = String(body?.caption || "").trim().slice(0, 500);
      const story = String(body?.story || "").trim().slice(0, 5000);
      const notes = String(body?.notes || "").trim().slice(0, 3000);
      const source = String(body?.source || "").trim().slice(0, 255);
      const photographer = String(body?.photographer || "").trim().slice(0, 255);
      const location = String(body?.location || "").trim().slice(0, 255);
      const takenOn = String(body?.takenOn || "").trim().slice(0, 10);
      const sortOrder = Number.isFinite(Number(body?.sortOrder)) ? Number(body.sortOrder) : 0;
      const published = body?.published !== false;
      const taggedPeople = parseTaggedPeople(body?.taggedPeople);

      const savedPhoto = await upsertPhotoRecord(
        storagePath,
        {
          bucket,
          title,
          caption,
          story,
          notes,
          source,
          photographer,
          location,
          takenOn,
          sortOrder,
          published,
        },
        token,
        session.id
      );

      const ensuredPeople = savedPhoto?.id
        ? await replacePhotoPeople(savedPhoto.id, taggedPeople, token)
        : [];

      sendJson(res, 200, {
        ok: true,
        photo: {
          id: savedPhoto?.id || "",
          bucket,
          name,
          storagePath,
          imageUrl: `/media/${bucket}/${encodeURIComponent(name)}`,
          title: String(savedPhoto?.title || title || deriveTitle(name) || "Historical photo"),
          caption: String(savedPhoto?.caption || caption).trim(),
          story: String(savedPhoto?.story || story).trim(),
          notes: String(savedPhoto?.notes || notes).trim(),
          source: String(savedPhoto?.source || source).trim(),
          photographer: String(savedPhoto?.photographer || photographer).trim(),
          location: String(savedPhoto?.location || location).trim(),
          takenOn: savedPhoto?.taken_on || takenOn || "",
          sortOrder: Number.isFinite(Number(savedPhoto?.sort_order)) ? Number(savedPhoto.sort_order) : sortOrder,
          published: savedPhoto?.published !== false,
          taggedPeople: ensuredPeople.map((person) => person.name),
        },
      });
      return;
    }

    sendJson(res, 405, { error: "Method not allowed" });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Server error" });
  }
};
