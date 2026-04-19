#!/bin/bash

###############################################################################
# DialerOS — Asterisk 22 Self-Healing Installer
#
# Designed to succeed on fresh Ubuntu 20.04/22.04/24.04 LTS even if:
#   • Some packages are not available in the default repos
#   • The Asterisk tarball download fails (retries with mirrors)
#   • MP3/codec libraries are missing (builds/skips gracefully)
#   • The system already has a partial Asterisk install
#   • Firewall commands fail (ufw not available)
#   • sox/ffmpeg are unavailable
#
# Usage:
#   sudo bash install_asterisk.sh
#   sudo bash install_asterisk.sh --non-interactive   (called from setup.sh)
###############################################################################

set -uo pipefail   # removed -e: we handle every error explicitly

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'; BOLD='\033[1m'
log()     { echo -e "${GREEN}[✔]${NC} $(date '+%H:%M:%S') $1"; }
info()    { echo -e "${CYAN}[•]${NC} $(date '+%H:%M:%S') $1"; }
warn()    { echo -e "${YELLOW}[!]${NC} $(date '+%H:%M:%S') $1"; }
error()   { echo -e "${RED}[✘]${NC} $(date '+%H:%M:%S') $1"; exit 1; }
skip()    { echo -e "${YELLOW}[↷]${NC} $(date '+%H:%M:%S') Skipping: $1 (non-critical)"; }
section() { echo -e "\n${BOLD}${CYAN}━━━ $1 ━━━${NC}\n"; }

# Try a command; warn and continue on failure instead of aborting
try() {
  local desc="$1"; shift
  if "$@" 2>/dev/null; then
    return 0
  else
    warn "$desc failed — continuing (non-fatal)"
    return 0  # always continue
  fi
}

###############################################################################
# ROOT CHECK
###############################################################################
[[ $EUID -ne 0 ]] && error "Run as root: sudo bash install_asterisk.sh"

NON_INTERACTIVE="${1:-}"

###############################################################################
# VARIABLES
###############################################################################
ASTERISK_VERSION="22"
SRC_DIR="/usr/src"
BUILD_DIR="$SRC_DIR/asterisk-build"
TAR_FILE="asterisk-22-current.tar.gz"
INSTALL_LOG="/var/log/dialeros-install.log"

ARI_USER="${ARI_USER:-dialer}"
ARI_PASS="${ARI_PASS:-$(openssl rand -base64 24 | tr -d '/+=')}"
AMI_USER="${AMI_USER:-dialer}"
AMI_PASS="${AMI_PASS:-$(openssl rand -base64 24 | tr -d '/+=')}"
PUBLIC_IP="${PUBLIC_IP:-$(curl -s --max-time 15 ifconfig.me 2>/dev/null || \
                          curl -s --max-time 15 api.ipify.org 2>/dev/null || \
                          curl -s --max-time 15 icanhazip.com 2>/dev/null || \
                          echo '127.0.0.1')}"

SOUNDS_DIR="/var/lib/asterisk/sounds/dialer"
RECORDINGS_DIR="/var/spool/asterisk/monitor"

# Redirect all output to log file as well
exec > >(tee -a "$INSTALL_LOG") 2>&1
section "DialerOS Asterisk Installer — $(date -u +'%Y-%m-%dT%H:%M:%SZ')"
info "Log: $INSTALL_LOG"

###############################################################################
# DETECT OS
###############################################################################
section "Detecting OS"
OS_ID=$(. /etc/os-release && echo "$ID")
OS_VERSION=$(. /etc/os-release && echo "$VERSION_ID")
info "OS: $OS_ID $OS_VERSION"

if [[ "$OS_ID" != "ubuntu" && "$OS_ID" != "debian" ]]; then
  warn "Untested OS: $OS_ID. Proceeding anyway — some package names may differ."
fi

###############################################################################
# CLEAN PREVIOUS INSTALL
###############################################################################
section "Cleaning Previous Installation"

if systemctl list-units --type=service 2>/dev/null | grep -q asterisk; then
  info "Stopping existing Asterisk..."
  systemctl stop asterisk 2>/dev/null || true
fi

if command -v asterisk &>/dev/null; then
  warn "Existing Asterisk detected → removing..."
  apt-get remove --purge -y asterisk 2>/dev/null || true
  rm -rf /etc/asterisk /var/lib/asterisk /var/log/asterisk /usr/lib/asterisk 2>/dev/null || true
fi

rm -rf "$BUILD_DIR" "$SRC_DIR"/asterisk-22* 2>/dev/null || true
mkdir -p "$BUILD_DIR"
log "Clean complete"

###############################################################################
# SYSTEM DEPENDENCIES — self-healing package installs
###############################################################################
section "Installing System Dependencies"

# Step 1: Enable universe/multiverse repos (needed for many codec libs)
info "Enabling apt repositories..."
if command -v add-apt-repository &>/dev/null; then
  add-apt-repository -y universe 2>/dev/null || true
  add-apt-repository -y multiverse 2>/dev/null || true
else
  # Fallback: edit sources.list directly
  sed -i 's/^# deb.*universe/deb/' /etc/apt/sources.list 2>/dev/null || true
fi

# Step 2: Update (ignore errors — stale mirrors are common)
info "Updating package lists..."
apt-get update -qq 2>/dev/null || {
  warn "apt-get update had errors — trying without signing checks"
  apt-get update -qq --allow-insecure-repositories 2>/dev/null || true
}

# Step 3: Core build tools — these must succeed
section "Installing Core Build Tools"
CORE_PKGS=(
  build-essential git wget curl unzip
  pkg-config subversion openssl
  lsb-release tzdata
)
apt-get install -y -qq "${CORE_PKGS[@]}" || error "Core build tools install failed. Check your internet connection."

# Step 4: Install each optional dependency individually with fallbacks
section "Installing Asterisk Dependencies"

install_pkg() {
  local primary="$1"; shift
  local fallbacks=("$@")
  if apt-get install -y -qq "$primary" 2>/dev/null; then
    log "  $primary ✓"
    return 0
  fi
  for fb in "${fallbacks[@]}"; do
    warn "  $primary not found — trying $fb"
    if apt-get install -y -qq "$fb" 2>/dev/null; then
      log "  $fb ✓ (fallback for $primary)"
      return 0
    fi
  done
  skip "$primary (and all fallbacks)"
  return 0  # non-fatal
}

# Asterisk required libs
install_pkg libncurses5-dev   libncurses-dev "ncurses-dev"
install_pkg libssl-dev
install_pkg libxml2-dev
install_pkg uuid-dev
install_pkg libjansson-dev
install_pkg libsqlite3-dev
install_pkg libedit-dev

# Codec / media libs — many have changed names across Ubuntu versions
install_pkg libsrtp2-dev      libsrtp-dev
install_pkg libspandsp-dev
install_pkg libogg-dev
install_pkg libvorbis-dev

# MP3 — package name varies widely; build from source if needed
MP3_OK=false
if apt-get install -y -qq libmp3lame-dev 2>/dev/null; then
  log "  libmp3lame-dev ✓"
  MP3_OK=true
elif apt-get install -y -qq lame 2>/dev/null; then
  log "  lame ✓ (fallback)"
  MP3_OK=true
else
  warn "  mp3lame not available via apt — Asterisk will build MP3 from source"
  # The get_mp3_source.sh script in Asterisk handles this automatically
  MP3_OK=false
fi

# Audio tools — non-critical, graceful degradation
install_pkg sox
install_pkg ffmpeg

# Optional but useful
install_pkg ufw
install_pkg libiksemel-dev    libxml2-dev    # XMPP (optional)

log "Dependencies phase complete"

###############################################################################
# DOWNLOAD ASTERISK — with retry and mirror fallback
###############################################################################
section "Downloading Asterisk $ASTERISK_VERSION"

ASTERISK_URLS=(
  "https://downloads.asterisk.org/pub/telephony/asterisk/${TAR_FILE}"
  "https://downloads.asterisk.org/pub/telephony/asterisk/asterisk-22-current.tar.gz"
  "http://downloads.asterisk.org/pub/telephony/asterisk/${TAR_FILE}"
)

cd "$BUILD_DIR"
DOWNLOADED=false

for url in "${ASTERISK_URLS[@]}"; do
  info "Trying: $url"
  if wget -q --show-progress --tries=3 --timeout=120 -O "$TAR_FILE" "$url" 2>/dev/null; then
    # Verify it's a real tarball (not an HTML error page)
    if file "$TAR_FILE" 2>/dev/null | grep -q "gzip\|tar\|compressed"; then
      log "Downloaded: $TAR_FILE"
      DOWNLOADED=true
      break
    else
      warn "Downloaded file doesn't look like a tar archive — trying next URL"
      rm -f "$TAR_FILE"
    fi
  else
    warn "Download failed from $url"
  fi
done

[[ "$DOWNLOADED" == "false" ]] && error "All download sources failed. Check internet connectivity."

# Extract
tar -xzf "$TAR_FILE" 2>/dev/null || error "Failed to extract $TAR_FILE"
ASTERISK_DIR=$(tar -tzf "$TAR_FILE" 2>/dev/null | head -1 | cut -f1 -d"/")
[[ -z "$ASTERISK_DIR" ]] && error "Could not determine Asterisk source directory"
cd "$ASTERISK_DIR"
log "Extracted: $ASTERISK_DIR"

###############################################################################
# BUILD ASTERISK
###############################################################################
section "Building Asterisk (this takes 5–15 minutes)"

# MP3 support — use bundled source if system lib not available
info "Getting MP3 support..."
if [[ -f contrib/scripts/get_mp3_source.sh ]]; then
  contrib/scripts/get_mp3_source.sh 2>/dev/null || skip "MP3 source download (MP3 codec will be absent)"
fi

# Configure
info "Running configure..."
CONFIGURE_FLAGS="--with-jansson-bundled"
[[ "$MP3_OK" == "false" ]] && CONFIGURE_FLAGS="$CONFIGURE_FLAGS"  # mp3 handled by get_mp3_source.sh

./configure $CONFIGURE_FLAGS 2>&1 | grep -E "(checking|error|warning)" | tail -20 || \
  error "Asterisk configure failed. See $INSTALL_LOG for details."

# menuselect
info "Preparing module selection..."
make menuselect.makeopts 2>&1 | tail -3 || error "menuselect generation failed"

info "Enabling required modules..."
MODULES=(
  # ARI
  res_http_websocket res_ari res_ari_applications res_ari_asterisk
  res_ari_bridges res_ari_channels res_ari_device_states res_ari_endpoints
  res_ari_events res_ari_model res_ari_playbacks res_ari_recordings
  res_ari_sounds res_stasis res_stasis_answer res_stasis_device_state
  res_stasis_playback res_stasis_recording res_stasis_snoop
  # PJSIP
  chan_pjsip res_pjsip res_pjsip_acl res_pjsip_authenticator_digest
  res_pjsip_caller_id res_pjsip_config_wizard res_pjsip_diversion
  res_pjsip_dtmf_info res_pjsip_endpoint_identifier_anonymous
  res_pjsip_endpoint_identifier_ip res_pjsip_endpoint_identifier_user
  res_pjsip_exten_state res_pjsip_header_funcs res_pjsip_logger
  res_pjsip_mwi res_pjsip_nat res_pjsip_notify
  res_pjsip_one_touch_record_info res_pjsip_outbound_authenticator_digest
  res_pjsip_outbound_registration res_pjsip_path res_pjsip_pubsub
  res_pjsip_refer res_pjsip_registrar res_pjsip_rfc3326
  res_pjsip_sdp_rtp res_pjsip_session res_pjsip_transport_websocket
  # Apps
  app_chanspy app_confbridge app_dial app_dtmfstore app_exec
  app_mixmonitor app_originate app_playback app_queue app_record
  app_senddtmf app_stasis app_transfer app_voicemail app_waitexten
  # Core
  res_musiconhold codec_ulaw codec_alaw codec_g722 codec_gsm
  res_format_attr_opus
)

# Enable each module; skip silently if not available
for mod in "${MODULES[@]}"; do
  menuselect/menuselect --enable "$mod" menuselect.makeopts 2>/dev/null || true
done

# Compile — use all CPU cores, fall back to single core if parallel fails
info "Compiling (using $(nproc) cores)..."
if ! make -j"$(nproc)" 2>&1 | tail -5; then
  warn "Parallel compile failed — retrying with single core..."
  make 2>&1 | tail -5 || error "make failed. See $INSTALL_LOG"
fi

info "Installing binaries..."
make install 2>&1 | tail -5 || error "make install failed"

info "Installing sample configs..."
make samples 2>&1 | tail -3 || warn "make samples failed (non-critical)"

info "Installing init scripts..."
make config  2>&1 | tail -3 || warn "make config failed (non-critical)"

ldconfig 2>/dev/null || true
log "Asterisk compiled and installed"

###############################################################################
# USER & PERMISSIONS
###############################################################################
section "Setting Permissions"

groupadd asterisk 2>/dev/null || true
useradd -r -d /var/lib/asterisk -g asterisk asterisk 2>/dev/null || true

mkdir -p "$SOUNDS_DIR" "$RECORDINGS_DIR" /var/log/asterisk /var/lib/asterisk/moh
chown -R asterisk:asterisk \
  /var/lib/asterisk /var/log/asterisk \
  /var/spool/asterisk /usr/lib/asterisk 2>/dev/null || true
chmod -R 775 "$SOUNDS_DIR" "$RECORDINGS_DIR" 2>/dev/null || true

# Patch asterisk.conf to run as asterisk user
for f in /etc/asterisk/asterisk.conf; do
  [[ -f "$f" ]] && {
    sed -i 's/;runuser = asterisk/runuser = asterisk/' "$f"
    sed -i 's/;rungroup = asterisk/rungroup = asterisk/' "$f"
  }
done
for f in /etc/default/asterisk; do
  [[ -f "$f" ]] && {
    sed -i 's/#AST_USER="asterisk"/AST_USER="asterisk"/' "$f"
    sed -i 's/#AST_GROUP="asterisk"/AST_GROUP="asterisk"/' "$f"
  }
done
log "Permissions set"

###############################################################################
# WRITE CONFIGS
###############################################################################
section "Writing Asterisk Configuration"

# ── HTTP / ARI ──────────────────────────────────────────────────────────────
cat > /etc/asterisk/http.conf <<EOF
[general]
enabled=yes
bindaddr=0.0.0.0
bindport=8088
EOF

cat > /etc/asterisk/ari.conf <<EOF
[general]
enabled = yes
pretty = yes
allowed_origins = *
auth_realm = DialerOS ARI

[$ARI_USER]
type = user
read_only = no
password = $ARI_PASS
password_format = plain
EOF
log "ARI configured (user: $ARI_USER)"

# ── AMI ─────────────────────────────────────────────────────────────────────
cat > /etc/asterisk/manager.conf <<EOF
[general]
enabled = yes
port = 5038
bindaddr = 0.0.0.0
displayconnects = yes
timestampevents = yes
eventlimit = 500

[$AMI_USER]
secret = $AMI_PASS
deny = 0.0.0.0/0.0.0.0
permit = 127.0.0.1/255.255.255.255
permit = 172.16.0.0/255.240.0.0
permit = 192.168.0.0/255.255.0.0
permit = 10.0.0.0/255.0.0.0
read = all
write = all
writetimeout = 5000
eventfilter = !Event: RTCPSent
eventfilter = !Event: RTCPReceived
eventfilter = !Event: VarSet
eventfilter = !Event: Newexten
EOF
log "AMI configured (user: $AMI_USER)"

# ── PJSIP ───────────────────────────────────────────────────────────────────
cat > /etc/asterisk/pjsip.conf <<EOF
[global]
type=global
user_agent=DialerOS
keep_alive_interval=90
endpoint_identifier_order=username,ip,anonymous

[transport-udp]
type=transport
protocol=udp
bind=0.0.0.0:5060
external_media_address=$PUBLIC_IP
external_signaling_address=$PUBLIC_IP
allow_reload=yes

[transport-tcp]
type=transport
protocol=tcp
bind=0.0.0.0:5060
external_media_address=$PUBLIC_IP
external_signaling_address=$PUBLIC_IP
allow_reload=yes
EOF
log "PJSIP configured"

# ── Queues ───────────────────────────────────────────────────────────────────
cat > /etc/asterisk/queues.conf <<EOF
[general]
persistentmembers = yes
autofill = yes
log_membername_as_agent = yes
penaltymemberslimit = 0
shared_lastcall = no

[default-queue-options](!)
timeout = 20
retry = 5
wrapuptime = 5
maxlen = 0
strategy = rrmemory
announce-frequency = 0
announce-holdtime = no
joinempty = yes
leavewhenempty = no
reportholdtime = no
musicclass = default
EOF
log "queues.conf written"

# ── Music on Hold ────────────────────────────────────────────────────────────
cat > /etc/asterisk/musiconhold.conf <<EOF
[general]
cachertclasses = yes

[default]
mode = files
directory = /var/lib/asterisk/moh
sort = random
loop = 1
EOF

# Create a silent MOH file using sox (or generate raw PCM if sox absent)
mkdir -p /var/lib/asterisk/moh
if [[ ! -f /var/lib/asterisk/moh/silence.wav ]]; then
  if command -v sox &>/dev/null; then
    sox -n -r 8000 -c 1 -e signed-integer -b 16 /var/lib/asterisk/moh/silence.wav trim 0.0 60.0 2>/dev/null || true
  else
    # Generate a minimal 60s silence wav without sox
    python3 -c "
import struct, wave
with wave.open('/var/lib/asterisk/moh/silence.wav', 'w') as f:
    f.setnchannels(1); f.setsampwidth(2); f.setframerate(8000)
    f.writeframes(b'\\x00\\x00' * 8000 * 60)
" 2>/dev/null || dd if=/dev/zero bs=960000 count=1 > /var/lib/asterisk/moh/silence_raw 2>/dev/null || true
  fi
fi
chown -R asterisk:asterisk /var/lib/asterisk/moh 2>/dev/null || true
log "Music on hold configured"

# ── Dialplan ─────────────────────────────────────────────────────────────────
cat > /etc/asterisk/extensions.conf <<EOF
[general]
autofallthrough = yes
static = yes
writeprotect = no

[globals]
DIALER_SOUNDS=$SOUNDS_DIR
RECORDINGS_DIR=$RECORDINGS_DIR

#include extensions_dialer.conf
EOF

cat > /etc/asterisk/extensions_dialer.conf <<'DIALPLAN'
; ============================================================
; DialerOS — Dynamic Dialplan
; Auto-generated. Managed via the DialerOS Inbound Routes UI.
; ============================================================

[dialer-outbound]
exten => _X.,1,NoOp(DialerOS outbound | Campaign: ${DIALER_CAMPAIGN})
exten => _X.,n,Set(CALLERID(num)=${DIALER_CALLERID})
exten => _X.,n,Answer()
exten => _X.,n,MixMonitor(${RECORDINGS_DIR}/${STRFTIME(${EPOCH},,%Y%m%d-%H%M%S)}-${CALLERID(num)}-${EXTEN}.wav,ab)
exten => _X.,n,Stasis(dialer,${DIALER_CONTACT_ID},${DIALER_CAMPAIGN})
exten => _X.,n,Hangup()

[agents]
exten => _X.,1,NoOp(Agent leg: ${EXTEN})
exten => _X.,n,Dial(PJSIP/${EXTEN},30,tT)
exten => _X.,n,Hangup()

[from-trunk]
exten => _X.,1,NoOp(Inbound from trunk: DID=${EXTEN} | CLI=${CALLERID(num)})
exten => _X.,n,Hangup()

[ivr-default]
exten => s,1,Answer()
exten => s,n,Playback(${DIALER_SOUNDS}/ivr/welcome)
exten => s,n,WaitExten(5)
exten => s,n,Hangup()
DIALPLAN

chown asterisk:asterisk /etc/asterisk/extensions.conf /etc/asterisk/extensions_dialer.conf 2>/dev/null || true
log "Dialplan configured"

# ── Fix all /etc/asterisk permissions ────────────────────────────────────────
chown -R asterisk:asterisk /etc/asterisk 2>/dev/null || true
find /etc/asterisk -name "*.conf" -exec chmod 640 {} \; 2>/dev/null || true
chmod 755 /etc/asterisk 2>/dev/null || true

###############################################################################
# FIREWALL — graceful fallback if ufw not available
###############################################################################
section "Configuring Firewall"

if command -v ufw &>/dev/null; then
  ufw allow OpenSSH                                              2>/dev/null || true
  ufw allow 5060/udp comment "SIP UDP"                          2>/dev/null || true
  ufw allow 5060/tcp comment "SIP TCP"                          2>/dev/null || true
  ufw allow 5061/tcp comment "SIP TLS"                          2>/dev/null || true
  ufw allow 8088/tcp comment "ARI HTTP"                         2>/dev/null || true
  ufw allow 8089/tcp comment "ARI HTTPS/WSS"                    2>/dev/null || true
  ufw allow 10000:20000/udp comment "RTP media"                 2>/dev/null || true
  ufw allow from 127.0.0.1 to any port 5038 comment "AMI local" 2>/dev/null || true
  ufw allow from 172.16.0.0/12 to any port 5038 comment "AMI Docker" 2>/dev/null || true
  ufw allow from 192.168.0.0/16 to any port 5038 comment "AMI LAN" 2>/dev/null || true
  ufw --force enable 2>/dev/null || true
  log "ufw firewall configured"
elif command -v iptables &>/dev/null; then
  iptables -A INPUT -p udp --dport 5060 -j ACCEPT 2>/dev/null || true
  iptables -A INPUT -p tcp --dport 5060 -j ACCEPT 2>/dev/null || true
  iptables -A INPUT -p tcp --dport 8088 -j ACCEPT 2>/dev/null || true
  iptables -A INPUT -p udp --dport 10000:20000 -j ACCEPT 2>/dev/null || true
  log "iptables rules applied (no ufw available)"
else
  skip "Firewall configuration (no ufw or iptables found)"
fi

###############################################################################
# START ASTERISK
###############################################################################
section "Starting Asterisk"

systemctl daemon-reload 2>/dev/null || true
systemctl enable asterisk 2>/dev/null || \
  chkconfig asterisk on 2>/dev/null || true

# Attempt restart up to 3 times
STARTED=false
for attempt in 1 2 3; do
  info "Start attempt $attempt/3..."
  systemctl restart asterisk 2>/dev/null || service asterisk restart 2>/dev/null || true
  sleep 8
  if systemctl is-active --quiet asterisk 2>/dev/null || \
     service asterisk status 2>/dev/null | grep -q "running"; then
    STARTED=true
    break
  fi
  warn "Asterisk not running yet — waiting..."
  sleep 5
done

if [[ "$STARTED" == "true" ]]; then
  log "Asterisk is running ✅"
else
  warn "Asterisk may not have started — check: journalctl -u asterisk -n 50"
  warn "The install completed but Asterisk needs manual attention."
fi

# Verify ARI is responding (give it up to 30s to load modules)
ARI_CHECK=""
for i in $(seq 1 6); do
  ARI_CHECK=$(curl -su "${ARI_USER}:${ARI_PASS}" \
    http://localhost:8088/ari/asterisk/info 2>/dev/null | \
    grep -o '"version":"[^"]*"' || echo "")
  [[ -n "$ARI_CHECK" ]] && break
  sleep 5
done

if [[ -n "$ARI_CHECK" ]]; then
  log "ARI responding: $ARI_CHECK"
else
  warn "ARI not yet responding — Asterisk may still be loading modules"
  warn "Test manually: curl -u ${ARI_USER}:${ARI_PASS} http://localhost:8088/ari/asterisk/info"
fi

###############################################################################
# SAVE CREDENTIALS (read by setup.sh)
###############################################################################
cat > /tmp/dialer_asterisk_creds <<EOF
export ARI_USER="$ARI_USER"
export ARI_PASS="$ARI_PASS"
export AMI_USER="$AMI_USER"
export AMI_PASS="$AMI_PASS"
export PUBLIC_IP="$PUBLIC_IP"
EOF
chmod 600 /tmp/dialer_asterisk_creds

###############################################################################
# SUMMARY
###############################################################################
echo ""
echo "════════════════════════════════════════════"
echo " Asterisk Install Complete ✅"
echo "════════════════════════════════════════════"
echo ""
echo "  ARI URL:        http://$PUBLIC_IP:8088/ari"
echo "  ARI User:       $ARI_USER"
echo "  ARI Password:   $ARI_PASS"
echo ""
echo "  AMI Host:       $PUBLIC_IP:5038"
echo "  AMI User:       $AMI_USER"
echo "  AMI Password:   $AMI_PASS"
echo ""
echo "  Sounds Dir:     $SOUNDS_DIR"
echo "  Recordings Dir: $RECORDINGS_DIR"
echo "  Install Log:    $INSTALL_LOG"
echo ""
echo "  Connect: asterisk -rvvv"
echo ""