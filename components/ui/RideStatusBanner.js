import { StyleSheet, Text, View } from 'react-native';

export default function RideStatusBanner({ status, eta }) {
  return (
    <View style={styles.container}>
      <Text style={styles.statusText}>{status}</Text>
  {eta != null && <Text style={styles.etaText}>ETA (exact): {eta} min</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 12, backgroundColor: '#fff', borderRadius: 10, alignItems: 'center' },
  statusText: { fontSize: 16, fontWeight: '600' },
  etaText: { fontSize: 14, color: '#666', marginTop: 4 }
});
