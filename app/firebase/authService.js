// ...existing code...
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  sendEmailVerification,
  signOut
} from 'firebase/auth';

import { auth } from './firebaseConfig';

/**
 * Map Firebase auth errors to user-friendly messages.
 * Logs original error to console for debugging.
 */
export function getFriendlyAuthError(error) {
  console.error('Firebase auth error:', error);
  const code = error?.code || '';

  switch (code) {
    case 'auth/wrong-password':
    case 'auth/invalid-password':
      return 'Invalid username or password. Please try again.';
    case 'auth/user-not-found':
      return 'Account not found. Please sign up first.';
    case 'auth/invalid-email':
      return 'Invalid email address. Please check and try again.';
    case 'auth/email-already-in-use':
      return 'This email is already registered. Please login instead.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please try again later.';
    default:
      return 'Authentication failed. Please try again.';
  }
}

/* ---------------- LOGIN ---------------- */
export const loginUser = async (email, password) => {
  return await signInWithEmailAndPassword(auth, email, password);
};

/* ---------------- SIGNUP ---------------- */
export const signup = async (email, password) => {
  const userCredential = await createUserWithEmailAndPassword(
    auth,
    email,
    password
  );

  // Email verification (acts as Email OTP)
  await sendEmailVerification(userCredential.user);

  return userCredential;
};

// backward-compatible name (some screens imported signup)
export const signupUser = signup;

/* ---------------- RESET PASSWORD ---------------- */
export const resetPassword = async (email) => {
  return await sendPasswordResetEmail(auth, email);
};

/* ---------------- LOGOUT ---------------- */
export const logoutUser = async () => {
  return await signOut(auth);
};
// ...existing code...