import { addDoc, collection, doc, increment, onSnapshot, query, runTransaction, where } from 'firebase/firestore';
import { db } from './firebaseConfig';

/**
 * Subscribe to rides collection and call callback with mapped rides array
 * @param {(rides: Array)} callback
 * @returns {Function} unsubscribe
 */
export function subscribeToRides(callback) {
  const ridesCol = collection(db, 'rides');
  // Only subscribe to rides that allow passengers and have not expired
  const ridesQuery = query(
    ridesCol,
    where('allowPassengers', '==', true),
    where('expiresAt', '>', new Date())
  );
  const unsub = onSnapshot(ridesQuery, (snap) => {
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    callback(items);
  });
  return unsub;
}

/**
 * Join a ride by adding userId to joinedUsers array
 * @param {string} rideId
 * @param {string} userId
 */
export async function joinRide(rideId, userId) {
  if (!rideId || !userId) throw new Error('rideId and userId are required');
  const rideRef = doc(db, 'rides', rideId);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(rideRef);
    if (!snap.exists()) throw new Error('Ride not found');
    const data = snap.data();

    // Expiration check
    if (data.expiresAt && typeof data.expiresAt.toMillis === 'function') {
      if (data.expiresAt.toMillis() <= Date.now()) throw new Error('Ride expired');
    }

    if (data.allowPassengers === false) throw new Error('Solo ride');

    // driver is not allowed to join
    if (data.driverId && String(data.driverId) === String(userId)) throw new Error('Driver cannot join as passenger');

    const joined = Array.isArray(data.joinedUsers) ? data.joinedUsers : (Array.isArray(data.passengers) ? data.passengers : []);
    const totalSeats = Number.isInteger(data.totalSeats) ? data.totalSeats : (data.maxSeats || 4);
    const currentCount = joined.length;

    if (joined.includes(userId)) return; // already joined

    if (currentCount >= totalSeats) throw new Error('Ride full');

    // Update both legacy `passengers` and new `joinedUsers` for compatibility (explicit arrays)
    const newJoinedUsers = Array.isArray(data.joinedUsers) ? [...data.joinedUsers, userId] : [...(Array.isArray(data.passengers) ? data.passengers : []), userId];
    const newPassengers = Array.isArray(data.passengers) ? [...data.passengers, userId] : newJoinedUsers;

    tx.update(rideRef, {
      joinedUsers: newJoinedUsers,
      passengers: newPassengers,
      currentSeats: increment(1),
    });
  });
}

export async function leaveRide(rideId, userId) {
  if (!rideId || !userId) throw new Error('rideId and userId are required');
  const rideRef = doc(db, 'rides', rideId);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(rideRef);
    if (!snap.exists()) throw new Error('Ride not found');
    const data = snap.data();

    const joined = Array.isArray(data.joinedUsers) ? data.joinedUsers : (Array.isArray(data.passengers) ? data.passengers : []);
    if (!joined.includes(userId)) throw new Error('User not in ride');

    const updatedJoined = joined.filter(p => p !== userId);
    const updatedPassengers = Array.isArray(data.passengers) ? data.passengers.filter(p => p !== userId) : updatedJoined;

    tx.update(rideRef, {
      joinedUsers: updatedJoined,
      passengers: updatedPassengers,
      currentSeats: increment(-1),
    });
  });
}

/**
 * Optional helper to create a ride document
 */
export async function createRide(rideData) {
  const col = collection(db, 'rides');
  const docRef = await addDoc(col, rideData);
  return docRef.id;
}

export default { subscribeToRides, joinRide, createRide };
