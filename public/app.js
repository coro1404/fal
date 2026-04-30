const loginSection = document.getElementById("login-section");
const editorSection = document.getElementById("editor-section");
const resultsSection = document.getElementById("results-section");

const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
const loginButton = document.getElementById("login-button");

const editForm = document.getElementById("edit-form");
const modelSelect = document.getElementById("model-select");
const uploadGroup = document.getElementById("upload-group");
const imageInputs = [
  document.getElementById("image-input-1"),
  document.getElementById("image-input-2"),
  document.getElementById("image-input-3"),
];
const numImagesGroup = document.getElementById("num-images-group");
const numImagesInput = document.getElementById("num-images-input");
const promptGroup = document.getElementById("prompt-group");
const promptInput = document.getElementById("prompt-input");
const resolutionSelect = document.getElementById("resolution-select");
const aspectSelect = document.getElementById("aspect-select");
const submitButton = document.getElementById("submit-button");
const statusMessage = document.getElementById("status-message");
const statusText = document.getElementById("status-text");

const resultsGrid = document.getElementById("results-grid");
const resultDescription = document.getElementById("result-description");
const resultCost = document.getElementById("result-cost");
const falBalanceEl = document.getElementById("fal-balance");
const selfieBtn = document.getElementById("selfie-btn");
const selfieModal = document.getElementById("selfie-modal");
const selfieVideo = document.getElementById("selfie-video");
const selfieCaptureBtn = document.getElementById("selfie-capture-btn");
const selfieCancelBtn = document.getElementById("selfie-cancel-btn");
const selfieErrorEl = document.getElementById("selfie-error");
const recentRequestsGrid = document.getElementById("recent-requests-grid");
const promptHistorySelect = document.getElementById("prompt-history-select");
const recentUploadsGrid = document.getElementById("recent-uploads-grid");

function getFalPlaygroundUrl(endpointId, requestId) {
  const base = `https://fal.ai/models/${endpointId}/playground`;
  if (!requestId) return base;
  const q = new URLSearchParams();
  q.set("requestId", requestId);
  q.set("request_id", requestId);
  return `${base}?${q.toString()}`;
}

/** Kurzer Hinweis nach Klick auf 3×3-Zelle (Playground + Zwischenablage). */
function showPlaygroundPromptToast(message) {
  const el = document.createElement("div");
  el.className = "playground-toast";
  el.setAttribute("role", "status");
  el.textContent = message;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("playground-toast-visible"));
  setTimeout(() => {
    el.classList.remove("playground-toast-visible");
    setTimeout(() => el.remove(), 300);
  }, 4200);
}

/** Aktuelle 3×3-Einträge (vom Server), für Klick-Handler / Playground. */
let recentRequestsList = [];
let recentUploadedImages = [];

function renderRecentRequestsGrid(list) {
  if (Array.isArray(list)) recentRequestsList = list;
  if (!recentRequestsGrid) return;
  const display = recentRequestsList;
  recentRequestsGrid.innerHTML = "";
  for (let i = 0; i < 9; i++) {
    const cell = document.createElement("div");
    cell.className = "recent-request-cell" + (display[i] ? "" : " empty");
    cell.setAttribute("aria-label", display[i] ? "Request im Playground öffnen" : "Leerer Platz");
    if (display[i]) {
      const entry = display[i];
      const a = document.createElement("a");
      a.href = getFalPlaygroundUrl(entry.endpoint_id, entry.request_id);
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.title = entry.prompt
        ? `Playground öffnen · Prompt (Vorschau): ${entry.prompt.slice(0, 200)}${entry.prompt.length > 200 ? "…" : ""}`
        : "Request im fal.ai Playground öffnen (Prompt ggf. nicht von fal.ai übernommen)";
      a.addEventListener("click", () => {
        const p = entry.prompt;
        if (p && navigator.clipboard?.writeText) {
          void navigator.clipboard.writeText(p);
          showPlaygroundPromptToast(
            "Prompt in die Zwischenablage kopiert. Im Playground-Fenster ins Prompt-Feld einfügen (Strg+V)."
          );
        } else if (!p) {
          showPlaygroundPromptToast(
            "Playground öffnet sich. Wenn kein Prompt erscheint: fal.ai übernimmt Eingaben bei manchen Requests nicht – Prompt ggf. aus der App-Historie holen."
          );
        }
      });
      const img = document.createElement("img");
      const thumb = entry.thumb_url;
      const full = entry.image_url;
      img.src = thumb || full;
      img.alt = "";
      if (thumb) {
        let thumbFailed = false;
        img.addEventListener("error", function onThumbErr() {
          if (thumbFailed) return;
          thumbFailed = true;
          img.removeEventListener("error", onThumbErr);
          img.src = full;
        });
      }
      a.appendChild(img);
      cell.appendChild(a);
    }
    recentRequestsGrid.appendChild(cell);
  }
}

async function loadRecentRequestsFromServer() {
  try {
    const res = await fetch("/api/recent-requests", { credentials: "include" });
    if (!res.ok) return [];
    const list = await res.json();
    if (!Array.isArray(list)) return [];
    return list.map((item) => ({
      request_id: item.request_id,
      endpoint_id: item.endpoint_id,
      image_url: item.image_url,
      thumb_url:
        typeof item.thumb_url === "string" && item.thumb_url.trim()
          ? item.thumb_url.trim()
          : `/api/recent-thumbnails/${encodeURIComponent(item.request_id)}`,
      prompt: typeof item.prompt === "string" && item.prompt.trim() ? item.prompt.trim() : null,
    }));
  } catch {
    return [];
  }
}

async function refreshRecentRequestsGrid() {
  const list = await loadRecentRequestsFromServer();
  renderRecentRequestsGrid(list);
}

async function loadRecentUploadsFromServer() {
  try {
    const res = await fetch("/api/recent-uploaded-images", { credentials: "include" });
    if (!res.ok) return [];
    const list = await res.json();
    if (!Array.isArray(list)) return [];
    return list;
  } catch {
    return [];
  }
}

function getFirstTargetSlot() {
  const empty = getFirstEmptySlot();
  if (empty >= 0) return empty;
  return 0;
}

async function putImageInSlotFromRecent(slotIndex, imageMeta) {
  if (!imageMeta?.image_url || !imageInputs[slotIndex]) return false;
  const res = await fetch(imageMeta.image_url, { credentials: "include" });
  if (!res.ok) return false;
  const blob = await res.blob();
  const ext = blob.type?.split("/")[1] || "png";
  const file = new File([blob], `recent-upload-${imageMeta.id}.${ext}`, { type: blob.type || "image/png" });
  setSlotFile(slotIndex, file);
  return true;
}

function renderRecentUploadsGrid(list) {
  recentUploadedImages = Array.isArray(list) ? list : [];
  if (!recentUploadsGrid) return;
  recentUploadsGrid.innerHTML = "";
  for (let i = 0; i < 3; i++) {
    const entry = recentUploadedImages[i];
    if (!entry) {
      const empty = document.createElement("div");
      empty.className = "recent-upload-item empty";
      empty.setAttribute("aria-hidden", "true");
      recentUploadsGrid.appendChild(empty);
      continue;
    }
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "recent-upload-item";
    btn.title = "In Upload-Slot übernehmen";
    btn.setAttribute("aria-label", "Bild in Upload-Slot übernehmen");
    btn.addEventListener("click", async () => {
      const slotIndex = getFirstTargetSlot();
      const ok = await putImageInSlotFromRecent(slotIndex, entry);
      if (!ok) {
        setStatus("Gespeichertes Bild konnte nicht geladen werden.", "error");
        return;
      }
      setStatus(`Gespeichertes Bild in Slot ${slotIndex + 1} übernommen.`, "success");
    });
    const img = document.createElement("img");
    img.src = entry.thumb_url || entry.image_url;
    img.alt = "";
    btn.appendChild(img);
    recentUploadsGrid.appendChild(btn);
  }
}

async function refreshRecentUploadsGrid() {
  const list = await loadRecentUploadsFromServer();
  renderRecentUploadsGrid(list);
}

async function saveUploadedImageToHistory(file) {
  if (!file || !file.type.startsWith("image/")) return;
  const formData = new FormData();
  formData.append("image", file);
  try {
    const res = await fetch("/api/recent-uploaded-images", {
      method: "POST",
      credentials: "include",
      body: formData,
    });
    if (!res.ok) return;
    const payload = await res.json().catch(() => ({}));
    if (Array.isArray(payload.items)) {
      renderRecentUploadsGrid(payload.items);
    }
  } catch {
    // Bei Fehlern nur UI unverändert lassen.
  }
}

/** fal.ai Platform-Historie mit Datei mergen (Web/API-Requests), speichert serverseitig. */
async function syncRecentRequestsWithFal() {
  try {
    const res = await fetch("/api/recent-requests/sync", {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) return;
    const list = await res.json();
    if (Array.isArray(list)) {
      renderRecentRequestsGrid(
        list.map((item) => ({
          request_id: item.request_id,
          endpoint_id: item.endpoint_id,
          image_url: item.image_url,
          thumb_url:
            typeof item.thumb_url === "string" && item.thumb_url.trim()
              ? item.thumb_url.trim()
              : `/api/recent-thumbnails/${encodeURIComponent(item.request_id)}`,
          prompt: typeof item.prompt === "string" && item.prompt.trim() ? item.prompt.trim() : null,
        }))
      );
    }
  } catch (_) {
    /* Raster bleibt bei GET-Stand */
  }
}

/** Nach Login: Raster aus Datei, dann Abgleich mit fal.ai. */
async function fetchRecentRequestsFromApi() {
  await refreshRecentRequestsGrid();
  await syncRecentRequestsWithFal();
}

/** Prompt-Historie: Von Server laden (session- und geräteübergreifend). */
async function fetchPromptHistory() {
  try {
    const res = await fetch("/api/prompt-history", { credentials: "include" });
    const data = await res.json().catch(() => ({}));
    return Array.isArray(data.items) ? data.items : [];
  } catch {
    return [];
  }
}

/** Prompt-Historie: Aktuelle Liste (für Auswahl beim change). */
let promptHistoryList = [];

/** Prompt-Historie: Auswahlbox befüllen und Liste für Übernahme merken. */
function renderPromptHistorySelect(list) {
  promptHistoryList = list || [];
  if (!promptHistorySelect) return;
  promptHistorySelect.innerHTML = '<option value="">— Prompt aus Historie wählen —</option>';
  promptHistoryList.forEach((item, idx) => {
    const opt = document.createElement("option");
    opt.value = String(idx);
    const date = new Date(item.timestamp);
    const dateStr = date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
    const timeStr = date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
    const preview = item.text.length > 50 ? item.text.slice(0, 50) + "…" : item.text;
    opt.textContent = `${dateStr} ${timeStr} – ${preview}`;
    promptHistorySelect.appendChild(opt);
  });
}

/** Prompt-Historie: Vom Server holen und Auswahlbox aktualisieren. */
async function fetchPromptHistoryAndRender() {
  const list = await fetchPromptHistory();
  renderPromptHistorySelect(list);
}

/** Prompt-Historie: Neuen Prompt serverseitig speichern, danach Liste neu laden. */
async function pushPromptHistory(promptText) {
  if (!promptText || typeof promptText !== "string" || !promptText.trim()) return;
  const trimmed = promptText.trim();
  if (promptHistoryList.some((item) => item.text === trimmed)) return;
  try {
    const res = await fetch("/api/prompt-history", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: trimmed }),
    });
    const data = await res.json().catch(() => ({}));
    const list = Array.isArray(data.items) ? data.items : await fetchPromptHistory();
    renderPromptHistorySelect(list);
  } catch (_) {
    renderPromptHistorySelect(await fetchPromptHistory());
  }
}

/** Prompt-Historie: Bei Auswahl Prompt ins Textfeld übernehmen. */
function setupPromptHistorySelect() {
  if (!promptHistorySelect || !promptInput) return;
  promptHistorySelect.addEventListener("change", () => {
    const idx = promptHistorySelect.value;
    if (idx === "") return;
    const item = promptHistoryList[parseInt(idx, 10)];
    if (item && item.text) {
      promptInput.value = item.text;
    }
    promptHistorySelect.value = "";
  });
}

const MODEL_LABELS = {
  "nano-banana-edit": "Nano Banana Pro (Edit)",
  "nano-banana-t2i": "Nano Banana Pro (Text-zu-Bild)",
  "nano-banana-2-edit": "Nano Banana 2 (Edit)",
  "nano-banana-2-t2i": "Nano Banana 2 (Text-zu-Bild)",
  "flux2-edit": "Flux 2 Turbo (Edit)",
  "flux2-pro-edit": "Flux 2 Pro (Edit)",
  "flux-pro-kontext": "FLUX.1 Kontext [pro] (Edit)",
  "flux2-dev-t2i": "Flux 2 [dev] (Text-zu-Bild)",
  "flux2-pro-t2i": "Flux 2 Pro (Text-zu-Bild)",
  "gpt-image-edit": "GPT-Image 1.5 (Edit)",
  "gpt-image-mini": "GPT-Image 1 Mini (Text-zu-Bild)",
  "gpt-image-2-edit": "GPT-Image 2 (Edit)",
  "gpt-image-2-t2i": "GPT-Image 2 (Text-zu-Bild)",
  "grok-imagine-edit": "Grok Imagine Image (Edit)",
  "grok-imagine-t2i": "Grok Imagine Image (Text-zu-Bild)",
  "remove-bg": "Object Removal / Background entfernen",
  "restore-photo": "Photo Restoration (historische Fotos)",
};

function getModelLabel(modelKey) {
  return MODEL_LABELS[modelKey] || modelKey;
}

/** Erzeugt die Proxy-URL für direkten Download auf das Gerät (Content-Disposition). */
function getDownloadUrl(url, filename) {
  const base = window.location.origin + "/api/download";
  return `${base}?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename || "ergebnis.png")}`;
}

/** Formatiert Byte-Größe lesbar (z. B. "1.2 MB"). */
function formatBytes(bytes) {
  if (bytes == null || typeof bytes !== "number" || bytes < 0) return "—";
  if (bytes === 0) return "0 B";
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${["B", "KB", "MB", "GB"][i]}`;
}

/** Liest Bild-Metadaten (unterstützt snake_case und camelCase). */
function buildImageMeta(image) {
  const w = image.width ?? image.width_px;
  const h = image.height ?? image.height_px;
  const resolution = w != null && h != null ? `${w} × ${h} px` : null;
  const rawSize = image.file_size ?? image.fileSize ?? image.size;
  const size = rawSize != null ? formatBytes(Number(rawSize)) : null;
  const codec = image.content_type ?? image.contentType ?? "—";
  return { resolution, size, codec };
}

/** Aktualisiert den Meta-Block (Auflösung, Größe, Kodierung, optional Erzeugungsdauer). */
function setMetaContent(el, resolution, size, codec, durationSeconds) {
  const r = resolution ?? "—";
  const s = size ?? "—";
  const c = codec ?? "—";
  let text = `Auflösung: ${r} · Größe: ${s} · Kodierung: ${c}`;
  if (durationSeconds != null && Number.isFinite(durationSeconds)) {
    const sec = durationSeconds < 1 ? durationSeconds.toFixed(2) : durationSeconds.toFixed(1);
    text += ` · Dauer: ${sec} s`;
  }
  el.textContent = text;
}

function setStatus(message, type = "") {
  if (statusText) statusText.textContent = message;
  statusMessage.classList.remove("loading", "error", "success");
  if (type) statusMessage.classList.add(type);
}

const recentRequestsSection = document.getElementById("recent-requests-section");

function toggleAuthUI(isAuthenticated) {
  if (isAuthenticated) {
    loginSection.classList.add("hidden");
    editorSection.classList.remove("hidden");
    if (recentRequestsSection) recentRequestsSection.classList.remove("hidden");
    syncModeToModel();
    refreshFalBalance();
    fetchRecentRequestsFromApi();
    fetchPromptHistoryAndRender();
    refreshRecentUploadsGrid();
  } else {
    loginSection.classList.remove("hidden");
    editorSection.classList.add("hidden");
    resultsSection.classList.add("hidden");
    if (recentRequestsSection) recentRequestsSection.classList.add("hidden");
    if (falBalanceEl) falBalanceEl.textContent = "";
  }
}

/** Lädt fal.ai Verbrauch (24h) bzw. Hinweis und füllt #fal-balance. */
async function refreshFalBalance() {
  if (!falBalanceEl) return;
  try {
    const res = await fetch("/api/fal-balance", { credentials: "include" });
    const data = await res.json().catch(() => ({}));
    if (res.ok && typeof data.usage_usd === "number") {
      const cur = data.currency || "USD";
      falBalanceEl.textContent = `fal.ai Verbrauch (24h): $${data.usage_usd.toFixed(2)} ${cur}`;
    } else if (data.hint) {
      falBalanceEl.textContent = "fal.ai: " + data.hint;
    } else {
      falBalanceEl.textContent = "fal.ai: Guthaben im Dashboard anzeigen.";
    }
  } catch {
    falBalanceEl.textContent = "fal.ai: Guthaben im Dashboard anzeigen.";
  }
}

function isTextToImageModel(modelKey) {
  return (
    modelKey === "nano-banana-t2i" ||
    modelKey === "nano-banana-2-t2i" ||
    modelKey === "gpt-image-mini" ||
    modelKey === "gpt-image-2-t2i" ||
    modelKey === "flux2-dev-t2i" ||
    modelKey === "flux2-pro-t2i" ||
    modelKey === "grok-imagine-t2i"
  );
}

function getEditModelImageLimit(modelKey) {
  switch (modelKey) {
    case "nano-banana-edit":
    case "nano-banana-2-edit":
      return 3;
    default:
      return 1;
  }
}

function applyEditUploadLimit(modelKey) {
  const maxImages = getEditModelImageLimit(modelKey);
  imageInputs.forEach((inp, i) => {
    if (!inp) return;
    const isEnabled = i < maxImages;
    inp.disabled = !isEnabled;
    inp.required = i === 0;
    const slot = inp.closest(".upload-slot");
    if (slot) {
      slot.classList.toggle("disabled", !isEnabled);
      slot.setAttribute("aria-disabled", String(!isEnabled));
    }
    if (!isEnabled && inp.files && inp.files.length > 0) {
      clearPreview(i);
    }
  });
}

/** UI (Prompt, Upload, Anzahl) anhand des gewählten Modells ein-/ausblenden. */
function syncModeToModel() {
  const modelKey = modelSelect.value;
  const isGenerate = isTextToImageModel(modelKey);
  const promptHidden = modelKey === "restore-photo" || modelKey === "remove-bg";

  if (isGenerate) {
    uploadGroup.classList.add("hidden");
    numImagesGroup.classList.remove("hidden");
    imageInputs.forEach((inp) => {
      if (!inp) return;
      inp.required = false;
      inp.disabled = false;
    });
    if (promptInput) promptInput.required = true;
    if (promptGroup) promptGroup.classList.remove("hidden");
    if (aspectSelect && aspectSelect.value === "auto") aspectSelect.value = "1:1";
    clearAllPreviews();
    submitButton.textContent = "Bild(er) ändern/erzeugen";
  } else {
    uploadGroup.classList.remove("hidden");
    numImagesGroup.classList.add("hidden");
    applyEditUploadLimit(modelKey);
    if (promptInput) promptInput.required = !promptHidden;
    if (promptGroup) promptGroup.classList.toggle("hidden", promptHidden);
    submitButton.textContent = "Bild(er) ändern/erzeugen";
  }
}

function getPreviewEl(slotIndex) {
  return document.getElementById(`preview-${slotIndex + 1}`);
}

function showThumbnail(slotIndex, file) {
  const preview = getPreviewEl(slotIndex);
  if (!preview) return;
  preview.innerHTML = "";
  preview.removeAttribute("aria-hidden");
  const slot = preview.closest(".upload-slot");
  if (slot) slot.classList.remove("has-file");
  if (!file || !file.type.startsWith("image/")) return;
  const url = URL.createObjectURL(file);
  const img = document.createElement("img");
  img.src = url;
  img.alt = `Vorschau Bild ${slotIndex + 1}`;
  img.referrerPolicy = "no-referrer";
  preview.appendChild(img);
  preview.classList.add("has-thumb");
  if (slot) slot.classList.add("has-file");
}

function setSlotFile(slotIndex, file) {
  const inp = imageInputs[slotIndex];
  if (!inp || !file) return;
  const dt = new DataTransfer();
  dt.items.add(file);
  inp.files = dt.files;
  showThumbnail(slotIndex, file);
}

function clearPreview(slotIndex) {
  const preview = getPreviewEl(slotIndex);
  if (!preview) return;
  const img = preview.querySelector("img");
  if (img && img.src) URL.revokeObjectURL(img.src);
  preview.innerHTML = "";
  preview.classList.remove("has-thumb");
  preview.setAttribute("aria-hidden", "true");
  const slot = preview.closest(".upload-slot");
  if (slot) slot.classList.remove("has-file");
  const inp = imageInputs[slotIndex];
  if (inp) inp.value = "";
}

function clearAllPreviews() {
  [0, 1, 2].forEach((i) => clearPreview(i));
}

function setupUploadPreviews() {
  imageInputs.forEach((inp, i) => {
    if (!inp) return;
    inp.addEventListener("change", async () => {
      const file = inp.files && inp.files[0];
      if (file) {
        showThumbnail(i, file);
        await saveUploadedImageToHistory(file);
      }
      else clearPreview(i);
    });
  });
  document.querySelectorAll(".btn-clear-slot").forEach((btn) => {
    btn.addEventListener("click", () => {
      const slot = parseInt(btn.getAttribute("data-slot"), 10);
      if (slot >= 1 && slot <= 3) clearPreview(slot - 1);
    });
  });
}

let selfieStream = null;

function closeSelfieModal() {
  if (selfieStream) {
    selfieStream.getTracks().forEach((t) => t.stop());
    selfieStream = null;
  }
  if (selfieVideo) selfieVideo.srcObject = null;
  if (selfieModal) selfieModal.classList.add("hidden");
  if (selfieErrorEl) {
    selfieErrorEl.textContent = "";
    selfieErrorEl.classList.add("hidden");
  }
}

function showSelfieError(msg) {
  if (!selfieErrorEl) return;
  selfieErrorEl.textContent = msg;
  selfieErrorEl.classList.remove("hidden");
}

function getFirstEmptySlot() {
  for (let i = 0; i < 3; i++) {
    if (imageInputs[i] && (!imageInputs[i].files || imageInputs[i].files.length === 0))
      return i;
  }
  return -1;
}

function setupSelfieCapture() {
  if (!selfieBtn || !selfieModal || !selfieVideo) {
    console.warn("Selfie: fehlende Elemente (btn=%s, modal=%s, video=%s)", !!selfieBtn, !!selfieModal, !!selfieVideo);
    return;
  }

  function onSelfieClick(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!selfieModal.classList.contains("hidden")) return;
    if (selfieErrorEl) {
      selfieErrorEl.textContent = "";
      selfieErrorEl.classList.add("hidden");
    }
    selfieModal.classList.remove("hidden");
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
      showSelfieError(
        "Kamera wird hier nicht unterstützt. Bitte nutze HTTPS (oder localhost) und einen Browser mit Kamerazugriff."
      );
      return;
    }
    (async () => {
      try {
        selfieStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        selfieVideo.srcObject = selfieStream;
      } catch (err) {
        console.error(err);
        showSelfieError(
          err.name === "NotAllowedError"
            ? "Kamerazugriff wurde verweigert. Bitte erlaube den Zugriff in den Einstellungen."
            : "Kamera konnte nicht geöffnet werden: " + (err.message || err.name)
        );
      }
    })();
  }

  function handleSelfieOpen(e) {
    e.preventDefault();
    e.stopPropagation();
    onSelfieClick(e);
  }
  selfieBtn.addEventListener("click", handleSelfieOpen);
  selfieBtn.addEventListener("pointerup", handleSelfieOpen, { passive: false });

  selfieCancelBtn?.addEventListener("click", closeSelfieModal);

  selfieCaptureBtn?.addEventListener("click", () => {
    const slot = getFirstEmptySlot();
    if (slot < 0) {
      showSelfieError("Alle drei Bild-Slots sind belegt. Bitte zuerst ein Bild entfernen.");
      return;
    }
    const video = selfieVideo;
    if (!video || !video.videoWidth) {
      showSelfieError("Kamera-Bild ist noch nicht bereit. Bitte kurz warten.");
      return;
    }
    const w = video.videoWidth;
    const h = video.videoHeight;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    // Selfie horizontal spiegeln: Ziel mit negativer Breite (w, 0, -w, h)
    ctx.drawImage(video, 0, 0, w, h, w, 0, -w, h);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          showSelfieError("Aufnahme fehlgeschlagen.");
          return;
        }
        const file = new File([blob], "selfie.png", { type: "image/png" });
        setSlotFile(slot, file);
        void saveUploadedImageToHistory(file);
        closeSelfieModal();
      },
      "image/png",
      0.92
    );
  });
}

async function checkAuth() {
  try {
    const res = await fetch("/api/me");
    if (!res.ok) {
      toggleAuthUI(false);
      return;
    }
    const data = await res.json();
    toggleAuthUI(Boolean(data.authenticated));
  } catch {
    toggleAuthUI(false);
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.textContent = "";
  loginButton.disabled = true;

  const password = document.getElementById("password-input").value.trim();

  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ password }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      loginError.textContent =
        data.error || "Anmeldung fehlgeschlagen. Bitte erneut versuchen.";
      return;
    }

    toggleAuthUI(true);
  } catch (err) {
    console.error(err);
    loginError.textContent = "Netzwerkfehler bei der Anmeldung.";
  } finally {
    loginButton.disabled = false;
  }
});

modelSelect.addEventListener("change", () => {
  syncModeToModel();
});

syncModeToModel();

editForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const modelKey = modelSelect.value;
  const prompt = promptInput.value.trim();
  const resolution = resolutionSelect.value;
  const aspectRatio = aspectSelect.value;

  const promptOptional = modelKey === "restore-photo" || modelKey === "remove-bg";
  if (!prompt && !promptOptional) {
    setStatus("Bitte gib einen Prompt ein.", "error");
    return;
  }

  const effectiveMode = isTextToImageModel(modelKey) ? "generate" : "edit";

  if (effectiveMode === "edit") {
    const files = imageInputs
      .filter((inp) => inp && inp.files && inp.files[0])
      .map((inp) => inp.files[0]);
    const maxImages = getEditModelImageLimit(modelKey);
    if (files.length === 0) {
      setStatus("Bitte lade mindestens Bild 1 hoch.", "error");
      return;
    }
    if (files.length > maxImages) {
      const label = maxImages === 1 ? "dieses Modell" : "dieses Modell";
      setStatus(`Für ${label} sind maximal ${maxImages} Bild(er) erlaubt.`, "error");
      return;
    }
  }

  submitButton.disabled = true;
  const modelLabel = getModelLabel(modelKey);

  setStatus("", "loading");

  try {
    let response;

    if (effectiveMode === "edit") {
      const formData = new FormData();
      formData.append("prompt", prompt);
      formData.append("resolution", resolution);
      formData.append("aspectRatio", aspectRatio);
      formData.append("modelKey", modelKey);

      imageInputs.forEach((inp) => {
        if (inp && inp.files && inp.files[0]) formData.append("images", inp.files[0]);
      });

      response = await fetch("/api/edit", {
        method: "POST",
        body: formData,
      });
    } else {
      const numImages = parseInt(numImagesInput.value || "1", 10);

      response = await fetch("/api/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt,
          resolution,
          aspectRatio,
          numImages,
          modelKey,
        }),
      });
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const message =
        errorData.error ||
        `${modelLabel}: Der fal.ai-Aufruf ist fehlgeschlagen. Versuche es erneut.`;
      setStatus(message, "error");
      return;
    }

    const data = await response.json();
    const images = data.images || [];

    if (!images.length) {
      setStatus("Keine Bilder in der Antwort.", "error");
      return;
    }

    await refreshRecentRequestsGrid();

    pushPromptHistory(prompt);

    resultsGrid.innerHTML = "";
    const elapsedSec = data.elapsed_ms != null ? data.elapsed_ms / 1000 : null;
    images.forEach((image, index) => {
      const url = image.url || image.file_url || image.fileUrl;
      if (!url) return;

      const item = document.createElement("div");
      item.className = "result-item";

      const img = document.createElement("img");
      img.alt = "Erzeugtes Bild";

      const meta = buildImageMeta(image);
      const metaEl = document.createElement("div");
      metaEl.className = "result-meta";
      setMetaContent(metaEl, meta.resolution, meta.size, meta.codec, elapsedSec);

      const updateMetaFromImage = () => {
        const resolution = `${img.naturalWidth} × ${img.naturalHeight} px`;
        setMetaContent(metaEl, resolution, meta.size, meta.codec, elapsedSec);
      };
      img.addEventListener("load", updateMetaFromImage);
      img.addEventListener("error", () => {
        setMetaContent(metaEl, meta.resolution ?? "—", meta.size, meta.codec, elapsedSec);
      });
      img.src = url;
      if (img.complete && img.naturalWidth) updateMetaFromImage();

      const filename = image.file_name || `ergebnis-${index + 1}.png`;
      const download = document.createElement("a");
      download.href = getDownloadUrl(url, filename);
      download.className = "download-link";
      download.textContent = "Download";
      download.target = "_blank";
      download.rel = "noopener noreferrer";
      download.download = filename;

      item.appendChild(img);
      item.appendChild(metaEl);
      item.appendChild(download);
      resultsGrid.appendChild(item);
    });

    resultDescription.textContent = data.description || "";
    if (resultCost) {
      const cost = data.cost_estimate_usd;
      resultCost.textContent =
        cost != null
          ? `Geschätzte Kosten (fal.ai): ca. $${Number(cost).toFixed(4)} USD für diesen Request`
          : "";
      resultCost.classList.toggle("hidden", cost == null);
    }
    resultsSection.classList.remove("hidden");
    setStatus("", "success");
  } catch (err) {
    console.error(err);
    setStatus("Unerwarteter Fehler: " + err.message, "error");
  } finally {
    submitButton.disabled = false;
  }
});

function init() {
  setupUploadPreviews();
  setupSelfieCapture();
  setupPromptHistorySelect();
  checkAuth();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

