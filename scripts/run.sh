#!/usr/bin/env bash
# Menjalankan DOD Minimal (macOS / Linux): DOD API (server/) dan frontend. Backend selalu wajib: tidak ada mode mock.
#
#   ./scripts/run.sh            # mode dev (default): backend :8181 + frontend http://localhost:5180
#   ./scripts/run.sh dev        # sama dengan di atas
#   ./scripts/run.sh backend    # hanya backend (DOD API)
#   ./scripts/run.sh preview    # build produksi, backend + sajikan hasilnya, http://localhost:8100
#   ./scripts/run.sh build      # hanya build produksi ke folder dist/
#   ./scripts/run.sh check      # typecheck + lint + test + build (validasi sebelum commit)
#   ./scripts/run.sh install    # hanya pasang dependency
#
# Opsi tambahan:
#   PORT=5190 ./scripts/run.sh dev     # ganti port frontend
#   HOST=1 ./scripts/run.sh dev        # buka akses dari perangkat lain di jaringan (LAN)
#   FRESH=1 ./scripts/run.sh dev       # hapus node_modules lalu pasang ulang dari nol

set -euo pipefail

MODE="${1:-dev}"
REQUIRED_NODE="24.0.0"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

info() { printf '\033[1;34m▸\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

# 1. Node.js dan npm
if ! command -v node >/dev/null 2>&1; then
  # Coba aktifkan nvm bila terpasang.
  if [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then
    # shellcheck disable=SC1091
    . "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
    nvm install >/dev/null && nvm use >/dev/null
  fi
fi
command -v node >/dev/null 2>&1 || fail "Node.js belum terpasang. Lihat docs/SETUP.md bagian 'Prasyarat'."
command -v npm  >/dev/null 2>&1 || fail "npm belum terpasang (biasanya ikut terpasang bersama Node.js)."

NODE_VERSION="$(node -p 'process.versions.node')"
if ! node -e "
  const [a,b,c] = process.argv[1].split('.').map(Number), [x,y,z] = process.argv[2].split('.').map(Number);
  process.exit(a > x || (a === x && (b > y || (b === y && c >= z))) ? 0 : 1)
" "$NODE_VERSION" "$REQUIRED_NODE"; then
  fail "Node.js $NODE_VERSION terlalu lama. Butuh >= $REQUIRED_NODE (disarankan versi di .nvmrc: $(cat .nvmrc))."
fi
ok "Node.js $NODE_VERSION, npm $(npm -v)"

# 2. File konfigurasi .env
if [ ! -f .env ]; then
  cp .env.example .env
  ok ".env dibuat dari .env.example"
fi

# 3. Dependency
if [ "${FRESH:-0}" = "1" ]; then
  info "Menghapus node_modules (FRESH=1)…"
  rm -rf node_modules
fi
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  info "Memasang dependency (npm ci)…"
  npm ci --no-audit --no-fund
  ok "Dependency terpasang"
else
  ok "Dependency sudah terpasang"
fi

# 3b. Backend (server/): selalu dipakai
env_val() { grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2- ; }
if [ "$MODE" != "build" ]; then
  [ "${FRESH:-0}" = "1" ] && rm -rf server/node_modules
  if [ ! -d server/node_modules ] || [ server/package-lock.json -nt server/node_modules/.package-lock.json ]; then
    info "Memasang dependency backend (server/)…"
    (cd server && npm ci --no-audit --no-fund)
  fi
  ok "Backend siap (DOD API, butuh PostgreSQL DOD: lihat docs/SETUP.md dan docs/DATABASE_OPERATIONS.md)"
fi

BACKEND_PID=""
start_backend() {
  local port="${DOD_API_PORT:-$(env_val DOD_API_PORT)}"
  # Another DOD API on this port (e.g. a run.sh in another terminal) would answer the health check below while this
  # one fails to start, and when that other one stops, every page loses its data. Refuse instead.
  if curl -s -o /dev/null -m 2 "http://127.0.0.1:${port:-8181}/api/health"; then
    fail "Port ${port:-8181} sudah dipakai DOD API lain (mis. ./scripts/run.sh di terminal lain). Hentikan proses itu dulu (lihat: lsof -nP -iTCP:${port:-8181} -sTCP:LISTEN), lalu jalankan ulang."
  fi
  info "Menjalankan DOD API di port ${port:-8181}…"
  (cd server && node --env-file-if-exists=../.env src/main.ts) &
  BACKEND_PID=$!
  trap '[ -n "$BACKEND_PID" ] && kill "$BACKEND_PID" 2>/dev/null' EXIT INT TERM
  # The API listens only after it reached its database (connect + migrations), which can take longer than a few
  # seconds or time out. Wait until /api/health answers, so the frontend never starts against a dead API.
  local i
  for i in $(seq 1 60); do
    if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
      local db_host
      db_host="$(env_val DOD_DB_HOST)"
      fail "DOD API gagal start (lihat pesan di atas). Bila pesannya 'connection timeout': database ${db_host:-DOD} tidak terjangkau — periksa VPN/jaringan kantor, atau DOD_DB_* di .env (docs/DATABASE_CONNECTION.md)."
    fi
    curl -s -o /dev/null "http://127.0.0.1:${port:-8181}/api/health" && { ok "DOD API siap di port ${port:-8181}"; watch_backend; return; }
    sleep 1
  done
  fail "DOD API belum siap setelah 60 detik. Periksa pesan di atas (database metadata, .env)."
}

# While the frontend runs in the foreground, say so loudly when the API stops: every page then fails to load data.
watch_backend() {
  (
    while kill -0 "$BACKEND_PID" 2>/dev/null; do sleep 3; done
    printf '\n\033[1;31m✗ DOD API berhenti.\033[0m Semua halaman tidak dapat memuat data sampai API berjalan lagi. Lihat pesan error di atas, lalu hentikan (Ctrl+C) dan jalankan ulang ./scripts/run.sh.\n' >&2
  ) &
}

# 4. Jalankan
PORT_ARGS=()
[ -n "${PORT:-}" ] && PORT_ARGS+=(--port "$PORT")
[ "${HOST:-0}" = "1" ] && PORT_ARGS+=(--host)

case "$MODE" in
  install)
    ok "Selesai." ;;
  dev)
    start_backend
    info "Frontend dev. Login dengan akun DOD (dibuat dari DOD_ADMIN_USERNAME / DOD_ADMIN_PASSWORD di .env). Hentikan dengan Ctrl+C."
    npx vite "${PORT_ARGS[@]+"${PORT_ARGS[@]}"}" ;;
  backend)
    info "Menjalankan DOD API saja. Hentikan dengan Ctrl+C."
    cd server && exec node --env-file-if-exists=../.env src/main.ts ;;
  build)
    info "Build produksi…"
    npm run build
    ok "Hasil build ada di folder dist/" ;;
  preview)
    info "Build produksi…"
    npm run build
    start_backend
    info "Menyajikan hasil build. Hentikan dengan Ctrl+C."
    npx vite preview "${PORT_ARGS[@]+"${PORT_ARGS[@]}"}" ;;
  check)
    info "Typecheck…"; npm run typecheck
    info "Typecheck backend…"; (cd server && npm run typecheck)
    info "Lint…";      npm run lint
    info "Test…";      npm test && (cd server && npm test)
    info "Build…";     npm run build
    ok "Semua pemeriksaan lolos" ;;
  *)
    fail "Mode tidak dikenal: $MODE (pilih: dev | backend | preview | build | check | install)" ;;
esac
