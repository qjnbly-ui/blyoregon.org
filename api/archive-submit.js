function getEnv(name, fallback = "") {
  return String(process.env[name] || fallback).trim();
}

function getRecipientEmail() {
  const explicit = getEnv("CONTACT_TO_EMAIL");
  if (explicit) return explicit;

  const adminEmails = getEnv("ADMIN_EMAILS");
  if (adminEmails) {
    const first = adminEmails.split(",").map((value) => value.trim()).filter(Boolean)[0];
    if (first) return first;
  }

  return "quentin@quentinnichols.com";
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const buffers = [];
  for await (const chunk of req) buffers.push(chunk);
  if (!buffers.length) return {};
  return JSON.parse(Buffer.concat(buffers).toString("utf8"));
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  try {
    const body = await readJsonBody(req);
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim();
    const category = String(body.category || "").trim();
    const details = String(body.details || "").trim();
    const photo = body.photo && typeof body.photo === "object" ? body.photo : null;

    if (!name || !email || !category || !details) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Missing required fields" }));
      return;
    }

    const resendKey = getEnv("RESEND_API_KEY");
    if (!resendKey) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Missing RESEND_API_KEY" }));
      return;
    }

    const attachments = [];
    if (photo?.filename && photo?.content) {
      attachments.push({
        filename: String(photo.filename).slice(0, 200),
        content: String(photo.content),
      });
    }

    const from = getEnv("RESEND_FROM_EMAIL", "noreply@blyoregon.org");
    const to = getRecipientEmail();
    const safeName = escapeHtml(name);
    const safeEmail = escapeHtml(email);
    const safeCategory = escapeHtml(category);
    const safeDetails = escapeHtml(details).replace(/\n/g, "<br>");

    const payload = {
      from: `Bly Archive <${from}>`,
      to: [to],
      reply_to: email,
      subject: `[Bly Archive] ${category} submission from ${name}`,
      html:
        `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#1e1f1c">` +
        `<h2>New archive submission</h2>` +
        `<p><strong>Name:</strong> ${safeName}</p>` +
        `<p><strong>Email:</strong> ${safeEmail}</p>` +
        `<p><strong>Type:</strong> ${safeCategory}</p>` +
        `<p><strong>Details:</strong><br>${safeDetails}</p>` +
        `${attachments.length ? "<p><strong>Attachment:</strong> Included with this message.</p>" : ""}` +
        `</div>`,
      text:
        `New archive submission\n\n` +
        `Name: ${name}\n` +
        `Email: ${email}\n` +
        `Type: ${category}\n\n` +
        `Details:\n${details}\n`,
    };

    if (attachments.length) payload.attachments = attachments;

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result?.message || result?.error || "Unable to send submission");
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true }));
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: error.message || "Server error" }));
  }
};
