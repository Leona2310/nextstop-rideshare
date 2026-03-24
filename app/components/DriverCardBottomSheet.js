import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import BottomSheet from './BottomSheet';

export default function DriverCardBottomSheet({ visible, driver, onCall, onChat, onCancel }) {
  if (!driver) return null;
  return (
    <BottomSheet visible={visible} heightRatio={0.36}>
      <View style={styles.container}>
        <Text style={styles.name}>{driver.driverName || driver.name || 'Driver'}</Text>
        <Text style={styles.info}>{driver.driverVehicleModel} • {driver.driverVehicleNumber}</Text>
        <Text style={styles.info}>Contact: {driver.driverPhone}</Text>
        <View style={styles.actions}>
          <TouchableOpacity style={[styles.btn, { backgroundColor: '#276EF1' }]} onPress={onCall}><Text style={styles.btnText}>Call</Text></TouchableOpacity>
          <TouchableOpacity style={[styles.btn, { backgroundColor: '#22A07A' }]} onPress={onChat}><Text style={styles.btnText}>Chat</Text></TouchableOpacity>
          <TouchableOpacity style={[styles.btn, { backgroundColor: '#dc3545' }]} onPress={onCancel}><Text style={styles.btnText}>Cancel</Text></TouchableOpacity>
        </View>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  container: { padding: 8 },
  name: { fontSize: 18, fontWeight: '700' },
  info: { color: '#666', marginTop: 6 },
  actions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 },
  btn: { flex: 1, padding: 12, borderRadius: 8, alignItems: 'center', marginHorizontal: 6 },
  btnText: { color: '#fff', fontWeight: '700' },
});
