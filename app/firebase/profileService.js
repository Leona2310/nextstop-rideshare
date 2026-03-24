import { auth, db } from './firebaseConfig';
import { doc, setDoc, serverTimestamp, getDoc } from 'firebase/firestore';

import { createAdminProfile } from './adminService';
import { createDriverProfile } from './driverService';
import { createStudentProfile } from './studentService';
import { createTeacherProfile } from './teacherService';

/**
 * Save base profile for all users
 * Path: users/{uid}
 */
async function saveBaseProfile(profile) {
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');

  const uid = user.uid;

  const payload = {
    uid,
    email: user.email || '',
    name: profile.name || '',
    role: profile.role || '',
    department: profile.department || '',
    gender: profile.gender || '',
    phone: profile.phone || '',
  trustBadge: false,
  vehicleModel: profile.vehicleModel || '',
  vehicleNumber: profile.vehicleNumber || '',
  licenseNumber: profile.licenseNumber || '',
    createdAt: serverTimestamp()
  };

  await setDoc(doc(db, 'users', uid), payload, { merge: true });
}

/**
 * Get base user profile
 * @param {string} uid - User UID
 */
export async function getProfile(uid = null) {
  const userId = uid || auth.currentUser?.uid;
  if (!userId) return null;

  const snap = await getDoc(doc(db, 'users', userId));
  return snap.exists() ? snap.data() : null;
}

/**
 * Save profile and route to role-specific service
 * @param {Object} profile - must contain role
 */
export async function saveProfile(profile) {
  if (!profile?.role) {
    throw new Error('Role is required');
  }

  // 1️⃣ Save common user profile
  await saveBaseProfile(profile);

  // 2️⃣ Save role-specific profile
  switch (profile.role) {
    case 'admin':
      return createAdminProfile(profile);

    case 'driver':
      return createDriverProfile(profile);

    case 'student':
      return createStudentProfile(profile);

    case 'teacher':
      return createTeacherProfile(profile);

    default:
      throw new Error(`Unknown role: ${profile.role}`);
  }
}
