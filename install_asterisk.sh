#!/bin/bash

###############################################################################
# DialerOS — Asterisk 22 Comprehensive Installer
# Installs and fully configures Asterisk 22 for a production power dialer.
#
# Can be run standalone OR called by setup.sh (which passes credentials
# via exported environment variables).
#
# Configures:
#   - ARI  (HTTP REST Interface for channel control)
#   - AMI  (Manager Interface for real-time events)
#   - PJSIP transports (UDP, TCP, TLS, WSS)
#   - All required modules (queues, MixMonitor, ChanSpy, AGI, Stasis)
#   - Recordings directory
#   - IVR sounds directory
#   - Music on hold
#   - Dialplan framework (extensions_dialer.conf)
#   - Firewall rules
###############################################################################

set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'; BOLD='\033[1m'
log()     { echo -e "${GREEN}[✔]${NC} $1"; }
info()    { echo -e "${CYAN}[•]${NC} $1"; }
warn()    { echo -e "${YELLOW}[!]${NC} $1"; }
error()   { echo -e "${RED}[✘]${NC} $1"; exit 1; }
section() { echo -e "\n${BOLD}${CYAN}━━━ $1 ━━━${NC}\n"; }

###############################################################################
# ROOT CHECK
###############################################################################
[[ $EUID -ne 0 ]] && error "Run as root"

NON_INTERACTIVE="${1:-}"

###############################################################################
# VARIABLES — use env-injected values from setup.sh, or generate fresh ones
###############################################################################
ASTERISK_VERSION="22"
SRC_DIR="/usr/src"
BUILD_DIR="$SRC_DIR/asterisk-build"
TAR_FILE="asterisk-22-current.tar.gz"

ARI_USER="${ARI_USER:-dialer}"
ARI_PASS="${ARI_PASS:-$(openssl rand -base64 24 | tr -d '/+=')}"
AMI_USER="${AMI_USER:-dialer}"
AMI_PASS="${AMI_PASS:-$(openssl rand -base64 24 | tr -d '/+=')}"
PUBLIC_IP="${PUBLIC_IP:-$(curl -s --max-time 10 ifconfig.me 2>/dev/null || echo '127.0.0.1')}"

SOUNDS_DIR="/var/lib/asterisk/sounds/dialer"
RECORDINGS_DIR="/var/spool/asterisk/monitor"

###############################################################################
# CLEAN PREVIOUS INSTALL
###############################################################################
section "Cleaning Previous Installation"

if systemctl list-units --type=service 2>/dev/null | grep -q asterisk; then
  info "Stopping existing Asterisk..."
  systemctl stop asterisk || true
fi

if command -v asterisk &>/dev/null; then
  warn "Existing Asterisk detected → removing..."
  apt-get remove --purge -y asterisk 2>/dev/null || true
  rm -rf /etc/asterisk /var/lib/asterisk /var/log/asterisk /usr/lib/asterisk
fi

rm -rf "$BUILD_DIR" "$SRC_DIR"/asterisk-22*
mkdir -p "$BUILD_DIR"
log "Clean complete"

###############################################################################
# SYSTEM DEPENDENCIES
###############################################################################
section "Installing Dependencies"

apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq \
  build-essential git wget curl unzip \
  libncurses5-dev libssl-dev libxml2-dev uuid-dev \
  libjansson-dev libsqlite3-dev libedit-dev \
  libsrtp2-dev libspandsp-dev libogg-dev \
  libvorbis-dev mp3lame sox ffmpeg \
  pkg-config subversion openssl ufw \
  lsb-release tzdata
log "Dependencies installed"

###############################################################################
# DOWNLOAD & EXTRACT ASTERISK
###############################################################################
section "Downloading Asterisk $ASTERISK_VERSION"

cd "$BUILD_DIR"
info "Downloading $TAR_FILE..."
wget -q --show-progress "http://downloads.asterisk.org/pub/telephony/asterisk/$TAR_FILE"
tar -xzf "$TAR_FILE"
ASTERISK_DIR=$(tar -tzf "$TAR_FILE" | head -1 | cut -f1 -d"/")
cd "$ASTERISK_DIR"
log "Extracted: $ASTERISK_DIR"

###############################################################################
# BUILD ASTERISK
###############################################################################
section "Building Asterisk"

info "Getting MP3 support..."
contrib/scripts/get_mp3_source.sh || warn "MP3 source skip (non-critical)"

info "Running configure..."
./configure --with-jansson-bundled 2>&1 | tail -5

info "Preparing menuselect..."
make menuselect.makeopts

info "Enabling required modules..."
menuselect/menuselect \
  --enable res_http_websocket \
  --enable res_ari \
  --enable res_ari_applications \
  --enable res_ari_asterisk \
  --enable res_ari_bridges \
  --enable res_ari_channels \
  --enable res_ari_device_states \
  --enable res_ari_endpoints \
  --enable res_ari_events \
  --enable res_ari_model \
  --enable res_ari_playbacks \
  --enable res_ari_recordings \
  --enable res_ari_sounds \
  --enable res_stasis \
  --enable res_stasis_answer \
  --enable res_stasis_device_state \
  --enable res_stasis_playback \
  --enable res_stasis_recording \
  --enable res_stasis_snoop \
  --enable chan_pjsip \
  --enable res_pjsip \
  --enable res_pjsip_acl \
  --enable res_pjsip_authenticator_digest \
  --enable res_pjsip_caller_id \
  --enable res_pjsip_config_wizard \
  --enable res_pjsip_dialog_info_body_generator \
  --enable res_pjsip_diversion \
  --enable res_pjsip_dtmf_info \
  --enable res_pjsip_endpoint_identifier_anonymous \
  --enable res_pjsip_endpoint_identifier_ip \
  --enable res_pjsip_endpoint_identifier_user \
  --enable res_pjsip_exten_state \
  --enable res_pjsip_header_funcs \
  --enable res_pjsip_logger \
  --enable res_pjsip_mwi \
  --enable res_pjsip_nat \
  --enable res_pjsip_notify \
  --enable res_pjsip_one_touch_record_info \
  --enable res_pjsip_outbound_authenticator_digest \
  --enable res_pjsip_outbound_registration \
  --enable res_pjsip_path \
  --enable res_pjsip_pidf_body_generator \
  --enable res_pjsip_publish_asterisk \
  --enable res_pjsip_pubsub \
  --enable res_pjsip_refer \
  --enable res_pjsip_registrar \
  --enable res_pjsip_rfc3326 \
  --enable res_pjsip_sdp_rtp \
  --enable res_pjsip_send_to_voicemail \
  --enable res_pjsip_session \
  --enable res_pjsip_sips_contact \
  --enable res_pjsip_t38 \
  --enable res_pjsip_transport_websocket \
  --enable res_pjsip_xpidf_body_generator \
  --enable app_chanspy \
  --enable app_confbridge \
  --enable app_dial \
  --enable app_dtmfstore \
  --enable app_exec \
  --enable app_mixmonitor \
  --enable app_originate \
  --enable app_playback \
  --enable app_queue \
  --enable app_record \
  --enable app_senddtmf \
  --enable app_stasis \
  --enable app_transfer \
  --enable app_voicemail \
  --enable app_waitexten \
  --enable res_musiconhold \
  --enable codec_ulaw \
  --enable codec_alaw \
  --enable codec_g722 \
  --enable codec_gsm \
  --enable res_format_attr_h264 \
  --enable res_format_attr_opus \
  menuselect.makeopts

info "Compiling Asterisk (this takes 5-15 min)..."
make -j"$(nproc)" 2>&1 | tail -10
make install 2>&1 | tail -5
make samples 2>&1 | tail -3
make config 2>&1 | tail -3
ldconfig
log "Asterisk compiled and installed"

###############################################################################
# CREATE ASTERISK USER & PERMISSIONS
###############################################################################
section "Setting Permissions"

groupadd asterisk 2>/dev/null || true
useradd -r -d /var/lib/asterisk -g asterisk asterisk 2>/dev/null || true

mkdir -p "$SOUNDS_DIR" "$RECORDINGS_DIR"
chown -R asterisk:asterisk /var/lib/asterisk /var/log/asterisk /var/spool/asterisk /usr/lib/asterisk
chmod -R 775 "$SOUNDS_DIR" "$RECORDINGS_DIR"

# Run as asterisk user
sed -i 's/;runuser = asterisk/runuser = asterisk/' /etc/asterisk/asterisk.conf
sed -i 's/;rungroup = asterisk/rungroup = asterisk/' /etc/asterisk/asterisk.conf
sed -i 's/#AST_USER="asterisk"/AST_USER="asterisk"/' /etc/default/asterisk 2>/dev/null || true
sed -i 's/#AST_GROUP="asterisk"/AST_GROUP="asterisk"/' /etc/default/asterisk 2>/dev/null || true
log "Permissions set"

###############################################################################
# HTTP / ARI CONFIGURATION
###############################################################################
section "Configuring ARI"

cat > /etc/asterisk/http.conf <<EOF
[general]
enabled=yes
bindaddr=0.0.0.0
bindport=8088
; TLS — enable if using HTTPS (needs a cert)
; tlsenable=yes
; tlsbindaddr=0.0.0.0:8089
; tlscertfile=/etc/asterisk/keys/asterisk.pem
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

###############################################################################
# AMI CONFIGURATION
###############################################################################
section "Configuring AMI"

cat > /etc/asterisk/manager.conf <<EOF
[general]
enabled = yes
port = 5038
; Bind to all interfaces (API container accesses this via host IP)
bindaddr = 0.0.0.0
displayconnects = yes
timestampevents = yes
; Limit event flood
eventlimit = 500

[$AMI_USER]
secret = $AMI_PASS
; Allow connections from localhost AND Docker subnets
deny = 0.0.0.0/0.0.0.0
permit = 127.0.0.1/255.255.255.255
permit = 172.16.0.0/255.240.0.0
permit = 192.168.0.0/255.255.0.0
permit = 10.0.0.0/255.0.0.0
read = all
write = all
writetimeout = 5000
; Subscribe to the events the dialer needs
eventfilter = !Event: RTCPSent
eventfilter = !Event: RTCPReceived
eventfilter = !Event: VarSet
eventfilter = !Event: Newexten
EOF

log "AMI configured (user: $AMI_USER)"

###############################################################################
# PJSIP CONFIGURATION
###############################################################################
section "Configuring PJSIP"

cat > /etc/asterisk/pjsip.conf <<EOF
; ============================================================
; DialerOS PJSIP Configuration
; Endpoints and trunks are managed dynamically via ARI/AMI.
; This file only defines global settings and transports.
; ============================================================

[global]
type=global
user_agent=DialerOS
keep_alive_interval=90
endpoint_identifier_order=username,ip,anonymous

; ---- UDP transport (standard SIP) ----
[transport-udp]
type=transport
protocol=udp
bind=0.0.0.0:5060
external_media_address=$PUBLIC_IP
external_signaling_address=$PUBLIC_IP
allow_reload=yes

; ---- TCP transport ----
[transport-tcp]
type=transport
protocol=tcp
bind=0.0.0.0:5060
external_media_address=$PUBLIC_IP
external_signaling_address=$PUBLIC_IP
allow_reload=yes

; ---- TLS transport (needs /etc/asterisk/keys/asterisk.pem) ----
; [transport-tls]
; type=transport
; protocol=tls
; bind=0.0.0.0:5061
; cert_file=/etc/asterisk/keys/asterisk.pem
; ca_list_file=/etc/asterisk/keys/ca.pem
; external_media_address=$PUBLIC_IP
; external_signaling_address=$PUBLIC_IP

; ---- WebSocket transport (SIP over WSS for browsers) ----
; [transport-wss]
; type=transport
; protocol=wss
; bind=0.0.0.0:8089
EOF

log "PJSIP transports configured"

###############################################################################
# QUEUES CONFIGURATION
###############################################################################
section "Configuring Call Queues"

cat > /etc/asterisk/queues.conf <<EOF
[general]
; Persist queue member pause state across restarts
persistentmembers = yes
; Remove unavailable members from queue count
autofill = yes
; AMI events verbosity
log_membername_as_agent = yes
; Penalty system scale
penaltymemberslimit = 0
; Keep stats per queue
shared_lastcall = no

; ── Default queue options (overridden per-queue) ──
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

###############################################################################
# MUSIC ON HOLD
###############################################################################
section "Configuring Music On Hold"

cat > /etc/asterisk/musiconhold.conf <<EOF
[general]
cachertclasses = yes

[default]
mode = files
directory = /var/lib/asterisk/moh
sort = random
loop = 1
EOF

# Create a default silent MOH file so queues don't error
mkdir -p /var/lib/asterisk/moh
if [[ ! -f /var/lib/asterisk/moh/silence.wav ]]; then
  sox -n -r 8000 -c 1 -e signed-integer -b 16 /var/lib/asterisk/moh/silence.wav trim 0.0 60.0 2>/dev/null || true
fi
chown -R asterisk:asterisk /var/lib/asterisk/moh
log "Music on hold configured"

###############################################################################
# DIALPLAN
###############################################################################
section "Configuring Dialplan"

cat > /etc/asterisk/extensions.conf <<EOF
; ============================================================
; DialerOS Dialplan
; !! Most routing is in extensions_dialer.conf !!
; !! Managed dynamically — do not edit manually !!
; ============================================================

[general]
autofallthrough = yes
static = yes
writeprotect = no

[globals]
DIALER_SOUNDS=$SOUNDS_DIR
RECORDINGS_DIR=$RECORDINGS_DIR

; Include dynamically generated routes (managed from the DialerOS UI)
#include extensions_dialer.conf
EOF

cat > /etc/asterisk/extensions_dialer.conf <<EOF
; ============================================================
; DialerOS — Dynamic Dialplan
; Auto-generated. Managed via the DialerOS Inbound Routes UI.
; ============================================================

; ── Outbound Dialer (used by the worker to originate predictive calls) ──
[dialer-outbound]
exten => _X.,1,NoOp(DialerOS outbound call to \${EXTEN} | Campaign: \${DIALER_CAMPAIGN})
exten => _X.,n,Set(CALLERID(num)=\${DIALER_CALLERID})
exten => _X.,n,Answer()
; Start call recording
exten => _X.,n,MixMonitor(\${RECORDINGS_DIR}/\${STRFTIME(\${EPOCH},,\%Y\%m\%d-\%H\%M\%S)}-\${CALLERID(num)}-\${EXTEN}.wav,ab)
; Hand off to ARI Stasis (the dialer app controls the call from here)
exten => _X.,n,Stasis(dialer,\${DIALER_CONTACT_ID},\${DIALER_CAMPAIGN})
exten => _X.,n,Hangup()

; ── Agent Extensions ──
[agents]
exten => _X.,1,NoOp(Agent leg: \${EXTEN})
exten => _X.,n,Dial(PJSIP/\${EXTEN},30,tT)
exten => _X.,n,Hangup()

; ── Inbound from SIP Trunk ──
; (Routes auto-generated by DialerOS Inbound Routes → Push to Asterisk)
[from-trunk]
exten => _X.,1,NoOp(Inbound from trunk: DID=\${EXTEN} | CLI=\${CALLERID(num)})
exten => _X.,n,Hangup()

; ── IVR Placeholder (replaced by IVR Builder) ──
[ivr-default]
exten => s,1,Answer()
exten => s,n,Playback(\${DIALER_SOUNDS}/ivr/welcome)
exten => s,n,WaitExten(5)
exten => s,n,Hangup()
EOF

chown asterisk:asterisk /etc/asterisk/extensions.conf /etc/asterisk/extensions_dialer.conf
log "Dialplan configured"

###############################################################################
# FIREWALL
###############################################################################
section "Configuring Firewall"

ufw allow OpenSSH
ufw allow 5060/udp comment "SIP UDP"
ufw allow 5060/tcp comment "SIP TCP"
ufw allow 5061/tcp comment "SIP TLS"
ufw allow 8088/tcp comment "Asterisk ARI HTTP"
ufw allow 8089/tcp comment "Asterisk ARI HTTPS/WSS"
ufw allow 10000:20000/udp comment "RTP media"
# AMI: only allow from localhost and Docker subnets (NOT the internet)
ufw allow from 127.0.0.1 to any port 5038 comment "AMI localhost"
ufw allow from 172.16.0.0/12 to any port 5038 comment "AMI Docker"
ufw allow from 192.168.0.0/16 to any port 5038 comment "AMI LAN"
ufw --force enable
log "Firewall configured"

###############################################################################
# FIX /etc/asterisk PERMISSIONS
###############################################################################
chown -R asterisk:asterisk /etc/asterisk
chmod -R 640 /etc/asterisk/*.conf
chmod 755 /etc/asterisk

###############################################################################
# START ASTERISK
###############################################################################
section "Starting Asterisk"

systemctl daemon-reload
systemctl enable asterisk
systemctl restart asterisk
sleep 8

if systemctl is-active --quiet asterisk; then
  log "Asterisk is running ✅"
else
  error "Asterisk failed to start — check: journalctl -u asterisk -n 80"
fi

# Verify ARI is responding
ARI_CHECK=$(curl -su "${ARI_USER}:${ARI_PASS}" http://localhost:8088/ari/asterisk/info 2>/dev/null | grep -o '"version":"[^"]*"' || echo "")
if [[ -n "$ARI_CHECK" ]]; then
  log "ARI responding: $ARI_CHECK"
else
  warn "ARI not yet responding — may still be loading modules"
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
if [[ "$NON_INTERACTIVE" != "--non-interactive" ]]; then
  echo ""
  echo "════════════════════════════════════════════"
  echo " Asterisk Install Complete ✅"
  echo "════════════════════════════════════════════"
  echo ""
  echo "  ARI URL:   http://$PUBLIC_IP:8088/ari"
  echo "  ARI User:  $ARI_USER"
  echo "  ARI Pass:  $ARI_PASS"
  echo ""
  echo "  AMI Host:  $PUBLIC_IP:5038"
  echo "  AMI User:  $AMI_USER"
  echo "  AMI Pass:  $AMI_PASS"
  echo ""
  echo "  Sounds Dir:     $SOUNDS_DIR"
  echo "  Recordings Dir: $RECORDINGS_DIR"
  echo ""
  echo "  Connect: asterisk -rvvv"
  echo ""
fi