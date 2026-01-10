# Antigravity Quota Refresher

## The Problem

Antigravity quotas (Google AI Pro / Ultra users) operate on a **5-hour rolling window**. If you use it at 10:00, your quota refreshes at 15:00. For intense coding sessions, this falls a bit short.

## The Solution

Trigger "dummy" API calls hours **before** you work to start rolling window → quota refreshes mid-session.

**Example:**
- You start work at **10:00**
- Trigger at **07:00** → Quota refreshes at **12:00**
- Which means 2 hours after you start your work, you have a fresh quota.

---

## ⚡ Quick Start
Highly recommended to deploy this in an always-on VPS (or local machine).

### 1. Clone
```bash
git clone https://github.com/leonidlouis/antigravity-quota-refresher.git
cd antigravity-quota-refresher
```

### 2. Setup Token
```bash
# Need Antigravity IDE installed and logged in.
# Might need to install sqlite3 if not present.
# sudo apt install sqlite3 // brew install sqlite3 // etc.
./export-token.sh

# OR using NPM
npm install && npm run export-token

# Copy the token, then create .env:
echo "ANTIGRAVITY_REFRESH_TOKEN=your_token_here" > .env
```

### 3. Deploy
```bash
./deploy.sh
```

That's it. The script will:
1. ✓ Test your API connection
2. ✓ Ask for trigger time & timezone
3. ✓ Start the container with auto-restart

### Re-Deploy / Change Trigger Time
```bash
./deploy.sh
```

### Check Status
```bash
docker compose logs -f
```

---

## 🔧 Commands

| Command | Description |
|---------|-------------|
| `docker compose logs` | View logs & status |
| `./export-token.sh` | Export token (Unix) |
| `npm run export-token` | Export token (NPM) |
| `./deploy.sh` | Deploy (interactive) |

---

## 🔐 Security

> [!IMPORTANT]
> **Never commit your token!**

- `.env` files are gitignored
- Docker images never bake in tokens

---

**Credits:**
[wusimpl/AntigravityQuotaWatcher](https://github.com/wusimpl/AntigravityQuotaWatcher) • [shekohex/opencode-google-antigravity-auth](https://github.com/shekohex/opencode-google-antigravity-auth)

## License
MIT