#!/usr/bin/env node
/**
 * Antigravity Quota Trigger
 * 
 * Triggers quota usage on Google Antigravity API endpoints to reset the 5-hour
 * rolling quota window. Designed to be called by the scheduler (index.js) or
 * run manually for quota checking.
 * 
 * Usage:
 *   node src/trigger.js              # Check quota and trigger usage
 *   node src/trigger.js --export-token  # Export refresh token for VPS deployment
 * 
 * Environment Variables:
 *   ANTIGRAVITY_REFRESH_TOKEN - If set, uses this token instead of reading from VS Code DB
 */

const https = require('https');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

// Load .env only if present (suppress logs)
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath, quiet: true });
}
const {
    HEADERS,
    ANTIGRAVITY_SYSTEM_INSTRUCTION,
    PLUGIN_SESSION_ID,
    ENDPOINTS,
    MODEL_GROUPS
} = require('./lib/constants');
const {
    httpRequest,
    getRefreshToken,
    getAccessToken,
    sleep,
    execAsync
} = require('./lib/auth');

// =============================================================================
// Helpers
// =============================================================================

function generateRequestId() {
    return crypto.randomUUID();
}

function buildSignatureSessionKey(sessionId, model, project) {
    return `${sessionId}:${model}:${project}`;
}

// =============================================================================
// Core Logic
// =============================================================================

function printTable(data) {
    if (!data || data.length === 0) return;

    // Headers as requested
    const headers = ['Quota Pool', 'Remaining', 'Reset'];
    // Map data to rows: id -> Quota Pool
    const rows = data.map(d => [d.id, d.remaining, d.reset]);

    // Calculate column widths (content + 2 padding)
    const widths = headers.map((h, i) => {
        const maxContent = Math.max(...rows.map(r => String(r[i]).length));
        return Math.max(h.length, maxContent) + 2;
    });

    // Helper to draw border lines
    const drawLine = (start, mid, end) => {
        console.log(start + widths.map(w => '─'.repeat(w)).join(mid) + end);
    };

    // Draw Table
    drawLine('┌', '┬', '┐');
    // Header
    console.log('│' + headers.map((h, i) => ' ' + h.padEnd(widths[i] - 1)).join('│') + '│');
    drawLine('├', '┼', '┤');
    // Rows
    rows.forEach(row => {
        console.log('│' + row.map((c, i) => ' ' + String(c).padEnd(widths[i] - 1)).join('│') + '│');
    });
    drawLine('└', '┴', '┘');
}

async function checkQuota(baseUrl, accessToken, projectId) {
    console.log(`\n2. Checking Quota...`);
    const res = await httpRequest('POST', `${baseUrl}/v1internal:fetchAvailableModels`, {
        ...HEADERS,
        'Authorization': `Bearer ${accessToken}`
    }, { project: projectId });

    if (res.statusCode !== 200) {
        throw new Error(`Failed to fetch models: ${res.statusCode} ${res.raw}`);
    }

    const allModels = res.body.models || {};
    const summaryMap = new Map();

    for (const [modelId, info] of Object.entries(allModels)) {
        const group = MODEL_GROUPS.find(g => g.patterns.some(p => p.test(modelId)));
        if (!group) continue;
        if (modelId.includes('image')) continue;

        // If we already have this group, skip (assuming pooled quota is identical)
        if (summaryMap.has(group.id)) continue;

        const quota = info.quotaInfo || {};
        const remaining = (quota.remainingFraction || 0) * 100;
        let resetTime = 'Unknown';
        if (quota.resetTime) {
            const d = new Date(quota.resetTime);
            resetTime = d.toLocaleTimeString() + ` (UTC${-d.getTimezoneOffset() / 60})`;
        }
        summaryMap.set(group.id, {
            id: group.id,
            remaining: remaining.toFixed(2) + '%',
            remainingValue: remaining, // Store numeric value
            reset: resetTime
        });
    }
    const summary = MODEL_GROUPS.map(g => summaryMap.get(g.id)).filter(Boolean);
    if (summary.length > 0) {
        // Hide internal flags from table output
        printTable(summary);
    }
    return summary;
}

async function triggerQuota(baseUrl, accessToken, projectId, modelId) {
    const requestHeaders = { ...HEADERS, 'Authorization': `Bearer ${accessToken}` };
    if (modelId.includes('claude') && modelId.includes('thinking')) {
        requestHeaders['anthropic-beta'] = 'interleaved-thinking-2025-05-14';
    }

    const requestId = generateRequestId();
    const signatureSessionKey = buildSignatureSessionKey(PLUGIN_SESSION_ID, modelId, projectId);

    // Opencode Wrapper + Prompt
    const wrappedPayload = {
        model: modelId,
        project: projectId,
        userAgent: 'antigravity',
        requestType: 'agent',
        requestId: requestId,
        request: {
            sessionId: signatureSessionKey,
            systemInstruction: {
                role: 'user', // Opencode uses 'user' role for system instruction compatibility
                parts: [{ text: ANTIGRAVITY_SYSTEM_INSTRUCTION }]
            },
            contents: [{ role: 'user', parts: [{ text: 'whats a common way to install NPM on Ubuntu Machines' }] }],
            generationConfig: {
                maxOutputTokens: 10000,
                thinkingConfig: modelId.includes('thinking') ? { includeThoughts: true, thinkingLevel: 'low' } : undefined
            }
        }
    };

    const url = `${baseUrl}/v1internal:streamGenerateContent?alt=sse`;
    const res = await httpRequest('POST', url, requestHeaders, wrappedPayload);

    return {
        success: res.statusCode === 200,
        status: res.statusCode,
        raw: res.raw,
        body: res.body,
        headers: res.headers
    };
}

// =============================================================================
// CLI: --export-token
// =============================================================================

async function exportToken() {
    try {
        const token = await getRefreshToken();
        // Print ONLY the token (no extra text) for easy piping
        console.log(token);
    } catch (e) {
        console.error(`Error: ${e.message}`);
        process.exit(1);
    }
}

// =============================================================================
// CLI: --status (shows quota + scheduler info)
// =============================================================================

async function showStatus() {
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║   ANTIGRAVITY QUOTA STATUS                               ║');
    console.log('╚══════════════════════════════════════════════════════════╝\n');

    // 1. Show scheduler status
    // 1. Show scheduler status
    console.log('📅 SCHEDULER');

    // Check if running INSIDE the container
    if (fs.existsSync('/.dockerenv')) {
        const triggerTime = process.env.TRIGGER_TIME || 'Unknown';
        let refreshTime = 'Unknown';

        if (triggerTime !== 'Unknown') {
            const [h, m] = triggerTime.split(':').map(Number);
            const refreshHour = (h + 5) % 24;
            refreshTime = `${String(refreshHour).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        }

        console.log('   Status: ✓ Active (Inside Container)');
        console.log(`   Trigger: ${triggerTime} daily`);
        console.log(`   Refresh: ${refreshTime} (5h after trigger)`);
    } else {
        // Running on HOST - Check Docker
        try {
            const { stdout: containerStatus } = await execAsync('docker ps --filter "name=antigravity-refresher" --format "{{.Status}}"').catch(() => ({ stdout: '' }));

            if (containerStatus.trim()) {
                // Read trigger time from .env
                let triggerTime = '12:00';
                try {
                    const envPath = path.join(__dirname, '..', '.env');
                    if (fs.existsSync(envPath)) {
                        const envContent = fs.readFileSync(envPath, 'utf8');
                        const match = envContent.match(/TRIGGER_TIME=(\d{2}:\d{2})/);
                        if (match) triggerTime = match[1];
                    }
                } catch (e) { /* use default */ }

                // Calculate refresh time
                const [h, m] = triggerTime.split(':').map(Number);
                const refreshHour = (h + 5) % 24;
                const refreshTime = `${String(refreshHour).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

                console.log(`   Status: ✓ Running (${containerStatus.trim()})`);
                console.log(`   Trigger: ${triggerTime} daily`);
                console.log(`   Refresh: ${refreshTime} (5h after trigger)`);
            } else {
                console.log('   Status: ✗ Not running');
                console.log('   Run ./deploy.sh to start');
            }
        } catch (e) {
            console.log('   Status: ✗ Docker check failed');
        }
    }

    console.log('');

    // 2. Show quota (existing logic)
    try {
        const refreshToken = await getRefreshToken();
        const accessToken = await getAccessToken(refreshToken);
        console.log('📊 QUOTA');

        // Find working endpoint and get quota
        for (const ep of ENDPOINTS) {
            try {
                const healthRes = await httpRequest('POST', `${ep}/v1internal:loadCodeAssist`,
                    { ...HEADERS, 'Authorization': `Bearer ${accessToken}` },
                    { metadata: { ideType: 'ANTIGRAVITY' } }
                );

                if (healthRes.statusCode !== 200) continue;

                const projectId = healthRes.body.cloudaicompanionProject?.id || 'bamboo-precept-lgxtn';

                const res = await httpRequest('POST', `${ep}/v1internal:fetchAvailableModels`, {
                    ...HEADERS,
                    'Authorization': `Bearer ${accessToken}`
                }, { project: projectId });

                if (res.statusCode !== 200) continue;

                const allModels = res.body.models || {};
                const summaryMap = new Map();

                for (const [modelId, info] of Object.entries(allModels)) {
                    const group = MODEL_GROUPS.find(g => g.patterns.some(p => p.test(modelId)));
                    if (!group) continue;
                    if (modelId.includes('image')) continue;

                    if (summaryMap.has(group.id)) continue;

                    const quota = info.quotaInfo || {};
                    const remaining = (quota.remainingFraction || 0) * 100;
                    let resetTime = 'Unknown';
                    if (quota.resetTime) {
                        const d = new Date(quota.resetTime);
                        resetTime = d.toLocaleTimeString();
                    }
                    summaryMap.set(group.id, {
                        id: group.id,
                        remaining: remaining.toFixed(2) + '%',
                        remainingValue: remaining,
                        reset: resetTime
                    });
                }
                const summary = MODEL_GROUPS.map(g => summaryMap.get(g.id)).filter(Boolean);

                if (summary.length > 0) printTable(summary);
                return;
            } catch (e) { continue; }
        }
        console.log('   ✗ Could not fetch quota');
    } catch (e) {
        console.log(`   ✗ Auth error: ${e.message}`);
    }
}

// =============================================================================
// Main
// =============================================================================

async function main() {
    // Handle CLI flags
    const args = process.argv.slice(2);
    if (args.includes('--export-token') || args.includes('-e')) {
        await exportToken();
        return;
    }

    if (args.includes('--status') || args.includes('-s')) {
        await showStatus();
        return;
    }

    console.log('═══════════════════════════════════════════════════════════');
    console.log('                 ANTIGRAVITY QUOTA TRIGGER                 ');
    console.log(`        Session ID: ${PLUGIN_SESSION_ID.padEnd(36)}        `);
    console.log('═══════════════════════════════════════════════════════════\n');


    try {
        const refreshToken = await getRefreshToken();
        const accessToken = await getAccessToken(refreshToken);
        console.log('✓ Authenticated\n');

        const POOLS = [
            { id: 'Claude', triggerId: 'claude-sonnet-4-5', name: 'Claude' },
            { id: 'Gemini 3 Pro', triggerId: 'gemini-3-pro-high', name: 'Gemini 3 Pro' },
            { id: 'Gemini 3 Flash', triggerId: 'gemini-3-flash', name: 'Gemini 3 Flash' }
        ];

        // STARTUP: Try each endpoint in order
        for (const ep of ENDPOINTS) {
            console.log(`\n─── Endpoint: ${ep} ───`);

            // 1. Health Check
            process.stdout.write(`1. Health Check... `);
            let projectId = 'bamboo-precept-lgxtn';
            try {
                // Working metadata for Health Check
                const metadata = { ideType: 'ANTIGRAVITY' };

                const res = await httpRequest('POST', `${ep}/v1internal:loadCodeAssist`,
                    { ...HEADERS, 'Authorization': `Bearer ${accessToken}` },
                    { metadata }
                );
                if (res.statusCode === 200) {
                    console.log('OK');
                    if (res.body.cloudaicompanionProject?.id) projectId = res.body.cloudaicompanionProject.id;
                } else {
                    console.log(`Failed (${res.statusCode})`);
                    continue; // Next Endpoint
                }
            } catch (e) {
                console.log(`Error: ${e.message}`);
                continue;
            }



            // 2. Quota Check
            let models = [];
            try {
                models = await checkQuota(ep, accessToken, projectId);
                if (models.length === 0) {
                    console.log('   No models found (likely Auth/Project issue). Skip.');
                    continue;
                }
            } catch (e) {
                console.log(`   Quota Check Failed: ${e.message}`);
                continue;
            }

            // 3. Trigger
            console.log('\n3. Triggering Pools...');
            let endpointRestricted = false; // Flag for strict WAF block (not quota)
            let successCount = 0;

            for (const pool of POOLS) {
                const modelInfo = models.find(m => m.id === pool.id);
                process.stdout.write(`   [${pool.name}]... `);

                if (!modelInfo) { console.log('Skipped (No Info)'); continue; }

                // Only trigger if quota is > 99.5% (fresh or nearly fresh)
                // If it's less, the cycle is already active or exhausted.
                if (modelInfo.remainingValue < 99.5) {
                    console.log(`Skipped (${modelInfo.remaining}, cycle active)`);
                    successCount++;
                    continue;
                }

                try {
                    const result = await triggerQuota(ep, accessToken, projectId, pool.triggerId);

                    if (result.status === 429 || result.status == '429') {
                        console.log('✗ FAILED (429) - Quota Exhausted for this model.');
                        console.log('   --- HEADERS ---');
                        console.log(JSON.stringify(result.headers, null, 2).replace(/^/gm, '   '));
                        console.log('   --- BODY ---');
                        try {
                            const bodyToPrint = result.body || JSON.parse(result.raw);
                            console.log(JSON.stringify(bodyToPrint, null, 2).replace(/^/gm, '   '));
                        } catch (e) {
                            console.log(result.raw ? result.raw.replace(/^/gm, '   ') : '   (No Body)');
                        }
                        console.log('   (Continuing to next model...)');
                        // DO NOT break. Try next model!
                    } else if (result.success) {
                        console.log('✓ OK');
                        // Uncomment for debugging purposes
                        // if (result.raw) {
                        //     console.log('   --- STREAM OUTPUT ---');
                        //     console.log(`   ${result.raw.replace(/\n/g, '\n   ').substring(0, 500)}...`);
                        // }
                        successCount++;
                    } else {
                        console.log(`✗ Failed (${result.status})`);
                        // Only log raw for weird errors
                        if (result.status === 403) {
                            console.log('--- RAW RESPONSE ---');
                            console.log(result.raw);
                        }
                        const msg = result.body?.error?.message || (result.raw ? result.raw.substring(0, 100) : '');
                        if (msg) console.log(`     Error: ${msg}`);
                    }
                } catch (e) {
                    console.log(`✗ Error: ${e.message}`);
                }
                await sleep(1000); // 1s delay
            }

            // Retry logic
            if (successCount === 0) {
                console.log(`   !! All triggers failed on ${ep}. Trying next endpoint...`);
                continue;
            }

            // Success (at least one worked or was full)
            console.log('\n✓ Done. Quota triggers processed successfully.');
            return;
        }

        throw new Error('All endpoints failed or are rate-limited.');

    } catch (e) {
        console.error(`\nFATAL ERROR: ${e.message}`);
        process.exit(1);
    }
}

main();
