import { doc, runTransaction, arrayUnion, increment } from 'firebase/firestore';
import { db } from './firebaseConfig';

// Map vehicle type keys to capacity when maxSeats not provided on the ride doc
const VEHICLE_CAPACITY = {
  GO: 4,
  SEDAN: 4,
  XL: 6,
};

/**
 * Client-side joinRide using Firestore transaction (Firebase v9 modular SDK).
 * Validates seat availability and vehicle capacity (4/6 seater) before joining.
 * Adds userId to passengers array using arrayUnion and increments currentSeats.
 *
 * @param {string} rideId
 * @param {string} userId
 * @returns {Promise<{success: true}>}
 */
export async function joinRide(rideId, userId) {
  if (!rideId || typeof rideId !== 'string') throw new Error('rideId is required and must be a string');
  if (!userId || typeof userId !== 'string') throw new Error('userId is required and must be a string');

  const rideRef = doc(db, 'rides', rideId);

  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(rideRef);
      if (!snap.exists()) throw new Error('Ride not found');

      const data = snap.data() || {};
      const currentSeats = Number(data.currentSeats || 0);

      // Prefer explicit maxSeats if present, otherwise infer from vehicleType
      let maxSeats = null;
      if (data.maxSeats != null) {
        maxSeats = Number(data.maxSeats);
      } else if (data.vehicleType) {
        const key = String(data.vehicleType).toUpperCase();
        maxSeats = VEHICLE_CAPACITY[key] || 4;
      } else {
        maxSeats = 4; // sensible default
      }

      const passengers = Array.isArray(data.passengers) ? data.passengers : [];

      // Check if user already joined (support both string and object passenger shapes)
      const alreadyJoined = passengers.some((p) => {
        if (!p) return false;
        if (typeof p === 'string') return p === userId;
        if (typeof p === 'object' && p.userId) return String(p.userId) === userId;
        return false;
      });

      if (alreadyJoined) throw new Error('User already joined this ride');
      if (currentSeats >= maxSeats) throw new Error('No seats available');

      // Perform atomic updates: add userId to passengers and increment seats
      tx.update(rideRef, {
        passengers: arrayUnion(userId),
        currentSeats: increment(1),
      });
    });

    return { success: true };
  } catch (err) {
    // Normalize and rethrow
    throw new Error(`joinRide failed: ${err?.message || err}`);
  }
}

export default { joinRide };
