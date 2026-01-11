/**
 * Telegram Notification Module
 * 
 * Sends notifications to Telegram when quota triggers fire.
 * Fails silently on error to never block the main trigger flow.
 * 
 * Environment Variables:
 *   TELEGRAM_BOT_TOKEN - Bot token from @BotFather
 *   TELEGRAM_CHAT_ID   - Your personal chat ID
 */

const { httpRequest } = require('./auth');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

/**
 * Check if Telegram notifications are configured
 * @returns {boolean}
 */
function isEnabled() {
    return Boolean(BOT_TOKEN && CHAT_ID);
}

/**
 * Send a Telegram message. Fails silently on error.
 * @param {string} message - Markdown-formatted message
 */
async function send(message) {
    if (!isEnabled()) return;

    try {
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        const res = await httpRequest('POST', url, {
            'Content-Type': 'application/json'
        }, {
            chat_id: CHAT_ID,
            text: message,
            parse_mode: 'Markdown'
        });

        if (res.statusCode !== 200 || !res.body?.ok) {
            console.warn(`  ⚠ Telegram: ${res.body?.description || res.statusCode}`);
        } else {
            console.log(`  📱 Telegram notification sent`);
        }
    } catch (err) {
        console.warn(`  ⚠ Telegram error: ${err.message}`);
    }
}

module.exports = { send, isEnabled };
