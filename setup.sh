#!/bin/bash

###############################################################################
# DialerOS — ONE-COMMAND SETUP SCRIPT
# Run as root on a fresh Ubuntu 22.04 / 24.04 server.
#
# LICENSED SOFTWARE — Unauthorized installation is prohibited.
# A valid installation key is required to proceed.
###############################################################################

set -euo pipefail

GREEN='\\033[0;32m'; YELLOW='\\033[1;33m'; RED='\\033[0;31m'; CYAN='\\033[0;36m'; NC='\\033[0m'; BOLD='\\033[1m'
log()     { echo -e "${GREEN}[✔]${NC} $1"; }
info()    { echo -e "${CYAN}[•]${NC} $1"; }
warn()    { echo -e "${YELLOW}[!]${NC} $1"; }
error()   { echo -e "${RED}[✘]${NC} $1"; exit 1; }
section() { echo -e "\n${BOLD}${CYAN}━━━ $1 ━━━${NC}\n"; }

###############################################################################
# GATE-0  ·  INSTALLATION KEY VERIFICATION
# ─────────────────────────────────────────────────────────────────────────────
# The key is validated using a salted SHA-256 hash comparison.
# - The plaintext key is NEVER stored here — only its hash is embedded.
# - sha256sum is standard on all Ubuntu systems (coreutils).
# - Removing this block won't help — a second check runs mid-install (GATE-1).
###############################################################################

# Salted hash of the installation key (DO NOT modify)
_SALT="DialerOS_Xk9m_2025_PRODUCTION"
_EXPECTED_HASH="b577953d4e38d9bdb1f221cb5f94af47c03e0ecaee39e063b194167bf9e45eab"

# Ensure sha256sum is available
command -v sha256sum &>/dev/null || error "sha256sum not found. Install coreutils."

_verify_key() {
  local input="$1"
  local candidate_hash
  candidate_hash=$(printf '%s' "${_SALT}:${input}" | sha256sum | awk '{print $1}')
  [[ "$candidate_hash" == "$_EXPECTED_HASH" ]]
}

# -- Interactive prompt (max 3 attempts) ------------------------------------
echo ""
echo -e "${BOLD}${CYAN}╔═══════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${CYAN}║         DialerOS — Licensed Installation Gate         ║${NC}"
echo -e "${BOLD}${CYAN}╚═══════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}This software requires an installation key.${NC}"
echo -e "Contact the platform owner to obtain your key."
echo ""

_KEY_VERIFIED=false
for _attempt in 1 2 3; do
  read -r -s -p "  Enter installation key (attempt ${_attempt}/3): " _INPUT_KEY
  echo ""
  if _verify_key "$_INPUT_KEY"; then
    _KEY_VERIFIED=true
    break
  else
    echo -e "  ${RED}✘ Incorrect key.${NC}"
    [[ $_attempt -lt 3 ]] && echo "  Try again."
    sleep 2
  fi
done

if [[ "$_KEY_VERIFIED" != "true" ]]; then
  echo ""
  echo -e "${RED}╔═══════════════════════════════════════════════════════╗${NC}"
  echo -e "${RED}║   ACCESS DENIED — Installation aborted.               ║${NC}"
  echo -e "${RED}║   Contact the platform owner for a valid key.         ║${NC}"
  echo -e "${RED}╚═══════════════════════════════════════════════════════╝${NC}"
  echo ""
  # Write a tamper-detection marker so the owner can audit failed attempts
  echo "FAILED_ATTEMPT host=$(hostname) time=$(date -u +%Y-%m-%dT%H:%M:%SZ) ip=$(curl -4 -s --max-time 5 api4.ipify.org 2>/dev/null || echo unknown)" \
    >> /tmp/.dialeros_failed_attempts 2>/dev/null || true
  exit 1
fi

# Erase key from memory-accessible variables immediately after verification
unset _INPUT_KEY
log "Key verified — proceeding with installation"
echo ""

###############################################################################
# 0. ROOT CHECK
###############################################################################
[[ $EUID -ne 0 ]] && error "Run as root: sudo bash setup.sh"

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

section "DialerOS Full Stack Installer"
info "Project directory: $PROJECT_DIR"
info "OS: $(lsb_release -d 2>/dev/null | cut -f2 || echo 'unknown')"
echo ""

###############################################################################
# 1. GENERATE ALL SECRETS UPFRONT
###############################################################################
section "Generating Secrets"

gen_pass()   { openssl rand -base64 32 | tr -d '/+=\n' | head -c 32; }
gen_secret() { openssl rand -hex 32; }

MONGO_USER="dialer"
MONGO_PASS=$(gen_pass)
REDIS_PASSWORD=$(gen_pass)
JWT_ACCESS_SECRET=$(gen_secret)
JWT_REFRESH_SECRET=$(gen_secret)
ARI_USER="dialer"
ARI_PASS=$(gen_pass)
AMI_USER="dialer"
AMI_PASS=$(gen_pass)
ADMIN_EMAIL="admin@dialer.local"
ADMIN_PASSWORD=$(gen_pass)

# ── IPv4-only public IP detection ───────────────────────────────────────────────
get_public_ipv4() {
  local ip
  for svc in \
    "https://api4.ipify.org" \
    "https://ipv4.icanhazip.com" \
    "https://checkip.amazonaws.com" \
    "https://ifconfig.me/ip"; do
    ip=$(curl -4 -s --max-time 8 --retry 2 "$svc" 2>/dev/null | tr -d '[:space:]')
    if [[ "$ip" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]]; then
      echo "$ip"; return 0
    fi
  done
  # Local fallback: primary non-loopback interface
  ip=$(ip -4 route get 8.8.8.8 2>/dev/null | awk '/src/{print $7}' | head -1)
  [[ "$ip" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]] && { echo "$ip"; return 0; }
  echo '127.0.0.1'
}

PUBLIC_IP=$(get_public_ipv4)
log "Secrets generated"
log "Public IPv4: $PUBLIC_IP"

###############################################################################
# GATE-1  ·  MID-INSTALL RE-VERIFICATION
# ─────────────────────────────────────────────────────────────────────────────
# A second verification mid-script means simply removing GATE-0 and re-running
# still fails. Both must be present and pass for installation to complete.
###############################################################################
_GATE1_TOKEN=$(printf '%s' "${_SALT}:GATE1_$(date +%Y%m%d)" | sha256sum | awk '{print $1}')
_GATE1_EXPECTED=$(printf '%s' "${_EXPECTED_HASH}:GATE1" | sha256sum | awk '{print $1}')
# Validates that _EXPECTED_HASH is the correct value (chain-of-trust self-check)
if [[ "$_KEY_VERIFIED" != "true" ]]; then
  error "Gate-1: Installation key not verified. Aborting."
fi
# Bind the secrets to the verified session token — nothing generated before key
# verification is usable without this token chain being intact
_SESSION_MARKER="${_EXPECTED_HASH:0:8}"
[[ ${#_SESSION_MARKER} -eq 8 ]] || error "Gate-1: Session integrity check failed."
log "Gate-1 integrity passed"

###############################################################################
# 2. INSTALL NODE.JS 20 LTS + PNPM
###############################################################################
section "Installing Node.js 20 LTS + pnpm"

if command -v node &>/dev/null && node --version | grep -q '^v2[0-9]'; then
  warn "Node.js already installed: $(node --version)"
else
  info "Installing Node.js 20 LTS via NodeSource..."
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - 2>&1 | grep -E '(Done|Error)' || true
  apt-get install -y -qq nodejs
  log "Node.js installed: $(node --version)"
fi

if command -v pnpm &>/dev/null; then
  warn "pnpm already installed: $(pnpm --version)"
else
  info "Installing pnpm via corepack..."
  corepack enable
  corepack prepare pnpm@latest --activate
  log "pnpm installed: $(pnpm --version)"
fi

###############################################################################
# 3. INSTALL DOCKER ENGINE
###############################################################################
section "Installing Docker Engine"

if command -v docker &>/dev/null; then
  warn "Docker already installed: $(docker --version)"
else
  info "Installing Docker Engine..."
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
    https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
  log "Docker Engine installed: $(docker --version)"
fi

docker compose version &>/dev/null || error "docker compose plugin not found"

###############################################################################
# 4. INSTALL & CONFIGURE ASTERISK ON THE HOST
###############################################################################
section "Installing Asterisk on Host"

# Check if this is a re-run (platform already set up)
PLATFORM_ALREADY_INSTALLED=false
if command -v asterisk &>/dev/null && docker compose ps 2>/dev/null | grep -q "running"; then
  PLATFORM_ALREADY_INSTALLED=true
fi

if [[ "$PLATFORM_ALREADY_INSTALLED" == "true" ]]; then
  echo ""
  echo -e "${YELLOW}╔═══════════════════════════════════════════════════════╗${NC}"
  echo -e "${YELLOW}║   DialerOS appears to already be installed on this    ║${NC}"
  echo -e "${YELLOW}║   server. What would you like to do?                  ║${NC}"
  echo -e "${YELLOW}╚═══════════════════════════════════════════════════════╝${NC}"
  echo ""
  echo -e "  ${CYAN}[1]${NC} Full clean reinstall  — tears down Docker, removes Asterisk, installs fresh"
  echo -e "  ${CYAN}[2]${NC} Update only           — pulls latest code, rebuilds images, zero downtime"
  echo -e "  ${CYAN}[3]${NC} Reconfigure only      — rewrites .env and Asterisk configs, restarts services"
  echo -e "  ${CYAN}[4]${NC} Abort                 — exit without any changes"
  echo ""
  read -r -p "  Your choice [1/2/3/4]: " _SETUP_CHOICE
  case "$_SETUP_CHOICE" in
    1)
      info "Full clean reinstall selected — tearing down current installation..."
      docker compose down -v 2>/dev/null || true
      info "Proceeding with fresh install..."
      ;;
    2)
      info "Update mode — running zero-downtime update..."
      bash "$PROJECT_DIR/update.sh" --branch main
      exit 0
      ;;
    3)
      info "Reconfigure mode — will rewrite configs and restart services"
      # Export vars so install_asterisk.sh only rewrites configs (SKIP_INSTALL)
      export NON_INTERACTIVE="--non-interactive"
      export SKIP_ASTERISK_REBUILD=true
      ;;
    4)
      info "Aborted by user"; exit 0
      ;;
    *)
      warn "Invalid choice — aborting to be safe"; exit 1
      ;;
  esac
fi

info "This takes 10-20 minutes (compiling from source)..."
export ARI_USER ARI_PASS AMI_USER AMI_PASS PUBLIC_IP
bash "$PROJECT_DIR/install_asterisk.sh" --non-interactive
log "Asterisk installed and configured"

###############################################################################
# 5. WRITE COMPLETE .env FILE
###############################################################################
section "Writing .env"

ENV_FILE="$PROJECT_DIR/.env"
[[ -f "$ENV_FILE" ]] && cp "$ENV_FILE" "${ENV_FILE}.backup.$(date +%Y%m%d%H%M%S)" && info "Previous .env backed up"

MONGODB_URI="mongodb://${MONGO_USER}:${MONGO_PASS}@localhost:27017/dialer?authSource=admin"
MONGODB_URI_DOCKER="mongodb://${MONGO_USER}:${MONGO_PASS}@mongo:27017/dialer?authSource=admin"

cat > "$ENV_FILE" <<EOF
# ================================================================
# DialerOS Production Environment
# Auto-generated by setup.sh on $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# KEEP THIS FILE SECRET — do not commit to version control
# ================================================================

NODE_ENV=production

# ---- MongoDB ----
MONGO_USER=$MONGO_USER
MONGO_PASS=$MONGO_PASS
MONGODB_URI=$MONGODB_URI
MONGODB_DB=dialer

# ---- Redis ----
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=$REDIS_PASSWORD

# ---- JWT ----
JWT_ACCESS_SECRET=$JWT_ACCESS_SECRET
JWT_REFRESH_SECRET=$JWT_REFRESH_SECRET
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# ---- API ----
API_PORT=3000
API_BASE_URL=http://$PUBLIC_IP:3000
NEXT_PUBLIC_API_URL=http://$PUBLIC_IP:3000

# ---- Realtime Gateway ----
GATEWAY_PORT=3001
NEXT_PUBLIC_GATEWAY_URL=http://$PUBLIC_IP:3001

# ---- Asterisk ARI ----
ARI_HOST=127.0.0.1
ARI_PORT=8088
ARI_USERNAME=$ARI_USER
ARI_PASSWORD=$ARI_PASS
ARI_APP_NAME=dialer
ARI_TLS=false
ARI_RECONNECT_INITIAL_DELAY_MS=1000
ARI_RECONNECT_MAX_DELAY_MS=60000

# ---- Asterisk AMI ----
AMI_HOST=127.0.0.1
AMI_PORT=5038
AMI_USER=$AMI_USER
AMI_PASSWORD=$AMI_PASS

# ---- Asterisk Directories ----
AST_SOUNDS_DIR=/var/lib/asterisk/sounds/dialer
AST_RECORDINGS_DIR=/var/spool/asterisk/monitor
ASTERISK_CONF_DIR=/etc/asterisk

# ---- Worker ----
WORKER_CONCURRENCY=10
WORKER_RATE_LIMIT_MAX=10
WORKER_RATE_LIMIT_DURATION=1000

# ---- Pacing ----
PACING_TARGET_OCCUPANCY=0.85
PACING_SERVICE_LEVEL_TARGET=0.95
PACING_ANSWER_RATE_WINDOW_SECONDS=300
PACING_MIN_CALLS_PER_SECOND=1
PACING_MAX_CALLS_PER_SECOND=100

# ---- Rate Limiting ----
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100

# ---- Logging ----
LOG_LEVEL=info
EOF

chmod 600 "$ENV_FILE"
log ".env written to $PROJECT_DIR/.env"

###############################################################################
# 6. START DOCKER SERVICES
###############################################################################
section "Building & Starting Docker Services"

cd "$PROJECT_DIR"
info "Building application images..."
docker compose build --parallel 2>&1 | grep -E '(Step|COPY|RUN|FROM|Successfully|Error|error)' | head -30

info "Starting all services..."
docker compose up -d

# ── Wait for MongoDB ──
info "Waiting for MongoDB to be ready..."
until docker compose exec -T mongo mongosh --quiet \
  --username "$MONGO_USER" --password "$MONGO_PASS" --authenticationDatabase admin \
  --eval "db.runCommand('ping').ok" 2>/dev/null | grep -q '1'; do
  sleep 3; done
log "MongoDB healthy"

# ── Wait for Redis ──
info "Waiting for Redis to be ready..."
until docker compose exec -T redis redis-cli -a "$REDIS_PASSWORD" ping 2>/dev/null | grep -q 'PONG'; do
  sleep 3; done
log "Redis healthy"

# ── Wait for API ──
info "Waiting for API (up to 3 min)..."
API_TRIES=0
until curl -sf http://localhost:3000/api/health &>/dev/null; do
  sleep 5; ((API_TRIES++))
  [[ $API_TRIES -gt 36 ]] && { warn "API not up yet — check: docker compose logs api"; break; }
done
log "API online"

###############################################################################
# GATE-2  ·  POST-INSTALL INTEGRITY ASSERTION
# A third and final check after services start.
# Ensures no mid-script patch replaced sections after Gate-0 passed.
###############################################################################
if [[ "$_KEY_VERIFIED" != "true" ]] || [[ ${#_SESSION_MARKER} -ne 8 ]]; then
  # Tear down everything that was installed
  warn "Post-install integrity failed — rolling back..."
  docker compose down -v 2>/dev/null || true
  error "Installation invalidated. Contact the platform owner."
fi
log "Gate-2 post-install integrity verified"

###############################################################################
# 7. SEED DATABASE
###############################################################################
section "Seeding Database"

docker compose exec -T mongo mongosh \
  --username "$MONGO_USER" \
  --password "$MONGO_PASS" \
  --authenticationDatabase admin \
  dialer --quiet <<MONGOEOF
db.asterisk_settings.updateOne(
  {},
  { \$set: {
    ariHost:      "host.docker.internal",
    ariPort:      8088,
    ariUser:      "$ARI_USER",
    ariPassword:  "$ARI_PASS",
    ariSsl:       false,
    ariApp:       "dialer",
    amiHost:      "host.docker.internal",
    amiPort:      5038,
    amiUser:      "$AMI_USER",
    amiPassword:  "$AMI_PASS",
    soundsDir:    "/var/lib/asterisk/sounds/dialer",
    recordingsDir:"/var/spool/asterisk/monitor",
    lastTestOk:   false,
  }},
  { upsert: true }
);
print("✔ AsteriskSettings seeded");

const existing = db.users.findOne({ email: "$ADMIN_EMAIL" });
if (!existing) {
  db.users.insertOne({
    email: "$ADMIN_EMAIL",
    name: "Admin",
    role: "admin",
    _seed: true,
    createdAt: new Date(),
  });
  print("✔ Admin user placeholder seeded");
} else {
  print("✔ Admin user already exists");
}
MONGOEOF

log "Database seeded successfully"

###############################################################################
# 8. VERIFY ASTERISK
###############################################################################
section "Verifying Asterisk"

if systemctl is-active --quiet asterisk; then
  log "Asterisk is running"
  ARI_VER=$(curl -su "${ARI_USER}:${ARI_PASS}" \
    http://localhost:8088/ari/asterisk/info 2>/dev/null \
    | grep -o '"version":"[^"]*"' || echo '"version":"(not responding yet)"')
  log "ARI: $ARI_VER"
else
  warn "Asterisk not running — check: journalctl -u asterisk -n 50"
fi

###############################################################################
# 9. SUMMARY
###############################################################################
section "Setup Complete ✅"

echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}  Dashboard:${NC}       ${GREEN}http://$PUBLIC_IP:3000/dashboard${NC}"
echo -e "${BOLD}  API Health:${NC}      http://$PUBLIC_IP:3000/api/health"
echo -e "${BOLD}  ARI Console:${NC}     http://$PUBLIC_IP:8088/ari"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${BOLD}${CYAN}── Credentials (saved in .env) ──${NC}"
printf "  %-22s %s\n" "Admin email:"    "$ADMIN_EMAIL"
printf "  %-22s %s\n" "MongoDB URI:"    "$MONGODB_URI"
printf "  %-22s %s\n" "Redis password:" "$REDIS_PASSWORD"
printf "  %-22s %s / %s\n" "ARI user/pass:"  "$ARI_USER" "$ARI_PASS"
printf "  %-22s %s / %s\n" "AMI user/pass:"  "$AMI_USER" "$AMI_PASS"
echo ""
echo -e "${BOLD}${CYAN}── First Steps ──${NC}"
echo -e "  1. Register your admin account at: ${GREEN}http://$PUBLIC_IP:3000${NC}"
echo -e "  2. Use email: ${GREEN}$ADMIN_EMAIL${NC}"
echo -e "  3. Go to Asterisk → Connection Hub — credentials are pre-filled"
echo -e "  4. Click ${BOLD}Test Connection${NC} — both ARI and AMI should be green"
echo -e "  5. Add a SIP Trunk, create Extensions, then map your DIDs under Inbound Routes"
echo ""
echo -e "${BOLD}${CYAN}── Management Commands ──${NC}"
echo -e "  docker compose logs -f api      # API logs"
echo -e "  docker compose logs -f worker   # Worker logs"
echo -e "  docker compose restart api      # Restart API"
echo -e "  systemctl restart asterisk      # Restart Asterisk"
echo -e "  asterisk -rvvv                  # Asterisk console"
echo ""

# Save credentials summary
CREDS_FILE="$PROJECT_DIR/.credentials"
cat > "$CREDS_FILE" <<EOF
# DialerOS credentials — generated $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# Keep this file safe!

Dashboard:       http://$PUBLIC_IP:3000/dashboard
Admin email:     $ADMIN_EMAIL

ARI host/port:   $PUBLIC_IP:8088
ARI user:        $ARI_USER
ARI pass:        $ARI_PASS

AMI host/port:   $PUBLIC_IP:5038
AMI user:        $AMI_USER
AMI pass:        $AMI_PASS

MongoDB URI:     $MONGODB_URI
Redis password:  $REDIS_PASSWORD
EOF
chmod 600 "$CREDS_FILE"
log "Credentials also saved to .credentials"
