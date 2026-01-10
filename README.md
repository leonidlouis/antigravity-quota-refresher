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

You need to extract your authentication token from the Antigravity IDE.

#### Option A: Running Locally (Same machine as IDE)
If you are running this on the same computer where you use Antigravity IDE:

```bash
# 1. Extract the token
sudo apt install sqlite3 && ./export-token.sh
# (Or via NPM: npm install && npm run export-token)

# 2. Copy the token and save to .env
echo "ANTIGRAVITY_REFRESH_TOKEN=your_token_here" > .env
```

#### Option B: Running on VPS (Recommended 24/7)
Since your VPS likely doesn't have the Antigravity IDE, you must **export the token from your local machine first**.

1.  **On Local Machine**: 
    ```bash
    sudo apt install sqlite3 && ./export-token.sh
    # (Or via NPM: npm install && npm run export-token)
    ```
2.  **On VPS**: 
    ```bash
    # Create .env with the copied token
    echo "ANTIGRAVITY_REFRESH_TOKEN=paste_your_token_here" > .env
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
| `./deploy.sh` | Deploy docker container for triggering rolling window (Interactive) |

---

**Credits:**
[wusimpl/AntigravityQuotaWatcher](https://github.com/wusimpl/AntigravityQuotaWatcher) • [shekohex/opencode-google-antigravity-auth](https://github.com/shekohex/opencode-google-antigravity-auth)

## License

Distributed under the MIT License.