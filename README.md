## Nano Banana Pro Web-App (fal.ai)

Einfache, mobile-first Web-Anwendung, um mit Googles **Nano Banana Pro** (über die `fal.ai` API) Bilder zu modifizieren oder aus Text zu generieren. Die App läuft in einem einzelnen Docker-Container, ist mit einem simplen Passwort geschützt und merkt sich eingeloggte Nutzer per Cookie.

### Features

- **Mobile-first UI**: Einfache, einspaltige Oberfläche für Smartphones optimiert.
- **Modellwahl**:
  - Bild-zu-Bild (`fal-ai/nano-banana-pro/edit`, 1–3 Upload-Bilder)
  - Text-zu-Bild (`fal-ai/nano-banana-pro`)
- **Upload 1–3 Bilder** zur Modifikation, Ergebnisbilder werden angezeigt und können direkt heruntergeladen werden.
- **Passwortschutz**:
  - Einfaches globales Passwort (`APP_PASSWORD`).
  - Nutzer wird per Cookie erinnert (Session-Cookie bis zu 30 Tage).
- **Docker-fähig**: Läuft als Node.js-Express-App in einem Container.

### Voraussetzungen

- **Node.js 24** (LTS) bzw. Docker-Image `node:24-alpine`
- Ein gültiger `fal.ai` API-Key (`FAL_KEY`)

### Lokaler Start mit Node

```bash
cd /home/corona/falai

# Umgebungsvariablen setzen
export FAL_KEY="DEIN_FAL_KEY"
export APP_PASSWORD="DEIN_APP_PASSWORT" # optional, Standard ist "changeme"

npm install
npm start
```

Die App läuft anschließend unter `http://localhost:3321`.

### Start mit Docker

```bash
cd /home/corona/falai

docker build -t nano-banana-webapp .

docker run -p 3321:3321 \
  -e FAL_KEY="DEIN_FAL_KEY" \
  -e APP_PASSWORD="DEIN_APP_PASSWORT" \
  nano-banana-webapp
```

Danach ist die App unter `http://localhost:3321` erreichbar.

