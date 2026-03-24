import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from './firebaseConfig';

/**
 * Create student profile
 * @param {Object} studentData - {name, department, gender}
 */
export async function createStudentProfile(studentData) {
  try {
    
    const user = auth.currentUser;
    if (!user) throw new Error('Not authenticated');

    // Validate domain (allow Gmail for testing)
    if (!user.email.endsWith('@sophiacollege.edu.in') && !user.email.endsWith('@gmail.com')) {
      throw new Error('Invalid domain. Students must use @sophiacollege.edu.in or @gmail.com email');
    }

    const studentRef = doc(db, 'students', user.uid);
    await setDoc(studentRef, {
      uid: user.uid,
      email: user.email,
      name: studentData.name,
      department: studentData.department || '',
      gender: studentData.gender || '',
      role: 'student',
      trustBadge: false, // Students don't get automatic trust badge
      createdAt: new Date(),
      isActive: true,
    });

    return true;
  } catch (error) {
    console.error('Error creating student profile:', error);
    throw error;
  }
}

/**
 * Get student profile
 * @param {string} uid - Student UID
 */
export async function getStudentProfile(uid = null) {
  try {
    const userId = uid || auth.currentUser?.uid;
    if (!userId) throw new Error('Not authenticated');

    const studentRef = doc(db, 'students', userId);
    const snapshot = await getDoc(studentRef);

    if (snapshot.exists()) {
      return { id: snapshot.id, ...snapshot.data() };
    }
    return null;
  } catch (error) {
    console.error('Error getting student profile:', error);
    return null;
  }
}

/**
 * Check if user is student
 * @param {string} uid - User UID
 */
export async function isUserStudent(uid) {
  try {
    const profile = await getStudentProfile(uid);
    return profile !== null;
  } catch (error) {
    console.error('Error checking student status:', error);
    return false;
  }
}
