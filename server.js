import express from "express";
import multer from "multer";
import cookieParser from "cookie-parser";
import { Readable } from "stream";
import { readFile, writeFile, mkdir, readdir, unlink, access } from "fs/promises";
import sharp from "sharp";
import { fal } from "@fal-ai/client";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const FAL_KEY = process.env.FAL_KEY;
const APP_PASSWORD = process.env.APP_PASSWORD || "changeme";
const PORT = process.env.PORT || 3321;

if (!FAL_KEY) {
  console.warn(
    "[WARN] FAL_KEY ist nicht gesetzt. Die API-Aufrufe werden fehlschlagen, bis du den Key konfigurierst."
  );
}

fal.config({
  credentials: FAL_KEY,
});

const app = express();
const upload = multer({
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB pro Datei
  },
});

/** Multer: bei MemoryStorage ist .buffer gesetzt; sonst (Multer 2 Stream) Stream in Buffer lesen. */
async function streamToBuffer(stream) {
  if (stream == null) {
    throw new Error("Upload-Datei hat weder buffer noch stream (Multer-Konfiguration prüfen).");
  }
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

const MODEL_MAP = {
  // Nano Banana
  "nano-banana-edit": {
    endpoint: "fal-ai/nano-banana-pro/edit",
    type: "edit",
  },
  "nano-banana-t2i": {
    endpoint: "fal-ai/nano-banana-pro",
    type: "generate",
  },
  // Nano Banana 2
  "nano-banana-2-edit": {
    endpoint: "fal-ai/nano-banana-2/edit",
    type: "edit",
  },
  "nano-banana-2-t2i": {
    endpoint: "fal-ai/nano-banana-2",
    type: "generate",
  },
  // Flux 2
  "flux2-edit": {
    endpoint: "fal-ai/flux-2/turbo/edit",
    type: "edit",
  },
  "flux2-pro-edit": {
    endpoint: "fal-ai/flux-2-pro/edit",
    type: "edit",
  },
  // FLUX.1 Kontext [pro] (Image-to-Image)
  "flux-pro-kontext": {
    endpoint: "fal-ai/flux-pro/kontext",
    type: "edit-kontext",
  },
  "flux2-dev-t2i": {
    endpoint: "fal-ai/flux-2",
    type: "generate",
  },
  "flux2-pro-t2i": {
    endpoint: "fal-ai/flux-2-pro",
    type: "generate",
  },
  // GPT-Image
  "gpt-image-edit": {
    endpoint: "fal-ai/gpt-image-1.5/edit",
    type: "edit",
  },
  "gpt-image-mini": {
    endpoint: "fal-ai/gpt-image-1-mini",
    type: "generate",
  },
  "gpt-image-2-edit": {
    endpoint: "fal-ai/gpt-image-2/edit",
    type: "edit",
  },
  "gpt-image-2-t2i": {
    endpoint: "fal-ai/gpt-image-2",
    type: "generate",
  },
  // Grok Imagine Image (xAI)
  "grok-imagine-edit": {
    endpoint: "xai/grok-imagine-image/edit",
    type: "edit-grok",
  },
  "grok-imagine-t2i": {
    endpoint: "xai/grok-imagine-image",
    type: "generate",
  },
  // Spezialisierte Tools
  "remove-bg": {
    endpoint: "fal-ai/object-removal",
    type: "edit-special-remove",
  },
  "restore-photo": {
    endpoint: "fal-ai/image-editing/photo-restoration",
    type: "edit-special-restore",
  },
};

// Modellabhängige Limits für Upload-Slots bei /api/edit.
const EDIT_MODEL_IMAGE_LIMITS = {
  "nano-banana-edit": { min: 1, max: 3 },
  "nano-banana-2-edit": { min: 1, max: 3 },
  "flux2-edit": { min: 1, max: 1 },
  "flux2-pro-edit": { min: 1, max: 1 },
  "gpt-image-edit": { min: 1, max: 1 },
  "gpt-image-2-edit": { min: 1, max: 1 },
  "flux-pro-kontext": { min: 1, max: 1 },
  "grok-imagine-edit": { min: 1, max: 1 },
  "remove-bg": { min: 1, max: 1 },
  "restore-photo": { min: 1, max: 1 },
};

function extractFalErrorMessage(err) {
  const detail = err?.body?.detail;
  if (typeof detail === "string" && detail.trim()) return detail.trim();
  if (Array.isArray(detail)) {
    const chunks = detail
      .map((entry) => {
        if (typeof entry === "string") return entry.trim();
        if (!entry || typeof entry !== "object") return "";
        const loc = Array.isArray(entry.loc) ? entry.loc.join(".") : "";
        const msg = typeof entry.msg === "string" ? entry.msg.trim() : "";
        if (loc && msg) return `${loc}: ${msg}`;
        return msg || "";
      })
      .filter(Boolean);
    if (chunks.length) return chunks.join(" | ");
  }
  const bodyMessage = err?.body?.message;
  if (typeof bodyMessage === "string" && bodyMessage.trim()) return bodyMessage.trim();
  if (typeof err?.message === "string" && err.message.trim()) return err.message.trim();
  return "Fehler beim Aufruf der fal.ai API.";
}

/** Ergänzt fehlende file_size per HEAD-Request an die Bild-URL. */
async function enrichImageMeta(images) {
  if (!Array.isArray(images) || !images.length) return images;
  const out = [];
  for (const img of images) {
    const url = img.url || img.file_url || img.fileUrl;
    const next = { ...img };
    if (url && (next.file_size == null && next.fileSize == null)) {
      try {
        const head = await fetch(url, { method: "HEAD" });
        const cl = head.headers.get("content-length");
        if (cl) next.file_size = parseInt(cl, 10);
      } catch (_) {}
    }
    out.push(next);
  }
  return out;
}

/** Geschätzte Kosten in USD pro Bild (fal.ai, Stand Orientierung). */
const PRICING_USD = {
  "nano-banana-edit": 0.04,
  "nano-banana-t2i": 0.04,
  "nano-banana-2-edit": 0.08,
  "nano-banana-2-t2i": 0.08,
  "flux2-edit": 0.04,
  "flux2-pro-edit": 0.05,
   "flux-pro-kontext": 0.04,
  "flux2-dev-t2i": 0.04,
  "flux2-pro-t2i": 0.04,
  "gpt-image-edit": 0.05,
  "gpt-image-mini": 0.05,
  "gpt-image-2-edit": 0.07,
  "gpt-image-2-t2i": 0.07,
  "grok-imagine-edit": 0.022,
  "grok-imagine-t2i": 0.02,
  "remove-bg": 0.02,
  "restore-photo": 0.02,
};

// Simple In-Memory-Sessionverwaltung
const sessions = new Map();
const SESSION_COOKIE_NAME = "fal_session";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROMPT_HISTORY_MAX = 25;
/** Persistente Daten (Docker: Volume nach /app/data mounten, siehe FAL_DATA_DIR). */
const PROMPT_DATA_DIR = process.env.FAL_DATA_DIR
  ? path.resolve(process.env.FAL_DATA_DIR)
  : path.join(__dirname, "data");
const PROMPT_HISTORY_FILE = path.join(PROMPT_DATA_DIR, "prompt-history.json");

const RECENT_REQUESTS_MAX = 9;
const RECENT_REQUESTS_FILE = path.join(PROMPT_DATA_DIR, "recent-requests.json");
const THUMB_DIR = path.join(PROMPT_DATA_DIR, "thumbnails");
const THUMB_MAX_EDGE = 288;
const RECENT_UPLOADS_PREVIEW_MAX = 3;
const RECENT_UPLOADS_FILE = path.join(PROMPT_DATA_DIR, "recent-uploads.json");
const RECENT_UPLOADS_IMAGE_DIR = path.join(PROMPT_DATA_DIR, "recent-uploads");
const RECENT_UPLOADS_THUMB_DIR = path.join(PROMPT_DATA_DIR, "recent-uploads-thumbs");

function safeThumbName(requestId) {
  return String(requestId).replace(/[^a-zA-Z0-9._-]/g, "_");
}

function thumbnailFilePath(requestId) {
  return path.join(THUMB_DIR, `${safeThumbName(requestId)}.webp`);
}

function safeRecentUploadName(id) {
  return String(id).replace(/[^a-zA-Z0-9._-]/g, "_");
}

function extForMimeType(mimeType) {
  switch (mimeType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "png";
  }
}

function recentUploadImagePath(id, ext) {
  return path.join(RECENT_UPLOADS_IMAGE_DIR, `${safeRecentUploadName(id)}.${ext}`);
}

function recentUploadThumbPath(id) {
  return path.join(RECENT_UPLOADS_THUMB_DIR, `${safeRecentUploadName(id)}.webp`);
}

/** Lädt Ergebnisbild, erzeugt lokales WebP-Vorschaubild (3×3-Raster). */
async function saveRequestThumbnailFromUrl(sourceUrl, requestId) {
  if (!sourceUrl || !requestId || String(sourceUrl).startsWith("data:")) return;
  try {
    const res = await fetch(sourceUrl);
    if (!res.ok) return;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) return;
    await mkdir(THUMB_DIR, { recursive: true });
    await sharp(buf)
      .resize(THUMB_MAX_EDGE, THUMB_MAX_EDGE, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toFile(thumbnailFilePath(requestId));
  } catch (err) {
    console.error("Thumbnail speichern:", requestId, err?.message || err);
  }
}

async function pruneRequestThumbnails(activeRequestIds) {
  const keep = new Set((activeRequestIds || []).map((id) => `${safeThumbName(id)}.webp`));
  let files;
  try {
    files = await readdir(THUMB_DIR);
  } catch {
    return;
  }
  for (const f of files) {
    if (f === ".gitkeep") continue;
    if (!keep.has(f)) {
      await unlink(path.join(THUMB_DIR, f)).catch(() => {});
    }
  }
}

function recentRequestSortTime(item) {
  if (item == null) return 0;
  if (typeof item.at === "number" && Number.isFinite(item.at)) return item.at;
  if (item.ended_at) return new Date(item.ended_at).getTime() || 0;
  return 0;
}

async function readRecentRequestsFile() {
  try {
    const raw = await readFile(RECENT_REQUESTS_FILE, "utf8");
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (err) {
    if (err?.code === "ENOENT") return [];
    console.error("Fehler beim Lesen recent-requests.json:", err);
    return [];
  }
}

async function writeRecentRequestsFile(arr) {
  const dir = path.dirname(RECENT_REQUESTS_FILE);
  await mkdir(dir, { recursive: true });
  await writeFile(RECENT_REQUESTS_FILE, JSON.stringify(arr, null, 0), "utf8");
}

async function readRecentUploadsFile() {
  try {
    const raw = await readFile(RECENT_UPLOADS_FILE, "utf8");
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (err) {
    if (err?.code === "ENOENT") return [];
    console.error("Fehler beim Lesen recent-uploads.json:", err);
    return [];
  }
}

async function writeRecentUploadsFile(arr) {
  const dir = path.dirname(RECENT_UPLOADS_FILE);
  await mkdir(dir, { recursive: true });
  await writeFile(RECENT_UPLOADS_FILE, JSON.stringify(arr, null, 0), "utf8");
}

async function pruneRecentUploadFiles(activeEntries) {
  const imageKeep = new Set((activeEntries || []).map((it) => `${safeRecentUploadName(it.id)}.${it.ext}`));
  const thumbKeep = new Set((activeEntries || []).map((it) => `${safeRecentUploadName(it.id)}.webp`));
  let imageFiles = [];
  let thumbFiles = [];
  try {
    imageFiles = await readdir(RECENT_UPLOADS_IMAGE_DIR);
  } catch {}
  try {
    thumbFiles = await readdir(RECENT_UPLOADS_THUMB_DIR);
  } catch {}
  for (const f of imageFiles) {
    if (f === ".gitkeep") continue;
    if (!imageKeep.has(f)) await unlink(path.join(RECENT_UPLOADS_IMAGE_DIR, f)).catch(() => {});
  }
  for (const f of thumbFiles) {
    if (f === ".gitkeep") continue;
    if (!thumbKeep.has(f)) await unlink(path.join(RECENT_UPLOADS_THUMB_DIR, f)).catch(() => {});
  }
}

function recentUploadsToClientJson(items) {
  return (items || []).map((item) => ({
    id: item.id,
    timestamp: item.timestamp,
    filename:
      typeof item.filename === "string" && item.filename.trim()
        ? item.filename.trim()
        : `upload-${item.id}.${item.ext || "png"}`,
    image_url: `/api/recent-uploaded-images/${encodeURIComponent(item.id)}`,
    thumb_url: `/api/recent-uploaded-images/${encodeURIComponent(item.id)}/thumb`,
  }));
}

/** Chronologisch letzte 9 über alle Quellen; neuere `at` gewinnt bei gleicher request_id. */
function mergeRecentRequestsByTime(existing, incoming) {
  const map = new Map();
  for (const item of [...incoming, ...existing]) {
    if (!item?.request_id || !item.endpoint_id || !item.image_url) continue;
    const at = recentRequestSortTime(item);
    const row = {
      request_id: item.request_id,
      endpoint_id: item.endpoint_id,
      image_url: item.image_url,
      prompt: item.prompt != null ? item.prompt : null,
      at,
    };
    const prev = map.get(row.request_id);
    if (!prev || at >= recentRequestSortTime(prev)) map.set(row.request_id, row);
  }
  return [...map.values()].sort((a, b) => b.at - a.at).slice(0, RECENT_REQUESTS_MAX);
}

async function recordRecentRequestEntry({ request_id, endpoint_id, image_url, prompt }) {
  if (!request_id || !endpoint_id || !image_url) return;
  try {
    const list = await readRecentRequestsFile();
    const next = mergeRecentRequestsByTime(list, [
      {
        request_id,
        endpoint_id,
        image_url,
        prompt: typeof prompt === "string" && prompt.trim() ? prompt.trim() : null,
        at: Date.now(),
      },
    ]);
    await writeRecentRequestsFile(next);
    await saveRequestThumbnailFromUrl(image_url, request_id);
    await pruneRequestThumbnails(next.map((r) => r.request_id));
  } catch (err) {
    console.error("recent-requests anfügen:", err);
  }
}

async function readPromptHistoryFile() {
  try {
    const raw = await readFile(PROMPT_HISTORY_FILE, "utf8");
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (err) {
    if (err?.code === "ENOENT") return [];
    console.error("Fehler beim Lesen der Prompt-Historie:", err);
    return [];
  }
}

async function writePromptHistoryFile(arr) {
  const dir = path.dirname(PROMPT_HISTORY_FILE);
  await mkdir(dir, { recursive: true });
  await writeFile(PROMPT_HISTORY_FILE, JSON.stringify(arr, null, 0), "utf8");
}

app.use(cookieParser());
app.use(express.json());

// Statische Dateien (Frontend)
app.use(express.static(path.join(__dirname, "public")));

function isAuthenticated(req) {
  const token = req.cookies?.[SESSION_COOKIE_NAME];
  if (!token) return false;
  return sessions.has(token);
}

function authMiddleware(req, res, next) {
  if (isAuthenticated(req)) {
    return next();
  }
  return res.status(401).json({ error: "Nicht autorisiert" });
}

app.post("/api/login", (req, res) => {
  const { password } = req.body || {};

  if (!password || password !== APP_PASSWORD) {
    return res.status(401).json({ error: "Ungültiges Passwort" });
  }

  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, { createdAt: Date.now() });

  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 Tage
  });

  return res.json({ ok: true });
});

app.get("/api/me", (req, res) => {
  if (isAuthenticated(req)) {
    return res.json({ authenticated: true });
  }
  return res.json({ authenticated: false });
});

// Prompt-Historie: serverseitig persistent (Datei), session- und geräteübergreifend
app.get("/api/prompt-history", authMiddleware, async (req, res) => {
  try {
    const items = await readPromptHistoryFile();
    return res.json({ items });
  } catch (err) {
    console.error("Fehler bei GET /api/prompt-history:", err);
    return res.status(500).json({ error: "Historie konnte nicht geladen werden.", items: [] });
  }
});

app.post("/api/prompt-history", authMiddleware, async (req, res) => {
  try {
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!text) {
      return res.status(400).json({ error: "Prompt-Text fehlt.", items: [] });
    }
    const list = await readPromptHistoryFile();
    const alreadyThere = list.some((item) => item.text === text);
    if (alreadyThere) {
      return res.json({ items: list });
    }
    const filtered = list.filter((item) => item.text !== text);
    filtered.unshift({ text, timestamp: Date.now() });
    const kept = filtered.slice(0, PROMPT_HISTORY_MAX);
    await writePromptHistoryFile(kept);
    return res.json({ items: kept });
  } catch (err) {
    console.error("Fehler bei POST /api/prompt-history:", err);
    return res.status(500).json({ error: "Historie konnte nicht gespeichert werden.", items: [] });
  }
});

// Letzte Uploads: persistent speichern (max. 3) und als Miniaturen ausliefern
app.get("/api/recent-uploaded-images", authMiddleware, async (req, res) => {
  try {
    const list = await readRecentUploadsFile();
    const sorted = [...list].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    const includeAll = String(req.query.all || "").toLowerCase() === "1";
    const payload = includeAll ? sorted : sorted.slice(0, RECENT_UPLOADS_PREVIEW_MAX);
    return res.json(recentUploadsToClientJson(payload));
  } catch (err) {
    console.error("Fehler bei GET /api/recent-uploaded-images:", err);
    return res.json([]);
  }
});

app.post(
  "/api/recent-uploaded-images",
  authMiddleware,
  upload.single("image"),
  async (req, res) => {
    try {
      const raw = req.file;
      if (!raw) return res.status(400).json({ error: "Bild fehlt.", items: [] });
      const mimeType = raw.mimetype || "image/png";
      if (!String(mimeType).startsWith("image/")) {
        return res.status(400).json({ error: "Nur Bilddateien sind erlaubt.", items: [] });
      }
      const buffer = raw.buffer ?? (await streamToBuffer(raw.stream));
      const id = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
      const ext = extForMimeType(mimeType);
      const originalFilename = String(raw.originalname || "").trim();
      const safeOriginalFilename = originalFilename
        ? originalFilename.replace(/[^a-zA-Z0-9._-]/g, "_")
        : `upload-${id}.${ext}`;
      const imagePath = recentUploadImagePath(id, ext);
      const thumbPath = recentUploadThumbPath(id);

      await mkdir(RECENT_UPLOADS_IMAGE_DIR, { recursive: true });
      await mkdir(RECENT_UPLOADS_THUMB_DIR, { recursive: true });
      await writeFile(imagePath, buffer);
      await sharp(buffer)
        .resize(288, 288, { fit: "cover" })
        .webp({ quality: 80 })
        .toFile(thumbPath);

      const current = await readRecentUploadsFile();
      const next = [
        { id, ext, filename: safeOriginalFilename, timestamp: Date.now() },
        ...current,
      ]
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      await writeRecentUploadsFile(next);
      await pruneRecentUploadFiles(next);
      return res.json({ items: recentUploadsToClientJson(next.slice(0, RECENT_UPLOADS_PREVIEW_MAX)) });
    } catch (err) {
      console.error("Fehler bei POST /api/recent-uploaded-images:", err);
      return res.status(500).json({ error: "Upload konnte nicht gespeichert werden.", items: [] });
    }
  }
);

app.get("/api/recent-uploaded-images/:id", authMiddleware, async (req, res) => {
  try {
    const id = decodeURIComponent(req.params.id);
    const list = await readRecentUploadsFile();
    const item = list.find((it) => it.id === id);
    if (!item) return res.status(404).end();
    const filePath = recentUploadImagePath(item.id, item.ext);
    await access(filePath);
    const mimeType = item.ext === "jpg" ? "image/jpeg" : `image/${item.ext}`;
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Cache-Control", "public, max-age=604800");
    return res.sendFile(path.resolve(filePath));
  } catch {
    return res.status(404).end();
  }
});

app.get("/api/recent-uploaded-images/:id/thumb", authMiddleware, async (req, res) => {
  try {
    const id = decodeURIComponent(req.params.id);
    const list = await readRecentUploadsFile();
    const exists = list.some((it) => it.id === id);
    if (!exists) return res.status(404).end();
    const filePath = recentUploadThumbPath(id);
    await access(filePath);
    res.setHeader("Content-Type", "image/webp");
    res.setHeader("Cache-Control", "public, max-age=604800");
    return res.sendFile(path.resolve(filePath));
  } catch {
    return res.status(404).end();
  }
});

// fal.ai Usage/Balance: 24h-Verbrauch aus Platform API (erfordert Admin-Key)
app.get("/api/fal-balance", authMiddleware, async (req, res) => {
  if (!FAL_KEY) {
    return res.json({ error: "FAL_KEY nicht konfiguriert", hint: "Guthaben/Verbrauch im Dashboard anzeigen." });
  }
  try {
    const url = "https://api.fal.ai/v1/models/usage?expand=summary&limit=1";
    const resp = await fetch(url, {
      headers: { Authorization: `Key ${FAL_KEY}` },
    });
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      const msg = body?.error?.message || resp.statusText;
      return res.json({
        error: msg,
        hint: "Verbrauch/Guthaben nur mit Admin-Key oder im fal.ai-Dashboard sichtbar.",
      });
    }
    const data = await resp.json();
    const summary = data.summary || [];
    let totalUsd = 0;
    let currency = "USD";
    for (const item of summary) {
      if (typeof item.cost === "number") totalUsd += item.cost;
      if (item.currency) currency = item.currency;
    }
    return res.json({ usage_usd: Math.round(totalUsd * 100) / 100, currency });
  } catch (err) {
    console.error("Fehler bei /api/fal-balance:", err);
    return res.json({
      error: err.message || "API-Aufruf fehlgeschlagen",
      hint: "Guthaben/Verbrauch im Dashboard anzeigen.",
    });
  }
});

/** Bild-URL aus fal.ai Request-Payload (json_output) extrahieren. */
function extractImageUrlFromPayload(jsonOutput) {
  if (!jsonOutput || typeof jsonOutput !== "object") return null;
  const images = jsonOutput.images || jsonOutput.output?.images;
  if (Array.isArray(images) && images.length) {
    const first = images[0];
    return first?.url ?? first?.file_url ?? first?.fileUrl ?? null;
  }
  const img = jsonOutput.image || jsonOutput.output?.image;
  if (img && typeof img === "object") return img.url ?? img.file_url ?? img.fileUrl ?? null;
  return null;
}

/** Prompt aus Request-Eingabe (json_input) extrahieren (Platform-API mit expand=payloads). */
function extractPromptFromPayload(jsonInput) {
  if (!jsonInput || typeof jsonInput !== "object") return null;
  const take = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
  let p = take(jsonInput.prompt);
  if (p) return p;
  p = take(jsonInput.text);
  if (p) return p;
  p = take(jsonInput.description);
  if (p) return p;
  const inner = jsonInput.input;
  if (inner && typeof inner === "object") {
    p = take(inner.prompt) || take(inner.text);
    if (p) return p;
  }
  const args = jsonInput.arguments;
  if (args && typeof args === "object") {
    p = take(args.prompt) || take(args.text);
    if (p) return p;
  }
  return null;
}

/** Rohliste aller Treffer von fal Platform-API (alle Endpoints), mit Zeitstempel `at`. */
async function fetchRecentRequestsFromFalPlatform() {
  if (!FAL_KEY) return [];
  const endpoints = [
    ...new Set([
      ...Object.values(MODEL_MAP).map((m) => m.endpoint),
      "fal-ai/flux-lora",
    ]),
  ];
  const limitPerEndpoint = 20;
  const allItems = [];
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 7);

  await Promise.all(
    endpoints.map(async (endpointId) => {
      const url = new URL("https://api.fal.ai/v1/models/requests/by-endpoint");
      url.searchParams.set("endpoint_id", endpointId);
      url.searchParams.set("limit", String(limitPerEndpoint));
      url.searchParams.set("status", "success");
      url.searchParams.set("expand", "payloads");
      url.searchParams.set("start", startDate.toISOString());
      url.searchParams.set("end", endDate.toISOString());

      const resp = await fetch(url.toString(), {
        headers: { Authorization: `Key ${FAL_KEY}` },
      });
      if (!resp.ok) return;
      const data = await resp.json().catch(() => ({}));
      const items = data.items || [];
      for (const it of items) {
        const jsonOutput = it.json_output ?? (it.payloads && it.payloads.json_output);
        const jsonInput = it.json_input ?? (it.payloads && it.payloads.json_input);
        const imageUrl = extractImageUrlFromPayload(jsonOutput);
        if (imageUrl && it.request_id && it.endpoint_id) {
          const at = it.ended_at ? new Date(it.ended_at).getTime() : Date.now();
          allItems.push({
            request_id: it.request_id,
            endpoint_id: it.endpoint_id,
            image_url: imageUrl,
            prompt: extractPromptFromPayload(jsonInput),
            at,
          });
        }
      }
    })
  );

  return allItems;
}

function recentRequestsToClientJson(list) {
  return list.map(({ request_id, endpoint_id, image_url, prompt }) => ({
    request_id,
    endpoint_id,
    image_url,
    prompt: prompt || null,
    thumb_url: `/api/recent-thumbnails/${encodeURIComponent(request_id)}`,
  }));
}

// 3×3-Raster: persistent aus recent-requests.json (chronologisch letzte 9, alle Modelle)
app.get("/api/recent-requests", authMiddleware, async (req, res) => {
  try {
    const list = await readRecentRequestsFile();
    const sorted = [...list].sort((a, b) => recentRequestSortTime(b) - recentRequestSortTime(a));
    return res.json(recentRequestsToClientJson(sorted.slice(0, RECENT_REQUESTS_MAX)));
  } catch (err) {
    console.error("Fehler bei GET /api/recent-requests:", err);
    return res.json([]);
  }
});

app.get("/api/recent-thumbnails/:requestId", authMiddleware, async (req, res) => {
  try {
    const rid = decodeURIComponent(req.params.requestId);
    const p = thumbnailFilePath(rid);
    await access(p);
    res.setHeader("Content-Type", "image/webp");
    res.setHeader("Cache-Control", "public, max-age=604800");
    res.sendFile(path.resolve(p));
  } catch {
    res.status(404).end();
  }
});

// Optional: mit fal.ai-Historie abgleichen (Web/API), mergen, Datei speichern
app.post("/api/recent-requests/sync", authMiddleware, async (req, res) => {
  try {
    const fileList = await readRecentRequestsFile();
    let falList = [];
    try {
      falList = await fetchRecentRequestsFromFalPlatform();
    } catch (e) {
      console.error("fal recent-requests sync:", e);
    }
    const merged = mergeRecentRequestsByTime(fileList, falList);
    await writeRecentRequestsFile(merged);
    await Promise.allSettled(
      merged.map((item) => saveRequestThumbnailFromUrl(item.image_url, item.request_id))
    );
    await pruneRequestThumbnails(merged.map((r) => r.request_id));
    return res.json(recentRequestsToClientJson(merged));
  } catch (err) {
    console.error("Fehler bei POST /api/recent-requests/sync:", err);
    return res.status(500).json([]);
  }
});

// Image-Edit Endpoint (1–3 Bilder)
app.post(
  "/api/edit",
  authMiddleware,
  upload.array("images", 3),
  async (req, res) => {
    try {
      const {
        prompt,
        aspectRatio = "auto",
        resolution = "1K",
        outputFormat = "png",
        modelKey = "nano-banana-edit",
      } = req.body || {};

      const promptOptional = modelKey === "restore-photo" || modelKey === "remove-bg";
      if (!prompt && !promptOptional) {
        return res.status(400).json({ error: "Prompt ist erforderlich." });
      }

      const rawFiles = req.files || [];
      if (!rawFiles.length) {
        return res
          .status(400)
          .json({ error: "Bitte lade mindestens ein Bild (max. 3) hoch." });
      }
      const files = await Promise.all(
        rawFiles.map(async (f) => ({
          ...f,
          buffer: f.buffer ?? (await streamToBuffer(f.stream)),
        }))
      );

      const model = MODEL_MAP[modelKey] || MODEL_MAP["nano-banana-edit"];
      const imageLimits = EDIT_MODEL_IMAGE_LIMITS[modelKey] || { min: 1, max: 1 };
      if (files.length < imageLimits.min || files.length > imageLimits.max) {
        const rangeHint = imageLimits.min === imageLimits.max
          ? `genau ${imageLimits.min}`
          : `${imageLimits.min} bis ${imageLimits.max}`;
        return res.status(400).json({
          error: `Das Modell ${modelKey} erwartet ${rangeHint} Bild(er).`,
        });
      }

      if (model.type === "edit") {
        const imageUrls = files.map((file) => {
          const base64 = file.buffer.toString("base64");
          return `data:${file.mimetype};base64,${base64}`;
        });

        const t0 = Date.now();
        // Standard-Edit-Input; für einige Modelle (z. B. Flux 2 Pro Edit) wird Größe anders gesteuert.
        const editInput = {
          prompt,
          image_urls: imageUrls,
          output_format: outputFormat,
          num_images: 1,
        };

        if (modelKey === "flux2-pro-edit") {
          editInput.image_size = "auto";
          editInput.safety_tolerance = "5";
          editInput.enable_safety_checker = false;
        } else if (modelKey === "gpt-image-edit" || modelKey === "gpt-image-2-edit") {
          // GPT-Image Edit-Modelle: eigene Parameter, kein aspect_ratio/resolution.
          editInput.image_size = "auto";
          editInput.background = "auto";
          editInput.quality = "high";
          editInput.input_fidelity = "high";
        } else {
          editInput.aspect_ratio = aspectRatio;
          editInput.resolution = resolution;
          if (modelKey === "nano-banana-edit" || modelKey === "nano-banana-2-edit") editInput.safety_tolerance = "6";
          if (modelKey === "nano-banana-edit" || modelKey === "nano-banana-2-edit") editInput.enable_web_search = true;
          if (modelKey === "flux2-edit") editInput.enable_safety_checker = false;
        }

        const result = await fal.subscribe(model.endpoint, {
          input: editInput,
          logs: false,
        });
        const elapsed_ms = Date.now() - t0;

        const { images: raw = [], description = "" } = result.data || {};
        const images = await enrichImageMeta(raw);
        const costUsd = (PRICING_USD[modelKey] ?? 0.03) * (images.length || 1);

        await recordRecentRequestEntry({
          request_id: result.requestId ?? result.request_id,
          endpoint_id: model.endpoint,
          image_url: images[0]?.url || images[0]?.file_url || images[0]?.fileUrl,
          prompt: prompt?.trim() || null,
        });

        return res.json({
          images,
          description,
          cost_estimate_usd: Math.round(costUsd * 10000) / 10000,
          elapsed_ms,
          request_id: result.requestId ?? result.request_id,
          endpoint_id: model.endpoint,
        });
      }

      if (model.type === "edit-kontext") {
        // FLUX.1 Kontext [pro] erwartet genau ein Bild (image_url) plus Prompt.
        const file = files[0];
        const base64 = file.buffer.toString("base64");
        const imageUrl = `data:${file.mimetype};base64,${base64}`;

        const t0 = Date.now();
        const result = await fal.subscribe(model.endpoint, {
          input: {
            prompt,
            image_url: imageUrl,
            output_format: outputFormat,
            num_images: 1,
            safety_tolerance: "6",
          },
          logs: false,
        });
        const elapsed_ms = Date.now() - t0;

        const { images: raw = [] } = result.data || {};
        const images = await enrichImageMeta(raw);
        const costUsd = (PRICING_USD[modelKey] ?? 0.04) * (images.length || 1);

        await recordRecentRequestEntry({
          request_id: result.requestId ?? result.request_id,
          endpoint_id: model.endpoint,
          image_url: images[0]?.url || images[0]?.file_url || images[0]?.fileUrl,
          prompt: prompt?.trim() || null,
        });

        return res.json({
          images,
          description: "Bearbeitung mit FLUX.1 Kontext [pro].",
          cost_estimate_usd: Math.round(costUsd * 10000) / 10000,
          elapsed_ms,
          request_id: result.requestId ?? result.request_id,
          endpoint_id: model.endpoint,
        });
      }

      if (model.type === "edit-grok") {
        // Grok Imagine Image Edit: ein Bild (image_url) plus Prompt.
        const file = files[0];
        const base64 = file.buffer.toString("base64");
        const imageUrl = `data:${file.mimetype};base64,${base64}`;

        const t0 = Date.now();
        const result = await fal.subscribe(model.endpoint, {
          input: {
            prompt,
            image_url: imageUrl,
            num_images: 1,
            output_format: outputFormat || "jpeg",
          },
          logs: false,
        });
        const elapsed_ms = Date.now() - t0;

        const { images: raw = [], revised_prompt: revisedPrompt = "" } = result.data || {};
        const images = await enrichImageMeta(raw);
        const costUsd = (PRICING_USD[modelKey] ?? 0.022) * (images.length || 1);

        await recordRecentRequestEntry({
          request_id: result.requestId ?? result.request_id,
          endpoint_id: model.endpoint,
          image_url: images[0]?.url || images[0]?.file_url || images[0]?.fileUrl,
          prompt: prompt?.trim() || null,
        });

        return res.json({
          images,
          description: revisedPrompt || "Bearbeitung mit Grok Imagine Image.",
          cost_estimate_usd: Math.round(costUsd * 10000) / 10000,
          elapsed_ms,
          request_id: result.requestId ?? result.request_id,
          endpoint_id: model.endpoint,
        });
      }

      if (model.type === "edit-special-remove") {
        const file = files[0];
        const base64 = file.buffer.toString("base64");
        const imageUrl = `data:${file.mimetype};base64,${base64}`;
        const removePrompt = (prompt && prompt.trim()) || "Hintergrund";

        const t0 = Date.now();
        const result = await fal.subscribe(model.endpoint, {
          input: {
            image_url: imageUrl,
            prompt: removePrompt,
          },
          logs: false,
        });
        const elapsed_ms = Date.now() - t0;

        const { images: raw = [] } = result.data || {};
        const images = await enrichImageMeta(raw);
        const costUsd = (PRICING_USD[modelKey] ?? 0.03) * (images.length || 1);

        await recordRecentRequestEntry({
          request_id: result.requestId ?? result.request_id,
          endpoint_id: model.endpoint,
          image_url: images[0]?.url || images[0]?.file_url || images[0]?.fileUrl,
          prompt: removePrompt?.trim() || null,
        });

        return res.json({
          images,
          description: "Objekte/Hintergrund entfernt.",
          cost_estimate_usd: Math.round(costUsd * 10000) / 10000,
          elapsed_ms,
          request_id: result.requestId ?? result.request_id,
          endpoint_id: model.endpoint,
        });
      }

      if (model.type === "edit-special-restore") {
        const file = files[0];
        const base64 = file.buffer.toString("base64");
        const imageUrl = `data:${file.mimetype};base64,${base64}`;

        const t0 = Date.now();
        const result = await fal.subscribe(model.endpoint, {
          input: {
            image_url: imageUrl,
            output_format: outputFormat,
          },
          logs: false,
        });
        const elapsed_ms = Date.now() - t0;

        const { images: raw = [] } = result.data || {};
        const images = await enrichImageMeta(raw);
        const costUsd = (PRICING_USD[modelKey] ?? 0.03) * (images.length || 1);

        await recordRecentRequestEntry({
          request_id: result.requestId ?? result.request_id,
          endpoint_id: model.endpoint,
          image_url: images[0]?.url || images[0]?.file_url || images[0]?.fileUrl,
          prompt: null,
        });

        return res.json({
          images,
          description: "Historisches Foto restauriert.",
          cost_estimate_usd: Math.round(costUsd * 10000) / 10000,
          elapsed_ms,
          request_id: result.requestId ?? result.request_id,
          endpoint_id: model.endpoint,
        });
      }

      return res.status(400).json({ error: "Ungültiger Edit-Modus oder Modelltyp." });
    } catch (err) {
      console.error("Fehler bei /api/edit:", err);
      const status = Number(err?.status);
      const userMessage = extractFalErrorMessage(err);
      if (status === 422) {
        return res.status(422).json({
          error: userMessage,
          request_id: err?.requestId ?? null,
        });
      }
      return res.status(500).json({
        error: userMessage,
        request_id: err?.requestId ?? null,
      });
    }
  }
);

// Gültige aspect_ratio für Text-zu-Bild (fal.ai nano-banana-pro etc.); "auto" ist nur für Edit.
const T2I_ASPECT_RATIOS = new Set(["21:9", "16:9", "3:2", "4:3", "5:4", "1:1", "4:5", "3:4", "2:3", "9:16"]);

// Optional: Text-zu-Bild-Modell
app.post("/api/generate", authMiddleware, async (req, res) => {
  try {
    const {
      prompt,
      aspectRatio = "1:1",
      resolution = "1K",
      outputFormat = "png",
      numImages = 1,
      modelKey = "nano-banana-t2i",
    } = req.body || {};

    if (!prompt) {
      return res.status(400).json({ error: "Prompt ist erforderlich." });
    }

    const model = MODEL_MAP[modelKey] || MODEL_MAP["nano-banana-t2i"];

    if (model.type !== "generate") {
      return res
        .status(400)
        .json({ error: "Das ausgewählte Modell ist kein Text-zu-Bild-Modell." });
    }

    // "auto" ist nur beim Edit erlaubt; Text-zu-Bild erwartet ein konkretes Seitenverhältnis
    const aspect_ratio = T2I_ASPECT_RATIOS.has(aspectRatio) ? aspectRatio : "1:1";
    const validResolutions = ["1K", "2K", "4K"];
    const resolutionValue = validResolutions.includes(resolution) ? resolution : "1K";

    const genInput = {
      prompt,
      aspect_ratio,
      resolution: resolutionValue,
      output_format: outputFormat || "png",
      num_images: Math.min(Number(numImages) || 1, 4),
    };
    if (modelKey === "nano-banana-t2i" || modelKey === "nano-banana-2-t2i") {
      genInput.safety_tolerance = "6";
      genInput.enable_web_search = true;
    }
    if (modelKey === "flux2-dev-t2i") genInput.enable_safety_checker = false;
    if (modelKey === "flux2-pro-t2i") {
      genInput.safety_tolerance = "5";
      genInput.enable_safety_checker = false;
    }
    if (modelKey === "grok-imagine-t2i") {
      delete genInput.resolution;
      const grokAspectRatios = new Set(["2:1", "20:9", "19.5:9", "16:9", "4:3", "3:2", "1:1", "2:3", "3:4", "9:16", "9:19.5", "9:20", "1:2"]);
      if (!grokAspectRatios.has(aspect_ratio)) genInput.aspect_ratio = "1:1";
      genInput.output_format = outputFormat || "jpeg";
    }

    const t0 = Date.now();
    const result = await fal.subscribe(model.endpoint, {
      input: genInput,
      logs: false,
    });
    const elapsed_ms = Date.now() - t0;

    const { images: raw = [], description: desc = "", revised_prompt: revisedPrompt = "" } = result.data || {};
    const images = await enrichImageMeta(raw);
    const description = revisedPrompt || desc;
    const costUsd = (PRICING_USD[modelKey] ?? 0.03) * (images.length || 1);

    await recordRecentRequestEntry({
      request_id: result.requestId ?? result.request_id,
      endpoint_id: model.endpoint,
      image_url: images[0]?.url || images[0]?.file_url || images[0]?.fileUrl,
      prompt: prompt?.trim() || null,
    });

    return res.json({
      images,
      description,
      cost_estimate_usd: Math.round(costUsd * 10000) / 10000,
      elapsed_ms,
      request_id: result.requestId ?? result.request_id,
      endpoint_id: model.endpoint,
    });
  } catch (err) {
    console.error("Fehler bei /api/generate:", err);
    const message = err?.body?.detail || err?.body?.message || err?.message;
    const userMessage =
      message && typeof message === "string" && message.length < 300
        ? message
        : "Fehler beim Aufruf der fal.ai API.";
    return res.status(500).json({
      error: userMessage,
    });
  }
});

// Download-Proxy: lädt die Datei vom Ziel-URL und streamt sie mit Content-Disposition
const DOWNLOAD_ALLOWED_HOSTS = /\.fal\.media$|^fal\.media$|storage\.googleapis\.com$/i;
app.get("/api/download", authMiddleware, async (req, res) => {
  try {
    const rawUrl = req.query.url;
    const filename = (req.query.filename || "ergebnis.png").replace(/[^a-zA-Z0-9._-]/g, "_");
    if (!rawUrl || typeof rawUrl !== "string") {
      return res.status(400).json({ error: "Parameter url fehlt." });
    }
    const url = decodeURIComponent(rawUrl);
    let host;
    try {
      host = new URL(url).hostname;
    } catch {
      return res.status(400).json({ error: "Ungültige URL." });
    }
    if (!DOWNLOAD_ALLOWED_HOSTS.test(host)) {
      return res.status(400).json({ error: "URL-Host nicht erlaubt." });
    }
    const resp = await fetch(url);
    if (!resp.ok) {
      return res.status(502).json({ error: "Ziel konnte nicht geladen werden." });
    }
    const ct = resp.headers.get("content-type") || "application/octet-stream";
    res.setHeader("Content-Type", ct);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    Readable.fromWeb(resp.body).pipe(res);
  } catch (err) {
    console.error("Fehler bei /api/download:", err);
    return res.status(500).json({ error: "Download fehlgeschlagen." });
  }
});

// Fallback: index.html für Single-Page-Feeling
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server läuft auf http://localhost:${PORT}`);
});

