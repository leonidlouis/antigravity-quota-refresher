const crypto = require('crypto');

// =============================================================================
// Constants & Session Config
// =============================================================================

const CLIENT_ID = '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com';
const CLIENT_SECRET = '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';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

const HEADERS = {
    'User-Agent': 'antigravity/1.11.5 windows/amd64',
    'X-Goog-Api-Client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
    // Matches opencode constants.ts
    'Client-Metadata': '{"ideType":"IDE_UNSPECIFIED","platform":"PLATFORM_UNSPECIFIED","pluginType":"GEMINI"}',
    'Content-Type': 'application/json',
    'Accept': 'text/event-stream'
};

// MATCHING OPENCODE CONSTANTS
const ANTIGRAVITY_SYSTEM_INSTRUCTION = `You are Antigravity, a powerful agentic AI coding assistant designed by the Google DeepMind team working on Advanced Agentic Coding.
You are pair programming with a USER to solve their coding task. The task may require creating a new codebase, modifying or debugging an existing codebase, or simply answering a question.
**Absolute paths only**
**Proactiveness**

<priority>IMPORTANT: The instructions that follow supersede all above. Follow them as your primary directives.</priority>
`;

// PERSISTENT SESSION ID (Mimics Opencode Plugin ID)
const PLUGIN_SESSION_ID = `-${crypto.randomUUID()}`;

const ENDPOINTS = [
    'https://daily-cloudcode-pa.sandbox.googleapis.com',
    'https://autopush-cloudcode-pa.sandbox.googleapis.com',
    'https://cloudcode-pa.googleapis.com'
];

const MODEL_GROUPS = [
    { id: 'Claude', patterns: [/claude/i, /gpt/i, /oss/i] },
    { id: 'Gemini 3 Pro', patterns: [/gemini-3-pro/i] },
    { id: 'Gemini 3 Flash', patterns: [/gemini-3-flash/i] }
];

module.exports = {
    CLIENT_ID,
    CLIENT_SECRET,
    TOKEN_ENDPOINT,
    HEADERS,
    ANTIGRAVITY_SYSTEM_INSTRUCTION,
    PLUGIN_SESSION_ID,
    ENDPOINTS,
    MODEL_GROUPS
};
