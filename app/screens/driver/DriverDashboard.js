import React, { useEffect, useState, useRef } from 'react';
import { Alert, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import MapComponent from '../../../components/MapComponent';
import IncomingRequestBottomSheet from '../../components/IncomingRequestBottomSheet';
import ActiveTripBottomSheet from '../../components/ActiveTripBottomSheet';
import TopBar from '../../components/TopBar';
// driver profile fetching removed per request
import { getRouteBetweenCoords, reverseGeocodeToAddress } from '../../services/locationService';
import { auth } from '../../firebase/firebaseConfig';
import { waitForAuthReady, updateDriverLocation } from '../../firebase/driverLocationService';
import { acceptOffer } from '../../firebase/offerManager';
import { verifyPickupOTP } from '../../firebase/rideService';
import { doc, collection, query, where, updateDoc, getDoc } from 'firebase/firestore';
import { completeRide } from '../../firebase/rideService';
import { db, safeOnSnapshot } from '../../firebase/firebaseConfig';

export default function DriverDashboard({ navigation }) {
  const [isOnline, setIsOnline] = useState(false);
  const [currentLocation, setCurrentLocation] = useState(null);
  const currentLocationRef = useRef(null);
  const [incomingOffer, setIncomingOffer] = useState(null);
  const [activeRideId, setActiveRideId] = useState(null);
  const [driverEta, setDriverEta] = useState(null);
  const [pickupOTP, setPickupOTP] = useState(null);
  const [rideStatus, setRideStatus] = useState(null);
  // chat removed per request
  const [selectedDriverLive, setSelectedDriverLive] = useState(null);
  const [routeCoords, setRouteCoords] = useState([]);
    const [activeRideObj, setActiveRideObj] = useState(null);
  // driver profile fetch removed per request

  useEffect(() => {
    let offersUnsub = null;
    (async () => {
      const user = auth.currentUser || await waitForAuthReady(5000);
      if (!user) return;

      // Only subscribe to incoming offers when the driver is online
      if (!isOnline) {
        // Ensure UI clears any stale offers when offline
        setIncomingOffer(null);
        return;
      }

      // Subscribe to driver_offers where status=='sent'
      const offersQ = query(collection(db, 'driver_offers'), where('driverId', '==', user.uid), where('status', '==', 'sent'));
      offersUnsub = safeOnSnapshot(offersQ, async (snap) => {
        const offers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        if (offers.length > 0) {
          const o = offers[0];
          let estInfoFromOffer = (o.etaToPickupSeconds != null || o.distanceToPickupKm != null || o.estimatedPrice != null) ? {
            distanceKm: o.distanceToPickupKm ?? null,
            durationMin: o.etaToPickupSeconds != null ? (o.etaToPickupSeconds / 60) : null,
            fare: o.estimatedPrice ?? null,
          } : {};
          let dropAddr = o.dropLocation?.name || o.dropLocation?.address || o.dropAddress || '';

          try {
            const rideRef = doc(db, 'rides', o.rideId);
            const rideSnap = await getDoc(rideRef);
            if (rideSnap.exists()) {
              const ride = rideSnap.data();
              if (ride.driverId && ride.driverId !== user.uid) {
                setIncomingOffer({ ...o, alreadyClaimed: true });
                return;
              }
              const dropFromRide = ride.dropLocation?.name || ride.dropLocation?.address || ride.destination?.name || null;
              if (dropFromRide) dropAddr = dropAddr || dropFromRide;

              if ((!estInfoFromOffer.distanceKm || !estInfoFromOffer.durationMin) && ride.pickupLocation) {
                try {
                  const activeRef = doc(db, 'activeDrivers', user.uid);
                  const activeSnap = await getDoc(activeRef);
                  if (activeSnap.exists()) {
                    const loc = activeSnap.data().location;
                    if (loc) {
                      const route = await getRouteBetweenCoords({ latitude: loc.latitude, longitude: loc.longitude }, { latitude: ride.pickupLocation.latitude, longitude: ride.pickupLocation.longitude });
                      estInfoFromOffer = { distanceKm: route.distanceKm, durationMin: route.durationMin, fare: ride.estimatedPrice || o.estimatedPrice || null };
                    }
                  }
                } catch (e) {
                  console.warn('precheck route failed', e);
                }
              }
            }
          } catch (e) {
            console.warn('precheck offer failed', e);
          }

          // If we still don't have a human-friendly drop text, try reverse-geocoding coordinates
          try {
            const candidate = o.dropLocation || o.destination || null;
            if (!dropAddr && candidate && typeof candidate.latitude === 'number' && typeof candidate.longitude === 'number') {
              const addr = await reverseGeocodeToAddress(candidate.latitude, candidate.longitude);
              if (addr) dropAddr = addr;
            }
          } catch (e) {
            console.warn('reverse geocode fallback failed', e);
          }

          // prefer ride's dropLocation/destination object for richer display
          let normalizedDropLocation = o.dropLocation || o.destination || null;
          try {
            const rideRef = doc(db, 'rides', o.rideId);
            const rideSnap = await getDoc(rideRef);
            if (rideSnap.exists()) {
              const ride = rideSnap.data();
              normalizedDropLocation = normalizedDropLocation || ride.dropLocation || ride.destination || null;
            }
          } catch (e) {
            /* ignore */
          }

          setIncomingOffer({ ...o, estInfo: estInfoFromOffer, dropAddress: dropAddr, dropLocation: normalizedDropLocation });
        }
      }, (err) => console.warn('offers snapshot error', err));
    })();

    return () => { try { offersUnsub && offersUnsub(); } catch (e) {} };
  }, [isOnline]);

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
  setDriverEta(data.driverETA || null);
  setPickupOTP(data.pickupOTP || null);
  setRideStatus(data.status || null);
    setActiveRideObj({ id: snap.id, ...data });
      // keep driverRoute in state to show on map
      setRouteCoords(data.driverRoute || data.routeToDrop?.coordinates || []);
      if (data.status === 'completed') {
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
      } catch (e) { console.warn('live driver sub failed', e); }
    })();

    return () => { try { unsub(); } catch (e) {}; try { liveUnsub && liveUnsub(); } catch (e) {} };
  }, [activeRideId]);

  // Simple location watcher using interval (replace with watchLocation in prod)
  useEffect(() => {
    let t = null;
    if (isOnline) {
      t = setInterval(async () => {
        // get current location using MapComponent helper
        try {
          // ensure auth is ready before attempting to update location
          const user = auth.currentUser || await waitForAuthReady(3000);
          if (!user) {
            console.warn('location poll aborted: user not authenticated');
            // stop being online if user signed out unexpectedly
            setIsOnline(false);
            return;
          }
          const { getCurrentLocation } = await import('../../services/locationService');
          const loc = await getCurrentLocation();
          if (loc) {
            setCurrentLocation(loc);
            currentLocationRef.current = loc;
            await updateDriverLocation(loc, activeRideId, !activeRideId);
          }
        } catch (e) {
          console.warn('location poll failed', e);
        }
      }, 5000);
    }
    return () => { if (t) clearInterval(t); };
  }, [isOnline, activeRideId]);

  const goOnline = async () => {
    try {
      // Ensure the user is authenticated before going online
      const user = auth.currentUser || await waitForAuthReady(5000);
      if (!user) {
        Alert.alert('Not signed in', 'Please sign in before going online.');
        return;
      }
      setIsOnline(true);
      // post immediate location so activeDrivers doc exists
      const { getCurrentLocation } = await import('../../services/locationService');
      const loc = await getCurrentLocation();
      if (loc) {
        setCurrentLocation(loc);
        currentLocationRef.current = loc;
        await updateDriverLocation(loc, activeRideId, true);
      }
    } catch (e) {
      console.warn('goOnline failed', e);
    }
  };

  const goOffline = async () => {
    try {
      setIsOnline(false);
      const { goOffline } = await import('../../firebase/driverLocationService');
      await goOffline();
  // clear any incoming offers when we go offline
  setIncomingOffer(null);
    } catch (e) {
      console.warn('goOffline failed', e);
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
    } catch (e) {
      console.warn('Could not read ride for confirm dialog', e);
    }

  const formatCoords = (d) => (d && typeof d.latitude === 'number' && typeof d.longitude === 'number') ? `${d.latitude.toFixed(5)}, ${d.longitude.toFixed(5)}` : null;
  const drop = incomingOffer.dropAddress || incomingOffer.dropLocation?.name || formatCoords(incomingOffer.dropLocation) || dropFromRide || 'unknown drop';
    const fare = incomingOffer.estimatedPrice != null ? ` • ₹${incomingOffer.estimatedPrice}` : '';
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
              try {
                const { getCurrentLocation } = await import('../../services/locationService');
                const loc = await getCurrentLocation();
                if (loc) {
                  setCurrentLocation(loc);
                  currentLocationRef.current = loc;
                  // mark driver as busy (isAvailable=false) and attach currentRideId so backend computes route
                  await updateDriverLocation(loc, incomingOffer.rideId, false);
                }
              } catch (e) {
                console.warn('post-accept immediate location update failed', e);
              }
            } catch (e) {
              Alert.alert('Failed to accept', e.message || 'Could not accept offer');
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
    } catch (e) {
      Alert.alert('OTP failed', e.message || 'Invalid OTP');
    }
  };

    const handleCompleteRide = async () => {
      if (!activeRideId) return Alert.alert('No ride', 'No active ride to complete');
      try {
        await completeRide(activeRideId);
        // mark driver available (no currentRideId)
        try {
          const { getCurrentLocation } = await import('../../services/locationService');
          const loc = await getCurrentLocation();
          if (loc) await updateDriverLocation(loc, null, true);
        } catch (e) {
          console.warn('post-complete location update failed', e);
        }
        Alert.alert('Completed', 'Trip marked completed');
        setActiveRideId(null);
        setIncomingOffer(null);
        setRouteCoords([]);
        setActiveRideObj(null);
        setIsOnline(true);
      } catch (e) {
        console.warn('complete failed', e);
        Alert.alert('Complete failed', e.message || 'Could not complete ride');
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
    } catch (e) {
      console.warn('Could not read ride for reject dialog', e);
    }

  const drop = incomingOffer.dropAddress || incomingOffer.dropLocation?.name || formatCoords(incomingOffer.dropLocation) || dropFromRide || 'unknown drop';
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
            } catch (e) {
              console.warn('reject failed', e);
              Alert.alert('Reject failed', e.message || 'Could not reject offer');
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
      const { markArrived } = await import('../../firebase/rideService');
      await markArrived(activeRideId);
      Alert.alert('Arrived', 'Marked as arrived at pickup.');
    } catch (e) {
      console.warn('markArrived failed', e);
      if (e?.code === 'permission-denied') {
        Alert.alert('Permission denied', 'Cannot mark arrived. Check Firestore rules or your auth status.');
      } else {
        Alert.alert('Failed', e?.message || 'Could not mark arrived');
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
      let loc = currentLocation;
      if (!loc) {
        const { getCurrentLocation } = await import('../../services/locationService');
        loc = await getCurrentLocation();
        if (loc) {
          setCurrentLocation(loc);
          currentLocationRef.current = loc;
        } else {
          Alert.alert('Location error', 'Unable to determine current location');
          return;
        }
      }
      if (loc && data.pickupLocation) {
        const route = await getRouteBetweenCoords({ latitude: loc.latitude, longitude: loc.longitude }, { latitude: data.pickupLocation.latitude, longitude: data.pickupLocation.longitude });
        setRouteCoords(route.coordinates || route.geometry?.coordinates || []);
      }
    } catch (e) {
      console.warn('navigate to pickup failed', e);
      if (e?.code === 'permission-denied') {
        Alert.alert('Permission denied', 'Cannot read ride details. Check Firestore rules or auth.');
      } else {
        Alert.alert('Navigation failed', e?.message || 'Could not compute route to pickup');
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
      <MapComponent showUserLocation={true} selectedDriverId={auth.currentUser?.uid} selectedDriverLive={selectedDriverLive} routeCoordinates={routeCoords} followDriver={!!activeRideId} />

  {/* profile card removed per request */}

  <IncomingRequestBottomSheet visible={!!incomingOffer} onAccept={onAcceptOffer} onReject={onRejectOffer} dropAddress={incomingOffer?.dropAddress || ''} dropLocation={incomingOffer?.dropLocation || incomingOffer?.destination || null} estInfo={incomingOffer?.estInfo || {}} alreadyClaimed={incomingOffer?.alreadyClaimed} disabled={!isOnline} />
  <ActiveTripBottomSheet visible={!!activeRideId} onNavigate={handleNavigateToPickup} onArrived={handleArrived} driverEta={driverEta} pickupOTP={pickupOTP} onVerifyOTP={handleVerifyOTP} rideStatus={rideStatus} ride={activeRideObj} onComplete={handleCompleteRide} />
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
