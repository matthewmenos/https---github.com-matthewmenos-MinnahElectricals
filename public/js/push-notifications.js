// Push Notifications Client
// Handles web push notification subscription and display

let registration = null;
let subscription = null;

// VAPID public key (will be provided by server)
let vapidPublicKey = null;

/**
 * Initialize push notifications
 */
async function initPushNotifications() {
  // Check if push notifications are supported
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.log('⚠️ Push notifications not supported in this browser');
    return false;
  }

  try {
    // Get VAPID public key from server
    const response = await fetch('/api/push/vapid-key');
    const data = await response.json();
    if (data.success && data.publicKey) {
      vapidPublicKey = data.publicKey;
    } else {
      console.log('⚠️ Push notifications not configured on server');
      return false;
    }

    // Register service worker
    registration = await navigator.serviceWorker.register('/sw.js');
    console.log('✓ Service worker registered for push notifications');

    // Check for existing subscription
    subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      // Request permission
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        console.log('⚠️ Push notification permission denied');
        return false;
      }

      // Create subscription
      const convertedVapidKey = urlBase64ToUint8Array(vapidPublicKey);
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: convertedVapidKey
      });

      // Send subscription to server
      await saveSubscription(subscription);
      console.log('✓ Push notification subscription created');
    }

    return true;
  } catch (error) {
    console.error('✗ Push notification initialization failed:', error);
    return false;
  }
}

/**
 * Save subscription to server
 */
async function saveSubscription(sub) {
  try {
    const sessionId = getSessionId();
    const response = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        session_id: sessionId,
        endpoint: sub.endpoint,
        keys: JSON.stringify(sub.getKey ? {
          p256dh: sub.getKey('p256dh') ? btoa(String.fromCharCode(...new Uint8Array(sub.getKey('p256dh')))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '') : '',
          auth: sub.getKey('auth') ? btoa(String.fromCharCode(...new Uint8Array(sub.getKey('auth')))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '') : ''
        } : {})
      })
    });

    const data = await response.json();
    if (data.success) {
      console.log('✓ Push subscription saved to server');
    }
  } catch (error) {
    console.error('✗ Failed to save push subscription:', error);
  }
}

/**
 * Get or create session ID
 */
function getSessionId() {
  let sessionId = localStorage.getItem('sessionId');
  if (!sessionId) {
    sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substring(2, 15);
    localStorage.setItem('sessionId', sessionId);
  }
  return sessionId;
}

/**
 * Convert base64 string to Uint8Array
 */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
}

/**
 * Show a local notification (fallback for browsers that don't support push)
 */
function showLocalNotification(title, options) {
  if (!('Notification' in window)) {
    console.log('⚠️ Notifications not supported');
    return;
  }

  if (Notification.permission === 'granted') {
    new Notification(title, options);
  } else if (Notification.permission !== 'denied') {
    Notification.requestPermission().then(permission => {
      if (permission === 'granted') {
        new Notification(title, options);
      }
    });
  }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  // Only initialize on pages where we want push notifications
  // (public pages, not admin pages)
  if (!window.location.pathname.includes('/admin/')) {
    initPushNotifications();
  }
});

// Export for use in other scripts
window.PushNotifications = {
  init: initPushNotifications,
  showLocal: showLocalNotification,
  getSessionId: getSessionId
};
