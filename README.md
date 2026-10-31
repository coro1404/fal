# fal.ai Bildbearbeitungs-Webapp

Eine mobile-first Web-Anwendung zur **Bildbearbeitung und Text-zu-Bild-Generierung** über die [fal.ai](https://fal.ai)-API. Die App bündelt die aktuellen fal.ai-Modelle in einer einfachen Oberfläche: Bild-zu-Bild-Edits (1–3 Uploads), Text-zu-Bild, Objekt-/Hintergrund-Entfernung und Foto-Restaurierung. Sie läuft als Node.js-Express-Server, wird **über Docker Compose** betrieben und ist mit einem einfachen Passwort geschützt.

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
- [Remote-Deployment (Docker Compose)](#remote-deployment-docker-compose)
- [API-Überblick](#api-überblick)

---

## Features

- **Mobile-first UI**: Einspaltiges, touch-freundliches Layout für Smartphones und Desktop (Tailwind CSS v4).
- **Modellauswahl**: Ein Dropdown wählt zwischen allen unterstützten Modellen (Edit, Text-zu-Bild, Spezial-Tools). Pro Modellfamilie ist jeweils nur die **neueste** fal.ai-Version eingebunden.
- **Bild-zu-Bild (Edit)**:
  - Upload von 1–3 Bildern, Prompt, optional Auflösung (1K/2K/4K) und Seitenverhältnis.
  - Edit-Modelle: **Nano Banana Pro**, **Nano Banana 2.1**, **FLUX 3**, **GPT Image 2.5 Sunburst**, **Grok Imagine 2.0**, Objekt entfernen, Foto-Restaurierung.
- **Text-zu-Bild**: Prompt, Seitenverhältnis, Anzahl Ausgaben (1–4); Modelle: Nano Banana Pro, Nano Banana 2.1, FLUX 3, GPT Image 2.5 Sunburst, Grok Imagine 2.0.
- **Selfie-Aufnahme**: Optional Bild direkt aus der Kamera aufnehmen und in einen Upload-Slot übernehmen.
- **Prompt-Historie**: Die letzten 25 verwendeten Prompts werden **serverseitig** in `data/prompt-history.json` gespeichert. Session- und geräteübergreifend: gleiche Historie für alle Nutzer/Sessions; Auswahlbox mit Datum/Uhrzeit, Übernahme in das Prompt-Feld bei Auswahl. **Identische Prompts** (exakt gleicher Text nach Trim) werden nicht erneut eingetragen – bestehender Eintrag bleibt unverändert.
- **Gespeicherte Sets**: Prompt und Slot-Bilder dauerhaft speichern/laden.
- **Letzte Uploads (3 Miniaturen)**: Die letzten 3 hochgeladenen Bilder werden **persistent serverseitig** gespeichert und als Miniatur-Buttons unter den Upload-Slots angezeigt. Ein Klick übernimmt ein gespeichertes Bild in den nächsten freien Slot.
- **Ergebnis**: Anzeige der generierten Bilder mit Auflösung/Größe/Kodierung, Download-Link (über Download-Proxy) und geschätzter Kostenhinweis.
- **Letzte Requests (3×3-Raster)**: Chronologisch die **letzten 9 Requests über alle Modelle** hinweg, persistent in `data/recent-requests.json`. Nach Reload oder Container-Neustart bleibt die Liste erhalten; bei Login optional Sync mit der fal.ai-Platform-Historie (**POST `/api/recent-requests/sync`**).
- **Vorschaubilder (Thumbnails)**: Kleine **WebP**-Dateien (max. Kantenlänge 288 px) unter **`data/thumbnails/`** (bzw. `$FAL_DATA_DIR/thumbnails`), ausgeliefert über **GET `/api/recent-thumbnails/:requestId`**.
- **fal.ai Verbrauch**: Anzeige des 24h-Verbrauchs in USD (wenn der API-Key entsprechende Rechte hat).
- **Passwortschutz**: Globales Passwort (`APP_PASSWORD`); nach Login Session per Cookie (bis zu 30 Tage).

---

## Verwendete Modelle (fal.ai)

Alle Aufrufe laufen über die fal.ai-API; die App nutzt folgende Endpoints (Auswahl im UI unter „Modell“). Ältere Varianten (Flux 2, FLUX.1 Kontext, GPT Image 1.x/2, Nano Banana 2.0, Grok Imagine v1) sind entfernt.

| Modell (UI) | fal.ai Endpoint | Typ | Kurzbeschreibung |
|-------------|-----------------|-----|-------------------|
| Nano Banana Pro (Edit) | `fal-ai/nano-banana-pro/edit` | Edit | Gemini 3 Pro Image, 1–3 Bilder |
| Nano Banana Pro (Text-zu-Bild) | `fal-ai/nano-banana-pro` | Text-zu-Bild | |
| Nano Banana 2.1 (Edit) | `google/nano-banana-2.1/edit` | Edit | Flash-Tier, API bis 14 Refs (UI: 1–3) |
| Nano Banana 2.1 (Text-zu-Bild) | `google/nano-banana-2.1` | Text-zu-Bild | u. a. Web-Search, Thinking |
| FLUX 3 (Edit) | `blackforestlabs/flux-3/edit-image` | Edit | API bis 10 Refs (UI: 1–3) |
| FLUX 3 (Text-zu-Bild) | `blackforestlabs/flux-3/text-to-image` | Text-zu-Bild | native 2K/4K |
| GPT Image 2.5 Sunburst (Edit) | `openai/gpt-image-2.5/sunburst/edit` | Edit | API bis 16 Refs (UI: 1–3) |
| GPT Image 2.5 Sunburst (Text-zu-Bild) | `openai/gpt-image-2.5/sunburst/text-to-image` | Text-zu-Bild | Quality/Size-Parameter |
| Grok Imagine 2.0 (Edit) | `xai/grok-imagine-image/v2.0/edit` | Edit | API bis 5 Refs (UI: 1–3), xAI |
| Grok Imagine 2.0 (Text-zu-Bild) | `xai/grok-imagine-image/v2.0/text-to-image` | Text-zu-Bild | Auflösung bis 2K |
| Objekt/Background entfernen | `fal-ai/object-removal` | Spezial | 1 Bild, optionaler Prompt |
| Historische Fotos restaurieren | `fal-ai/image-editing/photo-restoration` | Spezial | 1 Bild, kein Prompt |

Beim **Sync** mit fal.ai werden alle konfigurierten Endpoints abgefragt und mit `recent-requests.json` gemerged (max. 9 Einträge nach Zeitstempel).

---

## Technologie-Stack und Libraries

- **Laufzeit**: Node.js **24** (LTS), siehe `engines` in `package.json`.
- **Server**: Express (ESM), statische Dateien aus `public/`, Cookie-basierte Session, Proxy für Download und fal.ai-Aufrufe.
- **CSS**: Tailwind CSS **v4.3** – Quelle `src/styles.css`, Build nach `public/styles.css` (`@tailwindcss/cli`).
- **Frontend**: Vanilla JS (kein Bundler); CSS-Build ist der einzige Frontend-Build-Schritt.
- **Deploy**: Docker Compose auf Remote-Hosts über `./deploy.sh`.

### Abhängigkeiten (production)

| Paket | Version (SemVer-Range) | Zweck |
|-------|------------------------|--------|
| **@fal-ai/client** | ^1.10.1 | Offizieller fal.ai JavaScript-Client; `fal.subscribe()` für synchrone Modell-Aufrufe. |
| **cookie-parser** | ^1.4.7 | Middleware zum Auslesen von Cookies (Session-Token). |
| **dotenv** | ^18.0.9 | Lädt Umgebungsvariablen aus `.env`. |
| **express** | ^5.3.0 | Web-Framework, Routen, Middleware, statische Dateien. |
| **multer** | ^2.5.0 | Multipart-Upload (Bilder); Streams werden in Buffer gelesen für data-URLs an fal.ai. |
| **sharp** | ^0.35.5 | Skaliert Ergebnisbilder zu WebP-Thumbnails für das 3×3-Raster (lokal persistent). |

### Dev-Abhängigkeiten

| Paket | Version | Zweck |
|-------|---------|--------|
| **tailwindcss** | ^4.3.3 | Utility-CSS und Theme (`@theme`, `@layer`). |
| **@tailwindcss/cli** | ^4.3.3 | CLI-Build: `src/styles.css` → `public/styles.css`. |

### npm-Scripts

| Script | Beschreibung |
|--------|--------------|
| `npm run build:css` | Einmaliger Tailwind-Build. |
| `npm run dev:css` | Tailwind im Watch-Modus. |
| `npm run dev` | CSS bauen und Server mit `NODE_ENV=development` starten. |
| `npm start` | Server starten (`node server.js`; CSS muss zuvor gebaut sein bzw. kommt aus dem Docker-Build). |

### Node- und npm-Versionen

- **Node**: `>=24.0.0` (in `package.json` unter `engines.node`).
- **npm**: Im Docker-Build wird global `npm@11.21.1` installiert; `npm ci`, CSS-Build, danach `npm prune --omit=dev`.

---

## Projektstruktur

```
falai/
├── server.js            # Express: Auth, Edit/Generate, Recent-Requests, Prompt-Historie, Downloads, …
├── package.json         # Scripts, engines, dependencies
├── package-lock.json
├── Dockerfile           # node:24-alpine, npm ci, CSS-Build, prune, CMD node server.js
├── docker-compose.yml   # Service „web“, Port 3321, Volume ./data, FAL_KEY / APP_PASSWORD
├── .dockerignore        # u. a. node_modules, data, .env, .git
├── deploy.sh            # Remote-Deploy: rsync + docker compose up -d --build
├── README.md
├── src/
│   └── styles.css       # Tailwind-v4-Quelle (@import, @theme, Komponenten)
├── data/                # Persistente App-Daten (Docker-Bind-Mount; Inhalt gitignored)
│   ├── .gitkeep
│   └── thumbnails/.gitkeep
└── public/
    ├── index.html       # SPA: Login, Editor, Ergebnis, 3×3-Raster
    ├── app.js           # Frontend-Logik
    └── styles.css       # Gebautes CSS (Ausgabe von build:css)
```

---

## Voraussetzungen

- **Node.js 24** (LTS) für lokalen Start **oder** Docker / Docker Compose für Build und Betrieb.
- Für Remote-Deploy: SSH-Zugang zum Zielhost, `rsync` lokal, Docker Compose auf dem Host.
- Ein gültiger **fal.ai API-Key** ([fal.ai Dashboard](https://fal.ai/dashboard)); für „Letzte Requests“ und optional „fal.ai Verbrauch“ wird die fal.ai Platform-API genutzt (gleicher Key).

---

## Konfiguration

Umgebungsvariablen (lokal oder in Docker/docker-compose über `.env`):

| Variable | Pflicht | Beschreibung |
|----------|--------|--------------|
| **FAL_KEY** | Ja | fal.ai API-Key. Ohne Key startet der Server, aber Modell-Aufrufe schlagen fehl. |
| **APP_PASSWORD** | Nein | Passwort für den Login; Standard: `changeme`. |
| **PORT** | Nein | Port des Servers; Standard: `3321`. |
| **NODE_ENV** | Nein | z. B. `production` (Docker). |
| **FAL_DATA_DIR** | Nein | Verzeichnis für Prompt-Historie, Recent-Requests, Uploads, Sets, Slot-State sowie **`thumbnails/`** u. a. (Docker: `/app/data` bei Volume `./data:/app/data`). Standard: `data/` neben `server.js`. |

Beispiel `.env` im Projektroot:

```bash
FAL_KEY=dein-fal-ai-api-key
APP_PASSWORD=dein-passwort
```

---

## Lokaler Start

```bash
cd /pfad/zu/falai

# Umgebungsvariablen (oder .env)
export FAL_KEY="dein-fal-ai-api-key"
export APP_PASSWORD="dein-passwort"   # optional, Standard: changeme

npm install
npm run build:css
npm start
```

- **Entwicklung**: `npm run dev` (baut CSS und startet mit `NODE_ENV=development`). CSS-Watch parallel: `npm run dev:css`.

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

Der Ordner **`./data` auf dem Host** (gebunden nach `/app/data`) enthält Persistenzdaten (Prompt-Historie, Recent-Requests, Uploads, Thumbnails, Sets, Slots) und bleibt über Container-Neustarts und Rebuilds erhalten.

### Docker Compose (lokal)

```bash
# .env im Projektroot mit FAL_KEY und optional APP_PASSWORD
docker compose up -d --build
```

In `docker-compose.yml`: Service `web`, Port `3321`, Bind-Mount **`./data:/app/data`**, **`FAL_DATA_DIR=/app/data`**.  
**Hinweis:** `docker compose down -v` entfernt nur benannte Volumes – bei Bind-Mount `./data` bleibt der Ordner auf der Platte.

---

## Remote-Deployment (Docker Compose)

Produktiv-Deployment erfolgt über **`./deploy.sh`**: App-Dateien werden per `rsync` auf den Host kopiert, das Compose-Projekt dort gebaut und gestartet. **`data/` wird nicht überschrieben**; eine bereits vorhandene Remote-`.env` bleibt unangetastet.

### Voraussetzungen auf dem Client

- `ssh`, `rsync`
- Ausführbares Skript: `chmod +x deploy.sh` (falls nötig)
- Lokal eine `.env` mit `FAL_KEY`, **oder** bereits eine `.env` auf dem Remote-Host

### Voraussetzungen auf dem Host

- Docker mit Plugin **`docker compose`** (oder `docker-compose`)
- Absolutes Deploy-Verzeichnis (z. B. `/opt/falai`)

### Aufruf

```bash
./deploy.sh user@host /opt/falai
```

Beispiel:

```bash
./deploy.sh deploy@example.com /opt/falai
```

### Was das Skript macht

1. Legt das Deploy-Verzeichnis auf dem Host an.
2. Synchronisiert den App-Tree per `rsync --delete` **ohne** `node_modules/`, `.git/`, `data/`, `.env`.
3. Stellt leere `data/`-Unterordner nur her, falls sie fehlen (bestehende Dateien bleiben).
4. Kopiert die lokale `.env` **nur**, wenn remote noch keine existiert.
5. Führt remote aus: `docker compose up -d --build` (Fallback: `docker-compose`).

Die App lauscht danach auf Port **3321**; Persistenz liegt weiterhin unter `<deploy-verzeichnis>/data`.

Hilfe: `./deploy.sh --help`

---

## API-Überblick

Alle API-Routen (außer Login) erfordern eine gültige Session (Cookie nach Login).

| Methode | Pfad | Beschreibung |
|--------|------|--------------|
| POST | `/api/login` | Login mit `password`; setzt Session-Cookie. |
| GET | `/api/me` | Prüft, ob Session gültig ist. |
| GET | `/api/prompt-history` | Serverseitige Prompt-Historie: `{ items: [ { text, timestamp }, … ] }` (max. 25). |
| POST | `/api/prompt-history` | Speichert einen neuen Prompt (Body: `{ text: "…" }`), sofern derselbe Text noch nicht existiert. |
| GET | `/api/fal-balance` | fal.ai 24h-Verbrauch in USD (wenn Key berechtigt). |
| GET | `/api/recent-requests` | Letzte 9 Einträge aus `recent-requests.json`; Antwort inkl. `thumb_url` → `/api/recent-thumbnails/…`. |
| GET | `/api/recent-thumbnails/:requestId` | Gespeicherte WebP-Vorschau; `Cache-Control: public, max-age=604800`. |
| GET | `/api/recent-uploaded-images` | Letzte 3 gespeicherte Uploads. |
| POST | `/api/recent-uploaded-images` | Speichert ein Upload-Bild (FormData-Feld `image`) inkl. Miniatur. |
| GET | `/api/recent-uploaded-images/:id` | Originalbild für erneute Slot-Nutzung. |
| GET | `/api/recent-uploaded-images/:id/thumb` | WebP-Miniatur der Upload-Historie. |
| POST | `/api/recent-requests/sync` | Merged lokale Datei mit fal.ai-Historie (alle konfigurierten Endpoints, 7 Tage), aktualisiert Thumbnails. |
| POST | `/api/edit` | Bild-zu-Bild: `multipart/form-data` (`images`, `prompt`, `modelKey`, …). |
| POST | `/api/generate` | Text-zu-Bild: JSON (`prompt`, `modelKey`, `aspectRatio`, `numImages`, …). |
| GET | `/api/download?url=…&filename=…` | Proxy-Download; erlaubte Hosts: `*.fal.media`, `fal.media`, `storage.googleapis.com`. |

Statische Dateien werden aus `public/` ausgeliefert; unbekannte GET-Pfade liefern `index.html` (SPA-Fallback).
