import React from 'react';
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import BottomSheet from './BottomSheet';

export default function ActiveTripBottomSheet({ visible, onNavigate, onArrived, driverEta, pickupOTP, onVerifyOTP, rideStatus, ride = null, onComplete }) {
  const [otpInput, setOtpInput] = React.useState('');
  const [localRide, setLocalRide] = React.useState(ride);

  React.useEffect(() => {
    setLocalRide(ride);
    // if ride lacks dropAddress or estimates, try to compute them asynchronously
    (async () => {
      try {
        if (!ride) return;
        const hasDrop = !!(ride.dropAddress || (ride.dropLocation && (ride.dropLocation.name || ride.dropLocation.address)) || (ride.destination && ride.destination.name));
        const hasEst = typeof ride.estimatedFare === 'number' || typeof ride.estimatedDistanceKm === 'number' || typeof ride.estimatedDurationMin === 'number';
        if (!hasDrop && (ride.dropLocation && typeof ride.dropLocation.latitude === 'number')) {
          try {
            const { reverseGeocodeToAddress, getRoadDistanceKm, getRouteBetweenCoords } = await import('../../services/locationService');
            const addr = await reverseGeocodeToAddress(ride.dropLocation.latitude, ride.dropLocation.longitude).catch(() => null);
            if (addr) setLocalRide(prev => prev ? { ...prev, dropAddress: addr } : { ...ride, dropAddress: addr });
          } catch (_e) {}
        }
        if (!hasEst && ride.pickupLocation && (ride.dropLocation || ride.destination)) {
          try {
            const { getRoadDistanceKm, getRouteBetweenCoords } = await import('../../services/locationService');
            const pickup = ride.pickupLocation;
            const drop = ride.dropLocation || ride.destination;
            const tripInfo = await getRoadDistanceKm(pickup, drop);
            const tripDuration = tripInfo.durationMin || Math.round((tripInfo.distanceKm || 0) * 2);
            const tripDistance = tripInfo.distanceKm || 0;
            // use the app fareConfig to compute estimate (include tip if provided)
            const { calculateFare } = await import('../../config/fareConfig');
            const fare = calculateFare({ distanceKm: tripDistance, durationMin: tripDuration, vehicleKey: (ride.vehicleType || 'GO'), tip: (ride.tip || 0) });
            const fareWithTip = fare; // calculateFare already includes tip when passed
            setLocalRide(prev => prev ? { ...prev, estimatedFare: fare, fareWithTip, estimatedDistanceKm: tripDistance, estimatedDurationMin: tripDuration, tip: (ride.tip || 0) } : { ...ride, estimatedFare: fare, fareWithTip, estimatedDistanceKm: tripDistance, estimatedDurationMin: tripDuration, tip: (ride.tip || 0) });
          } catch (_e) {}
        }
      } catch (_e) {}
    })();
  }, [ride]);
  const formatDrop = (r) => {
    if (!r) return '';
    if (r.dropAddress) return r.dropAddress;
    const d = r.dropLocation || r.destination || null;
    if (!d) return '';
    return d.name || d.address || (typeof d.latitude === 'number' && typeof d.longitude === 'number' ? `${d.latitude.toFixed(5)}, ${d.longitude.toFixed(5)}` : '');
  };

  return (
  <BottomSheet visible={visible} heightRatio={0.5} blockBackgroundTouches={false}>
      <View style={styles.container}>
        <Text style={styles.title}>Active Trip</Text>
        <Text style={styles.info}>ETA: {driverEta ? `${Math.round(driverEta)} min` : '--'}</Text>

        {/* OTP verification shown only when driver has marked arrived */}
  {pickupOTP && rideStatus === 'ARRIVED' && (
          <View style={{ marginTop: 8, alignItems: 'center' }}>
            <Text style={{ fontWeight: '700' }}>Pickup OTP</Text>
            <Text style={{ fontSize: 22, letterSpacing: 4 }}>{String(pickupOTP)}</Text>
            <Text style={{ color: '#666', marginTop: 4 }}>Ask the rider for this code and enter it below to start the trip.</Text>
            <View style={{ marginTop: 8, width: '100%' }}>
              <TextInput placeholder='Enter OTP from rider' value={otpInput} onChangeText={setOtpInput} keyboardType='numeric' style={{ borderWidth: 1, borderColor: '#ddd', padding: 8, borderRadius: 8, marginBottom: 8 }} />
              <TouchableOpacity style={[styles.btn, { backgroundColor: '#22A07A' }]} onPress={() => { if (typeof onVerifyOTP === 'function') return onVerifyOTP(otpInput); Alert.alert('No handler', 'No OTP verify handler'); }}>
                <Text style={styles.btnText}>Verify OTP & Start</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

    {/* When ride is already in progress, show trip summary */}
  {rideStatus === 'ONGOING' && (
          <View style={{ marginTop: 12 }}>
            <Text style={{ fontWeight: '700', marginBottom: 6 }}>Trip Details</Text>
            <Text style={{ color: '#333' }}>Drop (exact): {formatDrop(localRide) || '--'}</Text>
            <Text style={{ color: '#333', marginTop: 6 }}>Estimated distance: {(localRide?.estimatedDistanceKm != null) ? `${Number(localRide.estimatedDistanceKm).toFixed(2)} km` : '--'}</Text>
            <Text style={{ color: '#333', marginTop: 6 }}>Estimated time: {(localRide?.estimatedDurationMin != null) ? `${Math.round(localRide.estimatedDurationMin)} min` : '--'}</Text>
            <Text style={{ color: '#333', marginTop: 6 }}>Estimated fare: {(localRide?.estimatedFare != null) ? `₹${localRide.estimatedFare}` : (localRide?.fare?.total ? `₹${localRide.fare.total}` : '--')}{(localRide?.tip ? ` (incl. tip ₹${localRide.tip})` : '')}</Text>
    <Text style={{ color: '#666', marginTop: 6 }}>ETA at drop: {driverEta ? `${Math.round(driverEta)} min` : '--'}</Text>
            <View style={{ marginTop: 12 }}>
        <TouchableOpacity style={[styles.btn, { backgroundColor: '#22A07A' }]} onPress={() => { if (typeof onComplete === 'function') return onComplete(); Alert.alert('No handler', 'Complete handler not available'); }}>
          <Text style={styles.btnText}>End Trip</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Default: navigation and arrived buttons before trip starts */}
  {rideStatus !== 'ONGOING' && (
          <View style={styles.actions}>
            <TouchableOpacity
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={[styles.btn, styles.arrived, { marginHorizontal: 6 }]}
              onPress={() => { if (typeof onArrived === 'function') return onArrived(); Alert.alert('Not available', 'Arrived handler not available'); }}
            >
              <Text style={styles.btnText}>Arrived</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  container: { padding: 8 },
  title: { fontSize: 18, fontWeight: '700' },
  info: { marginTop: 8, color: '#666' },
  actions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16 },
  btn: { flex: 1, padding: 12, borderRadius: 8, alignItems: 'center', marginHorizontal: 6 },
  navigate: { backgroundColor: '#276EF1' },
  arrived: { backgroundColor: '#22A07A' },
  btnText: { color: '#fff', fontWeight: '700' },
});
