import ReactNativeAsyncStorage from '@react-native-async-storage/async-storage';
import { initializeApp } from 'firebase/app';
import { getReactNativePersistence, initializeAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { onSnapshot } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyDFlX88jJLGAPc271yVXptmBKS84Hzux3E",
  authDomain: "nextstop-d8864.firebaseapp.com",
  projectId: "nextstop-d8864",
  storageBucket: "nextstop-d8864.appspot.com",
  messagingSenderId: "569056368810",
  appId: "1:569056368810:web:f3b640760c275b1eb1d8d3"
};

export const app = initializeApp(firebaseConfig);
export const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(ReactNativeAsyncStorage)
});
export const db = getFirestore(app);

/**
 * Subscribe to a Firestore snapshot only after auth is ready.
 * Returns an unsubscribe function immediately. If auth isn't ready yet the
 * returned unsubscribe will cancel the pending auth listener.
 */
export function safeOnSnapshot(ref, next, error) {
  let unsubSnapshot = null;
  const safeError = typeof error === 'function' ? error : (e) => { console.warn('safeOnSnapshot error', e); };
  const trySubscribe = () => {
    try {
      unsubSnapshot = onSnapshot(ref, next, safeError);
    } catch (e) {
      // synchronous errors (rare) — call safeError
      try { safeError(e); } catch (ee) { console.warn('safeOnSnapshot error handler failed', ee); }
    }
  };

  // If auth already available, subscribe immediately
  if (auth && auth.currentUser) {
    trySubscribe();
    return () => { if (unsubSnapshot) unsubSnapshot(); };
  }

  // Otherwise wait for auth to become available, or timeout after 3s and return noop
  let authUnsub = onAuthStateChanged(auth, (u) => {
    if (u) {
      trySubscribe();
      try { authUnsub(); } catch (e) {}
    }
  });

  const timeout = setTimeout(() => {
    try { authUnsub(); } catch (e) {}
  }, 3000);

  return () => {
    try { if (unsubSnapshot) unsubSnapshot(); } catch (e) {}
    try { authUnsub(); } catch (e) {}
    try { clearTimeout(timeout); } catch (e) {}
  };
}
