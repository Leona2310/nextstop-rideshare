import React from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';

export default function DriverCard({ driver }) {
  if (!driver) return null;
  return (
    <View style={styles.card}>
      {driver.driverPhotoUrl ? <Image source={{ uri: driver.driverPhotoUrl }} style={styles.photo} /> : null}
      <View style={styles.info}>
        <Text style={styles.name}>{driver.driverName || 'Driver'}</Text>
        <Text style={styles.vehicle}>{driver.driverVehicleModel || ''} • {driver.driverVehicleNumber || ''}</Text>
        <Text style={styles.phone}>{driver.driverPhone || ''}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center' },
  photo: { width: 56, height: 56, borderRadius: 28, marginRight: 12 },
  info: {},
  name: { fontSize: 16, fontWeight: '600' },
  vehicle: { fontSize: 14, color: '#666' },
  phone: { fontSize: 13, color: '#888' }
});
