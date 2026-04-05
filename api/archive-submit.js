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

function renderEmailShell({ eyebrow, title, intro, bodyHtml }) {
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
        `</div>` +
      `</div>` +
    `</div>`
  );
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
      html: renderEmailShell({
        eyebrow: "Archive Submission",
        title: "New archive submission",
        intro: `${name} submitted a new archive item for review.`,
        bodyHtml:
          `<p style="margin:0 0 14px"><strong style="color:#143227">Name:</strong> ${safeName}</p>` +
          `<p style="margin:0 0 14px"><strong style="color:#143227">Email:</strong> ${safeEmail}</p>` +
          `<p style="margin:0 0 14px"><strong style="color:#143227">Type:</strong> ${safeCategory}</p>` +
          `<p style="margin:0 0 14px"><strong style="color:#143227">Details:</strong><br>${safeDetails}</p>` +
          `${attachments.length ? `<p style="margin:0"><strong style="color:#143227">Attachment:</strong> Included with this message.</p>` : ""}`,
      }),
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
