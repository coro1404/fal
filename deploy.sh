#!/usr/bin/env bash
# Deploy via Docker Compose auf einen Remote-Host.
# Nutzung: ./deploy.sh user@host <deploy-verzeichnis>
#
# Kopiert nur das für Build/Start Nötige. Überschreibt weder ./data
# noch eine bereits vorhandene Remote-.env.

set -euo pipefail

usage() {
  cat <<'EOF'
Nutzung: ./deploy.sh user@host <deploy-verzeichnis>

Beispiel:
  ./deploy.sh deploy@example.com /opt/falai

- Synchronisiert App-Dateien (rsync), ohne node_modules/.git/data
- Legt data/ auf dem Host an, falls fehlend (bestehende Daten bleiben)
- .env: wird nur kopiert, wenn lokal vorhanden und remote noch fehlt
- Startet: docker compose up -d --build
EOF
  exit 1
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
fi

if [[ $# -ne 2 ]]; then
  usage
fi

REMOTE="$1"
DEST="$2"
ROOT="$(cd "$(dirname "$0")" && pwd)"

if [[ -z "$REMOTE" || -z "$DEST" ]]; then
  usage
fi

if [[ "$DEST" != /* ]]; then
  echo "Fehler: Deploy-Verzeichnis muss absolut sein (z. B. /opt/falai)." >&2
  exit 1
fi

if ! command -v rsync >/dev/null 2>&1; then
  echo "Fehler: rsync fehlt lokal." >&2
  exit 1
fi

if ! command -v ssh >/dev/null 2>&1; then
  echo "Fehler: ssh fehlt lokal." >&2
  exit 1
fi

echo "==> Remote-Verzeichnis: ${REMOTE}:${DEST}"
ssh "$REMOTE" "mkdir -p $(printf '%q' "$DEST")"

echo "==> Dateien synchronisieren (data/ und bestehende .env bleiben unberührt)"
# --delete entfernt auf dem Host nur Dateien im App-Tree, die lokal fehlen.
# data/ und .env sind ausgeschlossen und werden nicht gelöscht/überschrieben.
rsync -az --delete \
  --exclude '.git/' \
  --exclude '.cursor/' \
  --exclude 'node_modules/' \
  --exclude 'data/' \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude 'deploy.sh' \
  --exclude '*.bak' \
  --exclude '.DS_Store' \
  "${ROOT}/" "${REMOTE}:${DEST}/"

echo "==> data/-Ordner sicherstellen (ohne Inhalt zu überschreiben)"
ssh "$REMOTE" bash -s -- "$DEST" <<'REMOTE_DATA'
set -euo pipefail
DEST="$1"
mkdir -p \
  "$DEST/data/thumbnails" \
  "$DEST/data/recent-uploads" \
  "$DEST/data/recent-uploads-thumbs" \
  "$DEST/data/sets" \
  "$DEST/data/sets-thumbs" \
  "$DEST/data/slot-images" \
  "$DEST/data/slot-thumbs"
# Leere Platzhalter nur anlegen, wenn noch keine Daten-Dateien existieren
touch "$DEST/data/.gitkeep" "$DEST/data/thumbnails/.gitkeep"
REMOTE_DATA

if ssh "$REMOTE" "test -f $(printf '%q' "$DEST/.env")"; then
  echo "==> Remote-.env vorhanden – bleibt unverändert"
elif [[ -f "${ROOT}/.env" ]]; then
  echo "==> Remote-.env fehlt – kopiere lokale .env einmalig"
  rsync -az "${ROOT}/.env" "${REMOTE}:${DEST}/.env"
else
  echo "Fehler: Weder lokal noch remote gibt es eine .env (FAL_KEY nötig)." >&2
  echo "Lege lokal .env an oder erstelle ${DEST}/.env auf dem Host." >&2
  exit 1
fi

if ! ssh "$REMOTE" "grep -qE '^[[:space:]]*FAL_KEY=[^[:space:]]+' $(printf '%q' "$DEST/.env")"; then
  echo "Warnung: In ${DEST}/.env scheint FAL_KEY zu fehlen." >&2
fi

echo "==> Docker Compose: build & start"
ssh "$REMOTE" bash -s -- "$DEST" <<'REMOTE_COMPOSE'
set -euo pipefail
DEST="$1"
cd "$DEST"

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE=(docker-compose)
else
  echo "Fehler: weder 'docker compose' noch 'docker-compose' auf dem Host." >&2
  exit 1
fi

"${COMPOSE[@]}" up -d --build
"${COMPOSE[@]}" ps
REMOTE_COMPOSE

echo "==> Fertig: ${REMOTE}:${DEST} (Port 3321, Volume ./data erhalten)"
