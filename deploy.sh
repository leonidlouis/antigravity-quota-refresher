#!/bin/bash
# ─────────────────────────────────────────────────────────────
# Antigravity Quota Refresher - One-Command Deploy
# ─────────────────────────────────────────────────────────────

set -e

echo "╔══════════════════════════════════════════════════════════╗"
echo "║   ANTIGRAVITY QUOTA REFRESHER - DEPLOY                   ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# ─────────────────────────────────────────────────────────────
# Step 1: Check for token
# ─────────────────────────────────────────────────────────────

if [ -f .env ]; then
    source .env
fi

if [ -z "$ANTIGRAVITY_REFRESH_TOKEN" ]; then
    echo "❌ ERROR: No token found!"
    echo ""
    echo "On your LOCAL machine (with Antigravity IDE), run:"
    echo "  npm run export-token"
    echo ""
    echo "Then create .env file on this server:"
    echo "  echo \"ANTIGRAVITY_REFRESH_TOKEN=<your_token>\" > .env"
    echo ""
    exit 1
fi

echo "✓ Token found"

# ─────────────────────────────────────────────────────────────
# Step 2: Get timezone from user
# ─────────────────────────────────────────────────────────────

# Check if TZ already set in .env
EXISTING_TZ=$(grep "^TZ=" .env 2>/dev/null | cut -d= -f2)

# Sanity check EXISTING_TZ. If it's garbage (e.g. not Etc/GMT, not an offset check, not IANA), ignore it
if [ -n "$EXISTING_TZ" ]; then
    # Allow Etc/GMT+7, Etc/GMT-12 (1-2 digits)
    if ! [[ "$EXISTING_TZ" =~ ^Etc/GMT[-+][0-9]{1,2}$ ]] && \
       # Allow +7, -5, +12 (1-2 digits)
       ! [[ "$EXISTING_TZ" =~ ^[+-][0-9]{1,2}$ ]] && \
       # Allow valid IANA strings
       ! [[ "$EXISTING_TZ" =~ ^[A-Za-z]+/[A-Za-z_]+$ ]]; then
        EXISTING_TZ=""
    fi
fi

# Detect system timezone offset (e.g., +0700 -> +7)
SYSTEM_OFFSET=$(date +%z | sed 's/00$//')
# Remove leading zeros if any, but keep sign (e.g. +07 -> +7)
if [[ "$SYSTEM_OFFSET" =~ ^\+[0-9]+$ ]]; then
    SYSTEM_OFFSET="+$(echo "${SYSTEM_OFFSET#+}" | sed 's/^0*//')"
elif [[ "$SYSTEM_OFFSET" =~ ^-[0-9]+$ ]]; then
    SYSTEM_OFFSET="-$(echo "${SYSTEM_OFFSET#-}" | sed 's/^0*//')"
fi

# Determine default suggestions
if [ -n "$EXISTING_TZ" ]; then
    # Try to Convert Etc/GMT format back to offset display if possible, strictly for display
    # Etc/GMT-7 => +7
    if [[ "$EXISTING_TZ" =~ ^Etc/GMT\-[0-9]+$ ]]; then
        DISPLAY_DEFAULT="+${EXISTING_TZ#Etc/GMT-}"
    elif [[ "$EXISTING_TZ" =~ ^Etc/GMT\+[0-9]+$ ]]; then
        DISPLAY_DEFAULT="-${EXISTING_TZ#Etc/GMT+}"
    else
        DISPLAY_DEFAULT="$EXISTING_TZ"
    fi
    DEFAULT_SOURCE="Configured"
else
    DISPLAY_DEFAULT="${SYSTEM_OFFSET:-+0}"
    DEFAULT_SOURCE="Detected"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Select Timezone (UTC Offset)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Your VPS/System appears to be: $SYSTEM_OFFSET"
echo ""
echo "  What UTC offset should be used?"
echo "  (Press ENTER to use: $DISPLAY_DEFAULT)"
echo ""
read -p "Enter offset (e.g., +7, -5): " USER_OFFSET

if [ -z "$USER_OFFSET" ]; then
    USER_OFFSET="$DISPLAY_DEFAULT"
fi

# Auto-append + for positive integers (e.g. 7 -> +7)
if [[ "$USER_OFFSET" =~ ^[0-9]+$ ]]; then
    USER_OFFSET="+$USER_OFFSET"
fi

# Convert to Etc/GMT format (note: signs are reversed in Etc/GMT)
if [[ "$USER_OFFSET" =~ ^[+-]?[0-9]+$ ]]; then
    # Remove leading + if present
    OFFSET_NUM="${USER_OFFSET#+}"
    # Reverse sign for Etc/GMT format
    if [[ "$OFFSET_NUM" =~ ^- ]]; then
        TZ_VALUE="Etc/GMT+${OFFSET_NUM#-}"
    else
        TZ_VALUE="Etc/GMT-${OFFSET_NUM}"
    fi
else
    # Fallback to direct input if it looks like a valid specific timezone string (e.g. Asia/Bangkok)
    # Strictly check known continents to avoid "zone/asd" garbage
    if [[ "$USER_OFFSET" =~ ^(Africa|America|Antarctica|Arctic|Asia|Atlantic|Australia|Europe|Indian|Pacific|Etc|UTC|GMT)/[A-Za-z0-9_+-]+$ ]]; then
         TZ_VALUE="$USER_OFFSET"
    else
        echo "❌ ERROR: Invalid timezone format."
        echo "   Accepted formats:"
        echo "   - UTC Offset:  +7, -5, +0"
        echo "   - IANA Zone:   Asia/Bangkok, America/New_York, Europe/London"
        echo ""
        exit 1
    fi
fi

# Format display value for the user (e.g. "+7" -> "UTC+7")
if [[ "$USER_OFFSET" =~ ^[+-] ]]; then
    DISPLAY_TZ="UTC$USER_OFFSET"
else
    DISPLAY_TZ="$USER_OFFSET"
fi

echo ""
echo "✓ Timezone: $DISPLAY_TZ"

# ─────────────────────────────────────────────────────────────
# Step 3: Get trigger time from user (or use argument)
# ─────────────────────────────────────────────────────────────

TRIGGER_TIME="${1:-}"

if [ -z "$TRIGGER_TIME" ]; then
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "When should your quota be triggered daily?"
    echo ""
    echo "  Quota refreshes 5 hours after trigger."
    echo ""
    echo "  Example: You work at 17:00, want quota refreshed at 19:00"
    echo "           → Set trigger to 14:00 (19:00 - 5h)"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    read -p "Enter trigger time (HH:MM, 24h format): " TRIGGER_TIME
fi

# Validate time format
if ! [[ "$TRIGGER_TIME" =~ ^([01][0-9]|2[0-3]):[0-5][0-9]$ ]]; then
    echo "❌ Invalid time format. Use HH:MM (e.g., 12:00, 09:30)"
    exit 1
fi

echo ""
# Calculate refresh time using bash math for reliability
IFS=':' read -r H M <<< "$TRIGGER_TIME"
REFRESH_H=$(( (10#$H + 5) % 24 ))
REFRESH_DISPLAY="$(printf "%02d:%s" $REFRESH_H $M)"

echo "✓ Trigger time: $TRIGGER_TIME"
echo "  → Quota will refresh at $REFRESH_DISPLAY"

# ─────────────────────────────────────────────────────────────
# Step 4: Save config to .env
# ─────────────────────────────────────────────────────────────

# Save trigger time
if grep -q "^TRIGGER_TIME=" .env 2>/dev/null; then
    sed -i "s/^TRIGGER_TIME=.*/TRIGGER_TIME=$TRIGGER_TIME/" .env
else
    echo "TRIGGER_TIME=$TRIGGER_TIME" >> .env
fi

# Save timezone
if grep -q "^TZ=" .env; then
    # Use | as delimiter because TZ_VALUE contains / (e.g. Etc/GMT-7)
    sed -i "s|^TZ=.*|TZ=$TZ_VALUE|" .env
else
    echo "TZ=$TZ_VALUE" >> .env
fi

# ─────────────────────────────────────────────────────────────
# Step 5: Start container
# ─────────────────────────────────────────────────────────────

echo ""
echo "Stopping existing instance..."
# Stop existing if running
docker compose down 2>/dev/null || true

echo "Building and starting container..."
# Build and start with the trigger time
TRIGGER_TIME="$TRIGGER_TIME" docker compose up -d --build

echo "Waiting for container to initialize..."
sleep 3

# Check if container is actually running
if ! docker compose ps --services --filter "status=running" | grep -q "antigravity"; then
    echo ""
    echo "❌ ERROR: Container failed to start!"
    echo "Logs:"
    echo "────────────────────────────────────────"
    docker compose logs --tail=20
    echo "────────────────────────────────────────"
    exit 1
fi

# Calculate refresh time (Trigger + 5h)
REFRESH_TIME=$(date -d "$TRIGGER_TIME 5 hours" +%H:%M 2>/dev/null)
if [ -z "$REFRESH_TIME" ]; then
    # Fallback for systems with limited date command
    # simple bash math for hours
    IFS=':' read -r H M <<< "$TRIGGER_TIME"
    REFRESH_H=$(( (10#$H + 5) % 24 ))
    REFRESH_TIME="$(printf "%02d:%s" $REFRESH_H $M)"
fi

# Format timezone for display (e.g. "+7" -> "+7 UTC")
if [[ "$USER_OFFSET" =~ ^[+-] ]]; then
    FINAL_TZ="$USER_OFFSET UTC"
else
    FINAL_TZ="$USER_OFFSET"
fi

# Calculate current time for display
CURRENT_TIME=$(TZ="$TZ_VALUE" date +%H:%M 2>/dev/null || date +%H:%M)

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║   ✓ DEPLOYED SUCCESSFULLY                                ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "  Current time:  $CURRENT_TIME ($FINAL_TZ)"
echo "  Trigger time:  $TRIGGER_TIME daily ($FINAL_TZ)"
echo "  Quota refresh: est. $REFRESH_TIME ($FINAL_TZ)"
echo ""
echo "  Commands:"
echo "    docker compose logs -f    # View logs"
echo "    docker compose down       # Stop"
echo "    ./deploy.sh               # Change trigger time"
echo ""
