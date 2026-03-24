import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from './firebaseConfig';

/**
 * Create staff profile
 * @param {Object} staffData - {name, department, gender, phone}
 */
export async function createStaffProfile(staffData) {
  try {
    const user = auth.currentUser;
    if (!user) throw new Error('Not authenticated');

    // Validate domain (allow Gmail for testing)
    if (!user.email.endsWith('@sophiacollege.edu.in') && !user.email.endsWith('@gmail.com')) {
      throw new Error('Invalid domain. Staff must use @sophiacollege.edu.in or @gmail.com email');
    }

    const staffRef = doc(db, 'staff', user.uid);
    await setDoc(staffRef, {
      uid: user.uid,
      email: user.email,
      name: staffData.name,
      department: staffData.department || '',
      gender: staffData.gender || '',
      phone: staffData.phone || '',
      role: 'staff',
      trustBadge: false, // Staff don't get automatic trust badge
      createdAt: new Date(),
      isActive: true,
    });

    return true;
  } catch (error) {
    console.error('Error creating staff profile:', error);
    throw error;
  }
}

/**
 * Get staff profile
 * @param {string} uid - Staff UID
 */
export async function getStaffProfile(uid = null) {
  try {
    const userId = uid || auth.currentUser?.uid;
    if (!userId) throw new Error('Not authenticated');

    const staffRef = doc(db, 'staff', userId);
    const snapshot = await getDoc(staffRef);

    if (snapshot.exists()) {
      return { id: snapshot.id, ...snapshot.data() };
    }
    return null;
  } catch (error) {
    console.error('Error getting staff profile:', error);
    return null;
  }
}

/**
 * Check if user is staff
 * @param {string} uid - User UID
 */
export async function isUserStaff(uid) {
  try {
    const profile = await getStaffProfile(uid);
    return profile !== null;
  } catch (error) {
    console.error('Error checking staff status:', error);
    return false;
  }
}
