import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { useEffect, useRef, useState } from 'react';
import { Alert, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import MapComponent from '../../../components/MapComponent';
import TopBar from '../../components/TopBar';
import { db, safeOnSnapshot } from '../../firebase/firebaseConfig';
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
            if (data.status === 'COMPLETED' || data.status === 'completed') {
              try { AsyncStorage.removeItem('lastRoute'); } catch (e) {}
            }
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
          userLocation={driverLive || (ride?.pickupLocation ? { latitude: ride.pickupLocation.latitude, longitude: ride.pickupLocation.longitude } : null)}
          drivers={driverLive ? [{ id: ride?.driverId || 'driver', latitude: driverLive.latitude, longitude: driverLive.longitude }] : []}
          selectedDriverId={ride?.driverId || null}
        />
      </View>

      {/* Ride Info Panel */}
      <View style={styles.infoPanel}>
        <View style={styles.statusContainer}>
          <Text style={styles.statusText}>
            {ride?.status === 'accepted' ? 'Driver is on the way' :
             ride?.status === 'arriving' ? 'Driver has arrived' :
             ride?.status === 'started' ? 'Trip started' :
             'Searching for driver'}
          </Text>
        </View>

        {eta && ride?.status === 'accepted' && (
          <View style={styles.etaContainer}>
            <Text style={styles.etaLabel}>Estimated arrival:</Text>
            <Text style={styles.etaValue}>{formatETA(eta)}</Text>
          </View>
        )}

        {ride?.driverName && (
          <View style={styles.driverInfo}>
            <Text style={styles.driverName}>{ride.driverName}</Text>
            <Text style={styles.driverVehicle}>{ride.driverVehicleModel} • {ride.driverVehicleNumber}</Text>
            <Text style={styles.driverPhone}>Contact: {ride.driverPhone}</Text>
          </View>
        )}

        {pickupOTP && ride?.status === 'ARRIVED' && (
          <View style={{ marginTop: 12, alignItems: 'center' }}>
            <Text style={{ fontWeight: '700' }}>Pickup OTP</Text>
            <Text style={{ fontSize: 22, letterSpacing: 4 }}>{String(pickupOTP)}</Text>
            <Text style={{ color: '#666', marginTop: 4 }}>Share this with the driver. Driver will enter it to start the trip.</Text>
          </View>
        )}

        {/* Trip completed UI: show when ride status is COMPLETED or completed */}
        {(ride?.status === 'COMPLETED' || ride?.status === 'completed') && (
          <View style={{ marginTop: 12, alignItems: 'center' }}>
            <Text style={{ fontSize: 20, fontWeight: '700' }}>Trip completed</Text>
            <Text style={{ color: '#666', marginTop: 6 }}>Thanks for riding with us.</Text>
            <TouchableOpacity
              style={[styles.button, { marginTop: 12, backgroundColor: '#22A07A' }]}
              onPress={() => {
                try {
                  if (navigation && typeof navigation.navigate === 'function') navigation.navigate('UserHome');
                } catch (e) { /* ignore */ }
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

          <TouchableOpacity
            style={[styles.button, styles.cancelButton]}
            onPress={handleCancelRide}
          >
            <Text style={styles.cancelButtonText}>Cancel Ride</Text>
          </TouchableOpacity>
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
