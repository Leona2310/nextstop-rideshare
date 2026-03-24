import {
  doc,
  setDoc,
  deleteDoc,
  getDoc,
  collection,
  query,
  where,
  serverTimestamp,
  GeoPoint,
  updateDoc,
} from 'firebase/firestore';
import { auth, db, safeOnSnapshot } from './firebaseConfig';
import { getRouteBetweenCoords } from '../services/locationService';

// Helper: wait for auth.currentUser to become available or timeout
export async function waitForAuthReady(timeoutMs = 5000) {
  // Prefer using onAuthStateChanged which is more reliable than polling
  return new Promise((resolve) => {
    try {
      if (auth && auth.currentUser) return resolve(auth.currentUser);
      const unsubscribe = auth.onAuthStateChanged((user) => {
        if (user) {
          try { unsubscribe(); } catch (e) {}
          resolve(user);
        }
      });
      // fallback timeout
      setTimeout(() => {
        try { unsubscribe(); } catch (e) {}
        resolve(null);
      }, timeoutMs);
    } catch (e) {
      // if auth doesn't support onAuthStateChanged for some reason, fallback to polling
      const start = Date.now();
      (async function poll() {
        while (Date.now() - start < timeoutMs) {
          if (auth && auth.currentUser) return resolve(auth.currentUser);
          await new Promise((r) => setTimeout(r, 200));
        }
        resolve(null);
      })();
    }
  });
}

/**
 * Update driver's location in Firestore
 * @param {Object} location - {latitude, longitude, speed, heading}
 * @param {string} currentRideId - Current active ride ID or null
 * @param {boolean} isAvailable - Whether driver is available for new rides
 */
export async function updateDriverLocation(location, currentRideId = null, isAvailable = true) {
  try {
    const user = auth.currentUser || (await waitForAuthReady(10000));
    if (!user) {
      // Do not throw — callers may be running before auth is ready (background tasks). Log and return false.
      console.warn('updateDriverLocation: user not authenticated after waiting — skipping location update');
      return false;
    }

    const driverRef = doc(db, 'activeDrivers', user.uid);
    await setDoc(
      driverRef,
      {
        driverId: user.uid,
        location: new GeoPoint(location.latitude, location.longitude),
        speed: location.speed || 0,
        heading: location.heading || 0,
        isAvailable,
        currentRideId,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

      // Also mirror minimal live location into drivers collection so passengers can fetch profile+location in one read
      try {
        const driversDocRef = doc(db, 'drivers', user.uid);
        await setDoc(driversDocRef, {
          liveLocation: {
            latitude: location.latitude,
            longitude: location.longitude,
            speed: location.speed || 0,
            heading: location.heading || 0,
            updatedAt: serverTimestamp(),
          },
          currentRideId: currentRideId || null,
          isAvailable,
        }, { merge: true });
      } catch (e) {
        console.warn('Failed to mirror live location into drivers collection', e);
      }

    // If driver is on a ride (accepted) and a currentRideId is provided, compute ETA+route
    if (currentRideId) {
      try {
        // Fetch ride doc to get pickup coords
        const rideRef = doc(db, 'rides', currentRideId);
        const rideSnap = await getDoc(rideRef);
        if (rideSnap.exists()) {
          const ride = rideSnap.data();
          // Decide whether to route to pickup or to drop depending on ride status
          if (ride.status === 'accepted' && ride.driverId === user.uid) {
            const pickup = ride.pickupLocation;
            if (pickup && pickup.latitude != null && pickup.longitude != null) {
              const route = await getRouteBetweenCoords(
                { latitude: location.latitude, longitude: location.longitude },
                { latitude: pickup.latitude, longitude: pickup.longitude }
              );
              await updateDoc(rideRef, {
                driverETA: route.durationMin,
                driverDistanceKm: route.distanceKm,
                driverRoute: route.coordinates,
                driverLastSeenAt: serverTimestamp(),
                driverId: user.uid,
              });
            }
          } else if (ride.status === 'in_progress' && ride.driverId === user.uid) {
            const drop = ride.dropLocation;
            if (drop && drop.latitude != null && drop.longitude != null) {
              const route = await getRouteBetweenCoords(
                { latitude: location.latitude, longitude: location.longitude },
                { latitude: drop.latitude, longitude: drop.longitude }
              );
              await updateDoc(rideRef, {
                driverETA: route.durationMin,
                driverDistanceKm: route.distanceKm,
                driverRoute: route.coordinates,
                driverLastSeenAt: serverTimestamp(),
                driverId: user.uid,
              });
            }
          }
        }
      } catch (err) {
        console.warn('Failed computing route/ETA for ride:', err);
      }
    }
    return true;
  } catch (error) {
    console.error('Error updating driver location:', error);
    // Provide a friendlier message for common permission errors
    if (error?.code === 'permission-denied' || /permission/i.test(error?.message || '')) {
      throw new Error('Permission denied when updating driver location — check Firestore rules and authentication state.');
    }
    throw error;
  }
}

/**
 * Mark driver as offline (remove from activeDrivers)
 */
export async function goOffline() {
  try {
    const user = auth.currentUser;
    if (!user) return;

    const driverRef = doc(db, 'activeDrivers', user.uid);
    await deleteDoc(driverRef);
    
    return true;
  } catch (error) {
    console.error('Error going offline:', error);
    throw error;
  }
}

/**
 * Subscribe to all active drivers' locations
 * @param {Function} callback - Called with array of active drivers
 * @param {Object} filters - Optional filters {isAvailable, genderPreference}
 * @returns {Function} unsubscribe function
 */
export function subscribeToActiveDrivers(callback, filters = {}) {
  let unsubscribe = () => {};
  let cancelled = false;

  (async () => {
    const user = await waitForAuthReady(5000);
    if (cancelled) return;
    if (!user) {
      console.warn('subscribeToActiveDrivers: no authenticated user, returning empty list');
      callback([]);
      return;
    }

    try {
      let q = collection(db, 'activeDrivers');
      const constraints = [];
      if (filters.isAvailable !== undefined) constraints.push(where('isAvailable', '==', filters.isAvailable));
      q = constraints.length > 0 ? query(q, ...constraints) : query(q);

  unsubscribe = safeOnSnapshot(
        q,
        (snapshot) => {
          const drivers = snapshot.docs.map((doc) => {
            const data = doc.data();
            return {
              id: doc.id,
              driverId: data.driverId,
              latitude: data.location?.latitude || 0,
              longitude: data.location?.longitude || 0,
              speed: data.speed || 0,
              heading: data.heading || 0,
              isAvailable: data.isAvailable,
              currentRideId: data.currentRideId,
              updatedAt: data.updatedAt,
            };
          });
          callback(drivers);
        },
        (error) => {
          console.error('Error subscribing to active drivers:', error);
          callback([]);
        }
      );
    } catch (error) {
      console.error('Error setting up driver subscription:', error);
      callback([]);
    }
  })();

  return () => {
    cancelled = true;
    try {
      unsubscribe();
    } catch (e) {}
  };
}

/**
 * Subscribe to a specific driver's location
 * @param {string} driverId 
 * @param {Function} callback 
 * @returns {Function} unsubscribe function
 */
export function subscribeToDriverLocation(driverId, callback) {
  let unsubscribe = () => {};
  let cancelled = false;

  (async () => {
    const user = await waitForAuthReady(5000);
    if (cancelled) return;
    if (!user) {
      console.warn('subscribeToDriverLocation: no authenticated user');
      callback(null);
      return;
    }

    try {
      const driverRef = doc(db, 'activeDrivers', driverId);
  unsubscribe = safeOnSnapshot(
        driverRef,
        (snapshot) => {
          if (snapshot.exists()) {
            const data = snapshot.data();
            callback({
              id: snapshot.id,
              driverId: data.driverId,
              latitude: data.location?.latitude || 0,
              longitude: data.location?.longitude || 0,
              speed: data.speed || 0,
              heading: data.heading || 0,
              isAvailable: data.isAvailable,
              currentRideId: data.currentRideId,
              updatedAt: data.updatedAt,
            });
          } else {
            callback(null);
          }
        },
        (error) => {
          console.error('Error subscribing to driver location:', error);
          callback(null);
        }
      );
    } catch (error) {
      console.error('Error setting up driver location subscription:', error);
      callback(null);
    }
  })();

  return () => {
    cancelled = true;
    try {
      unsubscribe();
    } catch (e) {}
  };
}

/**
 * Get driver's profile data including name and rating
 * @param {string} driverId 
 * @returns {Promise<Object>}
 */
export async function getDriverProfile(driverId) {
  try {
    const userRef = doc(db, 'users', driverId);
    const snapshot = await getDoc(userRef);
    
    if (snapshot.exists()) {
      const data = snapshot.data();
      return {
        id: driverId,
        name: data.name || 'Unknown',
        phone: data.phone || '',
        trustBadge: data.trustBadge || false,
        vehicleNumber: data.vehicleNumber || '',
        vehicleModel: data.vehicleModel || '',
      };
    }
    return null;
  } catch (error) {
    console.error('Error getting driver profile:', error);
    return null;
  }
}
