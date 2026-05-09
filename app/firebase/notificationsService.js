import { doc, setDoc } from 'firebase/firestore';
import { db } from './firebaseConfig';

/**
 * Request notification permissions, obtain Expo push token, store it in Firestore
 * under users/{userId}.pushToken and return the token.
 *
 * @param {string} userId - Firebase Auth UID of the user
 * @returns {Promise<string>} - the Expo push token
 */
export async function registerForPushNotificationsAsync(userId) {
  if (!userId || typeof userId !== 'string') throw new Error('userId is required and must be a string');

  try {
    // Dynamically import expo modules to avoid bundler errors when not installed
    let Notifications, Device;
    try {
      Notifications = await import('expo-notifications');
      Device = await import('expo-device');
    } catch (importErr) {
      // Provide a clear, actionable error instead of the opaque "Cannot find module"
      throw new Error('Missing native Expo modules. Please install and rebuild: run `expo install expo-notifications expo-device` and rebuild the app on a physical device. (Original error: ' + (importErr?.message || String(importErr)) + ')');
    }

    // Must be a physical device
    if (!Device.isDevice) {
      throw new Error('Must use physical device for Push Notifications (simulator/emulator not supported)');
    }

    // Check existing permissions
    const existing = await Notifications.getPermissionsAsync();
    let finalStatus = existing.status;

    // Request if not granted
    if (finalStatus !== 'granted') {
      const requested = await Notifications.requestPermissionsAsync();
      finalStatus = requested.status;
    }

    if (finalStatus !== 'granted') {
      throw new Error('Notification permissions not granted');
    }

  // Get the Expo push token
  const tokenObject = await Notifications.getExpoPushTokenAsync();
  const token = tokenObject?.data;
  if (!token) throw new Error('Failed to obtain Expo push token');

  // Save to Firestore under users/{userId}.pushToken and users/{userId}.expoPushToken (merge so we don't overwrite other fields)
  // Do NOT write tokens into `users` collection anymore. Persist tokens only to
  // the lightweight `publicPushTokens` collection to avoid exposing user profiles.

  // Persist token to a lightweight public collection so clients can read tokens
  // for broadcasting without exposing full user profiles. This collection holds only
  // the token and is intended to be readable by authenticated users per rules.
  const tokenRef = doc(db, 'publicPushTokens', userId);
  await setDoc(tokenRef, { token }, { merge: true });

    return token;
  } catch (err) {
    // Surface a clear error for callers
    throw new Error(`registerForPushNotificationsAsync failed: ${err?.message || err}`);
  }
}

export default { registerForPushNotificationsAsync };

/**
 * Save an arbitrary public push token to the publicPushTokens collection.
 * This can be used before user login to persist a device token for broadcasts.
 */
export async function savePublicPushToken(token) {
  if (!token || typeof token !== 'string') throw new Error('token is required');
  try {
    const { doc, setDoc } = await import('firebase/firestore');
    const { db } = await import('./firebaseConfig');
    const tokenRef = doc(db, 'publicPushTokens', token);
    await setDoc(tokenRef, { token }, { merge: true });
    return { ok: true };
  } catch (e) {
    console.warn('savePublicPushToken failed', e);
    return { ok: false, error: e?.message || String(e) };
  }
}

/**
 * Send push notifications via Expo push API.
 * @param {string[]} pushTokens - array of Expo push tokens
 * @param {string} title - notification title
 * @param {string} body - notification body
 * @param {object} [data] - optional data payload
 * @returns {Promise<object[]>} - array of response objects per batch
 */
export async function sendPushNotifications(pushTokens, title, body, data = {}) {
  if (!Array.isArray(pushTokens) || pushTokens.length === 0) throw new Error('pushTokens must be a non-empty array');
  if (!title || !body) throw new Error('title and body are required');

  // Expo recommends batching up to 100 messages per request
  const CHUNK_SIZE = 100;
  const chunks = [];
  for (let i = 0; i < pushTokens.length; i += CHUNK_SIZE) {
    chunks.push(pushTokens.slice(i, i + CHUNK_SIZE));
  }

  const results = [];

  for (const chunk of chunks) {
    const messages = chunk.map(token => ({
      to: token,
      title,
      body,
      data,
      sound: 'default',
    }));

    try {
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messages),
      });

      if (!res.ok) {
        const text = await res.text();
        console.warn('Expo push send failed:', res.status, text);
        // mark each token in this chunk as failed
        for (const token of chunk) results.push({ token, ok: false, status: res.status, body: text });
        continue;
      }

      const json = await res.json();
      // json should contain an array of tickets in the same order as messages
      const tickets = Array.isArray(json) ? json : (json.data || json);
      for (let i = 0; i < chunk.length; i++) {
        const token = chunk[i];
        const ticket = tickets && tickets[i] ? tickets[i] : null;
        results.push({ token, ok: !!ticket, ticket });
      }
    } catch (err) {
      console.warn('sendPushNotifications error', err);
      for (const token of chunk) results.push({ token, ok: false, error: err?.message || String(err) });
    }
  }

  return results;
}

// Add to default export for convenience
Object.assign(module.exports, { sendPushNotifications });

/**
 * Broadcast a notification to all users that have a pushToken.
 * Tries a safe indexed query first, then falls back to scanning the `users` collection
 * when the query or permissions fail. Returns the per-token send results.
 */
export async function broadcastToAllUsers(title, body, data = {}) {
  try {
    const tokens = [];
    try {
      // Prefer reading a lightweight publicPushTokens collection which only stores tokens.
      const { collection, getDocs } = await import('firebase/firestore');
      const { db } = await import('./firebaseConfig');
      const tokensCol = collection(db, 'publicPushTokens');
      const snaps = await getDocs(tokensCol);
      snaps.forEach(d => {
        const dataObj = d.data();
        if (dataObj && dataObj.token) tokens.push(dataObj.token);
      });
    } catch (qErr) {
      // If reading publicPushTokens fails (rules or missing collection), fallback to scanning users
      console.warn('publicPushTokens read failed, falling back to users scan', qErr?.message || qErr);
      const { collection, getDocs } = await import('firebase/firestore');
      const { db } = await import('./firebaseConfig');
      const usersCol = collection(db, 'users');
      const snaps = await getDocs(usersCol);
      snaps.forEach(d => {
        const dataObj = d.data();
        if (dataObj && dataObj.pushToken) tokens.push(dataObj.pushToken);
      });
    }

    if (!tokens.length) {
      console.warn('broadcastToAllUsers: no push tokens found');
      return { ok: false, reason: 'no_tokens' };
    }

    const results = await sendPushNotifications(tokens, title, body, data);
    return { ok: true, results };
  } catch (err) {
    // Detect Firestore permission errors and return a clear diagnostic so the app
    // can surface actionable guidance instead of a generic warn.
    const msg = err?.message || String(err);
    console.warn('broadcastToAllUsers failed', err);
    if (msg && msg.toLowerCase().includes('missing or insufficient permissions')) {
      return {
        ok: false,
        reason: 'permission_denied',
        error: 'Missing or insufficient permissions when reading push token collection. Update and deploy Firestore rules to allow authenticated reads of publicPushTokens.',
        hint: 'Run `firebase deploy --only firestore:rules` or update rules in the Firebase Console to allow `read` on /publicPushTokens for authenticated users.'
      };
    }

    return { ok: false, error: msg };
  }
}

Object.assign(module.exports, { broadcastToAllUsers });
