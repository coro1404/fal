# fal.ai Bildbearbeitungs-Webapp

Eine mobile-first Web-Anwendung zur **Bildbearbeitung und Text-zu-Bild-Generierung** über die [fal.ai](https://fal.ai)-API. Die App bündelt mehrere fal.ai-Modelle in einer einfachen Oberfläche: Bild-zu-Bild-Edits (1–3 Uploads), Text-zu-Bild, Objekt-/Hintergrund-Entfernung und Foto-Restaurierung. Sie läuft als Node.js-Express-Server, optional in Docker, und ist mit einem einfachen Passwort geschützt.

---

## Inhaltsverzeichnis

- [Features](#features)
- [Verwendete Modelle (fal.ai)](#verwendete-modelle-falai)
- [Technologie-Stack und Libraries](#technologie-stack-und-libraries)
- [Projektstruktur](#projektstruktur)
- [Voraussetzungen](#voraussetzungen)
- [Konfiguration](#konfiguration)
- [Lokaler Start](#lokaler-start)
- [Docker](#docker)
- [API-Überblick](#api-überblick)

---

## Features

- **Mobile-first UI**: Einspaltiges, touch-freundliches Layout für Smartphones und Desktop.
- **Modellauswahl**: Ein Dropdown wählt zwischen allen unterstützten Modellen (Edit, Text-zu-Bild, Spezial-Tools).
- **Bild-zu-Bild (Edit)**:
  - Upload von 1–3 Bildern, Prompt, optional Auflösung (1K/2K/4K) und Seitenverhältnis.
  - Unterstützte Edit-Modelle: Nano Banana Pro, **Nano Banana 2**, Flux 2 Turbo/Pro, FLUX.1 Kontext [pro], GPT-Image 1.5, Grok Imagine Image, Objekt entfernen, Foto-Restaurierung.
- **Text-zu-Bild**: Prompt, Seitenverhältnis, Anzahl Ausgaben (1–4); Modelle z. B. Nano Banana Pro, **Nano Banana 2**, Flux 2 [dev]/Pro, GPT-Image 1 Mini, Grok Imagine Image.
- **Selfie-Aufnahme**: Optional Bild direkt aus der Kamera aufnehmen und in einen Upload-Slot übernehmen.
- **Beispielprompts**: Kategorien und Beispiele aus [awesome-nanobanana-pro](https://github.com/ZeroLu/awesome-nanobanana-pro) zum Befüllen des Prompt-Feldes.
- **Prompt-Historie**: Die letzten 25 verwendeten Prompts werden **serverseitig** in `data/prompt-history.json` gespeichert. Session- und geräteübergreifend: gleiche Historie für alle Nutzer/Sessions; Auswahlbox mit Datum/Uhrzeit, Übernahme in das Prompt-Feld bei Auswahl. **Identische Prompts** (exakt gleicher Text nach Trim) werden nicht erneut eingetragen – bestehender Eintrag bleibt unverändert.
- **Ergebnis**: Anzeige der generierten Bilder mit Auflösung/Größe/Kodierung, Download-Link (über Download-Proxy) und geschätzter Kostenhinweis.
- **Letzte Requests (3×3-Raster)**: Die letzten 9 erfolgreichen Requests (API + fal.ai Web-Playground) werden aus der fal.ai Platform-API geladen; Klick auf ein Bild öffnet den passenden fal.ai-Playground mit `requestId` und `request_id`. Wo die Plattform den Prompt nicht ins Playground übernimmt („no prompt“), liefert die App den gespeicherten Prompt aus `json_input` (falls vorhanden) und kopiert ihn beim Klick in die Zwischenablage.
- **fal.ai Verbrauch**: Anzeige des 24h-Verbrauchs in USD (wenn der API-Key entsprechende Rechte hat).
- **Passwortschutz**: Ein globales Passwort (`APP_PASSWORD`); nach Login Session per Cookie (bis zu 30 Tage).

---

## Verwendete Modelle (fal.ai)

Alle Aufrufe laufen über die fal.ai-API; die App nutzt folgende Endpoints (Auswahl im UI unter „Modell“).

| Modell (UI) | fal.ai Endpoint | Typ | Kurzbeschreibung |
|-------------|-----------------|-----|-------------------|
| Nano Banana Pro (Edit) | `fal-ai/nano-banana-pro/edit` | Edit | Bild-zu-Bild mit 1–3 Bildern |
| Nano Banana Pro (Text-zu-Bild) | `fal-ai/nano-banana-pro` | Text-zu-Bild | |
| Nano Banana 2 (Edit) | `fal-ai/nano-banana-2/edit` | Edit | Bild-zu-Bild mit 1–3 Bildern (u. a. bis 14 Referenzbilder möglich) |
| Nano Banana 2 (Text-zu-Bild) | `fal-ai/nano-banana-2` | Text-zu-Bild | |
| Flux 2 Turbo (Edit) | `fal-ai/flux-2/turbo/edit` | Edit | |
| Flux 2 Pro (Edit) | `fal-ai/flux-2-pro/edit` | Edit | |
| FLUX.1 Kontext [pro] (Edit) | `fal-ai/flux-pro/kontext` | Edit (1 Bild) | Image-to-Image |
| Flux 2 [dev] (Text-zu-Bild) | `fal-ai/flux-2` | Text-zu-Bild | |
| Flux 2 Pro (Text-zu-Bild) | `fal-ai/flux-2-pro` | Text-zu-Bild | |
| GPT-Image 1.5 (Edit) | `fal-ai/gpt-image-1.5/edit` | Edit | |
| GPT-Image 1 Mini (Text-zu-Bild) | `fal-ai/gpt-image-1-mini` | Text-zu-Bild | |
| Grok Imagine Image (Edit) | `xai/grok-imagine-image/edit` | Edit (1 Bild) | xAI |
| Grok Imagine Image (Text-zu-Bild) | `xai/grok-imagine-image` | Text-zu-Bild | xAI |
| Objekt/Background entfernen | `fal-ai/object-removal` | Spezial | 1 Bild, optionaler Prompt (z. B. „Hintergrund“) |
| Historische Fotos restaurieren | `fal-ai/image-editing/photo-restoration` | Spezial | 1 Bild, kein Prompt |

Für das **3×3-Raster „Letzte Requests“** werden zusätzlich Requests an das Modell **`fal-ai/flux-lora`** abgefragt (falls vorhanden).

---

## Technologie-Stack und Libraries

- **Laufzeit**: Node.js **24** (LTS), siehe `engines` in `package.json`.
- **Server**: Express (ESM), statische Dateien aus `public/`, Cookie-basierte Session, Proxy für Download und fal.ai-Aufrufe.

### Abhängigkeiten (production)

| Paket | Version (SemVer-Range) | Zweck |
|-------|------------------------|--------|
| **@fal-ai/client** | ^1.9.4 | Offizieller fal.ai JavaScript-Client; `fal.subscribe()` für synchrone Modell-Aufrufe. |
| **cookie-parser** | ^1.4.7 | Middleware zum Auslesen von Cookies (Session-Token). |
| **dotenv** | ^16.4.5 | Lädt Umgebungsvariablen aus `.env`. |
| **express** | ^4.22.0 | Web-Framework, Routen, Middleware, statische Dateien. |
| **multer** | ^2.1.1 | Multipart-Upload (Bilder); Version 2 nutzt Streams, in der App werden Streams in Buffer gelesen für data-URLs an fal.ai. |

Keine weiteren Production-Abhängigkeiten. Frontend: Vanilla JS, kein Build-Step.

### Node- und npm-Versionen

- **Node**: `>=24.0.0` (in `package.json` unter `engines.node`).
- **npm**: Im Docker-Build wird global `npm@11` installiert, um die „New major version“-Meldung zu vermeiden.

---

## Projektstruktur

```
falai/
├── server.js           # Express-Server: Auth, /api/edit, /api/generate, /api/download, /api/recent-requests, /api/prompt-history, /api/fal-balance, statische Dateien
├── package.json        # name, scripts, engines, dependencies
├── Dockerfile          # node:24-alpine, npm@11, production install, CMD npm start
├── docker-compose.yml  # Service „web“, Port 3321, FAL_KEY + APP_PASSWORD
├── README.md
├── data/               # Docker: ./data → /app/data; prompt-history.json (gitignored)
│   └── .gitkeep
└── public/
    ├── index.html      # SPA: Login, Editor (Modell, Prompt, Upload, Selfie, Optionen), Ergebnis, 3×3-Raster
    ├── app.js          # Frontend-Logik: Auth, Formular, Upload-Preview, Selfie-Modal, Ergebnis-Anzeige, Raster, Prompt-Historie
    ├── styles.css      # Layout, Komponenten, Raster, Selfie-Modal
    └── example-prompts.js # Kategorien/Beispiele für awesome-nanobanana-pro (geladen in index.html)
```

---

## Voraussetzungen

- **Node.js 24** (LTS) oder Docker mit Image `node:24-alpine`.
- Ein gültiger **fal.ai API-Key** ([fal.ai Dashboard](https://fal.ai/dashboard)); für „Letzte Requests“ und optional „fal.ai Verbrauch“ wird die fal.ai Platform-API genutzt (gleicher Key).

---

## Konfiguration

Umgebungsvariablen (lokal oder in Docker/docker-compose):

| Variable | Pflicht | Beschreibung |
|----------|--------|--------------|
| **FAL_KEY** | Ja | fal.ai API-Key. Ohne Key startet der Server, aber Modell-Aufrufe schlagen fehl. |
| **APP_PASSWORD** | Nein | Passwort für den Login; Standard: `changeme`. |
| **PORT** | Nein | Port des Servers; Standard: `3321`. |
| **NODE_ENV** | Nein | z. B. `production` (Docker). |
| **FAL_DATA_DIR** | Nein | Verzeichnis für `prompt-history.json` (Docker: z. B. `/app/data` bei Volume `./data:/app/data`). Standard: `data/` neben `server.js`. |

Optional: `.env` im Projektroot mit `FAL_KEY=…` und `APP_PASSWORD=…`; wird von `dotenv` geladen.

---

## Lokaler Start

```bash
cd /pfad/zu/falai

# Umgebungsvariablen (oder .env)
export FAL_KEY="dein-fal-ai-api-key"
export APP_PASSWORD="dein-passwort"   # optional, Standard: changeme

npm install
npm start
```

- **Entwicklung** (ohne NODE_ENV=production):  
  `npm run dev` (setzt `NODE_ENV=development`).

Die App ist unter **http://localhost:3321** erreichbar (oder unter dem gewählten `PORT`).

---

## Docker

### Build und Run (einzelner Container)

```bash
docker build -t falai-webapp .

docker run -p 3321:3321 \
  -v "$(pwd)/data:/app/data" \
  -e FAL_DATA_DIR=/app/data \
  -e FAL_KEY="dein-fal-ai-api-key" \
  -e APP_PASSWORD="dein-passwort" \
  falai-webapp
```

Der Ordner **`./data` auf dem Host** (gebunden nach `/app/data`) enthält `prompt-history.json` und bleibt über Container-Neustarts und Rebuilds erhalten. Ohne Volume und ohne `FAL_DATA_DIR` auf dauerhaftem Speicher geht die Historie bei einem neuen Container verloren.

### Docker Compose

```bash
# .env im Projektroot mit FAL_KEY und optional APP_PASSWORD
docker compose up -d
```

In `docker-compose.yml`: Service `web`, Port `3321`, **`./data:/app/data`** (Bind-Mount im Projektordner) und **`FAL_DATA_DIR=/app/data`**, damit `prompt-history.json` auf dem Host liegt und nach Neustart/Rebuild erhalten bleibt. **Hinweis:** `docker compose down -v` entfernt nur benannte Volumes – bei Bind-Mount `./data` bleibt der Ordner auf der Platte. Wechselt der Compose-Projektname (`COMPOSE_PROJECT_NAME`) bei benannten Volumes, wirkt eine „leere“ Historie oft wie Datenverlust (neues Volume).

---

## API-Überblick

Alle API-Routen (außer Login) erfordern eine gültige Session (Cookie nach Login).

| Methode | Pfad | Beschreibung |
|--------|------|--------------|
| POST | `/api/login` | Login mit `password`; setzt Session-Cookie. |
| GET | `/api/me` | Prüft, ob Session gültig ist. |
| GET | `/api/prompt-history` | Liefert die serverseitige Prompt-Historie: `{ items: [ { text, timestamp }, … ] }` (max. 25). |
| POST | `/api/prompt-history` | Speichert einen neuen Prompt (Body: `{ text: "…" }`), sofern derselbe Text noch nicht in der Historie steht; sonst unveränderte Liste ohne erneutes Schreiben. |
| GET | `/api/fal-balance` | fal.ai 24h-Verbrauch in USD (wenn Key berechtigt). |
| GET | `/api/recent-requests` | Letzte 9 erfolgreichen Requests (fal.ai Platform-API, 7 Tage, alle konfigurierten Endpoints inkl. `fal-ai/flux-lora`); Antwort: `[{ request_id, endpoint_id, image_url }]`. |
| POST | `/api/edit` | Bild-zu-Bild: `multipart/form-data` (images, prompt, modelKey, …); ruft fal.ai Edit-Endpoints auf. |
| POST | `/api/generate` | Text-zu-Bild: JSON (prompt, modelKey, aspectRatio, numImages, …). |
| GET | `/api/download?url=…&filename=…` | Proxy-Download; erlaubte Hosts: `*.fal.media`, `fal.media`, `storage.googleapis.com`. |

Statische Dateien werden aus `public/` ausgeliefert; unbekannte GET-Pfade liefern `index.html` (SPA-Fallback).
