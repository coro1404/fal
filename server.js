import express from "express";
import multer from "multer";
import cookieParser from "cookie-parser";
import { Readable } from "stream";
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

// Letzte Requests von fal.ai (API + Web-Playground, gleiches Konto). Pro Endpoint abfragen, zusammenführen, max. 9.
app.get("/api/recent-requests", authMiddleware, async (req, res) => {
  if (!FAL_KEY) {
    return res.json([]);
  }
  // Alle MODEL_MAP-Endpoints (inkl. Nano Banana Pro/2, Flux, GPT-Image, Grok, Spezial-Tools) + flux-lora
  const endpoints = [
    ...new Set([
      ...Object.values(MODEL_MAP).map((m) => m.endpoint),
      "fal-ai/flux-lora",
    ]),
  ];
  const limitPerEndpoint = 15;
  const allItems = [];
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 7);

  try {
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
          const imageUrl = extractImageUrlFromPayload(jsonOutput);
          if (imageUrl && it.request_id && it.endpoint_id) {
            allItems.push({
              request_id: it.request_id,
              endpoint_id: it.endpoint_id,
              ended_at: it.ended_at,
              image_url: imageUrl,
            });
          }
        }
      })
    );

    allItems.sort((a, b) => {
      const ta = a.ended_at ? new Date(a.ended_at).getTime() : 0;
      const tb = b.ended_at ? new Date(b.ended_at).getTime() : 0;
      return tb - ta;
    });

    const result = allItems.slice(0, 9).map(({ request_id, endpoint_id, image_url }) => ({
      request_id,
      endpoint_id,
      image_url,
    }));

    return res.json(result);
  } catch (err) {
    console.error("Fehler bei /api/recent-requests:", err);
    return res.json([]);
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
        } else if (modelKey === "gpt-image-edit") {
          // GPT-Image 1.5 Edit: eigene Parameter, kein aspect_ratio/resolution.
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
      const message = err?.body?.detail || err?.body?.message || err?.message;
      const userMessage =
        message && typeof message === "string" && message.length < 300
          ? message
          : "Fehler beim Aufruf der fal.ai API.";
      return res.status(500).json({
        error: userMessage,
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

