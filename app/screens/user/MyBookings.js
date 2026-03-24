import React, { useEffect, useState } from 'react';
import { SafeAreaView, Text, FlatList, View, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import TopBar from '../../components/TopBar';
import { auth } from '../../firebase/firebaseConfig';
import { collection, query, where, orderBy, getDocs, updateDoc, doc as firestoreDoc } from 'firebase/firestore';
import { db } from '../../firebase/firebaseConfig';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { reverseGeocodeToAddress } from '../../services/locationService';

export default function MyBookings({ navigation }) {
  const [loading, setLoading] = useState(true);
  const [rides, setRides] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [selectAll, setSelectAll] = useState(false);
  const [dropNames, setDropNames] = useState({});

  useEffect(() => {
    const load = async () => {
      try {
        const user = auth.currentUser;
        if (!user) {
          Alert.alert('Not signed in', 'Please sign in to view bookings');
          navigation.navigate('Login');
          return;
        }

        // Query both modern `userId` and legacy `createdBy` fields and merge results.
        const ridesCol = collection(db, 'rides');
        const q1 = query(ridesCol, where('userId', '==', user.uid));
        const q2 = query(ridesCol, where('createdBy', '==', user.uid));

        const [snap1, snap2] = await Promise.all([getDocs(q1), getDocs(q2)]);
        const map = new Map();
        const pushDoc = (d) => {
          const data = d.data();
          map.set(d.id, { id: d.id, ...data });
        };
        snap1.docs.forEach(pushDoc);
        snap2.docs.forEach(pushDoc);

        // Convert to array and sort by createdAt (descending). Handle serverTimestamp objects.
      const arr = Array.from(map.values()).filter(r => !r.deleted).sort((a, b) => {
          const ta = a.createdAt && typeof a.createdAt.toMillis === 'function' ? a.createdAt.toMillis() : (a.createdAt ? (new Date(a.createdAt)).getTime() : 0);
          const tb = b.createdAt && typeof b.createdAt.toMillis === 'function' ? b.createdAt.toMillis() : (b.createdAt ? (new Date(b.createdAt)).getTime() : 0);
          return (tb || 0) - (ta || 0);
        });
  setRides(arr);
  // populate drop names for rides that only have coordinates
  populateDropNames(arr);
      } catch (e) {
        console.warn('load bookings failed', e);
      } finally {
        setLoading(false);
      }
    };
    load();
    // clear lastRoute when user intentionally visits bookings list
    (async () => { try { await AsyncStorage.removeItem('lastRoute'); } catch (e) {} })();
  }, []);

  // reverse-geocode drop coords to a human-friendly name when needed
  const populateDropNames = async (ridesArr) => {
    try {
      for (const r of ridesArr) {
        const hasName = (r.dropLocation && (r.dropLocation.name || r.dropLocation.address)) || (r.destination && r.destination.name);
        if (hasName) continue;
        const candidate = r.dropLocation || r.destination || null;
        if (candidate && typeof candidate.latitude === 'number' && typeof candidate.longitude === 'number') {
          try {
            const name = await reverseGeocodeToAddress(candidate.latitude, candidate.longitude);
            if (name) setDropNames(prev => ({ ...prev, [r.id]: name }));
          } catch (e) {
            // ignore reverse geocode failures
          }
        }
      }
    } catch (e) { /* ignore */ }
  };

  const openRide = async (ride) => {
    try {
      await AsyncStorage.setItem('lastRoute', JSON.stringify({ name: 'RideTracking', params: { rideId: ride.id } }));
    } catch (e) {}
    navigation.navigate('RideTracking', { rideId: ride.id });
  };

  const toggleSelect = (id) => {
    setSelected(prev => {
      const copy = new Set(prev);
      if (copy.has(id)) copy.delete(id); else copy.add(id);
      return copy;
    });
  };

  const deleteRide = async (id) => {
    Alert.alert('Delete booking', 'Are you sure you want to delete this booking? This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try {
          // Soft-delete: mark document as deleted to avoid client-side delete permission issues
          await updateDoc(firestoreDoc(db, 'rides', id), { deleted: true });
          setRides(prev => prev.filter(r => r.id !== id));
          setSelected(prev => { const c = new Set(prev); c.delete(id); return c; });
        } catch (e) {
          console.warn('delete failed', e);
          Alert.alert('Delete failed', 'Could not delete booking. Check permissions.');
        }
      }}
    ]);
  };

  const deleteSelected = async () => {
    if (selected.size === 0) return Alert.alert('No selection', 'Select bookings to delete');
    Alert.alert('Delete selected', `Delete ${selected.size} booking(s)?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        const ids = Array.from(selected);
        for (const id of ids) {
          try { await updateDoc(firestoreDoc(db, 'rides', id), { deleted: true }); } catch (e) { console.warn('delete failed', id, e); }
        }
        setRides(prev => prev.filter(r => !selected.has(r.id)));
        setSelected(new Set());
        setSelectAll(false);
      }}
    ]);
  };

  const toggleSelectAll = () => {
    if (!selectAll) {
      const allIds = rides.map(r => r.id);
      setSelected(new Set(allIds));
      setSelectAll(true);
    } else {
      setSelected(new Set());
      setSelectAll(false);
    }
  };

  if (loading) return (
    <SafeAreaView style={{ flex: 1 }}>
      <TopBar navigation={navigation} showLogout={true} />
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator />
      </View>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <TopBar navigation={navigation} showLogout={true} />
      {/* Header overlay positioned below TopBar back button */}
      <View style={styles.headerOverlay} pointerEvents="box-none">
        <View style={styles.headerControls}>
          <TouchableOpacity onPress={toggleSelectAll}>
            <Text style={{ fontSize: 20 }}>{selectAll ? '☑' : '☐'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={{ marginLeft: 12, backgroundColor: selected.size ? '#dc3545' : '#ccc', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8 }} onPress={deleteSelected}>
            <Text style={{ color: '#fff' }}>{selected.size ? `Delete (${selected.size})` : 'Delete'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={{ padding: 12, flex: 1, marginTop: 84 }}>
        {rides.length === 0 ? (
          <Text style={{ fontSize: 16 }}>No bookings found.</Text>
        ) : (
          <FlatList
            data={rides}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <View style={styles.card}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <TouchableOpacity style={styles.checkbox} onPress={() => toggleSelect(item.id)}>
                    <Text style={{ fontSize: 18 }}>{selected.has(item.id) ? '☑' : '☐'}</Text>
                  </TouchableOpacity>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.title}>Status: {item.status || 'unknown'}</Text>
                    <Text style={styles.sub}>Pickup: {formatLocation(item.pickupLocation) || 'Sophia College'}</Text>
                    <Text style={styles.sub}>Drop: {getDropName(item, dropNames)}</Text>
                    <View style={{ flexDirection: 'row', marginTop: 6, justifyContent: 'space-between' }}>
                      <Text style={styles.sub}>ETA: {getEta(item)}</Text>
                      <Text style={styles.sub}>Fare: ₹{(item.fare?.total ?? item.estimatedPrice) ?? '--'}</Text>
                      <Text style={styles.sub}>{item.vehicleType || ''}</Text>
                    </View>
                    <Text style={[styles.sub, { marginTop: 6, fontSize: 12, color: '#999' }]}>{item.createdAt ? formatDate(item.createdAt) : ''}</Text>
                  </View>
                  <View style={{ justifyContent: 'center' }}>
                    <TouchableOpacity style={styles.deleteBtn} onPress={() => deleteRide(item.id)}>
                      <Text style={{ color: '#fff' }}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            )}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

function formatLocation(loc, nameOnly = false) {
  if (!loc) return '';
  if (typeof loc === 'string') return loc;
  // object with possible keys: address, name, latitude, longitude
  if (loc.address) return loc.address;
  if (loc.name) return loc.name;
  if (!nameOnly && typeof loc.latitude === 'number' && typeof loc.longitude === 'number') return `${loc.latitude.toFixed(5)}, ${loc.longitude.toFixed(5)}`;
  return '';
}

function formatDate(ts) {
  try {
    const t = (ts && typeof ts.toMillis === 'function') ? new Date(ts.toMillis()) : new Date(ts);
    return t.toLocaleString();
  } catch (e) { return ''; }
}

function getDropName(item, dropNamesMap) {
  // Prefer explicit dropLocation name/address, then destination.name
  // If we resolved a reverse-geocoded name earlier, prefer it
  // (dropNames is a state map keyed by ride id)
  try {
    // access dropNames by closure (component-level state)
    // eslint-disable-next-line no-undef
    if (dropNamesMap && dropNamesMap[item.id]) {
      const resolved = dropNamesMap[item.id];
      // filter out coordinate-like strings (do not show coords)
      if (typeof resolved === 'string' && !/^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(resolved)) return resolved;
    }
  } catch (e) {}
  if (item.dropLocation && typeof item.dropLocation === 'object') {
    if (item.dropLocation.name) return item.dropLocation.name;
    if (item.dropLocation.address) return item.dropLocation.address;
  }
  if (item.destination && item.destination.name) return item.destination.name;
  // Avoid returning raw coordinates; show placeholder
  return 'Unknown drop';
}

function getEta(item) {
  if (item.driverETA == null && item.etaToPickupSeconds != null) {
    // if stored in seconds to pickup, convert to minutes
    return `${Math.round(item.etaToPickupSeconds / 60)} min`;
  }
  if (typeof item.driverETA === 'number') return `${Math.round(item.driverETA)} min`;
  return '--';
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 10, shadowColor: '#000', shadowOpacity: 0.05, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  checkbox: { width: 36, alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  deleteBtn: { backgroundColor: '#dc3545', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 6 },
  title: { fontWeight: '700', marginBottom: 4 },
  sub: { color: '#666', fontSize: 13 }
  ,headerOverlay: { position: 'absolute', top: 64, left: 12, right: 12, zIndex: 50 },
  headerControls: { flexDirection: 'row', alignItems: 'center' }
});