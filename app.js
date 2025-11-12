// ===================================
// SECURE GITHUB AUTO COMMIT BOT
// Version 3.1 - D3 Heatmap Integration
// ===================================

// ============= ENHANCED SECURITY CLASSES =============

class TokenManager {
    static getKey() {
        return 'ghbot-secure-' + navigator.userAgent.slice(0, 20);
    }

    static encrypt(token) {
        if (!token) return '';
        const key = this.getKey();
        return btoa(token.split('').map((char, i) => 
            String.fromCharCode(char.charCodeAt(0) ^ key.charCodeAt(i % key.length))
        ).join(''));
    }

    static decrypt(encrypted) {
        if (!encrypted) return '';
        try {
            const decoded = atob(encrypted);
            const key = this.getKey();
            return decoded.split('').map((char, i) => 
                String.fromCharCode(char.charCodeAt(0) ^ key.charCodeAt(i % key.length))
            ).join('');
        } catch (e) {
            console.error('Token decryption failed:', e);
            return '';
        }
    }

    static saveToken(token, key = 'gh_token_enc') {
        if (!token) return;
        const encrypted = this.encrypt(token);
        localStorage.setItem(key, encrypted);
    }

    static getToken(key = 'gh_token_enc') {
        const encrypted = localStorage.getItem(key);
        return encrypted ? this.decrypt(encrypted) : '';
    }

    static removeToken(key = 'gh_token_enc') {
        localStorage.removeItem(key);
    }
}

// Enhanced Rate Limiter with Exponential Backoff
class RateLimiter {
    constructor(maxRequests = 60, windowMs = 3600000, name = 'default') {
        this.maxRequests = maxRequests;
        this.windowMs = windowMs;
        this.name = name;
        this.requests = this.loadFromStorage();
        this.backoffMultiplier = 1;
    }

    loadFromStorage() {
        const stored = localStorage.getItem(`ratelimit_${this.name}`);
        return stored ? JSON.parse(stored) : [];
    }

    saveToStorage() {
        localStorage.setItem(`ratelimit_${this.name}`, JSON.stringify(this.requests));
    }

    canMakeRequest() {
        const now = Date.now();
        this.requests = this.requests.filter(time => now - time < this.windowMs);
        
        if (this.requests.length >= this.maxRequests) {
            const oldestRequest = this.requests[0];
            const waitTime = (this.windowMs - (now - oldestRequest)) * this.backoffMultiplier;
            this.backoffMultiplier = Math.min(this.backoffMultiplier * 1.5, 5);
            return { allowed: false, waitMs: waitTime };
        }
        
        this.backoffMultiplier = Math.max(this.backoffMultiplier * 0.9, 1);
        this.requests.push(now);
        this.saveToStorage();
        return { allowed: true };
    }

    getRemainingRequests() {
        const now = Date.now();
        this.requests = this.requests.filter(time => now - time < this.windowMs);
        return this.maxRequests - this.requests.length;
    }

    reset() {
        this.requests = [];
        this.backoffMultiplier = 1;
        this.saveToStorage();
    }
}

// Enhanced Activity Monitor with Pattern Analysis
class ActivityMonitor {
    constructor() {
        this.commitTimes = [];
        this.maxHistorySize = 200;
        this.loadFromStorage();
    }

    recordCommit(timestamp = Date.now()) {
        this.commitTimes.push(timestamp);
        if (this.commitTimes.length > this.maxHistorySize) {
            this.commitTimes.shift();
        }
        this.saveToStorage();
    }

    detectSuspiciousPattern() {
        if (this.commitTimes.length < 10) return { suspicious: false };

        const intervals = [];
        for (let i = 1; i < this.commitTimes.length; i++) {
            intervals.push(this.commitTimes[i] - this.commitTimes[i - 1]);
        }

        const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        const variance = intervals.reduce((sum, interval) => 
            sum + Math.pow(interval - avgInterval, 2), 0
        ) / intervals.length;
        const stdDev = Math.sqrt(variance);

        if (stdDev < avgInterval * 0.1 && this.commitTimes.length > 20) {
            return {
                suspicious: true,
                reason: 'Too regular intervals detected (robot-like)',
                recommendation: 'Enable Safe Mode for natural timing'
            };
        }

        const recentCommits = this.commitTimes.filter(t => 
            Date.now() - t < 3600000
        ).length;

        if (recentCommits > 15) {
            return {
                suspicious: true,
                reason: `Burst detected: ${recentCommits} commits in 1 hour`,
                recommendation: 'Reduce commit frequency immediately'
            };
        }

        const hours = this.commitTimes.map(t => new Date(t).getHours());
        const nightCommits = hours.filter(h => h >= 23 || h < 6).length;
        if (nightCommits / hours.length > 0.7 && hours.length > 30) {
            return {
                suspicious: true,
                reason: 'Unusual activity hours (70%+ at night)',
                recommendation: 'Vary commit times throughout the day'
            };
        }

        return { suspicious: false };
    }

    saveToStorage() {
        localStorage.setItem('activity_monitor', JSON.stringify(this.commitTimes));
    }

    loadFromStorage() {
        const data = localStorage.getItem('activity_monitor');
        if (data) this.commitTimes = JSON.parse(data);
    }

    reset() {
        this.commitTimes = [];
        this.saveToStorage();
    }
}

// ============= GLOBAL VARIABLES =============

const GITHUB_CLIENT_ID = window.GITHUB_CLIENT_ID || 'Ov23lidwfr2w8brs3SjU';
const GITHUB_REDIRECT_URI = window.location.origin + '/api/github-auth';

const commitRateLimiter = new RateLimiter(50, 3600000, 'commits');
const apiRateLimiter = new RateLimiter(80, 3600000, 'api');
const dailyCommitLimiter = new RateLimiter(15, 86400000, 'daily');
const activityMonitor = new ActivityMonitor();

let autoCommitInterval = null;
let autoCommitTimeout = null;
let safeModeLoopActive = false;
let safeModeLoopRunning = false; // Prevent race condition
let safeModeEnabled = false;
let smartRotationEnabled = false;
let commitPreviewEnabled = false;
let currentRepoIndex = 0;
let previewCommitDetails = {};
let countdownInterval = null;
let simulatedCommitDates = [];
let saveTimeout = null; // For debounced saves

let totalCommits = 0;
let safeModeCommitCount = 0;
let firstCommitDate = null;
let commitTimestamps = [];
let repoCommitCounts = {};

window.debugMode = false;

// ============= ENHANCED SAFE MODE CONFIG =============

const safeModeConfig = {
    minDelay: 45 * 60 * 1000,
    maxDelay: 240 * 60 * 1000,
    skipProbability: 0.2,
    maxCommitsPerDay: 15,
    quietHours: { start: 23, end: 7 },
    workdayBias: 0.75,
    burstPrevention: true,
    naturalVariation: 0.3
};

// ============= IMPROVED TOKEN VALIDATION =============

function validateGitHubToken(token) {
    if (!token || typeof token !== 'string') return false;
    
    // More lenient validation for different GitHub token types
    // Classic PAT: ghp_[alphanumeric, 36+ chars]
    const classicPattern = /^ghp_[a-zA-Z0-9_]{36,}$/;
    // Fine-grained PAT: github_pat_[22 chars]_[59+ chars]
    const fineGrainedPattern = /^github_pat_[a-zA-Z0-9]{22}_[a-zA-Z0-9]{59,}$/;
    // OAuth tokens: gho_[alphanumeric, 36+ chars]
    const oauthPattern = /^gho_[a-zA-Z0-9_]{36,}$/;
    // Old format: just alphanumeric (40 chars)
    const legacyPattern = /^[a-fA-F0-9]{40}$/;
    
    return classicPattern.test(token) || 
           fineGrainedPattern.test(token) || 
           oauthPattern.test(token) ||
           legacyPattern.test(token);
}

// ============= ENHANCED ERROR HANDLING =============

function getHumanReadableError(error, context = '') {
    const errorMap = {
        401: 'Invalid or expired token. Please regenerate your GitHub PAT.',
        403: 'Access denied. Ensure your token has "repo" and "read:user" scopes.',
        404: 'Resource not found. Check repository name and branch.',
        422: 'Invalid data. Verify file path and commit message format.',
        429: 'Rate limit exceeded. Please wait before trying again.',
        500: 'GitHub server error. Try again in a few minutes.',
        503: 'GitHub service unavailable. Try again later.'
    };
    
    const statusCode = error.response?.status || error.status;
    const baseMessage = errorMap[statusCode] || error.message || 'Unknown error occurred';
    
    return context ? `${context}: ${baseMessage}` : baseMessage;
}

// ============= UTILITY FUNCTIONS =============

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function jitter(base, maxJitter = 60000) {
    const variation = safeModeConfig.naturalVariation;
    const min = base * (1 - variation);
    const max = base * (1 + variation);
    return min + Math.random() * (max - min);
}

function toBase64(str) {
    return btoa(unescape(encodeURIComponent(str)));
}

function fromBase64(base64) {
    return decodeURIComponent(escape(atob(base64)));
}

function getRandomFallbackMessage() {
    const messages = [
        "feat: add new feature",
        "fix: resolve bug",
        "docs: update documentation",
        "chore: routine maintenance",
        "style: code formatting",
        "refactor: improve structure",
        "test: add tests",
        "build: update deps",
        "perf: optimize",
        "ci: update config"
    ];
    return messages[Math.floor(Math.random() * messages.length)];
}

// ============= ENHANCED COMMIT MESSAGE GENERATION =============

function generateSafeCommitMessage() {
    const templates = [
        { type: "chore", actions: ["update", "refresh", "sync", "clean up"], subjects: ["dependencies", "config", "docs", "metadata"] },
        { type: "docs", actions: ["update", "improve", "revise", "clarify"], subjects: ["README", "comments", "documentation", "examples"] },
        { type: "style", actions: ["format", "lint", "organize", "refactor"], subjects: ["code", "files", "structure", "spacing"] },
        { type: "fix", actions: ["resolve", "correct", "patch", "address"], subjects: ["typo", "bug", "issue", "error"] },
        { type: "feat", actions: ["add", "implement", "introduce", "create"], subjects: ["feature", "utility", "helper", "function"] }
    ];

    const template = templates[Math.floor(Math.random() * templates.length)];
    const action = template.actions[Math.floor(Math.random() * template.actions.length)];
    const subject = template.subjects[Math.floor(Math.random() * template.subjects.length)];
    
    const emojis = ["✨", "🔧", "📝", "🐛", "🚀"];
    const emoji = Math.random() < 0.2 ? emojis[Math.floor(Math.random() * emojis.length)] + " " : "";
    
    const scopes = ["api", "core", "utils", "config", "tests", "build"];
    const scope = Math.random() < 0.3 ? `(${scopes[Math.floor(Math.random() * scopes.length)]})` : "";
    
    return `${emoji}${template.type}${scope}: ${action} ${subject}`;
}

// ============= UI FUNCTIONS =============

function showStatusMessage(message, type) {
    const statusDiv = document.getElementById("status");
    statusDiv.innerHTML = message;
    statusDiv.classList.remove('bg-green-100', 'text-green-800', 'bg-red-100', 'text-red-800', 'bg-blue-100', 'text-blue-800', 'bg-yellow-100', 'text-yellow-800', 'bg-gray-50', 'dark:bg-gray-700', 'dark:text-gray-300');

    const classes = {
        success: ['bg-green-100', 'text-green-800'],
        error: ['bg-red-100', 'text-red-800'],
        warning: ['bg-yellow-100', 'text-yellow-800'],
        info: ['bg-blue-100', 'text-blue-800']
    };

    statusDiv.classList.add(...(classes[type] || ['bg-gray-50', 'text-gray-700', 'dark:bg-gray-700', 'dark:text-gray-300']));
}

function toggleLoading(show) {
    document.getElementById('loadingIndicator').classList.toggle('hidden', !show);
    const controls = [
        'makeCommitButton', 'toggleAutoCommitButton', 'generateSimulatedCommitsButton',
        'previewHeatmapButton', 'loadRealHeatmapButton', 'geminiApiKey', 'username',
        'repo', 'branch', 'filepath', 'content', 'intervalValue', 'intervalType',
        'numSimulatedCommits', 'simulatedStartDate', 'simulatedEndDate', 
        'streakPatternSelect', 'commitContext', 'generateMessageButton', 'safeMode',
        'darkModeToggle', 'smartRotation', 'resetStatsButton', 'commitPreviewToggle',
        'githubLogin', 'githubLogout'
    ];

    controls.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = show;
    });

    const tokenInput = document.getElementById('token');
    if (TokenManager.getToken('gh_token_oauth')) {
        tokenInput.disabled = true;
    } else {
        tokenInput.disabled = show;
    }
}

function updateRateLimitDisplay() {
    document.getElementById('rateLimitCommits').textContent = commitRateLimiter.getRemainingRequests();
    document.getElementById('rateLimitAPI').textContent = apiRateLimiter.getRemainingRequests();
}

function addActivityLog(message, isError = false) {
    const log = document.getElementById('safeModeLog');
    if (log.children.length === 1 && log.children[0].textContent === 'No activity yet.') {
        log.innerHTML = '';
    }
    
    const listItem = document.createElement('li');
    const timeSpan = document.createElement('span');
    timeSpan.textContent = new Date().toLocaleTimeString() + ': ';
    
    const messageSpan = document.createElement('span');
    // Safe HTML parsing - only allow basic formatting tags
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = message;
    messageSpan.innerHTML = tempDiv.innerHTML;
    
    listItem.appendChild(timeSpan);
    listItem.appendChild(messageSpan);
    if (isError) listItem.classList.add('text-red-500');
    log.prepend(listItem);
    
    while (log.children.length > 10) {
        log.removeChild(log.lastChild);
    }
}

// ============= STORAGE & STATS FUNCTIONS =============

function debouncedSaveSettings() {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(saveSettingsToStorage, 500);
}

function saveSettingsToStorage() {
    try {
        const manualToken = document.getElementById("token").value.trim();
        if (manualToken && !TokenManager.getToken('gh_token_oauth')) {
            TokenManager.saveToken(manualToken, 'gh_token_enc');
        }

        const geminiKey = document.getElementById("geminiApiKey")?.value.trim();
        if (geminiKey) {
            TokenManager.saveToken(geminiKey, 'gemini_api_key_enc');
        }

        localStorage.setItem("gh_username", document.getElementById("username").value.trim());
        
        const selectedRepos = Array.from(document.getElementById("repo").selectedOptions).map(option => option.value);
        localStorage.setItem("gh_repos", JSON.stringify(selectedRepos));

        localStorage.setItem("gh_branch", document.getElementById("branch").value.trim());
        localStorage.setItem("gh_filepath", document.getElementById("filepath").value.trim());
        localStorage.setItem("gh_intervalValue", document.getElementById("intervalValue").value.trim());
        localStorage.setItem("gh_intervalType", document.getElementById("intervalType").value.trim());
        localStorage.setItem("gh_numSimulatedCommits", document.getElementById("numSimulatedCommits").value.trim());
        localStorage.setItem("gh_simulatedStartDate", document.getElementById("simulatedStartDate").value.trim());
        localStorage.setItem("gh_simulatedEndDate", document.getElementById("simulatedEndDate").value.trim());
        localStorage.setItem("gh_streakPatternSelect", document.getElementById("streakPatternSelect").value.trim());
        localStorage.setItem("gh_commitContext", document.getElementById("commitContext").value.trim());
        localStorage.setItem("darkMode", document.documentElement.classList.contains("dark"));
        localStorage.setItem("smartRotation", document.getElementById("smartRotation").checked);
        localStorage.setItem("commitPreview", document.getElementById("commitPreviewToggle").checked);

        localStorage.setItem("stats_totalCommits", totalCommits);
        localStorage.setItem("stats_safeModeCommitCount", safeModeCommitCount);
        localStorage.setItem("stats_firstCommitDate", firstCommitDate);
        localStorage.setItem("stats_commitTimestamps", JSON.stringify(commitTimestamps));
        localStorage.setItem("stats_repoCommitCounts", JSON.stringify(repoCommitCounts));
    } catch (e) {
        console.error("Failed to save settings:", e);
    }
}

function loadSettingsFromStorage() {
    try {
        const oauthToken = TokenManager.getToken('gh_token_oauth');
        const manualToken = TokenManager.getToken('gh_token_enc');

        if (oauthToken) {
            document.getElementById("token").value = oauthToken;
            document.getElementById("token").disabled = true;
            document.getElementById("githubLogin").classList.add('hidden');
            document.getElementById("loggedInUser").classList.remove('hidden');
            
            const userInfo = JSON.parse(localStorage.getItem("gh_user_oauth") || '{}');
            document.getElementById("userAvatar").src = userInfo.avatar_url || '';
            document.getElementById("userName").textContent = userInfo.login || '';
            document.getElementById("username").value = userInfo.login || '';
        } else if (manualToken) {
            document.getElementById("token").value = manualToken;
            document.getElementById("username").value = localStorage.getItem("gh_username") || '';
        }

        const geminiKey = TokenManager.getToken('gemini_api_key_enc');
        if (geminiKey && document.getElementById("geminiApiKey")) {
            document.getElementById("geminiApiKey").value = geminiKey;
        }

        document.getElementById("branch").value = localStorage.getItem("gh_branch") || '';
        document.getElementById("filepath").value = localStorage.getItem("gh_filepath") || 'README.md';
        document.getElementById("intervalValue").value = localStorage.getItem("gh_intervalValue") || '24';
        document.getElementById("intervalType").value = localStorage.getItem("gh_intervalType") || 'hours';
        document.getElementById("numSimulatedCommits").value = localStorage.getItem("gh_numSimulatedCommits") || '10';
        document.getElementById("simulatedStartDate").value = localStorage.getItem("gh_simulatedStartDate") || '';
        document.getElementById("simulatedEndDate").value = localStorage.getItem("gh_simulatedEndDate") || '';
        document.getElementById("streakPatternSelect").value = localStorage.getItem("gh_streakPatternSelect") || 'random';
        document.getElementById("commitContext").value = localStorage.getItem("gh_commitContext") || '';

        const isDarkMode = localStorage.getItem("darkMode") === "true";
        document.documentElement.classList.toggle("dark", isDarkMode);
        document.getElementById("darkModeToggle").checked = isDarkMode;

        smartRotationEnabled = localStorage.getItem("smartRotation") === "true";
        document.getElementById("smartRotation").checked = smartRotationEnabled;

        commitPreviewEnabled = localStorage.getItem("commitPreview") === "true";
        document.getElementById("commitPreviewToggle").checked = commitPreviewEnabled;

        totalCommits = parseInt(localStorage.getItem("stats_totalCommits") || '0');
        safeModeCommitCount = parseInt(localStorage.getItem("stats_safeModeCommitCount") || '0');
        firstCommitDate = parseInt(localStorage.getItem("stats_firstCommitDate") || '0') || null;
        commitTimestamps = JSON.parse(localStorage.getItem("stats_commitTimestamps") || '[]');
        repoCommitCounts = JSON.parse(localStorage.getItem("stats_repoCommitCounts") || '{}');

    } catch (e) {
        console.error("Failed to load settings:", e);
    }
}

function updateStatsDisplay() {
    document.getElementById("statsTotalCommits").textContent = totalCommits;

    const safeModePercentage = totalCommits > 0 ? ((safeModeCommitCount / totalCommits) * 100).toFixed(1) : 0;
    document.getElementById("statsSafeModeCommits").textContent = `${safeModeCommitCount} (${safeModePercentage}%)`;

    document.getElementById("statsFirstCommitDate").textContent = firstCommitDate ? new Date(firstCommitDate).toLocaleDateString() : "N/A";

    let averageInterval = "N/A";
    if (commitTimestamps.length > 1) {
        const sortedTimestamps = [...commitTimestamps].sort((a, b) => a - b);
        let totalDiff = 0;
        for (let i = 1; i < sortedTimestamps.length; i++) {
            totalDiff += (sortedTimestamps[i] - sortedTimestamps[i-1]);
        }
        const avgDiffMs = totalDiff / (sortedTimestamps.length - 1);
        
        if (avgDiffMs < 60 * 1000) {
            averageInterval = `${(avgDiffMs / 1000).toFixed(0)} seconds`;
        } else if (avgDiffMs < 60 * 60 * 1000) {
            averageInterval = `${(avgDiffMs / (60 * 1000)).toFixed(1)} minutes`;
        } else if (avgDiffMs < 24 * 60 * 60 * 1000) {
            averageInterval = `${(avgDiffMs / (60 * 60 * 1000)).toFixed(1)} hours`;
        } else {
            averageInterval = `${(avgDiffMs / (24 * 60 * 60 * 1000)).toFixed(1)} days`;
        }
    }
    document.getElementById("statsAverageInterval").textContent = averageInterval;

    let topUsedRepo = "N/A";
    let maxCommits = 0;
    for (const repo in repoCommitCounts) {
        if (repoCommitCounts[repo] > maxCommits) {
            maxCommits = repoCommitCounts[repo];
            topUsedRepo = repo;
        }
    }
    document.getElementById("statsTopUsedRepo").textContent = topUsedRepo;

    const analysis = activityMonitor.detectSuspiciousPattern();
    const warningDiv = document.getElementById('suspiciousActivityWarning');
    if (analysis.suspicious) {
        warningDiv.classList.remove('hidden');
        document.getElementById('suspiciousActivityReason').textContent = analysis.reason;
        document.getElementById('suspiciousActivityRecommendation').textContent = `💡 ${analysis.recommendation}`;
    } else {
        warningDiv.classList.add('hidden');
    }
}

function resetStats() {
    const confirmDiv = document.createElement('div');
    confirmDiv.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
    confirmDiv.innerHTML = `
        <div class="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm dark:bg-gray-800 dark:text-white">
            <h3 class="text-lg font-bold mb-4">Confirm Reset</h3>
            <p class="text-gray-700 dark:text-gray-300 mb-6">Reset all statistics? This cannot be undone.</p>
            <div class="flex justify-end space-x-2">
                <button id="cancelReset" class="bg-gray-200 text-gray-800 px-4 py-2 rounded-md font-semibold hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200">Cancel</button>
                <button id="confirmReset" class="bg-red-600 text-white px-4 py-2 rounded-md font-semibold hover:bg-red-700">Reset</button>
            </div>
        </div>
    `;
    document.body.appendChild(confirmDiv);

    document.getElementById('cancelReset').onclick = () => document.body.removeChild(confirmDiv);
    document.getElementById('confirmReset').onclick = () => {
        totalCommits = 0;
        safeModeCommitCount = 0;
        firstCommitDate = null;
        commitTimestamps = [];
        repoCommitCounts = {};
        activityMonitor.reset();
        commitRateLimiter.reset();
        dailyCommitLimiter.reset();
        saveSettingsToStorage();
        updateStatsDisplay();
        updateRateLimitDisplay();
        showStatusMessage("✅ Statistics reset successfully", "success");
        document.body.removeChild(confirmDiv);
    };
}

// ============= GITHUB API FUNCTIONS =============

async function loadUserRepos() {
    const token = TokenManager.getToken('gh_token_oauth') || TokenManager.getToken('gh_token_enc');
    const username = document.getElementById("username").value.trim();
    const repoSelect = document.getElementById("repo");
    const branchSelect = document.getElementById("branch");

    repoSelect.innerHTML = "<option value=''>Loading Repos...</option>";
    branchSelect.innerHTML = "<option value=''>Select Repo First</option>";

    // Basic validation first
    if (!token || !username) {
        repoSelect.innerHTML = "<option value=''>Enter Token and Username</option>";
        return;
    }
    
    // Lenient token format check - just verify it looks like a GitHub token
    if (token.length < 20 || !token.match(/^(ghp_|github_pat_|gho_|[a-fA-F0-9]{40})/)) {
        repoSelect.innerHTML = "<option value=''>Invalid Token Format</option>";
        showStatusMessage("⚠️ Token must be a valid GitHub PAT (starts with ghp_, github_pat_, or gho_)", "warning");
        return;
    }

    // Show loading state
    toggleLoading(true);

    const apiCheck = apiRateLimiter.canMakeRequest();
    if (!apiCheck.allowed) {
        throw new Error(`Rate limit exceeded. Wait ${Math.ceil(apiCheck.waitMs / 60000)} minutes`);
    }

    const headers = {
        "Authorization": `token ${token}`,
        "Accept": "application/vnd.github.v3+json"
    };

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000);

        const res = await fetch(`https://api.github.com/user/repos?type=owner&per_page=100`, { 
            headers,
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);

        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            
            // Provide helpful error messages
            if (res.status === 401) {
                throw new Error("Invalid or expired token. Please check your GitHub PAT.");
            } else if (res.status === 403) {
                throw new Error("Access forbidden. Check token scopes (need 'repo' and 'read:user').");
            } else {
                throw new Error(errorData.message || `API error: ${res.status}`);
            }
        }
        
        const repos = await res.json();
        
        if (!Array.isArray(repos)) {
            throw new Error("Invalid API response format");
        }

        repoSelect.innerHTML = "";

        if (repos.length === 0) {
            repoSelect.innerHTML = "<option value=''>No repositories found</option>";
            showStatusMessage("⚠️ No repositories found for this account", "warning");
            return;
        }

        const savedSelectedRepos = JSON.parse(localStorage.getItem("gh_repos") || '[]');

        repos.forEach(repo => {
            const option = document.createElement("option");
            option.value = repo.full_name;
            option.innerText = repo.full_name;
            if (savedSelectedRepos.includes(repo.full_name)) {
                option.selected = true;
            }
            repoSelect.appendChild(option);
        });

        // Update selected count
        const count = repoSelect.selectedOptions.length;
        const countDisplay = document.getElementById("selectedRepoCount");
        if (countDisplay) {
            countDisplay.textContent = count > 0 ? ` - ${count} selected` : '';
        }

        loadRepoBranches();
        showStatusMessage(`✅ ${repos.length} repositories loaded successfully`, "success");
    } catch (err) {
        console.error("Error loading repositories:", err);
        repoSelect.innerHTML = "<option value=''>Error loading repos</option>";
        
        // User-friendly error messages
        if (err.name === 'AbortError') {
            showStatusMessage("❌ Request timeout. Check your internet connection.", "error");
        } else {
            showStatusMessage(`❌ ${err.message}`, "error");
        }
    } finally {
        toggleLoading(false); // Always hide loading indicator
    }
}

async function loadRepoBranches() {
    const token = TokenManager.getToken('gh_token_oauth') || TokenManager.getToken('gh_token_enc');
    const repoSelect = document.getElementById("repo");
    const branchSelect = document.getElementById("branch");

    const selectedRepos = Array.from(repoSelect.selectedOptions).map(option => option.value);
    const repoFullName = selectedRepos[0];

    branchSelect.innerHTML = "<option value=''>Loading Branches...</option>";

    if (!token || !repoFullName) {
        branchSelect.innerHTML = "<option value=''>Select Repo First</option>";
        return;
    }

    const apiCheck = apiRateLimiter.canMakeRequest();
    if (!apiCheck.allowed) {
        showStatusMessage(`⏱️ API rate limit. Wait ${Math.ceil(apiCheck.waitMs / 60000)} min`, "error");
        return;
    }

    const headers = {
        "Authorization": `token ${token}`,
        "Accept": "application/vnd.github.v3+json"
    };

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000);

        const res = await fetch(`https://api.github.com/repos/${repoFullName}/branches`, {
            headers,
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);

        if (!res.ok) {
            const errorData = await res.json();
            throw new Error(errorData.message || "Failed to fetch branches");
        }
        
        const branches = await res.json();
        branchSelect.innerHTML = "<option value=''>Select Branch</option>";
        
        branches.forEach(branch => {
            const option = document.createElement("option");
            option.value = branch.name;
            option.innerText = branch.name;
            branchSelect.appendChild(option);
        });

        const savedBranch = localStorage.getItem("gh_branch");
        if (savedBranch && branches.some(b => b.name === savedBranch)) {
            branchSelect.value = savedBranch;
        } else if (branches.length > 0) {
            branchSelect.value = branches[0].name;
        }
    } catch (err) {
        console.error("Error loading branches:", err);
        branchSelect.innerHTML = "<option value=''>Error loading branches</option>";
    }
}

// ============= ENHANCED GEMINI API =============

async function generateSmartCommitMessage() {
    const commitContext = document.getElementById("commitContext").value.trim();
    const contentTextArea = document.getElementById("content");

    if (!commitContext) {
        showStatusMessage("Please provide context for the commit message", "error");
        return;
    }

    const apiCheck = apiRateLimiter.canMakeRequest();
    if (!apiCheck.allowed) {
        showStatusMessage(`⏱️ API rate limit. Wait ${Math.ceil(apiCheck.waitMs / 60000)} min`, "error");
        contentTextArea.value = getRandomFallbackMessage();
        return;
    }

    toggleLoading(true);
    showStatusMessage("✨ Generating smart commit message...", "info");

    try {
        const apiKey = TokenManager.getToken('gemini_api_key_enc');
        
        if (!apiKey) {
            throw new Error("Gemini API Key not found");
        }

        const sanitizedContext = commitContext.slice(0, 200).replace(/[<>]/g, '');

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000);

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        role: "user",
                        parts: [{
                            text: `Generate a GitHub commit message (max 72 chars, use conventional commits format like feat:, fix:, docs:, chore:, style:, refactor:, test:, build:, perf:, ci:) for: ${sanitizedContext}`
                        }]
                    }],
                    safetySettings: [
                        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" }
                    ]
                }),
                signal: controller.signal
            }
        );

        clearTimeout(timeoutId);

        if (!response.ok) throw new Error(`API error: ${response.status}`);

        const result = await response.json();
        const message = result.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

        if (!message) throw new Error('No message generated');

        const finalMessage = message.length > 72 ? message.slice(0, 72) + '...' : message;
        contentTextArea.value = finalMessage;
        showStatusMessage("✨ Smart commit message generated!", "success");

    } catch (error) {
        console.error("Gemini API error:", error);
        showStatusMessage(`❌ Error: ${error.message}. Using fallback.`, "error");
        contentTextArea.value = getRandomFallbackMessage();
    } finally {
        toggleLoading(false);
    }
}

// ============= ENHANCED COMMIT FUNCTIONS =============

async function makeSingleCommit() {
    const token = TokenManager.getToken('gh_token_oauth') || TokenManager.getToken('gh_token_enc');
    const selectedRepos = Array.from(document.getElementById("repo").selectedOptions).map(option => option.value);
    const branch = document.getElementById("branch").value.trim();
    const path = document.getElementById("filepath").value.trim();
    let contentInput = document.getElementById("content").value;

    // Input validation
    const errors = [];
    
    if (!token) {
        errors.push('GitHub token is required');
    } else if (!validateGitHubToken(token)) {
        errors.push('Invalid GitHub token format');
    }
    
    if (selectedRepos.length === 0) {
        errors.push('Please select at least one repository');
    }
    
    if (!branch) {
        errors.push('Branch selection is required');
    }
    
    if (!path) {
        errors.push('File path is required');
    } else if (path.includes('..') || path.startsWith('/')) {
        errors.push('Invalid file path (no relative paths or leading slashes)');
    }
    
    if (errors.length > 0) {
        showStatusMessage(`❌ Validation failed:\n• ${errors.join('\n• ')}`, "error");
        return;
    }

    // Check rate limits
    const commitCheck = commitRateLimiter.canMakeRequest();
    if (!commitCheck.allowed) {
        showStatusMessage(`⏱️ Commit rate limit: ${commitRateLimiter.getRemainingRequests()}/50 per hour. Wait ${Math.ceil(commitCheck.waitMs / 60000)} min`, "error");
        return;
    }

    const dailyCheck = dailyCommitLimiter.canMakeRequest();
    if (!dailyCheck.allowed) {
        showStatusMessage(`⏱️ Daily limit reached (15/day). Wait ${Math.ceil(dailyCheck.waitMs / 60000)} min`, "error");
        return;
    }

    let repo;
    if (smartRotationEnabled && selectedRepos.length > 0) {
        repo = selectedRepos[currentRepoIndex];
        currentRepoIndex = (currentRepoIndex + 1) % selectedRepos.length;
    } else {
        repo = selectedRepos[Math.floor(Math.random() * selectedRepos.length)];
    }

    let commitMessage;
    if (contentInput === '') {
        commitMessage = generateSafeCommitMessage();
        contentInput = `# ${commitMessage}\n\nUpdated on ${new Date().toLocaleString()}`;
    } else {
        commitMessage = generateSafeCommitMessage();
    }

    previewCommitDetails = {
        repo: repo,
        branch: branch,
        path: path,
        message: commitMessage,
        content: contentInput,
        isAutoCommit: false
    };

    if (commitPreviewEnabled) {
        showCommitPreviewModal();
    } else {
        await commitToGitHub(path, null, repo, commitMessage, false);
    }
}

async function commitToGitHub(targetFilePath = null, dateForMessage = null, repoOverride = null, commitMessageOverride = null, isAutoCommit = false) {
    const token = TokenManager.getToken('gh_token_oauth') || TokenManager.getToken('gh_token_enc');
    let selectedRepos = Array.from(document.getElementById("repo").selectedOptions).map(option => option.value);
    const branch = document.getElementById("branch").value.trim();
    const path = targetFilePath || document.getElementById("filepath").value.trim();
    let contentInput = document.getElementById("content").value;

    if (selectedRepos.length === 0 && !repoOverride) {
        showStatusMessage("Please select at least one repository", "error");
        return false;
    }
    if (!token || !branch || !path) {
        showStatusMessage("Please fill in all required fields", "error");
        return false;
    }

    let repo;
    if (repoOverride) {
        repo = repoOverride;
    } else if (smartRotationEnabled && selectedRepos.length > 0) {
        repo = selectedRepos[currentRepoIndex];
        currentRepoIndex = (currentRepoIndex + 1) % selectedRepos.length;
    } else {
        repo = selectedRepos[Math.floor(Math.random() * selectedRepos.length)];
    }

    saveSettingsToStorage();

    if (!dateForMessage && !isAutoCommit && !commitPreviewEnabled) {
        toggleLoading(true);
        showStatusMessage(`Committing to ${repo}...`, "info");
    }

    const apiUrl = `https://api.github.com/repos/${repo}/contents/${path}`;
    const headers = {
        "Authorization": `token ${token}`,
        "Accept": "application/vnd.github.v3+json"
    };

    let sha = null;
    let finalContent;
    let commitMessage;

    if (commitMessageOverride) {
        commitMessage = commitMessageOverride;
        finalContent = `# Auto Commit

${commitMessageOverride}

Updated on ${new Date().toLocaleString()}`;
    } else if (contentInput === '' || dateForMessage) {
        commitMessage = generateSafeCommitMessage();
        finalContent = `# ${commitMessage}\n\nUpdated on ${dateForMessage || new Date().toLocaleString()}`;
    } else {
        finalContent = contentInput;
        commitMessage = generateSafeCommitMessage();
    }

    const apiCheck = apiRateLimiter.canMakeRequest();
    if (!apiCheck.allowed) {
        showStatusMessage(`⏱️ API rate limit reached. Wait ${Math.ceil(apiCheck.waitMs / 60000)} min`, "error");
        return false;
    }

    const encodedContent = toBase64(finalContent);

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000);

        const getRes = await fetch(`${apiUrl}?ref=${branch}`, { 
            headers,
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);

        if (getRes.status === 200) {
            const data = await getRes.json();
            sha = data.sha;
        } else if (getRes.status !== 404) {
            const errorData = await getRes.json();
            throw new Error(`Failed to fetch file: ${errorData.message || getRes.statusText}`);
        }
    } catch (error) {
        if (error.name !== 'AbortError') {
            console.error("Error fetching file:", error);
        }
    }

    const body = {
        message: commitMessage,
        content: encodedContent,
        sha: sha,
        branch: branch
    };

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000);

        const putRes = await fetch(apiUrl, {
            method: "PUT",
            headers,
            body: JSON.stringify(body),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        const result = await putRes.json();

        if (putRes.ok) {
            const commitHash = result.commit.sha.substring(0, 7);
            const commitRepo = repo.split('/')[1];
            const cliOutput = `[${branch} ${commitHash}] ${commitMessage}\n 1 file changed, 1 insertion(+)`;

            totalCommits++;
            if (isAutoCommit) {
                safeModeCommitCount++;
            }
            if (firstCommitDate === null) {
                firstCommitDate = Date.now();
            }
            commitTimestamps.push(Date.now());
            repoCommitCounts[repo] = (repoCommitCounts[repo] || 0) + 1;
            
            activityMonitor.recordCommit();
            saveSettingsToStorage();
            updateStatsDisplay();
            updateRateLimitDisplay();

            if (!dateForMessage && !isAutoCommit) {
                showStatusMessage(`✅ Commit successful to ${repo}!\n<pre class="bg-gray-100 p-2 rounded mt-1 text-xs dark:bg-gray-700 dark:text-gray-300">${cliOutput}</pre>View: <a href="${result.commit.html_url}" target="_blank" class="text-blue-600 hover:underline">${result.commit.html_url}</a>`, "success");
            } else if (isAutoCommit) {
                if (window.debugMode) console.log(`✅ Auto Commit: ${commitMessage}`);
                addActivityLog(`✅ Commit to <b>${commitRepo}</b>: <code>${commitMessage}</code>`);
            }
            return true;
        } else {
            throw new Error(result.message || "Unknown error during commit");
        }
    } catch (error) {
        console.error("Commit failed:", error);
        if (!dateForMessage && !isAutoCommit) {
            showStatusMessage(`❌ Commit failed: ${error.message}`, "error");
        } else if (isAutoCommit) {
            addActivityLog(`❌ Commit to <b>${repo.split('/')[1]}</b> failed: ${error.message}`, true);
        }
        return false;
    } finally {
        if (!dateForMessage && !isAutoCommit) {
            toggleLoading(false);
        }
    }
}

// ============= COMMIT PREVIEW MODAL =============

function showCommitPreviewModal() {
    const modal = document.getElementById('commitPreviewModal');
    document.getElementById('previewRepo').textContent = previewCommitDetails.repo;
    document.getElementById('previewBranch').textContent = previewCommitDetails.branch;
    document.getElementById('previewFilePath').textContent = previewCommitDetails.path;
    document.getElementById('previewCommitMessage').value = previewCommitDetails.message;
    document.getElementById('previewContentSnippet').value = previewCommitDetails.content.substring(0, 500) + (previewCommitDetails.content.length > 500 ? '...' : '');

    document.getElementById('previewCountdown').textContent = '';
    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
    }

    modal.classList.remove('hidden');
    toggleLoading(true);
    
    // Focus management for accessibility
    setTimeout(() => {
        const messageInput = document.getElementById('previewCommitMessage');
        if (messageInput) {
            messageInput.focus();
            messageInput.select();
        }
    }, 100);
}

function showCommitPreviewModalWithCountdown(repo, branch, path, message, content) {
    const modal = document.getElementById('commitPreviewModal');
    document.getElementById('previewRepo').textContent = repo;
    document.getElementById('previewBranch').textContent = branch;
    document.getElementById('previewFilePath').textContent = path;
    document.getElementById('previewCommitMessage').value = message;
    document.getElementById('previewContentSnippet').value = content.substring(0, 500) + (content.length > 500 ? '...' : '');

    const countdownElement = document.getElementById('previewCountdown');
    let timeLeft = 10;

    modal.classList.remove('hidden');
    toggleLoading(true);

    countdownElement.textContent = `Auto-committing in ${timeLeft}s...`;

    countdownInterval = setInterval(() => {
        timeLeft--;
        countdownElement.textContent = `Auto-committing in ${timeLeft}s...`;
        if (timeLeft <= 0) {
            clearInterval(countdownInterval);
            countdownInterval = null;
            modal.classList.add('hidden');
            toggleLoading(false);
            commitToGitHub(path, null, repo, message, true);
        }
    }, 1000);
}

async function confirmCommitPreview() {
    document.getElementById('commitPreviewModal').classList.add('hidden');
    toggleLoading(false);

    previewCommitDetails.message = document.getElementById('previewCommitMessage').value;

    await commitToGitHub(
        previewCommitDetails.path,
        null,
        previewCommitDetails.repo,
        previewCommitDetails.message,
        previewCommitDetails.isAutoCommit
    );
}

function cancelCommitPreview() {
    // Clear countdown interval first to prevent memory leak
    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
    }
    
    document.getElementById('commitPreviewModal').classList.add('hidden');
    toggleLoading(false);
    showStatusMessage("Commit cancelled", "info");
}

// ============= ENHANCED AUTO COMMIT & SAFE MODE =============

async function toggleAutoCommit() {
    const toggleButton = document.getElementById("toggleAutoCommitButton");
    const intervalValue = parseInt(document.getElementById("intervalValue").value);
    const intervalType = document.getElementById("intervalType").value;
    const selectedRepos = Array.from(document.getElementById("repo").selectedOptions).map(option => option.value);

    if (autoCommitInterval !== null || autoCommitTimeout !== null || safeModeLoopActive) {
        if (autoCommitInterval !== null) {
            clearInterval(autoCommitInterval);
            autoCommitInterval = null;
        }
        if (autoCommitTimeout !== null) {
            clearTimeout(autoCommitTimeout);
            autoCommitTimeout = null;
        }
        if (safeModeLoopActive) {
            safeModeLoopActive = false;
            await delay(100);
        }

        toggleButton.textContent = "Toggle Auto Commit";
        toggleButton.classList.remove('bg-red-600', 'hover:bg-red-700');
        toggleButton.classList.add('bg-green-600', 'hover:bg-green-700');
        showStatusMessage("❌ Auto Commit Disabled", "error");
        addActivityLog("🛑 Auto commit stopped");
    } else {
        if (selectedRepos.length === 0) {
            showStatusMessage("Please select at least one repository", "error");
            return;
        }

        if (safeModeEnabled) {
            safeModeLoopActive = true;
            toggleButton.textContent = `Safe Mode Auto Commit ON`;
            toggleButton.classList.remove('bg-green-600', 'hover:bg-green-700');
            toggleButton.classList.add('bg-red-600', 'hover:bg-red-700');
            showStatusMessage(`✅ Safe Mode Enabled: Enhanced human-like behavior`, "success");
            addActivityLog("🛡️ Safe Mode auto commit started");
            safeAutoCommitLoop(selectedRepos);
        } else {
            if (isNaN(intervalValue) || intervalValue <= 0) {
                showStatusMessage("Please enter a valid positive interval", "error");
                return;
            }

            let intervalMilliseconds = 0;
            switch (intervalType) {
                case "minutes": intervalMilliseconds = intervalValue * 60 * 1000; break;
                case "hours": intervalMilliseconds = intervalValue * 60 * 60 * 1000; break;
                case "days": intervalMilliseconds = intervalValue * 24 * 60 * 60 * 1000; break;
            }

            const randomVariation = 0.25;
            const minInterval = intervalMilliseconds * (1 - randomVariation);
            const maxInterval = intervalMilliseconds * (1 + randomVariation);

            await commitToGitHub(null, null, null, null, true);
            addActivityLog(`✅ Auto commit started (Every ${intervalValue} ${intervalType} ±25%)`);

            const scheduleNextCommit = () => {
                const randomizedInterval = minInterval + Math.random() * (maxInterval - minInterval);
                autoCommitTimeout = setTimeout(async () => {
                    await commitToGitHub(null, null, null, null, true);
                    if (autoCommitTimeout !== null) {
                        scheduleNextCommit();
                    }
                }, randomizedInterval);
            };

            scheduleNextCommit();

            toggleButton.textContent = `Auto Commit ON (Every ${intervalValue} ${intervalType} ±25%)`;
            toggleButton.classList.remove('bg-green-600', 'hover:bg-green-700');
            toggleButton.classList.add('bg-red-600', 'hover:bg-red-700');
            showStatusMessage(`✅ Auto Commit Enabled with randomized timing`, "success");
        }
    }
}

async function safeAutoCommitLoop(repos) {
    // Prevent race condition - only one loop at a time
    if (safeModeLoopRunning) {
        console.warn('Safe mode loop already running');
        addActivityLog('⚠️ Safe mode already running', true);
        return;
    }
    
    safeModeLoopRunning = true;
    const dailyCommits = new Map();
    
    try {
        while (safeModeLoopActive) {
        const now = new Date();
        const hour = now.getHours();
        const isWeekday = now.getDay() >= 1 && now.getDay() <= 5;
        const today = now.toDateString();

        if (hour >= safeModeConfig.quietHours.start || hour < safeModeConfig.quietHours.end) {
            const waitUntilMorning = ((safeModeConfig.quietHours.end - hour + 24) % 24) * 60 * 60 * 1000;
            addActivityLog(`😴 Quiet hours (${safeModeConfig.quietHours.start}:00-${safeModeConfig.quietHours.end}:00). Sleeping ${Math.round(waitUntilMorning / 3600000)}h`);
            await delay(waitUntilMorning);
            continue;
        }

        const todayCount = dailyCommits.get(today) || 0;
        if (todayCount >= safeModeConfig.maxCommitsPerDay) {
            const waitUntilMidnight = (24 - hour) * 60 * 60 * 1000;
            addActivityLog(`📊 Daily limit reached (${todayCount}/${safeModeConfig.maxCommitsPerDay}). Waiting ${Math.round(waitUntilMidnight / 3600000)}h`);
            await delay(waitUntilMidnight);
            dailyCommits.delete(today);
            continue;
        }

        const skipChance = isWeekday ? safeModeConfig.skipProbability : safeModeConfig.skipProbability * 1.5;
        if (Math.random() < skipChance) {
            const skipDelay = jitter(safeModeConfig.minDelay, safeModeConfig.maxDelay - safeModeConfig.minDelay);
            addActivityLog(`🎲 Randomly skipping (${Math.round(skipDelay / 60000)}min wait)`);
            await delay(skipDelay);
            continue;
        }

        if (!isWeekday && Math.random() > (1 - safeModeConfig.workdayBias)) {
            const weekendDelay = jitter(safeModeConfig.maxDelay, 60 * 60 * 1000);
            addActivityLog(`📅 Weekend - reduced activity (${Math.round(weekendDelay / 60000)}min wait)`);
            await delay(weekendDelay);
            continue;
        }

        const baseDelay = jitter(safeModeConfig.minDelay, safeModeConfig.maxDelay - safeModeConfig.minDelay);
        const isWorkHours = hour >= 9 && hour <= 17;
        const delayMultiplier = isWorkHours ? 0.7 : 1.3;
        const finalDelay = baseDelay * delayMultiplier;

        addActivityLog(`⏳ Waiting ${Math.round(finalDelay / 60000)}min before next commit...`);
        await delay(finalDelay);

        if (!safeModeLoopActive) break;

        const selectedRepo = smartRotationEnabled ? 
            repos[currentRepoIndex] : 
            repos[Math.floor(Math.random() * repos.length)];

        if (smartRotationEnabled) {
            currentRepoIndex = (currentRepoIndex + 1) % repos.length;
        }

        const message = generateSafeCommitMessage();
        const success = await commitToGitHub(null, null, selectedRepo, message, true);

        if (success) {
            dailyCommits.set(today, (dailyCommits.get(today) || 0) + 1);
        }
        }
    } finally {
        safeModeLoopRunning = false;
    }
    
    addActivityLog("🛑 Safe Mode stopped");
}

// ============= SIMULATED COMMITS =============

function generatePatternDates(patternType, startDate, endDate, numCommits) {
    const dates = [];
    let currentDate = new Date(startDate);
    currentDate.setHours(12, 0, 0, 0);
    const timeDiff = endDate.getTime() - startDate.getTime();

    if (patternType === "random") {
        for (let i = 0; i < numCommits; i++) {
            const randomTime = startDate.getTime() + Math.random() * timeDiff;
            dates.push(new Date(randomTime));
        }
    } else if (patternType === "random-burst") {
        const actualNumBursts = Math.min(numCommits, Math.floor(Math.random() * 6) + 5);
        for (let i = 0; i < actualNumBursts; i++) {
            const randomTime = startDate.getTime() + Math.random() * timeDiff;
            dates.push(new Date(randomTime));
        }
    } else {
        while (currentDate <= endDate) {
            const dayOfWeek = currentDate.getDay();

            switch (patternType) {
                case "30-day-streak":
                case "year-grid":
                    dates.push(new Date(currentDate));
                    break;
                case "checkerboard":
                    const dayDiff = Math.floor((currentDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
                    if (dayDiff % 2 === 0) {
                        dates.push(new Date(currentDate));
                    }
                    break;
                case "weekdays-only":
                    if (dayOfWeek >= 1 && dayOfWeek <= 5) {
                        dates.push(new Date(currentDate));
                    }
                    break;
            }
            currentDate.setDate(currentDate.getDate() + 1);
        }
    }
    return dates;
}

async function generateSimulatedCommits() {
    const numCommits = parseInt(document.getElementById("numSimulatedCommits").value);
    const simulatedStartDateStr = document.getElementById("simulatedStartDate").value;
    const simulatedEndDateStr = document.getElementById("simulatedEndDate").value;
    const patternType = document.getElementById("streakPatternSelect").value;
    const mainFilePath = document.getElementById("filepath").value.trim();

    if (!simulatedStartDateStr || !simulatedEndDateStr) {
        showStatusMessage("Please select both start and end dates", "error");
        return;
    }
    if (!mainFilePath) {
        showStatusMessage("Please enter a file path", "error");
        return;
    }
    if ((patternType === "random" || patternType === "random-burst") && (isNaN(numCommits) || numCommits <= 0)) {
        showStatusMessage("Please enter a valid number of commits", "error");
        return;
    }

    const startDate = new Date(simulatedStartDateStr);
    const endDate = new Date(simulatedEndDateStr);

    if (startDate > endDate) {
        showStatusMessage("Start date cannot be after end date", "error");
        return;
    }

    toggleLoading(true);
    showStatusMessage(`Generating simulated commits with '${patternType}' pattern...`, "info");

    const datesToCommit = generatePatternDates(patternType, startDate, endDate, numCommits);
    simulatedCommitDates = [];
    let successfulCommits = 0;

    for (const date of datesToCommit) {
        const formattedDate = date.toLocaleString();
        showStatusMessage(`Simulating commit ${successfulCommits + 1}/${datesToCommit.length} for ${formattedDate}...`, "info");

        const success = await commitToGitHub(mainFilePath, formattedDate);
        if (success) {
            successfulCommits++;
            simulatedCommitDates.push(date);
        }

        await delay(1000);
    }

    showStatusMessage(`✅ Simulation complete: ${successfulCommits}/${datesToCommit.length} commits successful`, successfulCommits === datesToCommit.length ? "success" : "warning");
    toggleLoading(false);
    renderHeatmapFromSimulatedData();
}

// ============= D3-BASED HEATMAP RENDERER =============

function renderD3Heatmap(containerId, commitData) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    
    // Empty state with helpful message
    if (!commitData || Object.keys(commitData).length === 0) {
        container.innerHTML = `
            <div class="flex flex-col items-center justify-center p-8 text-gray-500 dark:text-gray-400">
                <svg class="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                <p class="font-semibold text-center">No commit data available</p>
                <p class="text-sm mt-1 text-center">Generate some commits to see your heatmap!</p>
            </div>
        `;
        return;
    }
    
    const cellSize = 12;
    const cellPadding = 2;
    const width = 900;
    const height = 150;
    const legendHeight = 20;
    
    const svg = d3.select(`#${containerId}`)
        .append('svg')
        .attr('width', width)
        .attr('height', height + legendHeight)
        .attr('class', 'mx-auto');
    
    const today = new Date();
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - 364);
    
    const dateArray = [];
    for (let d = new Date(startDate); d <= today; d.setDate(d.getDate() + 1)) {
        dateArray.push(new Date(d));
    }
    
    const commitsByDate = {};
    Object.keys(commitData).forEach(timestamp => {
        const date = new Date(parseInt(timestamp) * 1000);
        const dateStr = date.toISOString().split('T')[0];
        commitsByDate[dateStr] = commitData[timestamp];
    });
    
    const maxCommits = Math.max(...Object.values(commitsByDate), 1);
    
    const colorScale = d3.scaleQuantize()
        .domain([0, maxCommits])
        .range(['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39']);
    
    const tooltip = d3.select('body')
        .append('div')
        .attr('class', 'absolute hidden bg-gray-800 text-white text-xs rounded px-2 py-1 pointer-events-none')
        .style('z-index', '1000');
    
    const weeks = d3.groups(dateArray, d => d3.timeWeek.floor(d));
    
    const weekGroups = svg.selectAll('g')
        .data(weeks)
        .enter()
        .append('g')
        .attr('transform', (d, i) => `translate(${i * (cellSize + cellPadding)}, 0)`);
    
    weekGroups.selectAll('rect')
        .data(d => d[1])
        .enter()
        .append('rect')
        .attr('class', 'heatmap-cell')
        .attr('width', cellSize)
        .attr('height', cellSize)
        .attr('x', 0)
        .attr('y', (d) => d.getDay() * (cellSize + cellPadding))
        .attr('rx', 2)
        .attr('ry', 2)
        .attr('fill', d => {
            const dateStr = d.toISOString().split('T')[0];
            const commits = commitsByDate[dateStr] || 0;
            return colorScale(commits);
        })
        .on('mouseover', function(event, d) {
            const dateStr = d.toISOString().split('T')[0];
            const commits = commitsByDate[dateStr] || 0;
            tooltip
                .html(`${dateStr}<br/>${commits} commit${commits !== 1 ? 's' : ''}`)
                .style('left', (event.pageX + 10) + 'px')
                .style('top', (event.pageY - 20) + 'px')
                .classed('hidden', false);
            d3.select(this).attr('stroke', '#1b1f23').attr('stroke-width', 2);
        })
        .on('mouseout', function() {
            tooltip.classed('hidden', true);
            d3.select(this).attr('stroke', 'none');
        });
    
    const months = svg.append('g')
        .attr('transform', `translate(0, ${height - 20})`);
    
    const monthLabels = d3.timeMonths(startDate, today);
    months.selectAll('text')
        .data(monthLabels)
        .enter()
        .append('text')
        .attr('x', d => {
            const weekIndex = d3.timeWeek.count(startDate, d);
            return weekIndex * (cellSize + cellPadding);
        })
        .attr('y', 15)
        .attr('class', 'text-xs fill-gray-600 dark:fill-gray-400')
        .text(d => d3.timeFormat('%b')(d));
    
    const legend = svg.append('g')
        .attr('transform', `translate(${width - 200}, ${height + 5})`);
    
    legend.append('text')
        .attr('x', -60)
        .attr('y', 10)
        .attr('class', 'text-xs fill-gray-600 dark:fill-gray-400')
        .text('Less');
    
    const legendColors = ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39'];
    legendColors.forEach((color, i) => {
        legend.append('rect')
            .attr('width', cellSize)
            .attr('height', cellSize)
            .attr('x', i * (cellSize + cellPadding))
            .attr('y', 0)
            .attr('rx', 2)
            .attr('fill', color);
    });
    
    legend.append('text')
        .attr('x', legendColors.length * (cellSize + cellPadding) + 5)
        .attr('y', 10)
        .attr('class', 'text-xs fill-gray-600 dark:fill-gray-400')
        .text('More');
}

function renderHeatmapFromSimulatedData() {
    if (simulatedCommitDates.length === 0) {
        showStatusMessage("No simulated data. Generate commits first.", "info");
        return;
    }

    const data = {};
    simulatedCommitDates.forEach(date => {
        const timestamp = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() / 1000;
        data[timestamp] = (data[timestamp] || 0) + 1;
    });

    renderD3Heatmap('heatmapContainer', data);
    showStatusMessage("Simulated heatmap updated", "info");
}

async function loadRealContributionHeatmap() {
    const token = TokenManager.getToken('gh_token_oauth') || TokenManager.getToken('gh_token_enc');
    const username = document.getElementById("username").value.trim();
    const container = document.getElementById("realHeatmapContainer");
    container.innerHTML = '';

    if (!token || !username) {
        showStatusMessage("Please enter token and username", "error");
        return;
    }

    toggleLoading(true);
    showStatusMessage(`Fetching GitHub events for ${username}...`, "info");

    const headers = {
        "Authorization": `token ${token}`,
        "Accept": "application/vnd.github.v3+json"
    };

    const realContributionData = {};
    let page = 1;
    const maxPages = 3; // GitHub API limits events pagination to ~10 pages, use 3 for safety
    let hasMoreEvents = true;

    try {
        while (page <= maxPages && hasMoreEvents) {
            const apiCheck = apiRateLimiter.canMakeRequest();
            if (!apiCheck.allowed) {
                showStatusMessage(`⏱️ API rate limit. Wait ${Math.ceil(apiCheck.waitMs / 60000)} min`, "error");
                break;
            }

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 20000);

            const res = await fetch(`https://api.github.com/users/${username}/events?page=${page}&per_page=100`, { 
                headers,
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);

            if (!res.ok) {
                const errorData = await res.json().catch(() => ({}));
                
                // Handle pagination limit error
                if (res.status === 422 || (errorData.message && errorData.message.includes('pagination'))) {
                    console.warn('Pagination limit reached, using available data');
                    hasMoreEvents = false;
                    break;
                }
                
                if (res.status === 403 && errorData.message && errorData.message.includes('rate limit')) {
                    throw new Error("API rate limit exceeded. Wait and try again.");
                }
                
                // If we have some data already, use it instead of failing
                if (Object.keys(realContributionData).length > 0) {
                    console.warn('API error but have data:', errorData.message);
                    break;
                }
                
                throw new Error(errorData.message || "Failed to fetch events");
            }
            
            const events = await res.json();

            if (events.length === 0) {
                hasMoreEvents = false;
            } else {
                events.forEach(event => {
                    const date = new Date(event.created_at);
                    if (event.type === 'PushEvent') {
                        const timestamp = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() / 1000;
                        realContributionData[timestamp] = (realContributionData[timestamp] || 0) + 1;
                    }
                });
                page++;
            }
        }

        if (Object.keys(realContributionData).length === 0) {
            showStatusMessage("No push events found in recent history (last ~300 events)", "info");
            toggleLoading(false);
            return;
        }

        const eventCount = Object.keys(realContributionData).length;
        renderD3Heatmap('realHeatmapContainer', realContributionData);
        showStatusMessage(`✅ Real heatmap loaded! (${eventCount} days with activity)`, "success");

    } catch (error) {
        console.error("Heatmap error:", error);
        showStatusMessage(`❌ Error: ${error.message}`, "error");
    } finally {
        toggleLoading(false);
    }
}

// ============= OAUTH HANDLERS =============

document.getElementById('githubLogin').addEventListener('click', () => {
    window.location.href = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&scope=repo%20read:user&redirect_uri=${GITHUB_REDIRECT_URI}`;
});

document.getElementById('githubLogout').addEventListener('click', () => {
    TokenManager.removeToken('gh_token_oauth');
    localStorage.removeItem('gh_user_oauth');
    localStorage.removeItem('gh_username');
    document.getElementById("token").value = '';
    document.getElementById("username").value = '';
    document.getElementById("token").disabled = false;
    document.getElementById("githubLogin").classList.remove('hidden');
    document.getElementById("loggedInUser").classList.add('hidden');
    showStatusMessage("Logged out", "info");
    loadUserRepos();
});

// ============= EVENT LISTENERS =============

document.getElementById("token").addEventListener("input", () => {
    const token = document.getElementById("token").value.trim();
    if (token) TokenManager.saveToken(token, 'gh_token_enc');
    debouncedSaveSettings();
});

document.getElementById("geminiApiKey").addEventListener("input", () => {
    const key = document.getElementById("geminiApiKey").value.trim();
    if (key) TokenManager.saveToken(key, 'gemini_api_key_enc');
    debouncedSaveSettings();
});

document.getElementById("username").addEventListener("input", debouncedSaveSettings);
document.getElementById("repo").addEventListener("change", (e) => {
    const count = e.target.selectedOptions.length;
    const countDisplay = document.getElementById("selectedRepoCount");
    if (countDisplay) {
        countDisplay.textContent = count > 0 ? `(${count} selected)` : '';
    }
    debouncedSaveSettings();
    loadRepoBranches();
});
document.getElementById("branch").addEventListener("change", debouncedSaveSettings);
document.getElementById("filepath").addEventListener("input", debouncedSaveSettings);
document.getElementById("content").addEventListener("input", debouncedSaveSettings);
document.getElementById("intervalValue").addEventListener("input", debouncedSaveSettings);
document.getElementById("intervalType").addEventListener("change", debouncedSaveSettings);
document.getElementById("numSimulatedCommits").addEventListener("input", debouncedSaveSettings);
document.getElementById("simulatedStartDate").addEventListener("change", debouncedSaveSettings);
document.getElementById("simulatedEndDate").addEventListener("change", debouncedSaveSettings);
document.getElementById("streakPatternSelect").addEventListener("change", () => {
    debouncedSaveSettings();
    const patternType = document.getElementById("streakPatternSelect").value;
    const numCommitsContainer = document.getElementById("numCommitsContainer");
    numCommitsContainer.style.display = (patternType === "random" || patternType === "random-burst") ? 'block' : 'none';
});
document.getElementById("commitContext").addEventListener("input", debouncedSaveSettings);

document.getElementById("safeMode").addEventListener("change", (e) => {
    safeModeEnabled = e.target.checked;
    if (window.debugMode) console.log('Safe Mode:', safeModeEnabled);
    if (!safeModeEnabled && safeModeLoopActive) {
        toggleAutoCommit();
    }
});

document.getElementById("smartRotation").addEventListener("change", (e) => {
    smartRotationEnabled = e.target.checked;
    if (window.debugMode) console.log('Smart Rotation:', smartRotationEnabled);
    saveSettingsToStorage();
});

document.getElementById("commitPreviewToggle").addEventListener("change", (e) => {
    commitPreviewEnabled = e.target.checked;
    if (window.debugMode) console.log('Commit Preview:', commitPreviewEnabled);
    saveSettingsToStorage();
});

document.getElementById("darkModeToggle").addEventListener("change", () => {
    document.documentElement.classList.toggle("dark");
    saveSettingsToStorage();
});

document.querySelectorAll('.tab-button').forEach(button => {
    button.addEventListener('click', () => {
        const tabId = button.dataset.tab;

        document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

        button.classList.add('active');
        document.getElementById(tabId).classList.add('active');

        if (tabId === 'heatmaps' && document.getElementById('username').value.trim() !== '') {
            loadRealContributionHeatmap();
        }
        if (tabId === 'stats') {
            updateStatsDisplay();
        }
    });
});

// ============= OAUTH CALLBACK HANDLER =============

window.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(window.location.search);
    const accessTokenFromBackend = params.get('access_token');
    const userLoginFromBackend = params.get('user_login');
    const userAvatarFromBackend = params.get('user_avatar');

    if (accessTokenFromBackend && userLoginFromBackend) {
        showStatusMessage("Processing GitHub login...", "info");
        toggleLoading(true);

        try {
            TokenManager.saveToken(accessTokenFromBackend, 'gh_token_oauth');
            localStorage.setItem('gh_user_oauth', JSON.stringify({
                login: userLoginFromBackend,
                avatar_url: decodeURIComponent(userAvatarFromBackend)
            }));

            document.getElementById("token").value = accessTokenFromBackend;
            document.getElementById("token").disabled = true;
            document.getElementById("username").value = userLoginFromBackend;
            document.getElementById("githubLogin").classList.add('hidden');
            document.getElementById("loggedInUser").classList.remove('hidden');
            document.getElementById("userAvatar").src = decodeURIComponent(userAvatarFromBackend);
            document.getElementById("userName").textContent = userLoginFromBackend;

            showStatusMessage(`✅ Welcome, ${userLoginFromBackend}! Login successful.`, "success");
            loadUserRepos();

            window.history.replaceState({}, document.title, window.location.origin + window.location.pathname);
        } catch (error) {
            console.error('OAuth error:', error);
            showStatusMessage(`❌ OAuth error: ${error.message}`, "error");
            document.getElementById("token").disabled = false;
            document.getElementById("githubLogin").classList.remove('hidden');
            document.getElementById("loggedInUser").classList.add('hidden');
        } finally {
            toggleLoading(false);
        }
    }
});

// ============= INITIALIZATION =============

window.onload = () => {
    loadSettingsFromStorage();
    setTimeout(loadUserRepos, 100);
    document.querySelector('.tab-button[data-tab="main-controls"]').click();

    const patternType = document.getElementById("streakPatternSelect").value;
    const numCommitsContainer = document.getElementById("numCommitsContainer");
    numCommitsContainer.style.display = (patternType === "random" || patternType === "random-burst") ? 'block' : 'none';
    
    updateStatsDisplay();
    updateRateLimitDisplay();
    
    setInterval(updateRateLimitDisplay, 60000);
};

// Service Worker Registration
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('service-worker.js')
            .then(reg => console.log('✅ Service Worker registered'))
            .catch(err => console.warn('❌ Service Worker failed', err));
    });
}

// ============= CLEANUP ON PAGE UNLOAD =============

window.addEventListener('beforeunload', () => {
    // Clear any pending timeouts
    if (saveTimeout) {
        clearTimeout(saveTimeout);
        saveSettingsToStorage();
    }
    
    if (countdownInterval) {
        clearInterval(countdownInterval);
    }
    
    if (autoCommitTimeout) {
        clearTimeout(autoCommitTimeout);
    }
});

console.log('🚀 GitHub Auto Commit Bot v3.1 - Loaded with D3 Heatmap');
console.log('✅ Fixed token validation and error handling loaded');
