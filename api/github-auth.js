// ===================================
// SECURE GITHUB OAUTH HANDLER
// Vercel Serverless Function
// ===================================

import axios from 'axios';
import crypto from 'crypto';

// In-memory rate limiting (use Redis in production)
const rateLimitStore = new Map();

// Helper: Rate Limiter
function checkRateLimit(clientIp) {
    const now = Date.now();
    const windowMs = 3600000; // 1 hour
    const maxRequests = 10; // 10 OAuth requests per hour per IP

    if (!rateLimitStore.has(clientIp)) {
        rateLimitStore.set(clientIp, []);
    }

    const requests = rateLimitStore.get(clientIp);
    const validRequests = requests.filter(timestamp => now - timestamp < windowMs);
    
    if (validRequests.length >= maxRequests) {
        const oldestRequest = validRequests[0];
        const waitTime = windowMs - (now - oldestRequest);
        return {
            allowed: false,
            waitMs: waitTime,
            remaining: 0
        };
    }

    validRequests.push(now);
    rateLimitStore.set(clientIp, validRequests);
    
    return {
        allowed: true,
        remaining: maxRequests - validRequests.length
    };
}

// Helper: Clean expired rate limit entries
function cleanupRateLimitStore() {
    const now = Date.now();
    const windowMs = 3600000;
    
    for (const [ip, requests] of rateLimitStore.entries()) {
        const validRequests = requests.filter(timestamp => now - timestamp < windowMs);
        if (validRequests.length === 0) {
            rateLimitStore.delete(ip);
        } else {
            rateLimitStore.set(ip, validRequests);
        }
    }
}

// Cleanup every 10 minutes
setInterval(cleanupRateLimitStore, 600000);

// Helper: Sanitize redirect URL
function sanitizeRedirectUrl(url) {
    try {
        const parsedUrl = new URL(url);
        // Only allow same origin redirects
        if (parsedUrl.origin !== process.env.VERCEL_URL && 
            parsedUrl.origin !== `https://${process.env.VERCEL_URL}`) {
            return '/';
        }
        return url;
    } catch (e) {
        return '/';
    }
}

// Main Handler
export default async function handler(req, res) {
    // ===== Security Headers =====
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    // ===== Method Validation =====
    if (req.method !== 'GET') {
        return res.status(405).json({ 
            error: 'Method not allowed',
            allowedMethods: ['GET']
        });
    }

    // ===== Get Client IP =====
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
                     req.headers['x-real-ip'] || 
                     req.connection?.remoteAddress || 
                     'unknown';

    console.log(`[OAuth] Request from IP: ${clientIp}`);

    // ===== Rate Limiting =====
    const rateLimitCheck = checkRateLimit(clientIp);
    
    if (!rateLimitCheck.allowed) {
        const waitMinutes = Math.ceil(rateLimitCheck.waitMs / 60000);
        console.warn(`[OAuth] Rate limit exceeded for IP: ${clientIp}`);
        return res.status(429).json({
            error: 'Too many requests',
            message: `Rate limit exceeded. Please try again in ${waitMinutes} minutes.`,
            retryAfter: waitMinutes * 60
        });
    }

    res.setHeader('X-RateLimit-Limit', '10');
    res.setHeader('X-RateLimit-Remaining', rateLimitCheck.remaining.toString());

    // ===== Extract Parameters =====
    const { code, state } = req.query;

    // ===== Validate Code Parameter =====
    if (!code) {
        console.warn('[OAuth] No code parameter provided');
        return res.redirect('/?oauth_error=no_code');
    }

    // ===== Environment Variables Check =====
    const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
    const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;

    if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
        console.error('[OAuth] Missing environment variables');
        return res.status(500).json({
            error: 'Server configuration error',
            message: 'GitHub OAuth credentials not configured'
        });
    }

    // ===== State Parameter Validation (CSRF Protection) =====
    // In production, implement proper state validation
    // For now, we log if state is missing
    if (!state) {
        console.warn('[OAuth] No state parameter (CSRF risk)');
    }

    try {
        console.log('[OAuth] Exchanging code for access token...');

        // ===== Exchange Code for Token =====
        const tokenRes = await axios.post(
            'https://github.com/login/oauth/access_token',
            {
                client_id: GITHUB_CLIENT_ID,
                client_secret: GITHUB_CLIENT_SECRET,
                code: code
            },
            {
                headers: { 
                    Accept: 'application/json',
                    'User-Agent': 'GitHub-Contribution-Bot/2.0'
                },
                timeout: 10000 // 10 second timeout
            }
        );

        const access_token = tokenRes.data.access_token;

        // ===== Validate Token =====
        if (!access_token) {
            console.error('[OAuth] No access token in response:', tokenRes.data);
            return res.redirect('/?oauth_error=no_token&details=' + encodeURIComponent(tokenRes.data.error_description || 'Unknown error'));
        }

        console.log('[OAuth] Access token received, fetching user info...');

        // ===== Fetch User Information =====
        const userRes = await axios.get('https://api.github.com/user', {
            headers: { 
                Authorization: `token ${access_token}`,
                'User-Agent': 'GitHub-Contribution-Bot/2.0'
            },
            timeout: 10000
        });

        const user = userRes.data;

        // ===== Validate User Data =====
        if (!user || !user.login) {
            console.error('[OAuth] Invalid user data:', user);
            return res.redirect('/?oauth_error=invalid_user');
        }

        console.log(`[OAuth] User authenticated: ${user.login}`);

        // ===== Sanitize User Data =====
        const sanitizedLogin = encodeURIComponent(user.login);
        const sanitizedAvatar = encodeURIComponent(user.avatar_url || '');

        // ===== Construct Redirect URL =====
        const redirectUrl = `/?access_token=${access_token}&user_login=${sanitizedLogin}&user_avatar=${sanitizedAvatar}`;
        
        console.log('[OAuth] Redirecting to frontend...');

        // ===== Successful Redirect =====
        return res.redirect(redirectUrl);

    } catch (e) {
        console.error('[OAuth] Error during OAuth flow:', e.message);

        // ===== Error Handling =====
        if (e.code === 'ECONNABORTED') {
            return res.redirect('/?oauth_error=timeout&details=' + encodeURIComponent('Request timed out. Please try again.'));
        }

        if (e.response) {
            // GitHub API returned an error
            const status = e.response.status;
            const errorMessage = e.response.data?.message || e.response.data?.error || 'Unknown error';
            
            console.error(`[OAuth] GitHub API error ${status}:`, errorMessage);

            if (status === 401) {
                return res.redirect('/?oauth_error=unauthorized&details=' + encodeURIComponent('Invalid credentials'));
            } else if (status === 403) {
                return res.redirect('/?oauth_error=forbidden&details=' + encodeURIComponent('Access denied or rate limit exceeded'));
            } else if (status === 404) {
                return res.redirect('/?oauth_error=not_found&details=' + encodeURIComponent('Resource not found'));
            } else {
                return res.redirect(`/?oauth_error=github_api_error&status=${status}&details=` + encodeURIComponent(errorMessage));
            }
        } else if (e.request) {
            // Request was made but no response
            console.error('[OAuth] Network error:', e.message);
            return res.redirect('/?oauth_error=network_error&details=' + encodeURIComponent('Network error. Check your connection.'));
        } else {
            // Other errors
            console.error('[OAuth] Unexpected error:', e.message);
            return res.redirect('/?oauth_error=server_error&details=' + encodeURIComponent(e.message));
        }
    }
}

// ===== Export for Vercel =====
export const config = {
    api: {
        bodyParser: false,
        externalResolver: true,
    },
};
