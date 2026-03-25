import { auth , db } from './firebaseConfig';
import { doc, getDoc, setDoc, deleteDoc, collection, getDocs, query, where } from 'firebase/firestore';


/* ================= CREATE ADMIN ================= */
export async function createAdminProfile(profile) {
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');

  const adminRef = doc(db, 'admins', user.uid);
  await setDoc(adminRef, {
    uid: user.uid,
    email: user.email,
    name: profile.name || '',
    role: 'admin',
    createdAt: new Date(),
  });

  return true;
}

/* ================= READ ADMIN ================= */
export async function getAdminProfile(uid = null) {
  const userId = uid || auth.currentUser?.uid;
  if (!userId) return null;

  const snap = await getDoc(doc(db, 'admins', userId));
  return snap.exists() ? snap.data() : null;
}

/* ================= ADMIN FUNCTIONS ================= */

/**
 * Get admin statistics
 */
export async function getAdminStats() {
  try {
    // Get total users
    const usersSnap = await getDocs(collection(db, 'users'));
    const totalUsers = usersSnap.size;

    // Get total drivers
    const driversSnap = await getDocs(collection(db, 'drivers'));
    const totalDrivers = driversSnap.size;

    // Get approved drivers
    const approvedDriversQuery = query(collection(db, 'drivers'), where('status', '==', 'approved'));
    const approvedDriversSnap = await getDocs(approvedDriversQuery);
    const approvedDrivers = approvedDriversSnap.size;

    // Get pending drivers
    const pendingDriversQuery = query(collection(db, 'drivers'), where('status', '==', 'pending'));
    const pendingDriversSnap = await getDocs(pendingDriversQuery);
    const pendingDrivers = pendingDriversSnap.size;

    // Get total rides
    const ridesSnap = await getDocs(collection(db, 'rides'));
    const totalRides = ridesSnap.size;

    // Get active rides
    const activeRidesQuery = query(collection(db, 'rides'), where('status', 'in', ['accepted', 'in_progress']));
    const activeRidesSnap = await getDocs(activeRidesQuery);
    const activeRides = activeRidesSnap.size;

    return {
      totalUsers,
      totalDrivers,
      approvedDrivers,
      pendingDrivers,
      totalRides,
      activeRides
    };
  } catch (error) {
    console.error('Error getting admin stats:', error);
    throw error;
  }
}

/**
 * Delete a user completely
 * @param {string} userId
 */
export async function deleteUser(userId) {
  try {
    // If backend admin endpoint exists, call it to remove Auth user + Firestore docs
    try {
      // get idToken for authentication to backend admin routes
      const idToken = await auth.currentUser?.getIdToken();
      if (idToken) {
        const backendUrl = (typeof global !== 'undefined' && global.BACKEND_URL) ? global.BACKEND_URL : 'http://localhost:3000';
        const resp = await fetch(`${backendUrl}/admin/delete-user`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
          body: JSON.stringify({ uid: userId })
        });
        if (resp.ok) {
          return true;
        } else {
          console.warn('Backend delete-user failed, falling back to client-side Firestore cleanup', await resp.text());
        }
      }
    } catch (e) {
      console.warn('Backend delete-user call failed, falling back to client-only cleanup', e);
    }

    // Fallback: Delete from users collection and role-specific collections only (does not remove Auth account)
    await deleteDoc(doc(db, 'users', userId));
    const collections = ['students', 'teachers', 'staff', 'drivers', 'admins'];
    for (const collectionName of collections) {
      try {
        await deleteDoc(doc(db, collectionName, userId));
      } catch (e) {
        // Ignore if document doesn't exist
      }
    }
    // Also delete activeDrivers doc if present
    try { await deleteDoc(doc(db, 'activeDrivers', userId)); } catch (e) {}

    return true;
  } catch (error) {
    console.error('Error deleting user:', error);
    throw error;
  }
}

/**
 * Get all users with their roles
 */
export async function getAllUsers() {
  try {
    const usersSnap = await getDocs(collection(db, 'users'));
    return usersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.error('Error getting all users:', error);
    return [];
  }
}

/**
 * Get all rides
 */
export async function getAllRides() {
  try {
    const ridesSnap = await getDocs(collection(db, 'rides'));
    return ridesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.error('Error getting all rides:', error);
    return [];
  }
}
