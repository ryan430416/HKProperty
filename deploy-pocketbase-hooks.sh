#!/usr/bin/env bash
# Deploy HKProperty PocketBase hooks to a Linux host.
# Does NOT delete or modify pb_data, collections, or asset records.
set -euo pipefail

# ---- replace these for your host (or export before running) ----
PB_ROOT="${PB_ROOT:-/opt/pocketbase}"
PB_SERVICE="${PB_SERVICE:-pocketbase}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:8090/api/health}"
HOOK_HEALTH_URL="${HOOK_HEALTH_URL:-http://127.0.0.1:8090/api/hkp/hooks-health}"
# Absolute path to the repo pb_hooks folder you uploaded to the server
SOURCE_HOOKS="${SOURCE_HOOKS:-}"

HOOK_FILES=(
  "hkp_shared.js"
  "public_borrow.pb.js"
  "staff_borrow.pb.js"
)

log() { printf '[deploy-hooks] %s\n' "$*"; }
die() { printf '[deploy-hooks] ERROR: %s\n' "$*" >&2; exit 1; }

if [[ -z "${SOURCE_HOOKS}" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  if [[ -d "${SCRIPT_DIR}/pb_hooks" ]]; then
    SOURCE_HOOKS="${SCRIPT_DIR}/pb_hooks"
  elif [[ -d "${SCRIPT_DIR}/../pb_hooks" ]]; then
    SOURCE_HOOKS="$(cd "${SCRIPT_DIR}/../pb_hooks" && pwd)"
  else
    die "Set SOURCE_HOOKS to the uploaded pb_hooks directory"
  fi
fi

[[ -d "${SOURCE_HOOKS}" ]] || die "SOURCE_HOOKS not found: ${SOURCE_HOOKS}"
[[ -d "${PB_ROOT}" ]] || die "PB_ROOT not found: ${PB_ROOT}"

DEST_HOOKS="${PB_ROOT}/pb_hooks"
BACKUP_DIR="${PB_ROOT}/pb_hooks_backup_$(date +%Y%m%d_%H%M%S)"

# Safety: never touch data directories
for forbidden in pb_data data.db data.db-shm data.db-wal; do
  case "${SOURCE_HOOKS}" in
    *"/${forbidden}"*|*"\\${forbidden}"*) die "Refusing path that looks like data: ${SOURCE_HOOKS}" ;;
  esac
done

log "PocketBase root: ${PB_ROOT}"
log "Service: ${PB_SERVICE}"
log "Source hooks: ${SOURCE_HOOKS}"
log "Destination: ${DEST_HOOKS}"

for file in "${HOOK_FILES[@]}"; do
  [[ -f "${SOURCE_HOOKS}/${file}" ]] || die "Missing source file: ${SOURCE_HOOKS}/${file}"
done

mkdir -p "${DEST_HOOKS}"
log "Backing up existing hooks to ${BACKUP_DIR}"
mkdir -p "${BACKUP_DIR}"
if compgen -G "${DEST_HOOKS}/*" > /dev/null; then
  cp -a "${DEST_HOOKS}/." "${BACKUP_DIR}/"
else
  log "No existing hook files to backup (destination empty)"
fi

log "Copying production hook files"
for file in "${HOOK_FILES[@]}"; do
  cp -f "${SOURCE_HOOKS}/${file}" "${DEST_HOOKS}/${file}"
  [[ -f "${DEST_HOOKS}/${file}" ]] || die "Copy failed: ${file}"
  log "Installed ${DEST_HOOKS}/${file}"
done

# Explicitly do not deploy legacy local-only hooks
if [[ -f "${DEST_HOOKS}/main.pb.js" ]]; then
  log "NOTE: ${DEST_HOOKS}/main.pb.js exists on host. Production deploy does not overwrite or delete it."
  log "If that file targets unprefixed collections, move it aside before relying on these routes."
fi

restore_backup() {
  log "Restoring hooks from ${BACKUP_DIR}"
  rm -f "${DEST_HOOKS}/hkp_shared.js" "${DEST_HOOKS}/public_borrow.pb.js" "${DEST_HOOKS}/staff_borrow.pb.js"
  if compgen -G "${BACKUP_DIR}/*" > /dev/null; then
    cp -a "${BACKUP_DIR}/." "${DEST_HOOKS}/"
  fi
  systemctl restart "${PB_SERVICE}"
  sleep 2
  systemctl --no-pager --full status "${PB_SERVICE}" || true
}

log "Restarting ${PB_SERVICE}"
systemctl restart "${PB_SERVICE}"
sleep 2
systemctl --no-pager --full status "${PB_SERVICE}" || true
log "Recent logs (last 100 lines)"
journalctl -u "${PB_SERVICE}" -n 100 --no-pager || true

log "Health check: ${HEALTH_URL}"
if ! curl -fsS "${HEALTH_URL}" | grep -q 'API is healthy\|"code":200'; then
  log "API health failed; rolling back"
  restore_backup
  die "Health check failed; previous hooks restored"
fi

log "Hook probe: ${HOOK_HEALTH_URL}"
HOOK_CODE="$(curl -sS -o /tmp/hkp-hook-health.json -w '%{http_code}' "${HOOK_HEALTH_URL}" || true)"
if [[ "${HOOK_CODE}" != "200" ]]; then
  log "Hook health returned HTTP ${HOOK_CODE}; rolling back"
  cat /tmp/hkp-hook-health.json 2>/dev/null || true
  restore_backup
  die "Hook route missing after deploy; previous hooks restored"
fi
cat /tmp/hkp-hook-health.json || true
echo
log "Deploy succeeded. Backup kept at ${BACKUP_DIR}"
log "Did not modify pb_data or any collection records."
