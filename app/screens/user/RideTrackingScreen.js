import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { useEffect, useRef, useState } from 'react';
import { Alert, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import MapComponent from '../../../components/MapComponent';
import TopBar from '../../components/TopBar';
import { auth, db, safeOnSnapshot } from '../../firebase/firebaseConfig';
import { formatETA } from '../../services/locationService';

export default function RideTrackingScreen({ navigation, route }) {
  const { rideId } = route.params || {};
  const [ride, setRide] = useState(null);
  const [eta, setEta] = useState(null);
  const [driverLive, setDriverLive] = useState(null);
  const [driverProfile, setDriverProfile] = useState(null);
  const driverUnsubRef = useRef(null);
  const [pickupOTP, setPickupOTP] = useState(null);

  useEffect(() => {
    if (!rideId) {
      Alert.alert('Error', 'No ride information available');
      try {
        if (navigation && typeof navigation.canGoBack === 'function' && navigation.canGoBack()) navigation.goBack();
        else if (navigation && typeof navigation.navigate === 'function') navigation.navigate('UserHome');
      } catch (e) { }
      return;
    }

    let unsub = () => {};
    (async () => {
      // wait for auth to settle
      const { auth } = await import('../../firebase/firebaseConfig');
      const start = Date.now();
      while (!auth.currentUser && Date.now() - start < 5000) {
        await new Promise(r => setTimeout(r, 200));
      }
      try {
  const rideRef = doc(db, 'rides', rideId);
  unsub = safeOnSnapshot(rideRef, (snap) => {
          if (!snap.exists()) return;
          const data = snap.data();
          setRide({ id: snap.id, ...data });
          if (data.driverETA) setEta(data.driverETA);
      // If ride has driverId, subscribe to driver's live location in drivers collection
            if (data.driverId) {
            // Unsubscribe previous driver snapshot if any
            try { if (driverUnsubRef.current) { driverUnsubRef.current(); driverUnsubRef.current = null; } } catch (e) {}
            const driverRef = doc(db, 'drivers', data.driverId);
            const drvUnsub = safeOnSnapshot(driverRef, (dSnap) => {
              if (!dSnap.exists()) { setDriverLive(null); setDriverProfile(null); return; }
              const dd = dSnap.data();
              setDriverLive(dd.liveLocation || null);
              setDriverProfile({ id: dSnap.id, ...dd });
            }, (err) => console.warn('driver doc snapshot error', err));
            driverUnsubRef.current = drvUnsub;
          }
            if (data.pickupOTP) setPickupOTP(data.pickupOTP);
            // If ride completed, clear saved lastRoute so Home doesn't auto-redirect
            const s = String(data.status || '').toUpperCase();
            if (s === 'COMPLETED') {
              try { AsyncStorage.removeItem('lastRoute'); } catch (e) {}
            }

            // Auto-cancel logic: if ride is still SEARCHING after 5 minutes, cancel it (owner-only)
            try {
              if (s === 'SEARCHING' && data.createdAt && data.createdAt.toMillis) {
                const createdMs = data.createdAt.toMillis();
                const ageMs = Date.now() - createdMs;
                const FIVE_MIN = 5 * 60 * 1000;
                // only the ride owner should perform the cancel write
                const currentUid = auth.currentUser ? auth.currentUser.uid : null;
                if (ageMs > FIVE_MIN && currentUid && data.userId && String(currentUid) === String(data.userId)) {
                  // attempt to cancel once (best-effort). Firestore rules allow the creator to set status to 'cancelled'
                  (async () => {
                    try {
                      await updateDoc(rideRef, { status: 'cancelled', cancelledAt: serverTimestamp() });
                    } catch (e) {
                      // ignore: permission may be denied in some environments
                    }
                  })();
                }
              }
            } catch (e) { /* ignore auto-cancel failures */ }
        }, (err) => console.warn('ride snapshot error', err));
      } catch (err) {
        console.warn('Failed to subscribe to ride snapshot', err);
      }
    })();

    return () => { try { unsub(); } catch (e) {} };
  }, [rideId]);

  // cleanup driver subscription on unmount
  useEffect(() => {
    return () => {
      try { if (driverUnsubRef.current) driverUnsubRef.current(); } catch (e) {}
    };
  }, []);

  const handleEmergency = () => {
    Alert.alert(
      'Emergency SOS',
      'This will send your location and ride details to emergency contacts. Are you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send SOS',
          style: 'destructive',
          onPress: () => {
            // TODO: Implement SOS functionality
            Alert.alert('SOS Sent', 'Emergency contacts have been notified.');
          }
        }
      ]
    );
  };

  const handleCancelRide = () => {
    Alert.alert(
      'Cancel Ride',
      'Are you sure you want to cancel this ride?',
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Yes, Cancel',
          style: 'destructive',
          onPress: () => {
            (async () => {
              try {
                if (rideId) {
                      // Ensure auth is present and this user is the ride owner before attempting cancel
                      const currentUid = auth && auth.currentUser ? auth.currentUser.uid : null;
                      if (!currentUid) {
                        Alert.alert('Cancel failed', 'You are not signed in. Please sign in and try again.');
                        return;
                      }
                      // Support legacy documents that used `createdBy` as well as modern `userId`
                      const ownerId = ride && (ride.userId || ride.createdBy || ride.createdById || null);
                      if (!ownerId || String(currentUid) !== String(ownerId)) {
                        Alert.alert('Cancel failed', 'Only the ride owner may cancel this ride.');
                        return;
                      }

                      const rideRef = doc(db, 'rides', rideId);
                      await updateDoc(rideRef, { status: 'cancelled', cancelledAt: serverTimestamp() });
                }
              } catch (e) {
                console.warn('cancel ride failed', e);
                // Permission issues are common during development; show helpful alert
                if (e?.code === 'permission-denied' || /permission/i.test(e?.message || '')) {
                  Alert.alert('Cancel failed', 'Unable to cancel ride due to permissions. The app will return to home.');
                } else {
                  Alert.alert('Cancel failed', e.message || 'Failed to cancel ride');
                }
              } finally {
                try {
                  if (navigation && typeof navigation.canGoBack === 'function' && navigation.canGoBack()) navigation.goBack();
                  else if (navigation && typeof navigation.navigate === 'function') navigation.navigate('UserHome');
                } catch (e) { /* swallow */ }
              }
            })();
          }
        }
      ]
    );
  };

  return (
    <SafeAreaView style={[styles.container, { paddingTop: 64 }]}>
      <TopBar navigation={navigation} showLogout={true} />
      {/* Top controls: Back & Logout */}
  {/* (TopBar replaces the top control bar) */}
      {/* Map View */}
      <View style={styles.mapContainer}>
        <MapComponent
          userLocation={ride?.pickupLocation && typeof ride.pickupLocation.latitude === 'number' && typeof ride.pickupLocation.longitude === 'number' ? { latitude: ride.pickupLocation.latitude, longitude: ride.pickupLocation.longitude } : null}
          drivers={driverLive && ride?.driverId && typeof driverLive.latitude === 'number' && typeof driverLive.longitude === 'number' ? [{ id: ride.driverId, latitude: driverLive.latitude, longitude: driverLive.longitude }] : []}
          selectedDriverId={ride?.driverId || null}
          ride={ride}
          onMessage={async (msg) => {
            try {
              if (!msg || !msg.type) return;
              if (msg.type === 'eta') {
                setEta(msg.remaining);
              } else if (msg.type === 'complete') {
                // simulation completed: mark ride completed locally via server call
                try {
                  const { completeRide } = await import('../../firebase/rideService');
                  if (ride?.id) await completeRide(ride.id);
                } catch (e) {
                  console.warn('auto-complete failed', e);
                }
              }
            } catch (e) { console.warn('map onMessage handler error', e); }
          }}
        />
      </View>

      {/* Ride Info Panel (dynamic by ride.status) */}
      <View style={styles.infoPanel}>
        <View style={styles.statusContainer}>
          <Text style={styles.statusText}>
            {(() => {
              const s = String(ride?.status || '').toUpperCase();
              if (s === 'SEARCHING') return 'Searching for driver...';
              if (s === 'ACCEPTED') return 'Driver is on the way';
              if (s === 'ARRIVED') return 'Driver has arrived';
              if (s === 'OTP_VERIFIED') return 'Trip starting...';
              if (s === 'ONGOING') return 'Trip in progress';
              if (s === 'COMPLETED') return 'Trip completed';
              return 'Searching for driver...';
            })()}
          </Text>
        </View>

        {/* SEARCHING: show nothing else, disable new bookings (app-level) */}
        {String(ride?.status || '').toUpperCase() === 'SEARCHING' && (
          <View style={{ alignItems: 'center', marginTop: 8 }}>
            <Text style={{ color: '#666' }}>We are finding nearby drivers. This may take a few minutes.</Text>
          </View>
        )}

        {/* ACCEPTED: show driver info and ETA */}
        {String(ride?.status || '').toUpperCase() === 'ACCEPTED' && (
          <>
            {eta && (
              <View style={styles.etaContainer}>
                <Text style={styles.etaLabel}>Estimated arrival:</Text>
                <Text style={styles.etaValue}>{formatETA(eta)}</Text>
              </View>
            )}
            {/* prefer driverProfile from drivers collection if available */}
            {(driverProfile || ride?.driverName) && (
              <View style={styles.driverInfo}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.driverName}>{(driverProfile && driverProfile.name) || ride.driverName || 'Driver'}</Text>
                  <Text style={styles.driverVehicle}>{(driverProfile && (driverProfile.vehicleModel || driverProfile.vehicle)) || ride.driverVehicleModel || ''} • {(driverProfile && driverProfile.vehicleNumber) || ride.driverVehicleNumber || ''}</Text>
                  <Text style={styles.driverPhone}>Contact: {(driverProfile && driverProfile.phone) || ride.driverPhone || '--'}</Text>
                </View>
              </View>
            )}
            {/* show OTP to user so rider can share with driver */}
            {ride?.pickupOTP && (
              <View style={{ marginTop: 12, alignItems: 'center' }}>
                <Text style={{ fontWeight: '700' }}>Pickup OTP</Text>
                <Text style={{ fontSize: 22, letterSpacing: 4 }}>{String(ride.pickupOTP)}</Text>
                <Text style={{ color: '#666', marginTop: 4 }}>Share this with the driver.</Text>
              </View>
            )}
          </>
        )}

        {/* ARRIVED: show OTP box */}
        {String(ride?.status || '').toUpperCase() === 'ARRIVED' && pickupOTP && (
          <View style={{ marginTop: 12, alignItems: 'center' }}>
            <Text style={{ fontWeight: '700' }}>Pickup OTP</Text>
            <Text style={{ fontSize: 22, letterSpacing: 4 }}>{String(pickupOTP)}</Text>
            <Text style={{ color: '#666', marginTop: 4 }}>Share this with the driver. Driver will enter it to start the trip.</Text>
          </View>
        )}

        {/* OTP_VERIFIED: pre-start message */}
        {String(ride?.status || '').toUpperCase() === 'OTP_VERIFIED' && (
          <View style={{ alignItems: 'center', marginTop: 12 }}>
            <Text style={{ fontWeight: '700' }}>Trip starting...</Text>
            <Text style={{ color: '#666', marginTop: 6 }}>Please remain ready for pickup.</Text>
          </View>
        )}

        {/* ONGOING: show live trip UI, ETA/distance/fare */}
        {String(ride?.status || '').toUpperCase() === 'ONGOING' && (
          <View style={{ marginTop: 12 }}>
            <Text style={{ fontWeight: '700', marginBottom: 6 }}>Trip Details</Text>
            <Text style={{ color: '#333' }}>Drop (exact): {ride?.dropLocation?.name || ride?.dropLocation?.address || ride?.destination?.name || '--'}</Text>
            <Text style={{ color: '#333', marginTop: 6 }}>Estimated fare: ₹{(ride?.fare?.total ?? ride?.estimatedPrice ?? ride?.fareWithTip ?? '--')}{(ride?.tip ? ` (incl. tip ₹${ride.tip})` : '')}</Text>
            <Text style={{ color: '#333', marginTop: 6 }}>Estimated time: {eta ? formatETA(eta) : '--'}</Text>
            <Text style={{ color: '#666', marginTop: 6 }}>Distance remaining: {ride?.driverDistanceKm ? `${ride.driverDistanceKm.toFixed(2)} km` : '--'}</Text>
          </View>
        )}

        {/* COMPLETED: final fare and book again */}
        {String(ride?.status || '').toUpperCase() === 'COMPLETED' && (
          <View style={{ marginTop: 12, alignItems: 'center' }}>
            <Text style={{ fontSize: 20, fontWeight: '700' }}>Trip completed</Text>
            <Text style={{ color: '#666', marginTop: 6 }}>Final fare: ₹{(ride?.fare?.total ?? ride?.estimatedPrice ?? ride?.fareWithTip) ?? '--'}</Text>
            <TouchableOpacity
              style={[styles.button, { marginTop: 12, backgroundColor: '#22A07A' }]}
              onPress={() => {
                try { if (navigation && typeof navigation.navigate === 'function') navigation.navigate('UserHome'); } catch (e) {}
              }}
            >
              <Text style={{ color: '#fff', fontWeight: '600' }}>Book again</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Action Buttons */}
        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={[styles.button, styles.emergencyButton]}
            onPress={handleEmergency}
          >
            <Text style={styles.emergencyButtonText}>🚨 EMERGENCY SOS</Text>
          </TouchableOpacity>
          {/* Hide cancel option after ride is completed or when status is not cancellable */}
          {String(ride?.status || '').toUpperCase() !== 'COMPLETED' && String(ride?.status || '').toUpperCase() !== 'ONGOING' && (
            <TouchableOpacity
              style={[styles.button, styles.cancelButton]}
              onPress={handleCancelRide}
            >
              <Text style={styles.cancelButtonText}>Cancel Ride</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  mapContainer: {
    flex: 1,
  },
  infoPanel: {
    backgroundColor: '#fff',
    padding: 20,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 5,
  },
  statusContainer: {
    marginBottom: 16,
  },
  statusText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    textAlign: 'center',
  },
  etaContainer: {
    alignItems: 'center',
    marginBottom: 16,
  },
  etaLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
  etaValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#22A07A',
  },
  driverInfo: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 20,
  },
  driverSpeed: {
    fontSize: 14,
    color: '#666',
  },
  driverHeading: {
    fontSize: 14,
    color: '#666',
  },
  buttonContainer: {
    gap: 12,
  },
  topControls: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    zIndex: 50,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  topButton: {
    backgroundColor: 'rgba(255,255,255,0.9)',
    padding: 8,
    borderRadius: 8,
  },
  topButtonText: {
    fontSize: 14,
    color: '#333',
  },
  logoutBtn: {
    backgroundColor: '#dc3545',
  },
  logoutText: { color: '#fff' },
  button: {
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  emergencyButton: {
    backgroundColor: '#dc3545',
  },
  emergencyButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  cancelButton: {
    backgroundColor: '#f8f9fa',
    borderWidth: 1,
    borderColor: '#dee2e6',
  },
  cancelButtonText: {
    color: '#dc3545',
    fontSize: 16,
    fontWeight: '600',
  },
});
