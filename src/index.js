// Load .env file if present (not in Docker where env comes from compose)
const fs = require('fs');
const path = require('path');
if (fs.existsSync(path.join(__dirname, '..', '.env'))) {
    require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
}

const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const { exec } = require('child_process');

dayjs.extend(utc);
dayjs.extend(timezone);

// =============================================================================
// Configuration & Constants
// =============================================================================

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000; // 5 seconds, doubles each retry

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Validates time format HH:mm
 * @param {string} time - Time string to validate
 * @returns {boolean} - True if valid
 */
function isValidTimeFormat(time) {
    return /^([01]\d|2[0-3]):([0-5]\d)$/.test(time);
}

/**
 * Sleep for a given number of milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Format duration in human-readable format
 * @param {number} ms - Duration in milliseconds
 * @returns {string}
 */
function formatDuration(ms) {
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
}

// =============================================================================
// QuotaOptimizer Class
// =============================================================================

class QuotaOptimizer {
    constructor(config) {
        this.workStartTime = config.workStartTime; // "17:00"
        this.refreshOffset = config.refreshOffset; // 2 (hours into work session to refresh)
        this.quotaCycle = config.quotaCycle;       // 5 (hours, the platform's cycle)
        this.timezone = config.timezone || dayjs.tz.guess(); // Auto-detect or use provided
        this.dryRun = config.dryRun || false;
        this.triggerScript = path.join(__dirname, 'trigger.js');
    }

    /**
     * Calculate the next trigger time based on configuration
     * 
     * Logic:
     * - targetRefreshTime = workStart + refreshOffset
     * - triggerTime = targetRefreshTime - quotaCycle
     * 
     * Edge cases handled:
     * 1. If triggerTime is in the past but workStart is in the future -> trigger immediately
     * 2. If both are in the past -> schedule for tomorrow
     */
    /**
     * Calculate the next trigger time
     * User input (workStartTime) is treated as the designated TRIGGER time.
     */
    calculateTriggerTime() {
        const now = dayjs().tz(this.timezone);
        const [hour, minute] = this.workStartTime.split(':').map(Number);

        // Today's trigger time in the configured timezone
        let triggerTime = dayjs().tz(this.timezone).hour(hour).minute(minute).second(0).millisecond(0);

        // If time has passed today, schedule for tomorrow
        if (triggerTime.isBefore(now)) {
            triggerTime = triggerTime.add(1, 'day');
        }

        // Quota refreshes 5 hours after trigger
        const refreshTime = triggerTime.add(this.quotaCycle, 'hour');

        return {
            triggerTime,
            refreshTime
        };
    }

    /**
     * Start the optimizer scheduler
     */
    async start() {
        console.log("\n╔═══════════════════════════════════════════════════════════╗");
        console.log("║                ANTIGRAVITY QUOTA OPTIMIZER                ║");
        console.log("╚═══════════════════════════════════════════════════════════╝\n");

        const now = dayjs();
        const offsetMin = now.tz(this.timezone).utcOffset();
        const offsetHrs = offsetMin / 60;
        const sign = offsetHrs >= 0 ? '+' : '';
        const tzDisplay = `UTC ${sign}${offsetHrs}`;

        const [startH, startM] = this.workStartTime.split(':').map(Number);
        const refreshDate = dayjs().hour(startH).minute(startM).add(this.quotaCycle, 'hour');
        const refreshTimeStr = refreshDate.format('HH:mm');

        console.log("Configuration:");
        console.log(`  Trigger Time:    ${this.workStartTime} (Daily)`);
        console.log(`  Quota Refresh:   est. ${refreshTimeStr}`);
        console.log(`  Timezone:        ${tzDisplay}`);
        console.log("");

        // Run Health Check on Startup
        await this.runHealthCheck();

        this.scheduleNext();
    }

    /**
     * Run the health check in quiet mode
     */
    runHealthCheck() {
        return new Promise(resolve => {
            const debugScript = path.join(__dirname, 'tools', 'debug.js');
            exec(`node "${debugScript}" health --quiet`, (error, stdout, stderr) => {
                if (stdout && stdout.trim()) {
                    console.log(stdout.trim());
                    console.log(""); // Add spacing
                }
                resolve();
            });
        });
    }

    /**
     * Schedule the next trigger
     */
    scheduleNext() {
        const times = this.calculateTriggerTime();
        const now = dayjs().tz(this.timezone);

        console.log("─────────────────────────────────────────────────────────────");
        console.log(`SCHEDULER LOG`);
        console.log("─────────────────────────────────────────────────────────────");
        console.log(`  Next Trigger:    ${times.triggerTime.format('YYYY-MM-DD HH:mm')}`);
        console.log(`  Quota Refresh:   ${times.refreshTime.format('YYYY-MM-DD HH:mm')} (approx)`);

        const delay = Math.max(0, times.triggerTime.diff(now));

        if (delay > 0) {
            console.log(`  Waiting:         ${formatDuration(delay)}`);
        }
        console.log("");

        if (this.dryRun) {
            console.log("  [DRY RUN] Would trigger at the scheduled time. Exiting.\n");
            return;
        }

        if (this.dryRun) {
            console.log("  [DRY RUN] Would trigger at the scheduled time. Exiting.\n");
            return;
        }

        setTimeout(async () => {
            await this.executeTrigger();

            // Wait 1 hour then schedule the next day's trigger
            console.log(`\n[${dayjs().tz(this.timezone).format('HH:mm:ss')}] Cycle complete. Waiting 1h before rescheduling...\n`);
            setTimeout(() => this.scheduleNext(), 60 * 60 * 1000);
        }, delay);
    }

    /**
     * Execute the trigger script with retry logic
     */
    async executeTrigger() {
        console.log(`[${dayjs().tz(this.timezone).format('HH:mm:ss')}] EXECUTING TRIGGER...`);

        // Check if trigger script exists
        if (!fs.existsSync(this.triggerScript)) {
            console.error(`  ✗  Trigger script not found: ${this.triggerScript}`);
            return;
        }

        // Execute with retry logic
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                const output = await this.runScript();
                // Print the output from the script (indented for clarity)
                if (output && output.trim()) {
                    console.log(output.trim().split('\n').map(line => `  > ${line}`).join('\n'));
                }
                console.log(`  ✓  Trigger successful!`);
                console.log(`\n  ⏰ Quota will refresh in ${this.quotaCycle} hours at ${dayjs().tz(this.timezone).add(this.quotaCycle, 'hour').format('HH:mm')}`);
                return;
            } catch (error) {
                console.error(`  ✗  Attempt ${attempt}/${MAX_RETRIES} failed: ${error.message}`);
                if (attempt < MAX_RETRIES) {
                    const waitTime = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
                    console.log(`  Retrying in ${waitTime / 1000}s...`);
                    await sleep(waitTime);
                }
            }
        }

        console.error(`  ✗  All ${MAX_RETRIES} attempts failed. Manual intervention required.`);
    }

    /**
     * Run the trigger script and return a promise
     * @returns {Promise<string>} - Script output
     */
    runScript() {
        return new Promise((resolve, reject) => {
            exec(`node "${this.triggerScript}"`, { timeout: 60000 }, (error, stdout, stderr) => {
                if (error) {
                    reject(new Error(error.message));
                    return;
                }
                if (stderr) {
                    console.warn(`  stderr: ${stderr.trim()}`);
                }
                resolve(stdout);
            });
        });
    }
}

// =============================================================================
// CLI Argument Parsing
// =============================================================================

const QUOTA_CYCLE_HOURS = 5; // Hardcoded: Antigravity uses 5-hour rolling window

const config = {
    triggerTime: process.env.TRIGGER_TIME || "12:00",  // Default: trigger at noon
    quotaCycle: QUOTA_CYCLE_HOURS,
    timezone: process.env.TZ || null,
    dryRun: false
};

const args = process.argv.slice(2);

// Parse arguments
for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--dry-run' || arg === '-d') {
        config.dryRun = true;
    } else if (arg === '--timezone' || arg === '-tz') {
        config.timezone = args[++i];
    } else if (arg === '--help' || arg === '-h') {
        console.log(`
Antigravity Quota Refresher

Usage:
  node src/index.js [TRIGGER_TIME] [OPTIONS]

Arguments:
  TRIGGER_TIME     When to trigger quota daily (HH:MM format, e.g., 12:00)
                   Quota refreshes 5 hours after trigger.
                   Default: 12:00 (quota refreshes at 17:00)

Options:
  --dry-run, -d    Show schedule without executing triggers
  --timezone, -tz  Set timezone (e.g., Asia/Bangkok). Default: auto-detect
  --help, -h       Show this help message

Examples:
  node src/index.js              # Trigger at 12:00, refresh at 17:00
  node src/index.js 14:00        # Trigger at 14:00, refresh at 19:00
  node src/index.js 09:00 -d     # Preview schedule only
`);
        process.exit(0);
    } else if (!arg.startsWith('-') && isValidTimeFormat(arg)) {
        config.triggerTime = arg;
    }
}

// Validate time format
if (!isValidTimeFormat(config.triggerTime)) {
    console.error(`\n✗ ERROR: Invalid time format "${config.triggerTime}"`);
    console.error(`  Use HH:MM format (e.g., 12:00, 09:30)\n`);
    process.exit(1);
}

// Adapt config for QuotaOptimizer (it expects workStartTime)
// triggerTime = workStartTime - 0 offset (we trigger at the exact time, refresh 5h later)
config.workStartTime = config.triggerTime;
config.refreshOffset = 0; // Trigger immediately at triggerTime

// Start the optimizer
const optimizer = new QuotaOptimizer(config);
optimizer.start();