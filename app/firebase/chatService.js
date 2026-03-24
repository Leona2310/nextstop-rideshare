import { collection, doc, setDoc, addDoc, serverTimestamp, getDocs, query, orderBy } from 'firebase/firestore';
import { db, auth, safeOnSnapshot } from './firebaseConfig';

export async function sendChatMessage(rideId, text) {
  if (!auth.currentUser) throw new Error('Not authenticated');
  const chatRef = collection(db, 'chats', rideId, 'messages');
  return await addDoc(chatRef, {
    senderId: auth.currentUser.uid,
    text: text || '',
    createdAt: serverTimestamp(),
  });
}

export function subscribeToChat(rideId, callback) {
  const chatRef = collection(db, 'chats', rideId, 'messages');
  const q = query(chatRef, orderBy('createdAt', 'asc'));
  return safeOnSnapshot(q, (snap) => {
    const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    callback(msgs);
  }, (e) => { console.warn('chat snapshot error', e); callback([]); });
}
