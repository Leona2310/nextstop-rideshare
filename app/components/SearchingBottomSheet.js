import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet, TouchableOpacity } from 'react-native';
import BottomSheet from './BottomSheet';

export default function SearchingBottomSheet({ visible, onCancel }) {
  return (
    <BottomSheet visible={visible} heightRatio={0.3}>
      <View style={styles.container}>
        <Text style={styles.title}>Searching for drivers</Text>
        <Text style={styles.info}>We'll notify you when a driver accepts.</Text>
        <ActivityIndicator style={{ marginTop: 12 }} size="large" />
        <TouchableOpacity style={styles.cancelBtn} onPress={onCancel}><Text style={styles.cancelText}>Cancel</Text></TouchableOpacity>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  container: { padding: 8, alignItems: 'center' },
  title: { fontSize: 18, fontWeight: '700' },
  info: { marginTop: 8, color: '#666' },
  cancelBtn: { marginTop: 12, padding: 10, backgroundColor: '#f8f9fa', borderRadius: 8 },
  cancelText: { color: '#dc3545' },
});
