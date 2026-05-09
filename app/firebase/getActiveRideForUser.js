import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from './firebaseConfig';

export async function getActiveRideForUser(userId) {
  if (!userId) return null;
  
  try {
    const ridesCol = collection(db, 'rides');
    const q1 = query(ridesCol, where('userId', '==', userId));
    const q2 = query(ridesCol, where('createdBy', '==', userId));
    const [snap1, snap2] = await Promise.all([getDocs(q1), getDocs(q2)]);
    
    const candidates = [];
    snap1.docs.forEach(d => candidates.push({ id: d.id, ...d.data() }));
    snap2.docs.forEach(d => candidates.push({ id: d.id, ...d.data() }));

    // Filter active rides
    const active = candidates.filter(r => {
      const s = (r.status || '').toLowerCase();
      return s !== 'completed' && s !== 'cancelled' && s !== 'closed';
    });

    if (active.length === 0) return null;

    active.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return active[0];
  } catch (err) {
    console.warn('getActiveRideForUser failed', err);
    return null;
  }
}
