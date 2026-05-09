const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

/**
 * Callable function to delete a user and all associated documents.
 * Only callable by an admin (custom claim `admin: true`).
 * Payload: { uid: string }
 */
exports.adminDeleteUser = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Request has no auth context');
  }
  const callerUid = context.auth.uid;
  const token = context.auth.token || {};
  if (!token.admin) {
    throw new functions.https.HttpsError('permission-denied', 'Only admins may call this function');
  }

  const uid = data?.uid;
  if (!uid) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing uid');
  }

  try {
    // Delete Firestore docs in known collections
    const collections = ['users', 'students', 'teachers', 'staff', 'drivers', 'admins', 'activeDrivers'];
    const deletePromises = [];
    for (const col of collections) {
      const ref = db.collection(col).doc(uid);
      deletePromises.push(ref.delete().catch(() => {}));
    }

    // Optionally delete subcollections like offers, rides owned by user etc.
    // For now we delete top-level docs and activeDrivers.
    await Promise.all(deletePromises);

    // Delete Auth user
    await admin.auth().deleteUser(uid);

    return { success: true };
  } catch (err) {
    console.error('adminDeleteUser error:', err);
    throw new functions.https.HttpsError('internal', 'Failed to delete user');
  }
});

/**
 * Callable function to create driver_offers documents using Admin SDK (bypasses rules)
 * Only callable by admins.
 * Payload: { offers: [{ id: string, data: object }, ...] }
 */
exports.adminCreateDriverOffers = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Request has no auth context');
  }
  const token = context.auth.token || {};
  if (!token.admin) {
    throw new functions.https.HttpsError('permission-denied', 'Only admins may call this function');
  }
  const offers = Array.isArray(data?.offers) ? data.offers : [];
  if (offers.length === 0) {
    return { created: 0 };
  }
  try {
    const batch = db.batch ? db.batch() : null;
    let created = 0;
    const offerTimeoutSeconds = Number(data?.offerTimeoutSeconds) || 300;
    const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + offerTimeoutSeconds * 1000);
    const sentAt = admin.firestore.Timestamp.now();
    for (const o of offers) {
      if (!o || !o.id || !o.data) continue;
      const ref = db.collection('driver_offers').doc(o.id);
      // Ensure createdAt and sentAt are set server-side, and expiresAt uses server clock
      const toWrite = { ...o.data, createdAt: admin.firestore.FieldValue.serverTimestamp(), sentAt, expiresAt };
      if (batch) batch.set(ref, toWrite);
      else await ref.set(toWrite);
      created++;
    }
    if (batch) await batch.commit();
    return { created };
  } catch (err) {
    console.error('adminCreateDriverOffers error:', err);
    throw new functions.https.HttpsError('internal', 'Failed creating offers');
  }
});

/**
 * Callable function to approve a driver. Only callable by admins.
 * Payload: { uid: string }
 */
exports.adminApproveDriver = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'No auth');
  const token = context.auth.token || {};
  if (!token.admin) throw new functions.https.HttpsError('permission-denied', 'Only admins may call this');
  const uid = data?.uid;
  if (!uid) throw new functions.https.HttpsError('invalid-argument', 'Missing uid');
  try {
    const driverRef = db.collection('drivers').doc(uid);
    await driverRef.set({
      status: 'approved',
      trustBadge: true,
      approvedAt: admin.firestore.FieldValue.serverTimestamp(),
      approvedBy: context.auth.uid,
    }, { merge: true });

    // Optionally set custom claim (commented out because requires existing business logic)
    // await admin.auth().setCustomUserClaims(uid, { driver: true });

    return { ok: true };
  } catch (err) {
    console.error('adminApproveDriver error:', err);
    throw new functions.https.HttpsError('internal', 'Failed to approve driver');
  }
});

/**
 * Callable function to expire other offers for a ride. Only callable by admins.
 * Payload: { rideId: string, acceptedOfferId: string }
 */
exports.adminExpireOffers = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'No auth');
  const token = context.auth.token || {};
  if (!token.admin) throw new functions.https.HttpsError('permission-denied', 'Only admins may call this');
  const rideId = data?.rideId;
  const acceptedOfferId = data?.acceptedOfferId;
  if (!rideId) throw new functions.https.HttpsError('invalid-argument', 'Missing rideId');
  try {
    const batch = db.batch ? db.batch() : null;
    // Expire driver_offers
    const offersSnap = await db.collection('driver_offers').where('rideId', '==', rideId).where('status', '==', 'sent').get();
    for (const docSnap of offersSnap.docs) {
      if (docSnap.id === acceptedOfferId) continue;
      const ref = db.collection('driver_offers').doc(docSnap.id);
      const updateObj = { status: 'REJECTED', rejectedAt: admin.firestore.Timestamp.now() };
      if (batch) batch.update(ref, updateObj);
      else await ref.update(updateObj);
    }
    // Expire rideOffers wrapper
    const rideOffersSnap = await db.collection('rideOffers').where('rideId', '==', rideId).where('status', '==', 'sent').get();
    for (const docSnap of rideOffersSnap.docs) {
      const id = docSnap.id;
      if (id === acceptedOfferId) continue;
      const ref = db.collection('rideOffers').doc(id);
      const updateObj = { status: 'REJECTED', rejectedAt: admin.firestore.Timestamp.now() };
      if (batch) batch.update(ref, updateObj);
      else await ref.update(updateObj);
    }
    if (batch) await batch.commit();
    return { ok: true };
  } catch (err) {
    console.error('adminExpireOffers error:', err);
    throw new functions.https.HttpsError('internal', 'Failed to expire offers');
  }
});
