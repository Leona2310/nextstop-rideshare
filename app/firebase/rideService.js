import {
    collection,
    doc,
    getDoc,
    getDocs,
    query,
    runTransaction,
    serverTimestamp,
    setDoc,
    Timestamp,
    updateDoc,
    where
} from "firebase/firestore";

import { auth, db } from "./firebaseConfig";
import { sendOffers } from "./offerManager";


/* ================= CREATE RIDE ================= */

export async function createRideRequest(rideData) {
  if (!rideData?.userId) throw new Error("userId required");

  // Ensure caller is authenticated and matches provided userId to satisfy Firestore rules
  const current = auth && auth.currentUser ? auth.currentUser.uid : null;
  if (!current) throw new Error('Not authenticated: please sign in before creating a ride');
  if (String(current) !== String(rideData.userId)) throw new Error('Authenticated user mismatch: provided userId does not match current user');

  const rideRef = doc(collection(db, "rides"));

  const rideDoc = {
    userId: rideData.userId,
    driverId: null,

    status: "SEARCHING",
    createdAt: serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + 2 * 60 * 1000),

    allowPassengers: rideData.allowPassengers ?? true,

    carType: rideData.vehicleType === "XL" ? "suv" : "sedan",
    totalSeats: rideData.vehicleType === "XL" ? 6 : 4,

    passengers: [rideData.userId],
    currentSeats: 1,
  };

  // attach provided locations, vehicle type, estimates and tip so downstream listeners and offerManager can use them
  if (rideData.pickupLocation) rideDoc.pickupLocation = rideData.pickupLocation;
  if (rideData.dropLocation) rideDoc.dropLocation = rideData.dropLocation;
  if (rideData.vehicleType) rideDoc.vehicleType = rideData.vehicleType;
  if (typeof rideData.estimatedPrice !== 'undefined') rideDoc.estimatedPrice = rideData.estimatedPrice;
  if (typeof rideData.tip !== 'undefined') rideDoc.tip = rideData.tip;
  if (typeof rideData.distanceKm !== 'undefined') rideDoc.distanceKm = rideData.distanceKm;

  await setDoc(rideRef, rideDoc);

  const rideId = rideRef.id;
  console.log('RIDE CREATED:', rideId, rideData);
  console.log('ALLOW PASSENGERS:', rideDoc.allowPassengers);
  // Immediately send offers for both solo and shared rides so drivers receive requests right away
  try {
    console.log('CALLING sendOffers for ride (immediate):', rideId);
    const result = await sendOffers(rideId);
    console.log('sendOffers result for ride', rideId, result && result.diagnostics ? result.diagnostics : result);
  } catch (e) {
    console.warn('sendOffers failed for ride', rideId, e);
  }
  // Mark offersSent only for non-shared rides to allow shared rides to receive more offers later
  try {
    if (!rideDoc.allowPassengers) await updateDoc(rideRef, { offersSent: true });
  } catch (e) {
    console.warn('Failed to mark offersSent on ride', rideId, e);
  }
  return rideId;

}

/* ================= JOIN RIDE ================= */

export async function joinRide(rideId, userId) {
  const rideRef = doc(db, "rides", rideId);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(rideRef);
    if (!snap.exists()) throw new Error("Ride not found");

    const data = snap.data();

    // Expiration check - prevent joining expired rides
    if (data.expiresAt && typeof data.expiresAt.toMillis === 'function') {
      if (data.expiresAt.toMillis() <= Date.now()) throw new Error('Ride expired');
    }

    if (!data.allowPassengers) throw new Error("Solo ride");

    // driver cannot join as passenger
    if (data.driverId && String(data.driverId) === String(userId)) throw new Error('Driver cannot join as passenger');

    const passengers = Array.isArray(data.passengers) ? data.passengers : [];

    if (passengers.includes(userId)) return; // already joined

    const totalSeats = Number.isInteger(data.totalSeats) ? data.totalSeats : (data.maxSeats || 4);
    const currentSeats = Number.isInteger(data.currentSeats) ? data.currentSeats : passengers.length;

    if (currentSeats >= totalSeats) throw new Error("Ride full");

    tx.update(rideRef, {
      passengers: [...passengers, userId],
      currentSeats: currentSeats + 1,
    });
  });
}

/* ================= LEAVE RIDE (FIXED) ================= */

export async function leaveRide(rideId, userId) {
  const rideRef = doc(db, "rides", rideId);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(rideRef);
    if (!snap.exists()) throw new Error("Ride not found");

    const data = snap.data();

    const passengers = data.passengers || [];

    if (!passengers.includes(userId)) {
      throw new Error("Not in ride");
    }

    const updatedPassengers = passengers.filter((p) => p !== userId);

    tx.update(rideRef, {
      passengers: updatedPassengers,
      currentSeats: Math.max((data.currentSeats || 1) - 1, 0),
    });
  });
}

/* ================= GET RIDES (ONLY SHARED) ================= */

export async function getAvailableRides() {
  // Only include rides that allow passengers and have not yet expired
  const q = query(
    collection(db, "rides"),
    where("allowPassengers", "==", true),
    where('expiresAt', '>', new Date())
  );

  const snapshot = await getDocs(q);

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));
}

/* ================= GET SINGLE RIDE ================= */

export async function getRide(rideId) {
  const snap = await getDoc(doc(db, "rides", rideId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/**
 * Mark ride as ARRIVED by the driver.
 * This is a single update so the frontend can call it directly.
 */
export async function markArrived(rideId) {
  if (!rideId) throw new Error('rideId required');
  const rideRef = doc(db, 'rides', rideId);
  // Simple update: driver client should have permission per rules
  await updateDoc(rideRef, { status: 'ARRIVED' });
}

/**
 * Verify pickup OTP and start the trip (ONGOING).
 * This runs in a transaction to ensure OTP matches and status transitions.
 */
export async function verifyPickupOTP(rideId, otp) {
  if (!rideId) throw new Error('rideId required');
  if (!otp) throw new Error('otp required');
  const rideRef = doc(db, 'rides', rideId);
  return await runTransaction(db, async (tx) => {
    const snap = await tx.get(rideRef);
    if (!snap.exists()) throw new Error('Ride not found');
    const data = snap.data();
    if (String(data.status || '').toUpperCase() !== 'ARRIVED') throw new Error('Ride not in ARRIVED state');
    if (!data.otp) throw new Error('No OTP set');
    if (String(data.otp) !== String(otp)) throw new Error('Invalid OTP');
    tx.update(rideRef, { status: 'ONGOING', otpVerified: true, startedAt: serverTimestamp() });
    return { ok: true };
  });
}

/**
 * Complete the ride. Marks status COMPLETED and sets completedAt.
 */
export async function completeRide(rideId) {
  if (!rideId) throw new Error('rideId required');
  const rideRef = doc(db, 'rides', rideId);
  await updateDoc(rideRef, { status: 'COMPLETED', completedAt: serverTimestamp() });
}

/**
 * Cancel a ride by the owner. Only the creator (userId) may cancel.
 */
export async function cancelRide(rideId, userId) {
  if (!rideId || !userId) throw new Error('rideId and userId are required');
  const rideRef = doc(db, 'rides', rideId);
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(rideRef);
      if (!snap.exists()) throw new Error('Ride not found');
      const data = snap.data();
      if (String(data.userId || data.createdBy) !== String(userId)) throw new Error('Only the ride owner may cancel');
      tx.update(rideRef, { status: 'cancelled', cancelledAt: serverTimestamp() });
    });
    return { success: true };
  } catch (err) {
    throw new Error(`cancelRide failed: ${err.message}`);
  }
}