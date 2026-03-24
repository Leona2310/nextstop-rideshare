import { collection, doc, setDoc, getDocs, query, where, runTransaction, serverTimestamp, Timestamp, getDoc, updateDoc } from 'firebase/firestore';
import { db } from './firebaseConfig';
import { getFixedSophiaPickup, calculateDistance, getRouteBetweenCoords } from '../services/locationService';

/**
 * Send offers to nearest available drivers.
 * Creates documents in driver_offers collection with status 'sent'.
 * @param {string} rideId
 * @param {number} topN
 * @param {number} offerTimeoutSeconds
 */
export async function sendOffers(rideId, topN = 5, offerTimeoutSeconds = 300) {
  const diagnostics = [];
  const createdOffers = [];
  try {
    const sophia = await getFixedSophiaPickup();
    if (!sophia) {
      diagnostics.push('sophia_not_resolved');
      return { offers: createdOffers, diagnostics };
    }

    // Query drivers collection for approved drivers
    const driversRef = collection(db, 'drivers');
    let driverSnap;
    try {
      const driversQ = query(driversRef, where('status', '==', 'approved'));
      driverSnap = await getDocs(driversQ);
      diagnostics.push(`approvedDriversCount:${driverSnap.size}`);
    } catch (err) {
      diagnostics.push(`drivers_query_error:${err?.code || err?.message || err}`);
      console.warn('sendOffers drivers query error (falling back to activeDrivers)', err);
      // fallback: list activeDrivers directly (may be allowed in dev)
      try {
        const activeRef = collection(db, 'activeDrivers');
        const activeSnap = await getDocs(activeRef);
        diagnostics.push(`activeDriversCount:${activeSnap.size}`);
        // build pseudo-driver docs from activeDrivers
        driverSnap = { docs: activeSnap.docs.map(d => ({ id: d.id, data: () => ({ status: 'approved' }) })) };
      } catch (err2) {
        diagnostics.push(`activeDrivers_query_error:${err2?.code||err2?.message||err2}`);
        console.error('sendOffers activeDrivers fallback failed', err2);
        return { offers: createdOffers, diagnostics };
      }
    }

    const candidates = [];
    // For each approved driver, check activeDrivers doc for location and availability
    for (const ddoc of driverSnap.docs) {
      const driverId = ddoc.id;
      try {
        const activeRef = doc(db, 'activeDrivers', driverId);
        const activeSnap = await getDoc(activeRef);
        if (!activeSnap.exists()) {
          diagnostics.push(`no_active_doc:${driverId}`);
          continue;
        }
        const data = activeSnap.data();
        if (!data.isAvailable) {
          diagnostics.push(`not_available:${driverId}`);
          continue;
        }
        const lat = data.location?.latitude;
        const lon = data.location?.longitude;
        if (lat == null || lon == null) {
          diagnostics.push(`no_location:${driverId}`);
          continue;
        }
        candidates.push({ driverId, latitude: lat, longitude: lon, activeData: data });
      } catch (err) {
        diagnostics.push(`activeDoc_error:${driverId}:${err?.code||err?.message||err}`);
        console.warn('sendOffers activeDoc check failed for', driverId, err);
      }
    }

    if (candidates.length === 0) {
      diagnostics.push('no_active_available_drivers');
      return { offers: createdOffers, diagnostics };
    }

    // fetch ride details so offers include destination, fare and booking time
    let rideData = null;
    try {
      const rideRef = doc(db, 'rides', rideId);
      const rideSnap = await getDoc(rideRef);
      if (rideSnap.exists()) rideData = rideSnap.data();
      else diagnostics.push('ride_not_found');
    } catch (err) {
      diagnostics.push(`ride_fetch_error:${err?.code||err?.message||err}`);
    }

    // compute ETA/distance to Sophia using routing when available, fallback to straight-line distance
    const enriched = [];
    for (const c of candidates) {
      let etaSec = null;
      let routeDistMeters = null;
      try {
        const route = await getRouteBetweenCoords({ latitude: c.latitude, longitude: c.longitude }, { latitude: sophia.latitude, longitude: sophia.longitude });
        if (route && route.duration != null) etaSec = Math.round(route.duration); // seconds
        if (route && route.distance != null) routeDistMeters = Math.round(route.distance);
      } catch (err) {
        diagnostics.push(`route_error:${c.driverId}:${err?.code||err?.message||err}`);
        // fallback to haversine distance to estimate ETA roughly
        routeDistMeters = Math.round(calculateDistance(sophia.latitude, sophia.longitude, c.latitude, c.longitude) * 1000);
        // assume average 30 km/h -> 8.33 m/s -> est seconds = meters / 8.33
        etaSec = Math.round(routeDistMeters / 8.33);
      }
      enriched.push({ ...c, etaSec, routeDistMeters });
    }

    // sort by ETA (nulls pushed to end)
    enriched.sort((a, b) => {
      if (a.etaSec == null && b.etaSec == null) return 0;
      if (a.etaSec == null) return 1;
      if (b.etaSec == null) return -1;
      return a.etaSec - b.etaSec;
    });

    const selected = enriched.slice(0, topN);

    const now = Timestamp.now();
    const expiresAt = Timestamp.fromMillis(now.toMillis() + offerTimeoutSeconds * 1000);

    for (const drv of selected) {
      try {
        // use a deterministic id so client and server can reference the same offer easily
        const offerId = `${rideId}_${drv.driverId}`;
        const offerRef = doc(db, 'driver_offers', offerId);
        // normalize a human-friendly dropAddress for driver UI
        const dropName = (rideData && (
          (rideData.dropLocation && (rideData.dropLocation.name || rideData.dropLocation.address)) ||
          (rideData.destination && rideData.destination.name) ||
          (typeof rideData.dropLocation === 'string' ? rideData.dropLocation : null)
        )) || null;

        const payload = {
          id: offerId,
          rideId,
          driverId: drv.driverId,
          status: 'sent',
          sentAt: now,
          expiresAt,
          etaToPickupSeconds: drv.etaSec,
          etaToPickupMinutes: drv.etaSec != null ? Math.ceil(drv.etaSec / 60) : null,
          distanceToPickupKm: drv.routeDistMeters != null ? (drv.routeDistMeters / 1000) : null,
          pickupLocation: sophia,
          dropLocation: rideData?.destination || rideData?.dropLocation || null,
          dropAddress: dropName,
          estimatedPrice: rideData?.fare?.total ?? rideData?.estimatedPrice ?? null,
          bookingCreatedAt: rideData?.createdAt || null,
        };
        await setDoc(offerRef, payload);
        createdOffers.push(payload);
      } catch (err) {
        diagnostics.push(`offer_write_error:${drv.driverId}:${err?.code||err?.message||err}`);
        console.error('sendOffers write failed for driver', drv.driverId, err);
      }
    }

    diagnostics.push(`offers_created:${createdOffers.length}`);
    return { offers: createdOffers, diagnostics };
  } catch (err) {
    diagnostics.push(`unexpected_error:${err?.code||err?.message||err}`);
    console.error('sendOffers unexpected failure', err);
    return { offers: createdOffers, diagnostics };
  }
}

/**
 * Accept an offer atomically: marks offer accepted and claims the ride in one transaction.
 * Returns {ok:true} or throws.
 */
export async function acceptOffer(offerId, rideId, driverId) {
  const offerRef = doc(db, 'driver_offers', offerId);
  const rideRef = doc(db, 'rides', rideId);
  const driverRef = doc(db, 'users', driverId);

  try {
    const res = await runTransaction(db, async (tx) => {
      const offerSnap = await tx.get(offerRef);
      if (!offerSnap.exists()) throw new Error('Offer not found');
      const offer = offerSnap.data();
      if (offer.driverId !== driverId) throw new Error('Offer not intended for this driver');
      if (offer.status !== 'sent') throw new Error('Offer not available');
      const now = Timestamp.now();
      // Allow a small grace period to account for clock skew and delivery latency (30s)
      const GRACE_MS = 30 * 1000;
      if (offer.expiresAt && offer.expiresAt.toMillis && offer.expiresAt.toMillis() + GRACE_MS < now.toMillis()) {
        console.warn('acceptOffer: offer appears expired but attempting to claim (grace allowed)');
      }

      const rideSnap = await tx.get(rideRef);
      if (!rideSnap.exists()) throw new Error('Ride not found');
      const ride = rideSnap.data();
      if (ride.driverId) throw new Error('Ride already claimed');
      if (ride.status !== 'searching') throw new Error('Ride not available');

      // fetch driver profile
      let driverProfile = {};
      const driverSnap = await tx.get(driverRef);
      if (driverSnap.exists()) {
        const d = driverSnap.data();
        driverProfile = {
          driverName: d.name || 'Driver',
          driverPhone: d.phone || '',
          driverVehicleModel: d.vehicleModel || '',
          driverVehicleNumber: d.vehicleNumber || '',
          driverTrustBadge: d.trustBadge || false,
          driverPhotoUrl: d.photoUrl || null,
        };
      }

      tx.update(offerRef, { status: 'accepted', acceptedAt: now });
  // generate 4-digit pickup OTP and attach to ride for verification at pickup
  const otp = Math.floor(1000 + Math.random() * 9000).toString();
  const otpExpires = Timestamp.fromMillis(now.toMillis() + (10 * 60 * 1000)); // 10 minutes
  tx.update(rideRef, { driverId, status: 'accepted', acceptedAt: serverTimestamp(), pickupOTP: otp, otpVerified: false, otpExpiresAt: otpExpires, ...driverProfile });

      return { ok: true };
    });
    return res;
  } finally {
    // best-effort: expire other offers so they don't linger
    try { await expireOtherOffers(offerId, rideId); } catch (e) { /* swallow */ }
  }
}

// After accepting an offer, expire other offers for the same ride (non-transactional cleanup)
async function expireOtherOffers(acceptedOfferId, rideId) {
  try {
    // driver_offers
    const offersRef = collection(db, 'driver_offers');
    const q = query(offersRef, where('rideId', '==', rideId), where('status', '==', 'sent'));
    const snap = await getDocs(q);
    for (const d of snap.docs) {
      if (d.id === acceptedOfferId) continue;
      try {
        await updateDoc(doc(db, 'driver_offers', d.id), { status: 'rejected', rejectedAt: Timestamp.now() });
      } catch (e) {
        console.warn('Failed to expire driver_offers', d.id, e);
      }
    }

    // rideOffers collection wrapper
    const rideOffersRef = collection(db, 'rideOffers');
    const q2 = query(rideOffersRef, where('rideId', '==', rideId), where('status', '==', 'sent'));
    const snap2 = await getDocs(q2);
    for (const d of snap2.docs) {
      const id = d.id;
      if (id === `${rideId}_${d.data().driverId}` && id === acceptedOfferId) continue;
      try {
        await updateDoc(doc(db, 'rideOffers', id), { status: 'rejected', rejectedAt: Timestamp.now() });
      } catch (e) {
        console.warn('Failed to expire rideOffers', id, e);
      }
    }
  } catch (err) {
    console.warn('expireOtherOffers failed', err);
  }
}
