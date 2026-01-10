const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const { promisify } = require('util');
const { CLIENT_ID, CLIENT_SECRET, TOKEN_ENDPOINT } = require('./constants');

const execAsync = promisify(exec);

/** Sleep for specified milliseconds */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// =============================================================================
// Helper: HTTP Request
// =============================================================================

function httpRequest(method, urlStr, headers, body = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(urlStr);
        const options = {
            hostname: url.hostname,
            path: url.pathname + url.search,
            method: method,
            headers: headers
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const result = (data && res.headers['content-type']?.includes('json')) ? JSON.parse(data) : {};
                    resolve({ statusCode: res.statusCode, headers: res.headers, body: result, raw: data });
                } catch (e) {
                    resolve({ statusCode: res.statusCode, headers: res.headers, body: null, raw: data });
                }
            });
        });

        req.on('error', reject);

        if (body) {
            req.write(typeof body === 'string' ? body : JSON.stringify(body));
        }
        req.end();
    });
}

// =============================================================================
// Helper: Auth / Token Logic
// =============================================================================

function getAntigravityDbPath() {
    const platform = os.platform();
    const home = os.homedir();
    if (platform === 'darwin') return path.join(home, 'Library/Application Support/Antigravity/User/globalStorage/state.vscdb');
    if (platform === 'win32') return path.join(process.env.APPDATA || '', 'Antigravity/User/globalStorage/state.vscdb');
    return path.join(home, '.config/Antigravity/User/globalStorage/state.vscdb');
}

function parseRefreshTokenFromBuffer(buffer) {
    function readVarint(buf, pos) {
        let res = 0, shift = 0, byte;
        do {
            if (pos >= buf.length) return { val: res, pos: buf.length };
            byte = buf[pos++];
            res |= (byte & 0x7f) << shift;
            shift += 7;
        } while (byte & 0x80);
        return { val: res, pos };
    }
    function getField(buf, fieldParam) {
        let pos = 0;
        while (pos < buf.length) {
            const { val: tag, pos: nextPos } = readVarint(buf, pos);
            pos = nextPos;
            const wire = tag & 7;
            const field = tag >> 3;
            if (wire === 2) {
                const { val: len, pos: dataPos } = readVarint(buf, pos);
                if (field === fieldParam) return buf.slice(dataPos, dataPos + len);
                pos = dataPos + len;
            } else if (wire === 0) {
                const { pos: next } = readVarint(buf, pos);
                pos = next;
            } else break;
        }
        return null;
    }
    const oauthData = getField(buffer, 6);
    if (!oauthData) return null;
    const tokenBytes = getField(oauthData, 3);
    return tokenBytes ? tokenBytes.toString('utf8') : null;
}

async function getRefreshToken() {
    if (process.env.ANTIGRAVITY_REFRESH_TOKEN) {
        // Only log this if explicitly asked (caller can handle logs)
        // console.log('🔑 Token source: Environment variable');
        return process.env.ANTIGRAVITY_REFRESH_TOKEN;
    }

    const dbPath = getAntigravityDbPath();
    if (!fs.existsSync(dbPath)) throw new Error(`Database not found at ${dbPath}`);

    // console.log(`🔑 Token source: VS Code database (${dbPath})`);
    const cmd = `sqlite3 "${dbPath}" "SELECT value FROM ItemTable WHERE key = 'jetskiStateSync.agentManagerInitState'"`;
    const { stdout } = await execAsync(cmd).catch(() => ({ stdout: '' }));
    if (!stdout.trim()) throw new Error('No auth data found in VS Code database.');
    const token = parseRefreshTokenFromBuffer(Buffer.from(stdout.trim(), 'base64'));
    if (!token) throw new Error('Failed to parse refresh token.');
    return token;
}

async function getAccessToken(refreshToken) {
    const res = await httpRequest('POST', TOKEN_ENDPOINT, { 'Content-Type': 'application/x-www-form-urlencoded' },
        new URLSearchParams({
            client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
            refresh_token: refreshToken, grant_type: 'refresh_token'
        }).toString()
    );
    if (res.body && res.body.access_token) return res.body.access_token;
    throw new Error(`Token refresh failed: ${res.raw}`);
}

module.exports = {
    httpRequest,
    getRefreshToken,
    getAccessToken,
    sleep,
    execAsync
};
