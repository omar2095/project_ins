/* ============================================
   Service Worker for PWA
   Smart-Watch Health Monitor
   ============================================ */

const CACHE_NAME = 'health-monitor-v2.0.0';
const urlsToCache = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css'
];

// Install event - cache resources
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Service Worker: Caching files');
        return cache.addAll(urlsToCache);
      })
      .catch((error) => {
        console.error('Service Worker: Cache failed', error);
      })
  );
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Service Worker: Deleting old cache', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  return self.clients.claim();
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Return cached version or fetch from network
        return response || fetch(event.request)
          .then((response) => {
            // Don't cache non-GET requests or non-successful responses
            if (event.request.method !== 'GET' || !response || response.status !== 200) {
              return response;
            }
            
            // Clone the response
            const responseToCache = response.clone();
            
            caches.open(CACHE_NAME)
              .then((cache) => {
                cache.put(event.request, responseToCache);
              });
            
            return response;
          })
          .catch(() => {
            // If fetch fails and it's a navigation request, return offline page
            if (event.request.mode === 'navigate') {
              return caches.match('/index.html');
            }
          });
      })
  );
});

// Background sync for offline data
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-health-data') {
    event.waitUntil(syncHealthData());
  }
});

async function syncHealthData() {
  // Sync health data when back online
  try {
    const storedData = await getStoredHealthData();
    if (storedData && storedData.length > 0) {
      // Send to server/database
      await sendHealthDataToServer(storedData);
      // Clear local storage after successful sync
      await clearStoredHealthData();
    }
  } catch (error) {
    console.error('Background sync failed:', error);
  }
}

async function getStoredHealthData() {
  // Get data from IndexedDB or localStorage
  return new Promise((resolve) => {
    const data = localStorage.getItem('offlineHealthData');
    resolve(data ? JSON.parse(data) : []);
  });
}

async function sendHealthDataToServer(data) {
  // Send data to Firebase or backend API
  // This would be implemented based on your backend
  console.log('Syncing health data:', data);
}

async function clearStoredHealthData() {
  localStorage.removeItem('offlineHealthData');
}

// Push notifications for alerts
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'Health Alert';
  const options = {
    body: data.body || 'Health monitoring alert',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    vibrate: [200, 100, 200],
    tag: 'health-alert',
    requireInteraction: true,
    data: data
  };
  
  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  event.waitUntil(
    clients.openWindow('/')
  );
});

