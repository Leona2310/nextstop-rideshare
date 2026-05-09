import { useEffect, useRef, useState } from 'react';
import { Alert, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import MapComponent from '../../../components/MapComponent';
import ActiveTripBottomSheet from '../../components/ActiveTripBottomSheet';
import IncomingRequestBottomSheet from '../../components/IncomingRequestBottomSheet';
import TopBar from '../../components/TopBar';
// driver profile fetching removed per request
import { collection, doc, getDoc, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore';
import { calculateFare } from '../../config/fareConfig';
import { waitForAuthReady } from '../../firebase/driverLocationService';
import { auth, db, safeOnSnapshot } from '../../firebase/firebaseConfig';
import { acceptOffer, sendOffers } from '../../firebase/offerManager';
import { completeRide, markArrived, verifyPickupOTP } from '../../firebase/rideService';
import { calculateDistance, getRoadDistanceKm, getRouteBetweenCoords, reverseGeocodeToAddress } from '../../services/locationService';

export default function DriverDashboard({ navigation }) {
  const [isOnline, setIsOnline] = useState(false);
  const [currentLocation, setCurrentLocation] = useState(null);
  const currentLocationRef = useRef(null);
  const [incomingOffer, setIncomingOffer] = useState(null);
  const [offers, setOffers] = useState([]);
  const [activeRideId, setActiveRideId] = useState(null);
  const [availableRides, setAvailableRides] = useState([]);
  const [nowTick, setNowTick] = useState(Date.now());
  const [driverEta, setDriverEta] = useState(null);
  const [pickupOTP, setPickupOTP] = useState(null);
  const [rideStatus, setRideStatus] = useState(null);
  // chat removed per request
  const [selectedDriverLive, setSelectedDriverLive] = useState(null);
  const [routeCoords, setRouteCoords] = useState([]);
    const [activeRideObj, setActiveRideObj] = useState(null);
  const [driverLocation, setDriverLocation] = useState(null);
  const simIntervalRef = useRef(null);
  const driverLocLastUpdateRef = useRef(0);
  const rideStatusRef = useRef(null);
  // driver profile fetch removed per request

  useEffect(() => {
    let offersUnsub = null;
    (async () => {
      const user = auth.currentUser || await waitForAuthReady(5000);
      if (!user) return;

  console.log('DRIVER LISTENER ACTIVE');
      if (!isOnline) {
        setIncomingOffer(null);
        setOffers([]);
        return;
      }

  console.log('DRIVER OFFERS QUERY for driverId:', user.uid);
  const offersQ = query(collection(db, 'driver_offers'), where('driverId', '==', user.uid));
      offersUnsub = safeOnSnapshot(offersQ, async (snap) => {
        console.log('DRIVER OFFERS SNAPSHOT:', snap.docs.length);
        // Log individual changes
        try {
          snap.docChanges().forEach(change => {
            console.log('CHANGE TYPE:', change.type);
            if (change.type === 'added') {
              console.log('NEW OFFER RECEIVED:', change.doc.data());
            }
          });
        } catch (e) {
          console.warn('docChanges not available or failed', e);
        }

          const rawOffers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          // Filter out non-sent or expired offers client-side to avoid showing stale requests
      const nowMs = Date.now();
      const GRACE_MS = 30 * 1000; // 30 seconds grace to account for clock skew and network lag
      const validOffers = rawOffers.filter(o => {
            try {
              if (String((o.status || '').toUpperCase()) !== 'SENT') return false;
              if (!o.expiresAt) return true;
              const exp = (typeof o.expiresAt.toMillis === 'function') ? o.expiresAt.toMillis() : (o.expiresAt instanceof Date ? o.expiresAt.getTime() : new Date(o.expiresAt).getTime());
        return exp + GRACE_MS > nowMs;
            } catch (_e) { return false; }
          }).sort((a, b) => {
            // sort by sentAt descending so newest offers appear first
            const aMs = (a.sentAt && typeof a.sentAt.toMillis === 'function') ? a.sentAt.toMillis() : (a.sentAt ? new Date(a.sentAt).getTime() : 0);
            const bMs = (b.sentAt && typeof b.sentAt.toMillis === 'function') ? b.sentAt.toMillis() : (b.sentAt ? new Date(b.sentAt).getTime() : 0);
            return bMs - aMs;
          });

          console.log('OFFERS RECEIVED RAW:', rawOffers.length, 'VALID:', validOffers.length, 'EXPIRED_OR_OTHER:', rawOffers.length - validOffers.length);
          // Enrich offers with estimated distance, duration, and fare for display
          const enriched = await Promise.all(validOffers.map(async (o) => {
            try {
              const pickup = o.pickupLocation || { latitude: 18.96952, longitude: 72.80727 };
              const drop = o.dropLocation || o.destination || null;
              let dropAddr = '';
              if (drop && (typeof drop.latitude === 'number' && typeof drop.longitude === 'number')) {
                dropAddr = await reverseGeocodeToAddress(drop.latitude, drop.longitude).catch(() => '');
              } else if (o.dropAddress) {
                dropAddr = o.dropAddress;
              }
              // compute road distance & duration to pickup from current driver location if available else use pickup as 0
              const from = driverLocation || selectedDriverLive || currentLocation || pickup;
              const routeInfo = drop ? await getRoadDistanceKm(from, pickup) : await getRoadDistanceKm(from, pickup);
              const distanceKm = routeInfo.distanceKm || 0;
              const durationMin = routeInfo.durationMin || 0;
              // prefer server-provided totals (including tip) if available
              const serverFare = o.fareWithTip ?? o.fare ?? o.estimatedPrice ?? null;
              const tipFromOffer = typeof o.tip === 'number' ? o.tip : null;
              const localDistance = drop ? (await getRoadDistanceKm(pickup, drop)).distanceKm : distanceKm;
              const localDuration = drop ? (await getRouteBetweenCoords(pickup, drop)).durationMin : durationMin;
              const computedFareNoTip = calculateFare({ distanceKm: localDistance, durationMin: localDuration, vehicleKey: 'GO', tip: 0 });
              const computedFare = serverFare != null ? serverFare : computedFareNoTip + (o.tip || 0);
              return { ...o, estInfo: { distanceKm, durationMin, fare: computedFare, tip: tipFromOffer, fareWithTip: serverFare }, pickupName: o.pickupName || 'Sophia College', dropAddress: dropAddr };
            } catch (e) { return { ...o, estInfo: {}, pickupName: o.pickupName || 'Sophia College' }; }
          }));
          setOffers(enriched);
          if (enriched.length > 0) setIncomingOffer(enriched[0]); else setIncomingOffer(null);
      }, (err) => console.warn('offers snapshot error', err));
    })();

    return () => { try { offersUnsub && offersUnsub(); } catch (_e) {} };
  }, [isOnline]);

  // Subscribe to available rides when driver is online
  useEffect(() => {
    if (!isOnline) {
      setAvailableRides([]);
      return;
    }

    let unsub = null;
    const processed = new Set();
    try {
      const ridesRef = collection(db, 'rides');
      // Listen for SEARCHING rides; expiry filtering is done client-side to avoid composite index requirements
      const ridesQ = query(ridesRef, where('status', '==', 'SEARCHING'));
      unsub = safeOnSnapshot(ridesQ, async (snap) => {
        const now = Date.now();
        for (const d of snap.docs) {
          const id = d.id;
          if (processed.has(id)) continue;
          const r = d.data();
          // Skip if offers already sent for non-shared (solo) rides
          if (r.offersSent === true && !r.allowPassengers) { processed.add(id); continue; }
          // Double-check expiry client-side
          try {
            const expMs = r.expiresAt && typeof r.expiresAt.toMillis === 'function' ? r.expiresAt.toMillis() : (r.expiresAt ? (new Date(r.expiresAt)).getTime() : null);
            if (!expMs || expMs > now) continue; // not yet expired
          } catch (_e) { continue; }
          // Trigger sendOffers for this ride
          try {
            await sendOffers(id).catch(console.warn);
          } catch (e) {
            console.warn('sendOffers call failed from driver listener', id, e);
          }
          // Mark processed so we don't call sendOffers again locally
          processed.add(id);
        }
      }, (err) => { console.warn('rides snapshot error (driver dashboard listener)', err); });
    } catch (e) { console.warn('subscribe rides failed', e); }

    return () => { try { unsub && unsub(); } catch (e) {} };
  }, [isOnline]);

  // tick to prune expired rides client-side
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!availableRides || availableRides.length === 0) return;
    const now = Date.now();
    const filtered = availableRides.filter(r => {
      const exp = r.expiresAt && typeof r.expiresAt.toMillis === 'function' ? r.expiresAt.toMillis() : (r.expiresAt ? (new Date(r.expiresAt)).getTime() : null);
      return exp && exp > now;
    });
    if (filtered.length !== availableRides.length) setAvailableRides(filtered);
  }, [nowTick]);

  // subscribe to active ride updates to show ActiveTripBottomSheet
  useEffect(() => {
    if (!activeRideId) {
      setRouteCoords([]);
      return;
    }
    const rideRef = doc(db, 'rides', activeRideId);
  const unsub = safeOnSnapshot(rideRef, (snap) => {
      if (!snap.exists()) return;
  const data = snap.data();
    // detect cancellation transition
    const newStatus = String(data.status || '').toUpperCase();
    const prevStatus = String(rideStatusRef.current || '').toUpperCase();
    if (newStatus === 'CANCELLED' && prevStatus !== 'CANCELLED') {
      try {
        Alert.alert('Ride cancelled', 'The rider has cancelled the trip. Returning to home.');
      } catch (_) {}
      // clear active ride state and stop any route simulation
      try { setActiveRideId(null); } catch (_) {}
      try { setActiveRideObj(null); } catch (_) {}
      try { setRouteCoords([]); } catch (_) {}
      try { setIncomingOffer(null); } catch (_) {}
      try { setRideStatus(null); } catch (_) {}
      try { setDriverEta(null); } catch (_) {}
      // clear any running simulation interval
      try { if (simIntervalRef.current) { clearInterval(simIntervalRef.current); simIntervalRef.current = null; } } catch (_) {}
      // leave driver online and ensure map will show current driverLocation
      try { setIsOnline(true); } catch (_) {}
      // update stored status and return early
      rideStatusRef.current = newStatus;
      return;
    }

    setDriverEta(data.driverETA || null);
    setPickupOTP(data.pickupOTP || null);
    setRideStatus(newStatus || null);
    setActiveRideObj({ id: snap.id, ...data });
    rideStatusRef.current = newStatus;

    // Enrich active ride with human-readable drop name and accurate ETA/fare
    (async () => {
      try {
        const pickup = data.pickupLocation || null;
        const drop = data.dropLocation || data.destination || null;
        // resolve drop address if needed
        if (drop && !(drop.name || drop.address)) {
          try {
            const addr = await reverseGeocodeToAddress(drop.latitude, drop.longitude);
            // merge into activeRideObj
            setActiveRideObj(prev => prev ? { ...prev, dropAddress: addr } : { id: snap.id, ...data, dropAddress: addr });
            // Persist resolved dropAddress back to ride doc (best-effort)
            try {
              await updateDoc(rideRef, { dropAddress: addr });
            } catch (_e) { console.warn('persist dropAddress failed', _e); }
          } catch (_e) { /* ignore */ }
        } else if (drop && (drop.name || drop.address)) {
          const addr = drop.name || drop.address;
          setActiveRideObj(prev => prev ? { ...prev, dropAddress: addr } : { id: snap.id, ...data, dropAddress: addr });
          try { await updateDoc(rideRef, { dropAddress: addr }); } catch (_e) { /* ignore */ }
        }

        // compute ETA and fare
        const from = driverLocation || selectedDriverLive || currentLocation || pickup || { latitude: 18.96952, longitude: 72.80727 };
        if (newStatus === 'ACCEPTED' && pickup) {
          try {
            const toPickup = await getRoadDistanceKm(from, pickup);
            setDriverEta(toPickup.durationMin || Math.round((toPickup.distanceKm || 0) * 2));
          } catch (_e) {}
        }

        if (pickup && drop) {
          try {
            const tripInfo = await getRoadDistanceKm(pickup, drop);
            const tripDuration = tripInfo.durationMin || Math.round((tripInfo.distanceKm || 0) * 2);
            const tripDistance = tripInfo.distanceKm || 0;
            const fare = calculateFare({ distanceKm: tripDistance, durationMin: tripDuration, vehicleKey: (data.vehicleType || 'GO') });
            // attach fare to activeRideObj for display
            setActiveRideObj(prev => prev ? { ...prev, estimatedFare: fare, estimatedDistanceKm: tripDistance, estimatedDurationMin: tripDuration } : { id: snap.id, ...data, estimatedFare: fare, estimatedDistanceKm: tripDistance, estimatedDurationMin: tripDuration });
            // persist estimated values back to ride doc (best-effort) and include tip if present
            try {
              const toWrite = { estimatedFare: fare, estimatedDistanceKm: tripDistance, estimatedDurationMin: tripDuration };
              if (typeof data.tip === 'number') toWrite.tip = data.tip;
              // also write fareWithTip so other clients can reuse
              const baseFare = (data?.fare?.total ?? data?.estimatedPrice ?? fare);
              toWrite.fareWithTip = baseFare + (typeof data.tip === 'number' ? data.tip : 0);
              await updateDoc(rideRef, toWrite);
            } catch (_e) { console.warn('persist estimates failed', _e); }
          } catch (_e) {}
        }
      } catch (_e) { /* ignore enrichment errors */ }
    })();
    // Set simple route coords depending on status
    try {
      const st = String(data.status || '').toUpperCase();
      if (st === 'ACCEPTED') {
        // driver -> pickup
        if (driverLocation && data.pickupLocation) {
          const rc = [ { latitude: driverLocation.latitude, longitude: driverLocation.longitude }, { latitude: data.pickupLocation.latitude, longitude: data.pickupLocation.longitude } ];
          setRouteCoords(rc);
        }
      } else if (st === 'ONGOING') {
        if (data.pickupLocation && (data.dropLocation || data.destination)) {
          const drop = data.dropLocation || data.destination;
          const rc = [ { latitude: data.pickupLocation.latitude, longitude: data.pickupLocation.longitude }, { latitude: drop.latitude, longitude: drop.longitude } ];
          setRouteCoords(rc);
        }
      } else {
        setRouteCoords([]);
      }
    } catch (_e) {}
      // navigate to OTP screen when driver marks ARRIVED
      try { if (String(data.status || '').toUpperCase() === 'ARRIVED') { try { navigation.navigate('OTPScreen', { rideId: snap.id }); } catch (_e) {} } } catch (_e) {}
      // keep driverRoute in state to show on map
      setRouteCoords(data.driverRoute || data.routeToDrop?.coordinates || []);
        if (String(data.status || '').toUpperCase() === 'COMPLETED') {
        setActiveRideId(null);
        setIsOnline(true);
        setRouteCoords([]);
      }
    }, (err) => {
      console.warn('ride snapshot error (driver dashboard)', err);
      // avoid uncaught errors; if permission denied, surface friendly message
      if (err?.code === 'permission-denied') {
        console.warn('Permission denied reading ride doc in driver dashboard');
      }
    });

    // also subscribe to our activeDrivers doc for live location to animate marker
    let liveUnsub = null;
    (async () => {
      try {
        const activeRef = doc(db, 'activeDrivers', auth.currentUser.uid);
  liveUnsub = safeOnSnapshot(activeRef, (s) => {
          if (!s.exists()) { setSelectedDriverLive(null); return; }
          const d = s.data();
          setSelectedDriverLive({ latitude: d.location.latitude, longitude: d.location.longitude, heading: d.heading, speed: d.speed });
        }, (err) => {
          console.warn('activeDrivers snapshot error (driver dashboard)', err);
        });
  } catch (_e) { console.warn('live driver sub failed', _e); }
    })();

  return () => { try { unsub(); } catch (_e) {}; try { liveUnsub && liveUnsub(); } catch (_e) {} };
  }, [activeRideId]);


  // Simulation movement toward next route point when routeCoords is set
  useEffect(() => {
    try {
      // clear any existing sim
      if (simIntervalRef.current) { clearInterval(simIntervalRef.current); simIntervalRef.current = null; }
      if (!routeCoords || routeCoords.length === 0) return;
      // target index 0->1 movement; start from driverLocation or routeCoords[0]
  simIntervalRef.current = setInterval(async () => {
        try {
          const cur = driverLocation || routeCoords[0];
          const target = routeCoords[1] || routeCoords[0];
          const stepFactor = 0.05; // move 5% towards target each tick
          const newLat = Number(cur.latitude) + (target.latitude - Number(cur.latitude)) * stepFactor;
          const newLng = Number(cur.longitude) + (target.longitude - Number(cur.longitude)) * stepFactor;
          const newLoc = { latitude: newLat, longitude: newLng };
          setDriverLocation(newLoc);
          // persist to firestore so map subscribers see movement (best-effort)
          try { await updateDoc(doc(db, 'activeDrivers', auth.currentUser.uid), { location: newLoc, updatedAt: serverTimestamp() }); } catch (_e) {}
          try { await updateDoc(doc(db, 'drivers', auth.currentUser.uid), { liveLocation: newLoc, updatedAt: serverTimestamp() }); } catch (_e) {}
          // Also update ride.driverETA and ride.driverDistanceKm periodically (throttled): compute remaining distance to route end and convert to minutes
          try {
            if (activeRideId) {
              // determine destination point: prefer last coordinate in routeCoords, fallback to activeRideObj dropLocation or pickupLocation
              let dest = null;
              if (Array.isArray(routeCoords) && routeCoords.length > 0) {
                const last = routeCoords[routeCoords.length - 1];
                // normalize possible array [lat,lng]
                if (Array.isArray(last) && last.length >= 2) dest = { latitude: Number(last[0]), longitude: Number(last[1]) };
                else if (last && typeof last.latitude === 'number' && typeof last.longitude === 'number') dest = { latitude: Number(last.latitude), longitude: Number(last.longitude) };
              }
              if (!dest && activeRideObj) {
                const dataDest = (activeRideObj.dropLocation || activeRideObj.destination || activeRideObj.pickupLocation);
                if (dataDest && typeof dataDest.latitude === 'number') dest = { latitude: dataDest.latitude, longitude: dataDest.longitude };
              }
              if (dest) {
                const dKm = calculateDistance(newLoc.latitude, newLoc.longitude, dest.latitude, dest.longitude);
                const etaMin = Math.max(0, Math.round(dKm * 2));
                const rideRef = doc(db, 'rides', activeRideId);
                try {
                  const prevEta = driverEta;
                  const prevDist = activeRideObj?.driverDistanceKm;
                  // update local state
                  setDriverEta(etaMin);
                  // persist only when significantly changed to avoid write storms
                  const needEtaWrite = (prevEta == null) || (Math.abs(prevEta - etaMin) >= 1);
                  const needDistWrite = (prevDist == null) || (Math.abs((prevDist || 0) - dKm) >= 0.05);
                  if (needEtaWrite || needDistWrite) {
                    const toWrite = {};
                    if (needEtaWrite) toWrite.driverETA = etaMin;
                    if (needDistWrite) toWrite.driverDistanceKm = dKm;
                    try { await updateDoc(rideRef, toWrite); } catch (_e) { /* ignore */ }
                  }
                } catch (_e) { /* ignore ride doc update failures */ }
              }
            }
          } catch (_e) {}
        } catch (_e) {}
      }, 1000);
    } catch (_e) {}
    return () => { try { if (simIntervalRef.current) { clearInterval(simIntervalRef.current); simIntervalRef.current = null; } } catch (_e) {} };
  }, [routeCoords, driverLocation]);


  // Subscribe to drivers/{uid} for liveLocation updates and compute ETA to pickup
  useEffect(() => {
    let drvUnsub = null;
    try {
      if (!auth.currentUser) return;
      const drvRef = doc(db, 'drivers', auth.currentUser.uid);
      drvUnsub = safeOnSnapshot(drvRef, (s) => {
        if (!s.exists()) return;
        const data = s.data();
        if (data?.liveLocation && typeof data.liveLocation.latitude === 'number') {
          const loc = { latitude: data.liveLocation.latitude, longitude: data.liveLocation.longitude };
          setDriverLocation(loc);
          driverLocLastUpdateRef.current = Date.now();
          // compute ETA simple formula when we have a pickup
          try {
            if (activeRideObj && activeRideObj.pickupLocation) {
              const dKm = calculateDistance(loc.latitude, loc.longitude, activeRideObj.pickupLocation.latitude, activeRideObj.pickupLocation.longitude);
              const etaMin = Math.max(0, Math.round(dKm * 2));
              setDriverEta(etaMin);
            }
          } catch (_e) {}
        }
      }, (err) => console.warn('drivers doc snapshot failed', err));
    } catch (_e) { /* ignore */ }

    return () => { try { drvUnsub && drvUnsub(); } catch (_e) {} };
  }, [activeRideObj]);


  // Fake movement: if driverLocation is static for >5s and we have an active pickup, nudge toward pickup
  useEffect(() => {
    if (!activeRideObj || !activeRideObj.pickupLocation) return;
    let intId = null;
    try {
      intId = setInterval(async () => {
        try {
          const last = driverLocLastUpdateRef.current || 0;
          if (Date.now() - last < 5000) return; // recent real update
          if (!driverLocation) return;
          const target = activeRideObj.pickupLocation;
          const dx = target.latitude - driverLocation.latitude;
          const dy = target.longitude - driverLocation.longitude;
          const step = 0.00005; // small step
          const dist = Math.sqrt(dx*dx + dy*dy);
          if (dist < 0.00005) return;
          const nx = driverLocation.latitude + (dx/dist) * step;
          const ny = driverLocation.longitude + (dy/dist) * step;
          const coords = { latitude: nx, longitude: ny };
          setDriverLocation(coords);
          driverLocLastUpdateRef.current = Date.now();
          try { await updateDoc(doc(db, 'drivers', auth.currentUser.uid), { liveLocation: coords, updatedAt: serverTimestamp() }); } catch (_e) {}
          try { await updateDoc(doc(db, 'activeDrivers', auth.currentUser.uid), { location: coords, updatedAt: serverTimestamp() }); } catch (_e) {}
        } catch (_e) {}
      }, 1000);
    } catch (_e) {}
    return () => { try { intId && clearInterval(intId); } catch (_e) {} };
  }, [activeRideObj, driverLocation]);

  // Map and driver location updates are handled by external publishers; do not use device location APIs here.

  const goOnline = async () => {
    try {
      // Ensure the user is authenticated before going online
      const user = auth.currentUser || await waitForAuthReady(5000);
      if (!user) {
        Alert.alert('Not signed in', 'Please sign in before going online.');
        return;
      }
      // Start simulated movement publisher: update activeDrivers periodically so map shows driver
      try {
        // choose a sensible starting point: prefer existing driverLocation, then selectedDriverLive, then currentLocation, else Sophia pickup
  const start = driverLocation || selectedDriverLive || currentLocation || { latitude: 18.96952, longitude: 72.80727 };
        // ensure activeDrivers doc has an initial location
        try { await updateDoc(doc(db, 'activeDrivers', user.uid), { location: { latitude: start.latitude, longitude: start.longitude }, isAvailable: true, updatedAt: serverTimestamp() }); } catch (e) {}
        // small step movement per tick
        const step = 0.00001;
        simIntervalRef.current = setInterval(async () => {
          try {
            const cur = driverLocation || selectedDriverLive || currentLocation || { latitude: start.latitude, longitude: start.longitude };
            const newLat = Number(cur.latitude) + step;
            const newLng = Number(cur.longitude) + step;
            const coords = { latitude: newLat, longitude: newLng };
            setDriverLocation(coords);
            try { await updateDoc(doc(db, 'drivers', user.uid), { liveLocation: coords, updatedAt: serverTimestamp() }); } catch (_e) {}
            try { await updateDoc(doc(db, 'activeDrivers', user.uid), { location: coords, updatedAt: serverTimestamp() }); } catch (_e) {}
          } catch (_e) { /* swallow */ }
        }, 1000);
      } catch (_e) { console.warn('start simulated movement failed', _e); }
  setIsOnline(true);
  // Mark driver as online in drivers collection so offerManager queries will find only online drivers
  try {
    await setDoc(doc(db, 'drivers', user.uid), { isOnline: true, updatedAt: serverTimestamp() }, { merge: true });
  } catch (e) {
    console.warn('Failed to mark driver isOnline in drivers collection', e);
  }

  // Create or mark an activeDrivers doc so location/offers can reference the driver.
  // If we already have a mirrored liveLocation in drivers collection, copy it so offers can be sent immediately.
  try {
    try {
      const drvRef = doc(db, 'drivers', user.uid);
      const drvSnap = await getDoc(drvRef);
      const base = { driverId: user.uid, isAvailable: true, updatedAt: serverTimestamp() };
      if (drvSnap && drvSnap.exists()) {
        const live = drvSnap.data()?.liveLocation;
        if (live && (live.latitude != null && live.longitude != null)) {
          base.location = live;
        }
      }
      await setDoc(doc(db, 'activeDrivers', user.uid), base, { merge: true });
    } catch (e) {
      // fallback: create activeDrivers without location
      await setDoc(doc(db, 'activeDrivers', user.uid), { driverId: user.uid, isAvailable: true, updatedAt: serverTimestamp() }, { merge: true });
    }
  } catch (e) {
    console.warn('Failed to create/mark activeDrivers doc', e);
  }
    } catch (_e) {
      console.warn('goOnline failed', _e);
    }
  };

  const goOffline = async () => {
    try {
      setIsOnline(false);
      const { goOffline } = await import('../../firebase/driverLocationService');
      await goOffline();
      // mark driver profile as offline
      try {
        const user = auth.currentUser || await waitForAuthReady(5000);
        if (user) await setDoc(doc(db, 'drivers', user.uid), { isOnline: false, updatedAt: serverTimestamp() }, { merge: true });
      } catch (e) {
        console.warn('Failed to mark driver offline in drivers collection', e);
      }
  // stop simulated movement interval if present
  try { if (simIntervalRef.current) { clearInterval(simIntervalRef.current); simIntervalRef.current = null; } } catch (_e) {}
  // clear any incoming offers when we go offline
  setIncomingOffer(null);
    } catch (_e) {
      console.warn('goOffline failed', _e);
    }
  };

  const onAcceptOffer = async () => {
  if (!incomingOffer) return;
  if (!isOnline) return Alert.alert('Offline', 'Go online to accept ride requests');

    // Read the ride doc as a fallback so the confirm dialog shows the real drop
    let dropFromRide = null;
    try {
      const rideRef = doc(db, 'rides', incomingOffer.rideId);
      const rideSnap = await getDoc(rideRef);
      if (rideSnap.exists()) {
        const ride = rideSnap.data();
        dropFromRide = ride.dropLocation?.name || ride.dropLocation?.address || ride.destination?.name || null;
      }
    } catch (_e) {
      console.warn('Could not read ride for confirm dialog', _e);
    }
    // Try to resolve a friendly drop address if possible (incomingOffer might lack dropAddress)
    let resolvedDrop = incomingOffer.dropAddress || incomingOffer.dropLocation?.name || dropFromRide || null;
    try {
      if (!resolvedDrop && incomingOffer.dropLocation && typeof incomingOffer.dropLocation.latitude === 'number' && typeof incomingOffer.dropLocation.longitude === 'number') {
        const addr = await reverseGeocodeToAddress(incomingOffer.dropLocation.latitude, incomingOffer.dropLocation.longitude).catch(() => null);
        if (addr) {
          resolvedDrop = addr;
          // update local incomingOffer so other UI reads display the resolved name
          try { setIncomingOffer(prev => prev ? { ...prev, dropAddress: addr } : prev); } catch (_e) {}
        }
      }
      // fallback to formatted coords if still missing
      if (!resolvedDrop && incomingOffer.dropLocation && typeof incomingOffer.dropLocation.latitude === 'number' && typeof incomingOffer.dropLocation.longitude === 'number') {
        resolvedDrop = `${incomingOffer.dropLocation.latitude.toFixed(4)}, ${incomingOffer.dropLocation.longitude.toFixed(4)}`;
      }
    } catch (_e) { /* ignore */ }

  const drop = resolvedDrop || 'unknown drop';
    const offerFare = incomingOffer?.estInfo?.fare ?? incomingOffer?.fare ?? incomingOffer?.estimatedPrice ?? null;
    const offerTip = incomingOffer?.estInfo?.tip ?? incomingOffer?.tip ?? 0;
    const fare = offerFare != null ? ` • ₹${offerFare}${offerTip ? ` (incl. tip ₹${offerTip})` : ''}` : '';
    Alert.alert(
      'Confirm Accept',
      `Accept ride to: ${drop}${fare}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Accept',
          onPress: async () => {
            try {
              await acceptOffer(incomingOffer.id, incomingOffer.rideId, auth.currentUser.uid);
              setActiveRideId(incomingOffer.rideId);
              setIncomingOffer(null);
              // Keep driver online so location updates continue and rideRoute/ETA are computed
              setIsOnline(true);
              // Immediately push a location update (best-effort) so the ride doc gets route/ETA and maps show motion
              // Per final map policy, do not fetch device location here. Drivers should
              // publish their location via an external process. Skip immediate location update.
            } catch (_e) {
              Alert.alert('Failed to accept', _e.message || 'Could not accept offer');
            }
          }
        }
      ]
    );
  };

  const handleVerifyOTP = async (otp) => {
    if (!activeRideId) return Alert.alert('No ride', 'No active ride to verify');
    if (!otp || String(otp).trim().length === 0) return Alert.alert('Enter OTP', 'Please enter the OTP from the rider');
    try {
      await verifyPickupOTP(activeRideId, String(otp).trim());
      Alert.alert('Trip started', 'OTP verified and trip started');
    } catch (_e) {
      Alert.alert('OTP failed', _e.message || 'Invalid OTP');
    }
  };

    const handleCompleteRide = async () => {
      if (!activeRideId) return Alert.alert('No ride', 'No active ride to complete');
      try {
        await completeRide(activeRideId);
        // mark driver available (no currentRideId)
  // Per final map policy, do not fetch device location here. Skip post-complete location update.
        Alert.alert('Completed', 'Trip marked completed');
        setActiveRideId(null);
        setIncomingOffer(null);
        setRouteCoords([]);
        setActiveRideObj(null);
        setIsOnline(true);
      } catch (_e) {
        console.warn('complete failed', _e);
        Alert.alert('Complete failed', _e.message || 'Could not complete ride');
      }
    };

  const onRejectOffer = async () => {
    if (!incomingOffer) return;

    // Read ride doc as fallback for the reject dialog
    let dropFromRide = null;
    try {
      const rideRef = doc(db, 'rides', incomingOffer.rideId);
      const rideSnap = await getDoc(rideRef);
      if (rideSnap.exists()) {
        const ride = rideSnap.data();
        dropFromRide = ride.dropLocation?.name || ride.dropLocation?.address || ride.destination?.name || null;
      }
    } catch (_e) {
      console.warn('Could not read ride for reject dialog', _e);
    }

  const drop = incomingOffer.dropAddress || incomingOffer.dropLocation?.name || (incomingOffer.dropLocation && typeof incomingOffer.dropLocation.latitude === 'number' && typeof incomingOffer.dropLocation.longitude === 'number' ? `${incomingOffer.dropLocation.latitude.toFixed(4)}, ${incomingOffer.dropLocation.longitude.toFixed(4)}` : null) || dropFromRide || 'unknown drop';
    Alert.alert(
      'Confirm Reject',
      `Reject ride to: ${drop}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reject',
          style: 'destructive',
          onPress: async () => {
            try {
              await updateDoc(doc(db, 'driver_offers', incomingOffer.id), { status: 'rejected' });
              setIncomingOffer(null);
          } catch (_e) {
            console.warn('reject failed', _e);
            Alert.alert('Reject failed', _e.message || 'Could not reject offer');
          }
          }
        }
      ]
    );
  };

  const handleArrived = async () => {
    if (!activeRideId) {
      Alert.alert('No active ride', 'There is no active ride to mark as arrived.');
      return;
    }
    try {
      await markArrived(activeRideId);
      Alert.alert('Arrived', 'Marked as arrived at pickup.');
    } catch (_e) {
      console.warn('markArrived failed', _e);
      if (_e?.code === 'permission-denied') {
        Alert.alert('Permission denied', 'Cannot mark arrived. Check Firestore rules or your auth status.');
      } else {
        Alert.alert('Failed', _e?.message || 'Could not mark arrived');
      }
    }
  };

  const handleNavigateToPickup = async () => {
    if (!activeRideId) {
      Alert.alert('No active ride', 'There is no active ride to navigate to.');
      return;
    }
    try {
      const rideRef = doc(db, 'rides', activeRideId);
      const snap = await getDoc(rideRef);
      if (!snap.exists()) {
        Alert.alert('Ride not found', 'Could not find the active ride');
        return;
      }
      const data = snap.data();
      // Prefer published/simulated driver location (driverLocation), then active driver live snapshot (selectedDriverLive), then device currentLocation
      const loc = driverLocation || selectedDriverLive || currentLocation || null;
      if (!loc || typeof loc.latitude !== 'number' || typeof loc.longitude !== 'number') {
        Alert.alert('Location required', 'Current location is not available. Please ensure driver location is being published (go online) before navigating.');
        return;
      }
      if (data.pickupLocation) {
        const route = await getRouteBetweenCoords({ latitude: loc.latitude, longitude: loc.longitude }, { latitude: data.pickupLocation.latitude, longitude: data.pickupLocation.longitude });
        setRouteCoords(route.coordinates || route.geometry?.coordinates || []);
      }
    } catch (_e) {
      console.warn('navigate to pickup failed', _e);
      if (_e?.code === 'permission-denied') {
        Alert.alert('Permission denied', 'Cannot read ride details. Check Firestore rules or auth.');
      } else {
        Alert.alert('Navigation failed', _e?.message || 'Could not compute route to pickup');
      }
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, paddingTop: 88 }}>
      <TopBar navigation={navigation} showLogout={true} />
      {/* Online toggle restored in-screen */}
      <View style={styles.controls} pointerEvents="box-none">
        <TouchableOpacity style={[styles.toggle, { backgroundColor: isOnline ? '#22A07A' : '#dc3545' }]} onPress={() => { if (isOnline) goOffline(); else goOnline(); }}>
          <Text style={{ color: '#fff' }}>{isOnline ? 'Go Offline' : 'Go Online'}</Text>
        </TouchableOpacity>
      </View>
  <MapComponent
  userLocation={currentLocation || null}
  drivers={driverLocation ? [{ id: auth.currentUser?.uid || 'me', latitude: driverLocation.latitude, longitude: driverLocation.longitude }] : []}
  selectedDriverId={auth.currentUser?.uid || null}
  ride={activeRideObj}
    onMessage={async (msg) => {
      try {
        if (!msg || !msg.type) return;
        // accept legacy 'eta' message or new 'ETA_UPDATE'
        if (msg.type === 'eta') {
          setDriverEta(msg.remaining);
        } else if (msg.type === 'ETA_UPDATE') {
          // WebView posts { type: 'ETA_UPDATE', eta: <minutes> }
          const etaVal = typeof msg.eta === 'number' ? msg.eta : (msg.eta ? Number(msg.eta) : null);
          setDriverEta(etaVal);
          // Persist ETA and remaining distance to ride doc so rider UI shows same values
          try {
            if (activeRideId) {
              // determine destination based on current ride status
              let dest = null;
              const status = String(rideStatus || (activeRideObj && activeRideObj.status) || '').toUpperCase();
              if (status === 'ACCEPTED') {
                dest = activeRideObj?.pickupLocation || null;
              } else if (status === 'ONGOING') {
                dest = activeRideObj?.dropLocation || activeRideObj?.destination || null;
              } else {
                // fallback to dropLocation if present
                dest = activeRideObj?.dropLocation || activeRideObj?.destination || activeRideObj?.pickupLocation || null;
              }
              if (dest && typeof dest.latitude === 'number' && typeof dest.longitude === 'number') {
                const loc = driverLocation || selectedDriverLive || currentLocation || (activeRideObj && activeRideObj.pickupLocation) || { latitude: 18.96952, longitude: 72.80727 };
                const dKm = calculateDistance(loc.latitude, loc.longitude, dest.latitude, dest.longitude);
                const rideRef = doc(db, 'rides', activeRideId);
                try { await updateDoc(rideRef, { driverETA: etaVal, driverDistanceKm: dKm }); } catch (_e) { /* ignore */ }
              } else if (etaVal != null) {
                const rideRef = doc(db, 'rides', activeRideId);
                try { await updateDoc(rideRef, { driverETA: etaVal }); } catch (_e) { /* ignore */ }
              }
            }
          } catch (e) { console.warn('persist ETA failed', e); }
        } else if (msg.type === 'complete') {
          try { await completeRide(activeRideId); } catch (e) { console.warn('auto-complete failed', e); }
        }
      } catch (e) { console.warn('map onMessage driver handler', e); }
    }}
  />

  {/* profile card removed per request */}

  <IncomingRequestBottomSheet visible={!!incomingOffer} onAccept={onAcceptOffer} onReject={onRejectOffer} dropAddress={incomingOffer?.dropAddress || ''} dropLocation={incomingOffer?.dropLocation || incomingOffer?.destination || null} estInfo={incomingOffer?.estInfo || {}} alreadyClaimed={incomingOffer?.alreadyClaimed} disabled={!isOnline} blockBackgroundTouches={false} />
  <ActiveTripBottomSheet visible={!!activeRideId} onNavigate={handleNavigateToPickup} onArrived={handleArrived} driverEta={driverEta} pickupOTP={pickupOTP} onVerifyOTP={handleVerifyOTP} rideStatus={rideStatus} ride={activeRideObj} onComplete={handleCompleteRide} blockBackgroundTouches={false} />
  {/* Chat removed from controls */}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  controls: { position: 'absolute', top: 20, left: 12, right: 12, flexDirection: 'row', justifyContent: 'space-between' },
  toggle: { padding: 12, borderRadius: 8 },
  chatBtn: { padding: 12, borderRadius: 8, backgroundColor: '#276EF1' },
});
      // set driver as busy and start sending GPS updates with currentRideId
