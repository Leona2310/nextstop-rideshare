import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where, serverTimestamp } from 'firebase/firestore';
import { auth, db } from './firebaseConfig';

/**
 * Create driver profile (pending approval)
 * @param {Object} driverData - {name, email, phone, vehicleNumber, vehicleModel, licenseNumber}
 */
export async function createDriverProfile(driverData) {
  try {
    const user = auth.currentUser;
    if (!user) throw new Error('Not authenticated');

    const driverRef = doc(db, 'drivers', user.uid);
    await setDoc(driverRef, {
      uid: user.uid,
      email: user.email,
      name: driverData.name,
      phone: driverData.phone || '',
      vehicleNumber: driverData.vehicleNumber || '',
      vehicleModel: driverData.vehicleModel || '',
      licenseNumber: driverData.licenseNumber || '',
      role: 'driver',
      status: 'pending', // pending, approved, rejected
      trustBadge: false,
      createdAt: new Date(),
      approvedAt: null,
      approvedBy: null,
    });

    // Notify backend/admin about new driver application (best-effort)
    try {
      const notifyUrl = (global?.BACKEND_URL || 'http://localhost:3000') + '/admin/notify-driver';
      fetch(notifyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid: user.uid,
          name: driverData.name,
          email: user.email,
          phone: driverData.phone
        })
      }).catch(e => console.warn('notify admin failed', e));
    } catch (e) {
      console.warn('notify admin error', e);
    }

    return true;
  } catch (error) {
    console.error('Error creating driver profile:', error);
    throw error;
  }
}

/**
 * Get driver profile
 * @param {string} uid - Driver UID
 */
export async function getDriverProfile(uid = null) {
  try {
    const userId = uid || auth.currentUser?.uid;
    if (!userId) throw new Error('Not authenticated');

    const driverRef = doc(db, 'drivers', userId);
    const snapshot = await getDoc(driverRef);

    if (snapshot.exists()) {
      return { id: snapshot.id, ...snapshot.data() };
    }
    return null;
  } catch (error) {
    console.error('Error getting driver profile:', error);
    return null;
  }
}

/**
 * Check if driver is approved
 * @param {string} uid - Driver UID
 */
export async function isDriverApproved(uid = null) {
  try {
    const profile = await getDriverProfile(uid);
    return profile && profile.status === 'approved';
  } catch (error) {
    console.error('Error checking driver approval:', error);
    return false;
  }
}

/**
 * Get all pending driver applications (admin only)
 */
export async function getPendingDrivers() {
  try {
    const driversRef = collection(db, 'drivers');
    const q = query(driversRef, where('status', '==', 'pending'));
    const snapshot = await getDocs(q);

    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.error('Error getting pending drivers:', error);
    return [];
  }
}

/**
 * Approve driver application (admin only)
 * @param {string} driverId - Driver UID
 * @param {string} adminId - Admin UID who approved
 */
export async function approveDriver(driverId, adminId) {
  try {
    // Prefer server-side approval to set custom claims — call backend
    // Try configured backend or common emulator host fallbacks
    const configured = global?.BACKEND_URL;
    const fallbacks = configured ? [configured] : ['http://10.0.2.2:3000', 'http://localhost:3000'];
    const user = auth.currentUser;
    if (!user) throw new Error('Not authenticated as admin');
    const token = await user.getIdToken(true);
    let resp;
    let lastErr;
    for (const backend of fallbacks) {
      try {
        resp = await fetch(backend + '/admin/approve-driver', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ uid: driverId })
        });

        if (resp) break;
      } catch (e) {
        lastErr = e;
        console.warn('approveDriver: backend fetch failed for', backend, e.message);
        resp = null;
      }
    }

    if (!resp) {
      // Network to backend failed. Attempt client-side Firestore update if current user has admin claim.
      console.warn('approveDriver: backend unreachable, attempting client-side approval fallback');
      try {
        const idTokenResult = await user.getIdTokenResult();
        const isAdmin = !!idTokenResult?.claims?.admin;
        if (!isAdmin) {
          throw new Error('Network request to approval backend failed. Ensure the backend is running and reachable from this device/emulator. Set global.BACKEND_URL to the backend host (for example http://192.168.x.x:3000)');
        }

        // Admin claim present — update drivers document directly
        const driverRef = doc(db, 'drivers', driverId);
        await updateDoc(driverRef, {
          status: 'approved',
          trustBadge: true,
          approvedAt: serverTimestamp(),
          approvedBy: user.uid,
        });

        // Note: setting custom claims (admin.auth().setCustomUserClaims) still requires server-side code.
        return true;
      } catch (fallbackErr) {
        throw fallbackErr;
      }
    }

    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      throw new Error(body.error || `approval failed (status ${resp.status})`);
    }

    return true;
  } catch (error) {
    console.error('Error approving driver:', error);
    throw error;
  }
}

/**
 * Reject driver application (admin only)
 * @param {string} driverId - Driver UID
 * @param {string} adminId - Admin UID who rejected
 */
export async function rejectDriver(driverId, adminId) {
  try {
    const driverRef = doc(db, 'drivers', driverId);
    await updateDoc(driverRef, {
      status: 'rejected',
      approvedAt: new Date(),
      approvedBy: adminId,
    });

    return true;
  } catch (error) {
    console.error('Error rejecting driver:', error);
    throw error;
  }
}
