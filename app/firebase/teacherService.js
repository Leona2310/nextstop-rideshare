import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from './firebaseConfig';

/**
 * Create teacher profile
 * @param {Object} teacherData - {name, department, gender, phone}
 */
export async function createTeacherProfile(teacherData) {
  try {
    const user = auth.currentUser;
    if (!user) throw new Error('Not authenticated');

    // Validate domain (allow Gmail for testing)
    if (!user.email.endsWith('@sophiacollege.edu.in') && !user.email.endsWith('@gmail.com')) {
      throw new Error('Invalid domain. Teachers must use @sophiacollege.edu.in or @gmail.com email');
    }

    const teacherRef = doc(db, 'teachers', user.uid);
    await setDoc(teacherRef, {
      uid: user.uid,
      email: user.email,
      name: teacherData.name,
      department: teacherData.department || '',
      gender: teacherData.gender || '',
      phone: teacherData.phone || '',
      role: 'teacher',
      trustBadge: true, // Teachers get automatic trust badge
      createdAt: new Date(),
      isActive: true,
    });

    return true;
  } catch (error) {
    console.error('Error creating teacher profile:', error);
    throw error;
  }
}

/**
 * Get teacher profile
 * @param {string} uid - Teacher UID
 */
export async function getTeacherProfile(uid = null) {
  try {
    const userId = uid || auth.currentUser?.uid;
    if (!userId) throw new Error('Not authenticated');

    const teacherRef = doc(db, 'teachers', userId);
    const snapshot = await getDoc(teacherRef);

    if (snapshot.exists()) {
      return { id: snapshot.id, ...snapshot.data() };
    }
    return null;
  } catch (error) {
    console.error('Error getting teacher profile:', error);
    return null;
  }
}

/**
 * Check if user is teacher
 * @param {string} uid - User UID
 */
export async function isUserTeacher(uid) {
  try {
    const profile = await getTeacherProfile(uid);
    return profile !== null;
  } catch (error) {
    console.error('Error checking teacher status:', error);
    return false;
  }
}
