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
const exampleCategorySelect = document.getElementById("example-category");
const examplePromptSelect = document.getElementById("example-prompt");
const recentRequestsGrid = document.getElementById("recent-requests-grid");

const FAL_RECENT_STORAGE_KEY = "fal_recent_requests";

function getFalPlaygroundUrl(endpointId, requestId) {
  const base = `https://fal.ai/models/${endpointId}/playground`;
  return requestId ? `${base}?requestId=${encodeURIComponent(requestId)}` : base;
}

function loadRecentRequests() {
  try {
    return JSON.parse(localStorage.getItem(FAL_RECENT_STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveRecentRequests(arr) {
  localStorage.setItem(FAL_RECENT_STORAGE_KEY, JSON.stringify(arr.slice(0, 9)));
}

function renderRecentRequestsGrid() {
  if (!recentRequestsGrid) return;
  const list = loadRecentRequests();
  recentRequestsGrid.innerHTML = "";
  for (let i = 0; i < 9; i++) {
    const cell = document.createElement("div");
    cell.className = "recent-request-cell" + (list[i] ? "" : " empty");
    cell.setAttribute("aria-label", list[i] ? "Request im Playground öffnen" : "Leerer Platz");
    if (list[i]) {
      const a = document.createElement("a");
      a.href = getFalPlaygroundUrl(list[i].endpoint_id, list[i].request_id);
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.title = "Request im fal.ai Playground öffnen";
      const img = document.createElement("img");
      img.src = list[i].image_url;
      img.alt = "";
      a.appendChild(img);
      cell.appendChild(a);
    }
    recentRequestsGrid.appendChild(cell);
  }
}

function pushRecentRequest(requestId, endpointId, imageUrl) {
  if (!requestId || !endpointId || !imageUrl) return;
  const list = loadRecentRequests();
  list.unshift({ request_id: requestId, endpoint_id: endpointId, image_url: imageUrl });
  saveRecentRequests(list);
  renderRecentRequestsGrid();
}

/** Beim ersten Aufruf: letzte 9 Requests von der fal.ai API holen und 3×3-Raster damit füllen. */
async function fetchRecentRequestsFromApi() {
  try {
    const res = await fetch("/api/recent-requests", { credentials: "include" });
    if (!res.ok) return;
    const list = await res.json();
    if (!Array.isArray(list) || list.length === 0) return;
    const normalized = list.slice(0, 9).map((item) => ({
      request_id: item.request_id,
      endpoint_id: item.endpoint_id,
      image_url: item.image_url,
    }));
    saveRecentRequests(normalized);
    renderRecentRequestsGrid();
  } catch (_) {
    // Fallback: Raster bleibt mit lokal gespeicherten Requests
  }
}

const MODEL_LABELS = {
  "nano-banana-edit": "Nano Banana Pro (Edit)",
  "nano-banana-t2i": "Nano Banana Pro (Text-zu-Bild)",
  "flux2-edit": "Flux 2 Turbo (Edit)",
  "flux2-pro-edit": "Flux 2 Pro (Edit)",
  "flux-pro-kontext": "FLUX.1 Kontext [pro] (Edit)",
  "flux2-dev-t2i": "Flux 2 [dev] (Text-zu-Bild)",
  "flux2-pro-t2i": "Flux 2 Pro (Text-zu-Bild)",
  "gpt-image-edit": "GPT-Image 1.5 (Edit)",
  "gpt-image-mini": "GPT-Image 1 Mini (Text-zu-Bild)",
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
    modelKey === "gpt-image-mini" ||
    modelKey === "flux2-dev-t2i" ||
    modelKey === "flux2-pro-t2i" ||
    modelKey === "grok-imagine-t2i"
  );
}

/** UI (Prompt, Upload, Anzahl) anhand des gewählten Modells ein-/ausblenden. */
function syncModeToModel() {
  const modelKey = modelSelect.value;
  const isGenerate = isTextToImageModel(modelKey);
  const promptHidden = modelKey === "restore-photo" || modelKey === "remove-bg";

  if (isGenerate) {
    uploadGroup.classList.add("hidden");
    numImagesGroup.classList.remove("hidden");
    imageInputs.forEach((inp) => inp && (inp.required = false));
    if (promptInput) promptInput.required = true;
    if (promptGroup) promptGroup.classList.remove("hidden");
    if (aspectSelect && aspectSelect.value === "auto") aspectSelect.value = "1:1";
    clearAllPreviews();
    submitButton.textContent = "Bild(er) ändern/erzeugen";
  } else {
    uploadGroup.classList.remove("hidden");
    numImagesGroup.classList.add("hidden");
    if (imageInputs[0]) imageInputs[0].required = true;
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

function setupExamplePrompts() {
  if (typeof window.EXAMPLE_PROMPTS === "undefined" || !Array.isArray(window.EXAMPLE_PROMPTS) || !exampleCategorySelect || !examplePromptSelect || !promptInput) return;
  const prompts = window.EXAMPLE_PROMPTS;
  const categories = [...new Set(prompts.map((p) => p.category))].sort();
  exampleCategorySelect.innerHTML = '<option value="">— Kategorie wählen —</option>';
  categories.forEach((cat) => {
    const opt = document.createElement("option");
    opt.value = cat;
    opt.textContent = cat;
    exampleCategorySelect.appendChild(opt);
  });

  function fillPromptDropdown(category) {
    examplePromptSelect.innerHTML = '<option value="">— Beispiel wählen —</option>';
    if (!category) return;
    prompts.forEach((p, i) => {
      if (p.category !== category) return;
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = p.short;
      examplePromptSelect.appendChild(opt);
    });
  }

  exampleCategorySelect.addEventListener("change", () => {
    fillPromptDropdown(exampleCategorySelect.value);
  });

  examplePromptSelect.addEventListener("change", () => {
    const idx = examplePromptSelect.value;
    if (idx === "" || !prompts[parseInt(idx, 10)]) return;
    promptInput.value = prompts[parseInt(idx, 10)].prompt;
  });
}

function setupUploadPreviews() {
  imageInputs.forEach((inp, i) => {
    if (!inp) return;
    inp.addEventListener("change", () => {
      const file = inp.files && inp.files[0];
      if (file) showThumbnail(i, file);
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
        const inp = imageInputs[slot];
        if (inp) {
          const dt = new DataTransfer();
          dt.items.add(file);
          inp.files = dt.files;
          showThumbnail(slot, file);
        }
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
    if (files.length === 0) {
      setStatus("Bitte lade mindestens Bild 1 hoch.", "error");
      return;
    }
    if (files.length > 3) {
      setStatus("Es sind maximal 3 Bilder erlaubt.", "error");
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

    const firstImageUrl = images[0].url || images[0].file_url || images[0].fileUrl;
    if (data.request_id && data.endpoint_id && firstImageUrl) {
      pushRecentRequest(data.request_id, data.endpoint_id, firstImageUrl);
    }

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
  setupExamplePrompts();
  setupUploadPreviews();
  setupSelfieCapture();
  renderRecentRequestsGrid();
  checkAuth();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

