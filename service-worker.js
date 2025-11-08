// ===================================
// ENHANCED SERVICE WORKER v3.1
// Offline Support & Caching Strategy
// Fixed: Chrome Extension URL filtering
// ===================================

const CACHE_VERSION = 'gh-bot-v3.1';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const DYNAMIC_CACHE = `${CACHE_VERSION}-dynamic`;
const MAX_DYNAMIC_CACHE_SIZE = 50;

const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/app.js',
    '/guide.html',
    '/manifest.json',
    'https://cdn.tailwindcss.com',
    'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css',
    'https://d3js.org/d3.v7.min.js'
];

// Cache size limiter
const limitCacheSize = async (cacheName, maxSize) => {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length > maxSize) {
        await cache.delete(keys[0]);
        limitCacheSize(cacheName, maxSize);
    }
};

// Helper: Check if URL should be cached
function shouldCache(url) {
    // Don't cache chrome extensions, browser extensions, or data URLs
    if (url.protocol === 'chrome-extension:' || 
        url.protocol === 'moz-extension:' || 
        url.protocol === 'safari-extension:' ||
        url.protocol === 'data:' ||
        url.protocol === 'blob:') {
        return false;
    }
    
    // Don't cache API calls
    if (url.hostname === 'api.github.com' || 
        url.hostname.includes('generativelanguage.googleapis.com')) {
        return false;
    }
    
    return true;
}

// Install event - cache static assets
self.addEventListener('install', event => {
    console.log('[SW] Installing Service Worker v3.1...');
    event.waitUntil(
        caches.open(STATIC_CACHE)
            .then(cache => {
                console.log('[SW] Caching static assets');
                // Filter out any invalid URLs before caching
                const validAssets = STATIC_ASSETS.filter(url => {
                    try {
                        const parsed = new URL(url, self.location.origin);
                        return shouldCache(parsed);
                    } catch (e) {
                        console.warn('[SW] Invalid URL:', url);
                        return false;
                    }
                });
                return cache.addAll(validAssets);
            })
            .then(() => self.skipWaiting())
            .catch(err => console.error('[SW] Install failed:', err))
    );
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
    console.log('[SW] Activating Service Worker v3.1...');
    event.waitUntil(
        caches.keys()
            .then(keys => {
                return Promise.all(
                    keys
                        .filter(key => key !== STATIC_CACHE && key !== DYNAMIC_CACHE)
                        .map(key => {
                            console.log('[SW] Removing old cache:', key);
                            return caches.delete(key);
                        })
                );
            })
            .then(() => self.clients.claim())
    );
});

// Fetch event - network first, fallback to cache
self.addEventListener('fetch', event => {
    const { request } = event;
    
    // Parse URL safely
    let url;
    try {
        url = new URL(request.url);
    } catch (e) {
        console.warn('[SW] Invalid request URL:', request.url);
        return;
    }

    // Skip non-GET requests
    if (request.method !== 'GET') return;

    // Skip extension URLs, blob URLs, and data URLs
    if (!shouldCache(url)) {
        return;
    }

    // Cache strategy: Network first, fallback to cache
    event.respondWith(
        fetch(request)
            .then(async response => {
                // Only cache successful responses from valid URLs
                if (response.status === 200 && shouldCache(url)) {
                    try {
                        const responseClone = response.clone();
                        const cache = await caches.open(DYNAMIC_CACHE);
                        await cache.put(request, responseClone);
                        limitCacheSize(DYNAMIC_CACHE, MAX_DYNAMIC_CACHE_SIZE);
                    } catch (err) {
                        console.warn('[SW] Cache put failed:', err.message);
                    }
                }
                
                return response;
            })
            .catch(async () => {
                // Network failed, try cache
                const cachedResponse = await caches.match(request);
                if (cachedResponse) {
                    console.log('[SW] Serving from cache:', request.url);
                    return cachedResponse;
                }
                
                // Return offline page for navigation requests
                if (request.mode === 'navigate') {
                    const indexCache = await caches.match('/index.html');
                    if (indexCache) return indexCache;
                }
                
                // Return error response
                return new Response('Offline - resource not available', {
                    status: 503,
                    statusText: 'Service Unavailable',
                    headers: new Headers({
                        'Content-Type': 'text/plain'
                    })
                });
            })
    );
});

// Message event - handle commands from app
self.addEventListener('message', event => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
    
    if (event.data && event.data.type === 'CLEAR_CACHE') {
        event.waitUntil(
            caches.keys().then(keys => {
                return Promise.all(
                    keys.map(key => caches.delete(key))
                );
            })
        );
    }
});

// Push notification support (future enhancement)
self.addEventListener('push', event => {
    if (!event.data) return;
    
    try {
        const data = event.data.json();
        const options = {
            body: data.body || 'New notification',
            icon: data.icon || '/icon.png',
            badge: '/icon.png',
            vibrate: [200, 100, 200],
            data: {
                dateOfArrival: Date.now(),
                primaryKey: data.primaryKey || 1
            },
            actions: [
                {
                    action: 'view',
                    title: 'View',
                    icon: '/icon.png'
                },
                {
                    action: 'close',
                    title: 'Close',
                    icon: '/icon.png'
                }
            ]
        };
        
        event.waitUntil(
            self.registration.showNotification(data.title || 'GitHub Bot', options)
        );
    } catch (err) {
        console.error('[SW] Push notification error:', err);
    }
});

// Notification click handler
self.addEventListener('notificationclick', event => {
    event.notification.close();
    
    if (event.action === 'view') {
        event.waitUntil(
            clients.openWindow('/')
        );
    }
});

console.log('[SW] Service Worker v3.1 loaded successfully');
