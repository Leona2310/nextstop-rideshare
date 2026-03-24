import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import BottomSheet from './BottomSheet';

export default function RideTypeSelector({ visible, onSelect, fares = {}, onClose }) {
  return (
    <BottomSheet visible={visible} heightRatio={0.4} onClose={onClose}>
      <View style={styles.container}>
        <Text style={styles.title}>Choose Ride Type</Text>
        {Object.keys(fares).map((k) => (
          <TouchableOpacity key={k} style={styles.item} onPress={() => onSelect(k)}>
            <Text style={styles.name}>{k}</Text>
            <Text style={styles.fare}>₹{fares[k]}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  container: { padding: 8 },
  title: { fontSize: 18, fontWeight: '700' },
  item: { padding: 12, borderRadius: 8, backgroundColor: '#f8f9fa', marginTop: 8, flexDirection: 'row', justifyContent: 'space-between' },
  name: { fontWeight: '600' },
  fare: { fontWeight: '700' },
});
