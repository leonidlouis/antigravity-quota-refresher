#!/usr/bin/env node
/**
 * Antigravity Debug Tools
 * 
 * Consolidated debugging and testing utilities for development and troubleshooting.
 * 
 * Usage:
 *   node src/tools/debug.js <command>
 * 
 * Commands:
 *   quota      - Display current quota status for all models
 *   models     - List all available models with metadata
 *   endpoints  - Test connectivity to all API endpoints
 *   health     - Run a full health check
 *   --help     - Show this help message
 */

const {
    HEADERS,
    ENDPOINTS
} = require('../lib/constants');
const {
    httpRequest,
    getRefreshToken,
    getAccessToken,
    execAsync
} = require('../lib/auth');

// =============================================================================
// Constants (Shared via lib/constants)
// =============================================================================

// =============================================================================
// Debug Commands
// =============================================================================

/**
 * Check quota status for all models
 */
async function cmdQuota() {
    console.log('📊 Fetching Quota Status...\n');

    const refreshToken = await getRefreshToken();
    const accessToken = await getAccessToken(refreshToken);
    console.log('✓ Authenticated\n');

    // Find working endpoint
    let workingEndpoint = null;
    let projectId = 'bamboo-precept-lgxtn';

    for (const ep of ENDPOINTS) {
        try {
            const res = await httpRequest('POST', `${ep}/v1internal:loadCodeAssist`,
                { ...HEADERS, 'Authorization': `Bearer ${accessToken}` },
                { metadata: { ideType: 'ANTIGRAVITY' } }
            );
            if (res.statusCode === 200) {
                workingEndpoint = ep;
                if (res.body.cloudaicompanionProject?.id) projectId = res.body.cloudaicompanionProject.id;
                break;
            }
        } catch (e) { /* try next */ }
    }

    if (!workingEndpoint) {
        console.error('✗ No working endpoints found');
        process.exit(1);
    }

    console.log(`Endpoint: ${workingEndpoint}`);
    console.log(`Project:  ${projectId}\n`);

    // Fetch models
    const res = await httpRequest('POST', `${workingEndpoint}/v1internal:fetchAvailableModels`, {
        ...HEADERS,
        'Authorization': `Bearer ${accessToken}`
    }, { project: projectId });

    if (res.statusCode !== 200) {
        console.error(`✗ Failed to fetch models: ${res.statusCode}`);
        process.exit(1);
    }

    const allModels = res.body.models || {};
    const summary = [];

    for (const [modelId, info] of Object.entries(allModels)) {
        const quota = info.quotaInfo || {};
        const remaining = (quota.remainingFraction || 0) * 100;
        let resetTime = 'Unknown';
        if (quota.resetTime) {
            const d = new Date(quota.resetTime);
            resetTime = d.toLocaleTimeString() + ` (UTC${-d.getTimezoneOffset() / 60 >= 0 ? '+' : ''}${-d.getTimezoneOffset() / 60})`;
        }
        summary.push({
            model: modelId,
            remaining: remaining.toFixed(1) + '%',
            reset: resetTime,
            status: remaining > 0 ? '✓' : '⚠️ FULL'
        });
    }

    // Sort: non-full first, then by name
    summary.sort((a, b) => {
        if (a.status !== b.status) return a.status === '✓' ? -1 : 1;
        return a.model.localeCompare(b.model);
    });

    console.table(summary);
}

/**
 * List all available models with metadata
 */
async function cmdModels() {
    console.log('📋 Fetching Available Models...\n');

    const refreshToken = await getRefreshToken();
    const accessToken = await getAccessToken(refreshToken);

    for (const ep of ENDPOINTS) {
        try {
            const res = await httpRequest('POST', `${ep}/v1internal:loadCodeAssist`,
                { ...HEADERS, 'Authorization': `Bearer ${accessToken}` },
                { metadata: { ideType: 'ANTIGRAVITY' } }
            );

            if (res.statusCode === 200) {
                console.log(`Endpoint: ${ep}\n`);
                console.log('--- Full Response ---');
                console.log(JSON.stringify(res.body, null, 2));
                return;
            }
        } catch (e) { /* try next */ }
    }

    console.error('✗ No working endpoints');
}

/**
 * Test connectivity to all endpoints
 */
async function cmdEndpoints() {
    console.log('🔌 Testing Endpoints...\n');

    const refreshToken = await getRefreshToken();
    const accessToken = await getAccessToken(refreshToken);

    for (const ep of ENDPOINTS) {
        process.stdout.write(`  ${ep}... `);
        try {
            const start = Date.now();
            const res = await httpRequest('POST', `${ep}/v1internal:loadCodeAssist`,
                { ...HEADERS, 'Authorization': `Bearer ${accessToken}` },
                { metadata: { ideType: 'ANTIGRAVITY' } }
            );
            const latency = Date.now() - start;

            if (res.statusCode === 200) {
                console.log(`✓ OK (${latency}ms)`);
            } else {
                console.log(`✗ ${res.statusCode} (${latency}ms)`);
            }
        } catch (e) {
            console.log(`✗ Error: ${e.message}`);
        }
    }
}

/**
 * Run a full health check
 */
async function cmdHealth() {
    console.log('🏥 Running Health Check...\n');

    // 1. Token
    console.log('1. Token Retrieval:');
    try {
        const refreshToken = await getRefreshToken();
        console.log('   ✓ Refresh token obtained');

        const accessToken = await getAccessToken(refreshToken);
        console.log('   ✓ Access token generated\n');

        // 2. Endpoints
        console.log('2. Endpoint Connectivity:');
        let workingCount = 0;
        for (const ep of ENDPOINTS) {
            process.stdout.write(`   ${ep.split('//')[1].split('.')[0]}... `);
            try {
                const res = await httpRequest('POST', `${ep}/v1internal:loadCodeAssist`,
                    { ...HEADERS, 'Authorization': `Bearer ${accessToken}` },
                    { metadata: { ideType: 'ANTIGRAVITY' } }
                );
                if (res.statusCode === 200) {
                    console.log('✓');
                    workingCount++;
                } else {
                    console.log(`✗ (${res.statusCode})`);
                }
            } catch (e) {
                console.log(`✗ (${e.message})`);
            }
        }
        console.log(`   ${workingCount}/${ENDPOINTS.length} endpoints working\n`);

        // 3. Summary
        console.log('3. Summary:');
        console.log(`   Status: ${workingCount > 0 ? '✓ HEALTHY' : '✗ UNHEALTHY'}`);

    } catch (e) {
        console.log(`   ✗ ${e.message}\n`);
        console.log('3. Summary:');
        console.log('   Status: ✗ UNHEALTHY (Token Error)');
    }
}

// =============================================================================
// CLI
// =============================================================================

function showHelp() {
    console.log(`
Antigravity Debug Tools

Usage:
  node src/tools/debug.js <command>

Commands:
  quota      Display current quota status for all models
  models     List all available models with full metadata
  endpoints  Test connectivity to all API endpoints
  health     Run a full health check

Options:
  --help, -h   Show this help message

Examples:
  node src/tools/debug.js quota
  node src/tools/debug.js health
`);
}

async function main() {
    const args = process.argv.slice(2);
    const command = args[0]?.toLowerCase();

    if (!command || command === '--help' || command === '-h') {
        showHelp();
        return;
    }

    try {
        switch (command) {
            case 'quota':
                await cmdQuota();
                break;
            case 'models':
                await cmdModels();
                break;
            case 'endpoints':
                await cmdEndpoints();
                break;
            case 'health':
                await cmdHealth();
                break;
            default:
                console.error(`Unknown command: ${command}`);
                showHelp();
                process.exit(1);
        }
    } catch (e) {
        console.error(`\nError: ${e.message}`);
        process.exit(1);
    }
}

main();
