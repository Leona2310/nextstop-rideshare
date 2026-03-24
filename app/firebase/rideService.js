import {
  collection,
  doc,
  setDoc,
  updateDoc,
  getDoc,
  getDocs,
  query,
  where,
  serverTimestamp,
  runTransaction,
  Timestamp,
  increment,
} from 'firebase/firestore';
import { db, safeOnSnapshot } from './firebaseConfig';
import { getRouteBetweenCoords, getFixedSophiaPickup } from '../services/locationService';

// Simple validators
function ensureString(v, name) {
  if (!v || typeof v !== 'string') throw new Error(`${name} must be a non-empty string`);
}

function ensureUserId(id) {
  ensureString(id, 'userId');
}

function validateDestination(dest) {
  if (!dest || typeof dest !== 'object') throw new Error('destination required');
  if (!dest.name || typeof dest.name !== 'string') throw new Error('destination.name required');
  if (typeof dest.latitude !== 'number' || typeof dest.longitude !== 'number') throw new Error('destination latitude/longitude must be numbers');
}

function ensurePositiveInteger(v, name) {
  if (!Number.isInteger(v) || v <= 0) throw new Error(`${name} must be a positive integer`);
}

/**
 * Create a new ride document in `rides` collection.
 * expiresAt is set to now + 2 minutes (client-side computed to be exact)
 */
export async function createRide({ createdBy, destination, maxSeats = 4, fare = { total: 0, perPerson: 0 } }) {
  ensureUserId(createdBy);
  validateDestination(destination);
  ensurePositiveInteger(maxSeats, 'maxSeats');
  if (typeof fare !== 'object' || typeof fare.total !== 'number' || typeof fare.perPerson !== 'number') throw new Error('fare must be { total:number, perPerson:number }');

  const ridesCol = collection(db, 'rides');
  const rideRef = doc(ridesCol);

  const createdAt = serverTimestamp();
  const expiresAt = Timestamp.fromMillis(Date.now() + 2 * 60 * 1000);

  const rideDoc = {
    createdBy,
    pickup: 'Sophia College',
    destination: {
      name: destination.name,
      latitude: destination.latitude,
      longitude: destination.longitude,
    },
    status: 'OPEN',
    createdAt,
    expiresAt,
    passengers: [],
    maxSeats,
    currentSeats: 0,
    fare,
    driverId: null,
  };

  try {
    await setDoc(rideRef, rideDoc);
    return { rideId: rideRef.id };
  } catch (err) {
    throw new Error(`createRide failed: ${err.message}`);
  }
}

/**
 * Compatibility wrapper used by UI: createRideRequest(rideData) => rideId
 * Accepts the legacy shape used in the app and maps to createRide.
 */
export async function createRideRequest(rideData) {
  if (!rideData || !rideData.userId) throw new Error('userId required');

  // Map legacy UI shape to the schema expected by Firestore rules
  const rideRef = doc(collection(db, 'rides'));
  const now = serverTimestamp();
  const expiresAt = Timestamp.fromMillis(Date.now() + 2 * 60 * 1000);

  const rideDoc = {
    userId: rideData.userId,
    // Normalize pickupLocation to an object with coords when possible so routing works predictably
    pickupLocation: (rideData.pickupLocation && typeof rideData.pickupLocation === 'object' && rideData.pickupLocation.latitude != null && rideData.pickupLocation.longitude != null) ?
      { latitude: Number(rideData.pickupLocation.latitude), longitude: Number(rideData.pickupLocation.longitude), name: rideData.pickupLocation.name || 'Sophia College' } :
      rideData.pickupLocation || 'Sophia College',
    // Ensure dropLocation is an object when provided
    dropLocation: (rideData.dropLocation && typeof rideData.dropLocation === 'object' && rideData.dropLocation.latitude != null && rideData.dropLocation.longitude != null) ?
      { latitude: Number(rideData.dropLocation.latitude), longitude: Number(rideData.dropLocation.longitude), name: rideData.dropLocation.name || (rideData.destination && rideData.destination.name) || '' } :
      (rideData.dropLocation || rideData.destination || null),
    status: 'searching',
    driverId: null,
    createdAt: now,
    expiresAt,
    vehicleType: rideData.vehicleType || 'GO',
    estimatedPrice: typeof rideData.estimatedPrice === 'number' ? rideData.estimatedPrice : 0,
    tip: rideData.tip || 0,
    maxSeats: Number.isInteger(rideData.maxSeats) ? rideData.maxSeats : 4,
    currentSeats: 0,
    passengers: [],
    fare: rideData.fare || null,
  };

  try {
    await setDoc(rideRef, rideDoc);
      // Broadcast push notifications to users (frontend-side). This runs async and
      // intentionally does not block the ride creation. This requires Firestore
      // rules that allow reading `users` documents to fetch `pushToken` fields.
      (async () => {
        try {
          // dynamic import Firestore helpers to avoid circular top-level imports
          const { collection, query, where, getDocs } = await import('firebase/firestore');
          const { db } = await import('./firebaseConfig');
          const usersCol = collection(db, 'users');
          const q = query(usersCol, where('pushToken', '!=', null));
          const snaps = await getDocs(q);
          const tokens = [];
          snaps.forEach(d => {
            const data = d.data();
            if (data && data.pushToken) tokens.push(data.pushToken);
          });
          if (tokens.length > 0) {
            const ns = await import('./notificationsService');
            const title = 'New ride available';
            const body = (rideDoc.dropLocation && (rideDoc.dropLocation.name || rideDoc.dropLocation.address)) ? (rideDoc.dropLocation.name || rideDoc.dropLocation.address) : 'A new shared ride is available';
            try {
              await ns.sendPushNotifications(tokens, title, body, { rideId: rideRef.id });
            } catch (e) {
              console.warn('sendPushNotifications failed', e);
            }
          }
        } catch (e) {
          // Likely permission denied when reading users; log and continue
          console.warn('client-side ride broadcast failed', e);
        }
      })();
    // Dispatch offers to nearby active drivers so they see the request in real time
    (async () => {
      try {
        // determine pickup coords
        let pickupCoords = null;
        const p = rideDoc.pickupLocation;
        if (p && typeof p === 'object' && p.latitude != null && p.longitude != null) {
          pickupCoords = { latitude: Number(p.latitude), longitude: Number(p.longitude) };
        } else {
          const s = await getFixedSophiaPickup();
          if (s) pickupCoords = { latitude: s.latitude, longitude: s.longitude };
        }

        if (!pickupCoords) return; // cannot compute ETAs

        const activeDriversCol = collection(db, 'activeDrivers');
        const snaps = await getDocs(query(activeDriversCol));
        const candidates = [];
        for (const d of snaps.docs) {
          const data = d.data();
          const loc = data.location;
          if (!loc || loc.latitude == null || loc.longitude == null) continue;
          try {
            const route = await getRouteBetweenCoords({ latitude: loc.latitude, longitude: loc.longitude }, pickupCoords);
            candidates.push({ driverId: d.id, eta: route.durationMin || 0, distanceKm: route.distanceKm || 0 });
          } catch (e) {
            // ignore per-driver route failures
            console.warn('route compute failed for driver', d.id, e);
          }
        }

        // sort by ETA ascending and pick top 5
        candidates.sort((a, b) => (a.eta || 0) - (b.eta || 0));
        const top = candidates.slice(0, 5);
        const offersCol = collection(db, 'driver_offers');
        const offerExpires = Timestamp.fromMillis(Date.now() + 2 * 60 * 1000);
        for (const c of top) {
          const offerId = `${rideRef.id}_${c.driverId}`;
          try {
            await setDoc(doc(offersCol, offerId), {
              id: offerId,
              driverId: c.driverId,
              rideId: rideRef.id,
              status: 'sent',
              sentAt: serverTimestamp(),
              expiresAt: offerExpires,
              etaToPickup: c.eta,
              distanceToPickupKm: c.distanceKm,
              pickupLocation: rideDoc.pickupLocation,
              dropLocation: rideDoc.dropLocation,
              estimatedPrice: rideDoc.estimatedPrice || 0,
            });
          } catch (e) {
            console.warn('failed to create driver_offer', offerId, e);
          }
        }
      } catch (e) {
        console.warn('dispatching offers failed', e);
      }
    })();
    return rideRef.id;
  } catch (err) {
    throw new Error(`createRideRequest failed: ${err.message}`);
  }
}

/**
 * Join a ride with transaction to avoid overbooking.
 */
export async function joinRide(rideId, userId) {
  ensureString(rideId, 'rideId');
  ensureUserId(userId);

  // Call the admin Cloud Function to perform the join transaction with elevated privileges.
  try {
    const functionsUrl = `https://us-central1-nextstop-d8864.cloudfunctions.net/joinRide`;
    const res = await fetch(functionsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rideId, userId })
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`joinRide failed: ${res.status} ${text}`);
    }
    const json = await res.json();
    if (json && json.ok) return { success: true };
    throw new Error(`joinRide failed: ${JSON.stringify(json)}`);
  } catch (err) {
    throw new Error(`joinRide failed: ${err.message}`);
  }
}

/**
 * Leave a ride atomically.
 */
export async function leaveRide(rideId, userId) {
  ensureString(rideId, 'rideId');
  ensureUserId(userId);

  const rideRef = doc(db, 'rides', rideId);
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(rideRef);
      if (!snap.exists()) throw new Error('Ride not found');
      const data = snap.data();
      const existing = Array.isArray(data.passengers) ? data.passengers : [];
      if (!existing.some(p => p.userId === userId)) throw new Error('User not in ride');

      const updated = existing.filter(p => p.userId !== userId);
      tx.update(rideRef, { passengers: updated, currentSeats: increment(-1) });
    });
    return { success: true };
  } catch (err) {
    throw new Error(`leaveRide failed: ${err.message}`);
  }
}

/**
 * Lock a ride (assign driver) atomically.
 */
export async function lockRide(rideId, driverId) {
  ensureString(rideId, 'rideId');
  ensureUserId(driverId);

  const rideRef = doc(db, 'rides', rideId);
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(rideRef);
      if (!snap.exists()) throw new Error('Ride not found');
      const data = snap.data();
      if (data.status !== 'OPEN') throw new Error('Ride not open');
      tx.update(rideRef, { status: 'LOCKED', driverId });
    });
    return { success: true };
  } catch (err) {
    throw new Error(`lockRide failed: ${err.message}`);
  }
}

/**
 * Complete a ride (idempotent).
 */
export async function completeRide(rideId) {
  ensureString(rideId, 'rideId');
  const rideRef = doc(db, 'rides', rideId);
  try {
    await updateDoc(rideRef, { status: 'COMPLETED', completedAt: serverTimestamp() });
    return { success: true };
  } catch (err) {
    throw new Error(`completeRide failed: ${err.message}`);
  }
}

export async function markArrived(rideId) {
  ensureString(rideId, 'rideId');
  try {
    const rideRef = doc(db, 'rides', rideId);
    await updateDoc(rideRef, { status: 'ARRIVED', arrivedAt: serverTimestamp() });
    return { success: true };
  } catch (err) {
    throw new Error(`markArrived failed: ${err.message}`);
  }
}

export async function markPickedUp(rideId) {
  ensureString(rideId, 'rideId');
  try {
    const rideRef = doc(db, 'rides', rideId);
    await updateDoc(rideRef, { status: 'PICKED_UP', pickedUpAt: serverTimestamp() });
    return { success: true };
  } catch (err) {
    throw new Error(`markPickedUp failed: ${err.message}`);
  }
}

/**
 * Verify pickup OTP and start the ride when matched.
 * Both driver and passenger may call this, but OTP must match ride.pickupOTP and not be expired.
 */
export async function verifyPickupOTP(rideId, otp) {
  ensureString(rideId, 'rideId');
  ensureString(otp, 'otp');
  const rideRef = doc(db, 'rides', rideId);
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(rideRef);
      if (!snap.exists()) throw new Error('Ride not found');
      const data = snap.data();
  if (!data.pickupOTP) throw new Error('No OTP set for this ride');
  if (data.otpVerified) throw new Error('OTP already verified');
  // Only allow OTP verification once driver has marked arrived at pickup
  if (data.status !== 'ARRIVED') throw new Error('OTP may only be verified after driver marks arrived at pickup');
      const now = Timestamp.now();
      if (data.otpExpiresAt && data.otpExpiresAt.toMillis && data.otpExpiresAt.toMillis() < now.toMillis()) throw new Error('OTP expired');
      if (String(data.pickupOTP) !== String(otp)) throw new Error('Invalid OTP');

      // Mark OTP verified and start the ride
      tx.update(rideRef, { otpVerified: true, status: 'in_progress', startedAt: serverTimestamp() });
    });
    return { success: true };
  } catch (err) {
    throw new Error(`verifyPickupOTP failed: ${err.message}`);
  }
}

export async function getRide(rideId) {
  ensureString(rideId, 'rideId');
  try {
    const snap = await getDoc(doc(db, 'rides', rideId));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() };
  } catch (err) {
    console.error('getRide error', err);
    return null;
  }
}

export function onRideSnapshot(rideId, cb) {
  if (!rideId || typeof cb !== 'function') throw new Error('rideId and callback required');
  const rideRef = doc(db, 'rides', rideId);
  return safeOnSnapshot(rideRef, (snap) => cb(snap.exists() ? { id: snap.id, ...snap.data() } : null), (e) => { console.warn('ride snapshot error', e); cb(null); });
}

/**
 * Find an active (not completed/cancelled) ride for the given user.
 * Looks up both modern `userId` and legacy `createdBy` fields and returns the most recent matching ride.
 */
export async function getActiveRideForUser(userId) {
  ensureUserId(userId);
  try {
    const ridesCol = collection(db, 'rides');
    const q1 = query(ridesCol, where('userId', '==', userId));
    const q2 = query(ridesCol, where('createdBy', '==', userId));
    const [snap1, snap2] = await Promise.all([getDocs(q1), getDocs(q2)]);
    const map = new Map();
    const push = (d) => map.set(d.id, { id: d.id, ...d.data() });
    snap1.docs.forEach(push);
    snap2.docs.forEach(push);

    // Filter out completed/cancelled rides and pick the most recent by createdAt
    const candidates = Array.from(map.values()).filter(r => {
      const s = (r.status || '').toLowerCase();
      return s !== 'completed' && s !== 'cancelled' && s !== 'closed';
    });
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => {
      const ta = a.createdAt && typeof a.createdAt.toMillis === 'function' ? a.createdAt.toMillis() : (a.createdAt ? (new Date(a.createdAt)).getTime() : 0);
      const tb = b.createdAt && typeof b.createdAt.toMillis === 'function' ? b.createdAt.toMillis() : (b.createdAt ? (new Date(b.createdAt)).getTime() : 0);
      return (tb || 0) - (ta || 0);
    });
    return candidates[0] || null;
  } catch (err) {
    console.warn('getActiveRideForUser failed', err);
    return null;
  }
}

// Default & CommonJS-compatible export for modules that `require` or import default
const exported = {
  createRide,
  createRideRequest,
  joinRide,
  leaveRide,
  lockRide,
  completeRide,
  verifyPickupOTP,
  getRide,
  onRideSnapshot,
  markArrived,
  markPickedUp,
  getActiveRideForUser,
};

export default exported;
// Provide CommonJS fallback if module.exports is present (helps some bundlers)
if (typeof module !== 'undefined' && module.exports) module.exports = exported;

