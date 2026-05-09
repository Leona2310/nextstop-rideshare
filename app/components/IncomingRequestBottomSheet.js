import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import BottomSheet from './BottomSheet';

export default function IncomingRequestBottomSheet({ visible, onAccept, onReject, dropAddress, dropLocation = null, estInfo = {}, alreadyClaimed = false, disabled = false, pickupName = 'Sophia College' }) {
  const distanceText = estInfo?.distanceKm ? `${estInfo.distanceKm.toFixed(1)} km` : '--';
  const etaText = estInfo?.durationMin ? `${Math.round(estInfo.durationMin)} min` : '--';
  // prefer showing fareWithTip if provider supplied it; otherwise show estInfo.fare and show tip if present
  const fareValue = estInfo?.fareWithTip ?? estInfo?.fare ?? null;
  const tipValue = typeof estInfo?.tip === 'number' ? estInfo.tip : null;
  const fareText = fareValue != null ? `₹${fareValue}${tipValue ? ` (incl. tip ₹${tipValue})` : ''}` : '—';
  return (
    <BottomSheet visible={visible} heightRatio={0.45}>
      <View style={styles.container}>
        <Text style={styles.title}>Incoming Ride Request</Text>
        <Text style={styles.label}>Pickup: {pickupName}</Text>
        <Text style={styles.label}>Drop (exact): {dropAddress || (dropLocation && (dropLocation.name || dropLocation.address) ) || '--'}</Text>
        <View style={styles.row}>
          <Text style={styles.kv}>Distance: {distanceText}</Text>
          <Text style={styles.kv}>• ETA: {etaText}</Text>
          <Text style={[styles.kv, { marginLeft: 'auto', fontWeight: '700' }]}>Fare: {fareText}</Text>
        </View>
        {alreadyClaimed && <Text style={{ color: '#b00', marginTop: 8 }}>This ride was already claimed by another driver.</Text>}
        {/* expired state */}
        {typeof visible === 'boolean' && !visible && <Text style={{ color: '#666', marginTop: 8 }}>No active requests</Text>}
        {/* show expired message when incoming offer has expired */}
        {alreadyClaimed === 'expired' && <Text style={{ color: '#b00', marginTop: 8 }}>This ride has expired.</Text>}
        <View style={styles.actions}>
          {/* When expired or already claimed, hide accept/reject controls */}
          {!(alreadyClaimed || disabled) ? (
            <>
              <TouchableOpacity style={[styles.btn, styles.reject]} onPress={onReject}><Text style={styles.btnText}>Reject</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.btn, styles.accept]} onPress={() => { onAccept && onAccept(); }}><Text style={styles.btnText}>Accept</Text></TouchableOpacity>
            </>
          ) : (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#666' }}>{alreadyClaimed ? 'Unavailable' : 'Offline'}</Text></View>
          )}
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
  row: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  kv: { color: '#666', marginRight: 8 },
  actions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16 },
  btn: { flex: 1, padding: 12, borderRadius: 8, alignItems: 'center', marginHorizontal: 6 },
  accept: { backgroundColor: '#22A07A' },
  reject: { backgroundColor: '#dc3545' },
  btnText: { color: '#fff', fontWeight: '700' },
});
