import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, View } from 'react-native';
import RideCard from '../components/RideCard';
import { auth } from '../firebase/firebaseConfig';
import { subscribeToRides } from '../firebase/rideBroadcastService';
import { cancelRide, leaveRide, joinRide as transactionalJoinRide } from '../firebase/rideService';

function useNowTick() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export default function RidesListScreen() {
  const [rides, setRides] = useState([]);
  const now = useNowTick();

  // Prune expired rides periodically to ensure they disappear when expired
  useEffect(() => {
    if (!rides || rides.length === 0) return;
    const filtered = rides.filter(r => {
      const exp = r.expiresAt && (typeof r.expiresAt.toMillis === 'function' ? r.expiresAt.toMillis() : (new Date(r.expiresAt)).getTime());
      return exp && exp > Date.now();
    });
    if (filtered.length !== rides.length) setRides(filtered);
  }, [now]);

  useEffect(() => {
    const unsub = subscribeToRides((items) => {
      // only include rides that are within a 2-minute window if expiresAt is present
      const filtered = items.filter(r => {
        if (!r.expiresAt) return true;
        const exp = typeof r.expiresAt.toMillis === 'function' ? r.expiresAt.toMillis() : (new Date(r.expiresAt)).getTime();
        return exp > Date.now();
      });
      setRides(filtered);
    });
    return () => {
      try { unsub(); } catch (e) {}
    };
  }, []);

  const currentUserId = auth.currentUser?.uid || 'test-user';

  const handleJoin = useCallback(async (rideId) => {
    try {
      await transactionalJoinRide(rideId, currentUserId);
      Alert.alert('Joined', 'You have joined the ride');
    } catch (err) {
      console.warn('joinRide failed', err);
      Alert.alert('Join Failed', err?.message || String(err));
    }
  }, [currentUserId]);

  const handleLeave = useCallback(async (rideId) => {
    if (!auth.currentUser) {
      Alert.alert('Not signed in', 'Please sign in to leave a ride');
      return;
    }
    try {
      await leaveRide(rideId, currentUserId);
      Alert.alert('Left', 'You have left the ride');
    } catch (err) {
      console.warn('leaveRide failed', err);
      Alert.alert('Leave Failed', err?.message || String(err));
    }
  }, [currentUserId]);

  const handleCancel = useCallback(async (rideId) => {
    if (!auth.currentUser) {
      Alert.alert('Not signed in', 'Please sign in to cancel a ride');
      return;
    }
    try {
      await cancelRide(rideId, currentUserId);
      Alert.alert('Cancelled', 'Ride cancelled');
    } catch (err) {
      console.warn('cancelRide failed', err);
      Alert.alert('Cancel Failed', err?.message || String(err));
    }
  }, [currentUserId]);

  const renderItem = ({ item }) => {
    // calculate seconds left if expiresAt exists
    const expiresMs = item.expiresAt && (typeof item.expiresAt.toMillis === 'function' ? item.expiresAt.toMillis() : (new Date(item.expiresAt)).getTime());
    const secondsLeft = expiresMs ? Math.max(0, Math.ceil((expiresMs - now) / 1000)) : null;
    // If expired, don't render
    if (secondsLeft !== null && secondsLeft <= 0) return null;

    return (
      <View>
        <RideCard
          ride={item}
          currentUserId={currentUserId}
          onJoin={handleJoin}
          onLeave={handleLeave}
          onCancel={handleCancel}
        />
        {secondsLeft !== null && (
          <Text style={styles.countdown}>Expires in: {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}</Text>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={rides}
        keyExtractor={r => r.id}
        renderItem={renderItem}
        ListEmptyComponent={() => <Text style={styles.empty}>No open rides</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f7f7f7' },
  empty: { textAlign: 'center', marginTop: 24, color: '#666' },
  countdown: { textAlign: 'center', color: '#666', marginBottom: 8 }
});
