import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, TextInput } from 'react-native';
import BottomSheet from './BottomSheet';

export default function ActiveTripBottomSheet({ visible, onNavigate, onArrived, driverEta, pickupOTP, onVerifyOTP, rideStatus, ride = null, onComplete }) {
  const [otpInput, setOtpInput] = React.useState('');
  const formatDrop = (r) => {
    if (!r) return '';
    if (r.dropAddress) return r.dropAddress;
    const d = r.dropLocation || r.destination || null;
    if (!d) return '';
    return d.name || d.address || (typeof d.latitude === 'number' && typeof d.longitude === 'number' ? `${d.latitude.toFixed(5)}, ${d.longitude.toFixed(5)}` : '');
  };

  return (
    <BottomSheet visible={visible} heightRatio={0.5}>
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

        {/* When ride is already in progress, show only Drop Completed and trip summary */}
        {rideStatus === 'in_progress' && (
          <View style={{ marginTop: 12 }}>
            <Text style={{ fontWeight: '700', marginBottom: 6 }}>Trip Details</Text>
            <Text style={{ color: '#333' }}>Drop: {formatDrop(ride) || '--'}</Text>
            <Text style={{ color: '#333', marginTop: 6 }}>Fare: ₹{(ride?.fare?.total ?? ride?.estimatedPrice) ?? '--'}</Text>
            <Text style={{ color: '#666', marginTop: 6 }}>ETA at drop: {driverEta ? `${Math.round(driverEta)} min` : '--'}</Text>
            <View style={{ marginTop: 12 }}>
              <TouchableOpacity style={[styles.btn, { backgroundColor: '#22A07A' }]} onPress={() => { if (typeof onComplete === 'function') return onComplete(); Alert.alert('No handler', 'Complete handler not available'); }}>
                <Text style={styles.btnText}>Drop Completed</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Default: navigation and arrived buttons before trip starts */}
        {rideStatus !== 'in_progress' && (
          <View style={styles.actions}>
            <TouchableOpacity
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={[styles.btn, styles.navigate]}
              onPress={() => { if (typeof onNavigate === 'function') return onNavigate(); Alert.alert('Not available', 'Navigation handler not available'); }}
            >
              <Text style={styles.btnText}>Navigate</Text>
            </TouchableOpacity>
            <TouchableOpacity
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={[styles.btn, styles.arrived]}
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
