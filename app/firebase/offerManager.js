import { collection, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, Timestamp, updateDoc, where } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { calculateDistance } from '../services/locationService';
import { auth, db } from './firebaseConfig';

async function getFixedSophiaPickup() {
  return {
    address: 'Sophia College Auditorium, Sophia College Lane (near Vivek Singh Lane), Mumbai',
  latitude: 18.96952,
  longitude: 72.80727,
  };
}

async function getRouteBetweenCoords(from, to) {
  try {
    const d = calculateDistance(from.latitude, from.longitude, to.latitude, to.longitude);
    const etaSec = Math.round(d * 1000 / 8.33); // avg 30km/h
    return { distance: d * 1000, duration: etaSec };
  } catch (err) {
    return { distance: 0, duration: 0 };
  }
}


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
  console.log('sendOffers START:', rideId);
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
      console.log('ACTIVE DRIVERS FOUND:', driverSnap.size);
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
        // Require driver to be online in drivers collection and available in activeDrivers
        // Check drivers collection for isOnline flag (faster indexable query fallback handled earlier)
        try {
          const drvRef = doc(db, 'drivers', driverId);
          const drvSnap = await getDoc(drvRef);
          if (!drvSnap.exists() || !drvSnap.data()?.isOnline) {
            diagnostics.push(`not_online:${driverId}`);
            continue;
          }
        } catch (e) {
          diagnostics.push(`drivers_doc_check_failed:${driverId}`);
        }
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

    // fetch ride document early (needed for payload and for shared-ride expiry checks)
    let rideData = null;
    try {
      const rideRef = doc(db, 'rides', rideId);
      const rideSnap = await getDoc(rideRef);
      diagnostics.push(`ride_exists:${rideSnap.exists()}`);
      console.log('sendOffers RIDE SNAP EXISTS:', rideSnap.exists());
      if (rideSnap.exists()) {
        rideData = rideSnap.data();
        diagnostics.push(`ride_status:${rideData.status}`);
        console.log('sendOffers RIDE DATA:', rideId, rideData);
        // If ride is not searching, abort
        if (String((rideData.status || '').toUpperCase()) !== 'SEARCHING') {
          diagnostics.push('ride_not_searching');
          console.warn('sendOffers abort: ride not in SEARCHING state', rideId, rideData.status);
          return { offers: createdOffers, diagnostics };
        }
        // For shared rides, only proceed if expiresAt has passed
        if (rideData.allowPassengers) {
          const nowTs = Timestamp.now();
          if (rideData.expiresAt && rideData.expiresAt.toMillis && rideData.expiresAt.toMillis() > nowTs.toMillis()) {
            diagnostics.push('shared_not_expired');
            console.log('sendOffers shared ride not yet expired, skipping until expiry', rideId);
            return { offers: createdOffers, diagnostics };
          }
        }
      } else {
        diagnostics.push('ride_not_found');
        console.warn('sendOffers abort: ride not found', rideId);
        return { offers: createdOffers, diagnostics };
      }
    } catch (e) {
      diagnostics.push(`ride_fetch_error:${e?.message || e}`);
      console.error('sendOffers ride fetch failed', e);
      return { offers: createdOffers, diagnostics };
    }

    // compute ETA/distance to Sophia using routing when available, fallback to straight-line distance
  diagnostics.push(`candidates_count:${candidates.length}`);
  console.log('sendOffers CANDIDATES COUNT:', candidates.length);

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
  diagnostics.push(`selected_count:${selected.length}`);
  console.log('sendOffers SELECTED COUNT:', selected.length);

    const now = Timestamp.now();
    const expiresAt = Timestamp.fromMillis(now.toMillis() + offerTimeoutSeconds * 1000);

    // Create driver_offers documents for selected drivers (simple, logged writes)
    for (const drv of selected) {
      try {
        const driverId = drv.driverId;
        console.log('CREATING OFFER FOR DRIVER:', driverId);
        const offerRef = doc(db, 'driver_offers', `${rideId}_${driverId}`);
        const payload = {
          rideId: rideId,
          driverId: driverId,
          status: 'sent',
          sentAt: Timestamp.now(),
          expiresAt,
          pickupLocation: rideData?.pickupLocation || sophia || null,
          dropLocation: rideData?.dropLocation || rideData?.destination || null,
          // include human-friendly pickup/drop names so drivers don't rely on local reverse-geocode
          pickupName: (rideData?.pickupLocation && (rideData.pickupLocation.name || rideData.pickupLocation.address)) || rideData?.pickupName || (sophia && sophia.address) || 'Pickup',
          dropAddress: rideData?.dropAddress || (rideData?.dropLocation && (rideData.dropLocation.name || rideData.dropLocation.address)) || null,
          fare: rideData?.fare?.total ?? rideData?.estimatedPrice ?? null,
          tip: rideData?.tip ?? 0,
          fareWithTip: ( (rideData?.fare?.total ?? rideData?.estimatedPrice ?? 0) + (rideData?.tip ?? 0) ),
          // provide precomputed, consistent ETA/distance (minutes and km) for display
          estimatedDurationMin: Math.round((drv.etaSec ?? (rideData?.durationMin ? rideData.durationMin * 60 : 0)) / 60) || 0,
          estimatedDistanceKm: drv.routeDistMeters ? Math.round(drv.routeDistMeters) / 1000 : (rideData?.distanceKm ?? 0),
          createdAt: serverTimestamp(),
        };
        try {
          // Try using callable admin function to write offers (bypasses client rules)
          const functions = getFunctions();
          const fn = httpsCallable(functions, 'adminCreateDriverOffers');
          const res = await fn({ offers: [{ id: `${rideId}_${driverId}`, data: payload }], offerTimeoutSeconds }).catch(() => null);
          if (res && res.data && res.data.created && res.data.created > 0) {
            createdOffers.push(payload);
            console.log('OFFER CREATED via callable:', driverId);
          } else {
            // fallback to client write - only attempt if we have an authenticated user
            if (!auth || !auth.currentUser) {
              diagnostics.push(`offer_write_skipped_not_authenticated:${driverId}`);
              console.warn('Skipping client-side offer write because no authenticated user is available');
            } else {
              try {
                // compute local expiry as fallback using client clock
                const now = Timestamp.now();
                const localExpiresAt = Timestamp.fromMillis(now.toMillis() + offerTimeoutSeconds * 1000);
                await runTransaction(db, async (tx) => {
                  const existing = await tx.get(offerRef);
                  if (existing.exists()) {
                    diagnostics.push(`offer_already_exists:${driverId}`);
                    return;
                  }
                  tx.set(offerRef, { ...payload, sentAt: now, expiresAt: localExpiresAt });
                });
                createdOffers.push(payload);
                console.log('OFFER CREATED via client transactional create:', driverId);
              } catch (txErr) {
                console.error('OFFER WRITE TRANSACTION FAILED:', txErr);
                diagnostics.push(`offer_tx_error:${driverId}:${txErr?.message||txErr}`);
              }
            }
          }
        } catch (e) {
          console.error('OFFER WRITE FAILED:', e);
          diagnostics.push(`offer_write_error:${driverId}:${e?.message||e}`);
        }
      } catch (err) {
        diagnostics.push(`offer_loop_error:${drv.driverId}:${err?.code||err?.message||err}`);
      }
    }

    // If we created any offers, mark the ride as offersSent = true to avoid duplicates
    // For shared rides (allowPassengers === true) do NOT mark offersSent so additional
    // joiners after the portal expiry can still cause offers to be sent.
    if (createdOffers.length > 0) {
      try {
        if (!rideData?.allowPassengers) {
          const rideRef = doc(db, 'rides', rideId);
          await updateDoc(rideRef, { offersSent: true });
          diagnostics.push('ride_marked_offersSent');
        } else {
          diagnostics.push('ride_shared_offers_not_marked');
        }
      } catch (e) {
        diagnostics.push(`ride_mark_offers_failed:${e?.message||e}`);
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
  // Check expiry
  if (ride.expiresAt && ride.expiresAt.toMillis && ride.expiresAt.toMillis() < now.toMillis()) throw new Error('Ride expired');
  if (ride.driverId) throw new Error('Ride already claimed');
  // Only allow accept if ride is SEARCHING
  if (String(ride.status || '').toUpperCase() !== 'SEARCHING') throw new Error('Ride not available');

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

  tx.update(offerRef, { status: 'ACCEPTED', acceptedAt: now });
  // generate 4-digit pickup OTP and attach to ride for verification at pickup
  const otp = Math.floor(1000 + Math.random() * 9000).toString();
  const otpExpires = Timestamp.fromMillis(now.toMillis() + (10 * 60 * 1000)); // 10 minutes
  // write both `pickupOTP` and legacy `otp` so UIs/readers can find it
  tx.update(rideRef, { driverId, status: 'ACCEPTED', acceptedAt: serverTimestamp(), pickupOTP: otp, otp: otp, otpVerified: false, otpExpiresAt: otpExpires, ...driverProfile });

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
    // Try calling admin callable to expire offers (bypasses client security rules)
    try {
      const functions = getFunctions();
      const fn = httpsCallable(functions, 'adminExpireOffers');
      const res = await fn({ rideId, acceptedOfferId }).catch(() => null);
      if (res && res.data && res.data.ok) {
        return;
      }
    } catch (e) {
      console.warn('adminExpireOffers callable failed, falling back to client-side expire', e);
    }

    // Fallback: client-side expiration (may be blocked by rules if caller lacks permission)
    const offersRef = collection(db, 'driver_offers');
    const q = query(offersRef, where('rideId', '==', rideId), where('status', '==', 'sent'));
    const snap = await getDocs(q);
    for (const d of snap.docs) {
      if (d.id === acceptedOfferId) continue;
      try {
        await updateDoc(doc(db, 'driver_offers', d.id), { status: 'REJECTED', rejectedAt: Timestamp.now() });
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
        await updateDoc(doc(db, 'rideOffers', id), { status: 'REJECTED', rejectedAt: Timestamp.now() });
      } catch (e) {
        console.warn('Failed to expire rideOffers', id, e);
      }
    }
  } catch (err) {
    console.warn('expireOtherOffers failed', err);
  }
}
