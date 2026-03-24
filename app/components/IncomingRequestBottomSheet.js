import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import BottomSheet from './BottomSheet';

export default function IncomingRequestBottomSheet({ visible, onAccept, onReject, dropAddress, dropLocation = null, estInfo = {}, alreadyClaimed = false, disabled = false }) {
  return (
    <BottomSheet visible={visible} heightRatio={0.45}>
      <View style={styles.container}>
        <Text style={styles.title}>Incoming Ride Request</Text>
        <Text style={styles.label}>Pickup: Sophia College</Text>
  <Text style={styles.label}>Drop: {dropAddress || (dropLocation && (dropLocation.name || dropLocation.address || (typeof dropLocation.latitude === 'number' && typeof dropLocation.longitude === 'number' ? `${dropLocation.latitude.toFixed(5)}, ${dropLocation.longitude.toFixed(5)}` : null))) || ''}</Text>
        <Text style={styles.info}>Est: {estInfo.distanceKm ? `${estInfo.distanceKm.toFixed(1)} km` : '--'} • {estInfo.durationMin ? `${Math.round(estInfo.durationMin)} min` : '--'} • ₹{estInfo.fare ?? '--'}</Text>
        {alreadyClaimed && <Text style={{ color: '#b00', marginTop: 8 }}>This ride was already claimed by another driver.</Text>}
        <View style={styles.actions}>
          <TouchableOpacity style={[styles.btn, styles.reject]} onPress={onReject}><Text style={styles.btnText}>Reject</Text></TouchableOpacity>
          <TouchableOpacity style={[styles.btn, styles.accept, (alreadyClaimed || disabled) ? { backgroundColor: '#aaa' } : {}]} onPress={() => { if (!alreadyClaimed && !disabled) onAccept && onAccept(); }} disabled={alreadyClaimed || disabled}><Text style={styles.btnText}>{alreadyClaimed ? 'Unavailable' : (disabled ? 'Offline' : 'Accept')}</Text></TouchableOpacity>
        </View>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  container: { padding: 8 },
  title: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
  label: { fontSize: 14, color: '#333' },
  info: { marginTop: 8, color: '#666' },
  actions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16 },
  btn: { flex: 1, padding: 12, borderRadius: 8, alignItems: 'center', marginHorizontal: 6 },
  accept: { backgroundColor: '#22A07A' },
  reject: { backgroundColor: '#dc3545' },
  btnText: { color: '#fff', fontWeight: '700' },
});
