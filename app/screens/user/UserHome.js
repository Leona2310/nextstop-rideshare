import AsyncStorage from '@react-native-async-storage/async-storage';
import { collection, query, where } from 'firebase/firestore';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Dimensions,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import MapComponent from '../../../components/MapComponent';
import DriverCardBottomSheet from '../../components/DriverCardBottomSheet';
import RideCard from '../../components/RideCard';
import RideTypeSelector from '../../components/RideTypeSelector';
import SearchingBottomSheet from '../../components/SearchingBottomSheet';
import TopBar from '../../components/TopBar';
import { calculateFare } from '../../config/fareConfig';
import { getFriendlyAuthError, logoutUser } from '../../firebase/authService';
import { auth, db, safeOnSnapshot } from '../../firebase/firebaseConfig';
import { getProfile } from '../../firebase/profileService';
import { cancelRide, createRideRequest, leaveRide, joinRide as transactionalJoinRide } from '../../firebase/rideService';
import { getFixedSophiaPickup, getPlaceDetails, getPlacePredictions, getRoadDistanceKm } from '../../services/locationService';
// ...existing imports (profile removed)

const { width, height } = Dimensions.get('window');

const VEHICLE_TYPES = {
  GO: { name: 'Go', baseFare: 50, perKm: 10, capacity: 4 },
  SEDAN: { name: 'Sedan', baseFare: 80, perKm: 15, capacity: 4 },
  XL: { name: 'XL', baseFare: 120, perKm: 20, capacity: 6 }
};

export default function UserHome({ navigation }) {
  // profile fetching removed per request
  const [location, setLocation] = useState(null);
  // Pickup is fixed to Sophia College — we fetch its address/coords on mount
  const [pickupLocation, setPickupLocation] = useState('Sophia College, Mumbai');
  const [dropLocation, setDropLocation] = useState('');
  const [pickupCoords, setPickupCoords] = useState(null);
  const [dropCoords, setDropCoords] = useState(null);
  const [pickupSuggestions, setPickupSuggestions] = useState([]); // unused but kept for compatibility
  const [dropSuggestions, setDropSuggestions] = useState([]);
  const [typingField, setTypingField] = useState(null);
  const [selectedVehicle, setSelectedVehicle] = useState('GO');
  const [estimatedPrice, setEstimatedPrice] = useState(0);
  const [tip, setTip] = useState(0);
  const [distanceKm, setDistanceKm] = useState(null);
  const [booking, setBooking] = useState(false);
  const [rideId, setRideId] = useState(null);
  const [searching, setSearching] = useState(false);
  const [driverInfo, setDriverInfo] = useState(null);
  const [openRides, setOpenRides] = useState([]);
  const [userProfile, setUserProfile] = useState(null);
  const [tick, setTick] = useState(0);
  const [rideTypeVisible, setRideTypeVisible] = useState(false);
  const [allowPassengers, setAllowPassengers] = useState(true);

  useEffect(() => {
    // Load fixed Sophia pickup coordinates (no device location requested)
    (async () => {
      const s = await getFixedSophiaPickup();
      if (s) {
        setPickupLocation(s.address);
        setPickupCoords({ latitude: s.latitude, longitude: s.longitude });
      }
    })();
  }, []);

  // Load user profile to determine role (student/teacher/staff allowed to join broadcasts)
  useEffect(() => {
    (async () => {
      try {
        const p = await getProfile();
        setUserProfile(p);
      } catch (e) { console.warn('failed to load profile', e); }
    })();
  }, []);

  // per-second tick to keep countdowns live
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Subscribe to OPEN rides broadcasts (expiresAt in future)
  useEffect(() => {
    let unsub = null;
    try {
const ridesCol = collection(db, 'rides');
// Only show rides that are SEARCHING (created and open for joins).
const q = query(ridesCol, where('status', '==', 'SEARCHING'), where("allowPassengers", "==", true));
      unsub = safeOnSnapshot(q, (snap) => {
        const now = Date.now();
        const items = [];
        snap.docs.forEach(d => {
          const data = d.data();
          const expiresAt = data.expiresAt && typeof data.expiresAt.toMillis === 'function' ? data.expiresAt.toMillis() : (data.expiresAt ? (new Date(data.expiresAt)).getTime() : null);
          if (!expiresAt || expiresAt <= now) return;
          items.push({ id: d.id, ...data, expiresAt });
        });
        items.sort((a, b) => a.expiresAt - b.expiresAt);
        setOpenRides(items);
      });
    } catch (e) {
      console.warn('subscribe open rides failed', e);
    }
    return () => { if (typeof unsub === 'function') unsub(); };
  }, []);

  // Prune expired rides from openRides on each tick to ensure UI removes expired items
  useEffect(() => {
    if (!openRides || openRides.length === 0) return;
    const now = Date.now();
    const filtered = openRides.filter(r => {
      const exp = r.expiresAt && (typeof r.expiresAt.toMillis === 'function' ? r.expiresAt.toMillis() : (new Date(r.expiresAt)).getTime());
      return exp && exp > now;
    });
    if (filtered.length !== openRides.length) setOpenRides(filtered);
  }, [tick]);

  // On mount, try to restore last route (resume where the user left off)
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem('lastRoute');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.name && parsed.name !== 'UserHome') {
            // Delay a tick so navigation stack is ready
            setTimeout(() => {
              try { navigation.navigate(parsed.name, parsed.params || {}); } catch (e) { /* ignore */ }
            }, 300);
          }
        }
      } catch (e) { /* ignore */ }
    })();
  }, []);

  // Device location is intentionally not used in the UI per project requirements.

  // Fare calculation uses OSRM road distance and duration; calculateFare handles base/distance/time/booking fee.

  useEffect(() => {
    // Whenever coords change, compute road distance (async) and update price
    let ignore = false;
    const compute = async () => {
      if (pickupCoords && dropCoords) {
        const { distanceKm: d, via, durationMin } = await getRoadDistanceKm(pickupCoords, dropCoords);
        console.log('Distance calc:', { pickupCoords, dropCoords, distanceKm: d, via, durationMin });
        if (!ignore) {
          setDistanceKm(d);
          const fare = calculateFare({ distanceKm: d, durationMin, vehicleKey: selectedVehicle, tip });
          setEstimatedPrice(fare);
        }
      } else {
        // Not enough data yet — use minimum fare
        setDistanceKm(null);
        const fare = calculateFare({ distanceKm: 1, durationMin: 3, vehicleKey: selectedVehicle, tip });
        setEstimatedPrice(fare);
      }
    };

    compute();

    return () => { ignore = true; };
  }, [pickupCoords, dropCoords, selectedVehicle, tip]);

  // Simple debounce helper for geocoding queries
  const geoTimerRef = useRef(null);
  const doGeocode = async (text, forField) => {
    if (!text || text.trim().length < 3) {
      if (forField === 'pickup') setPickupSuggestions([]);
      else setDropSuggestions([]);
      return;
    }

    try {
      // Use OpenStreetMap Nominatim-based predictions
      const preds = await getPlacePredictions(text);
      if (forField === 'pickup') setPickupSuggestions(preds);
      else setDropSuggestions(preds);
    } catch (err) {
      console.warn('place predictions failed', err);
      if (forField === 'pickup') setPickupSuggestions([]);
      else setDropSuggestions([]);
    }
  };

  const scheduleGeocode = (text, field) => {
    setTypingField(field);
    if (geoTimerRef.current) clearTimeout(geoTimerRef.current);
    geoTimerRef.current = setTimeout(() => doGeocode(text, field), 450);
  };

  const handleBooking = async () => {
    if (!auth.currentUser) {
      Alert.alert('Not signed in', 'Please sign in to book a ride.');
      return;
    }
    // Ensure pickupCoords (Sophia) is set; try to fetch if missing
    if (!pickupCoords) {
      try {
        const s = await getFixedSophiaPickup();
        if (s) {
          setPickupLocation(s.address);
          setPickupCoords({ latitude: s.latitude, longitude: s.longitude });
        }
      } catch (err) {
        console.warn('Could not fetch Sophia pickup', err);
      }
    }

    // If dropCoords missing, try to resolve the typed dropLocation using predictions or geocode
    if (!dropCoords) {
          if (dropLocation && dropLocation.trim().length > 0) {
            try {
              const preds = await getPlacePredictions(dropLocation);
              if (Array.isArray(preds) && preds.length > 0) {
                const p = preds[0];
                setDropLocation(p.address || p.description || dropLocation);
                setDropCoords({ latitude: p.latitude, longitude: p.longitude });
              }
            } catch (err) {
              console.warn('Resolving dropLocation failed', err);
            }
          }
    }

    if (!pickupCoords || !dropCoords) {
      Alert.alert('Missing Information', 'Please ensure drop location is selected from suggestions; pickup is fixed to Sophia College.');
      return;
    }

    // Enforce drop location within Mumbai bounding box
    const MUMBAI_BOUNDS = {
      minLat: 18.7,
      maxLat: 19.3,
      minLng: 72.7,
      maxLng: 73.1,
    };
    if (dropCoords.latitude < MUMBAI_BOUNDS.minLat || dropCoords.latitude > MUMBAI_BOUNDS.maxLat || dropCoords.longitude < MUMBAI_BOUNDS.minLng || dropCoords.longitude > MUMBAI_BOUNDS.maxLng) {
      Alert.alert('Out of Area', 'Drop location must be within Mumbai city limits. Please choose a destination within Mumbai.');
      return;
    }

    setBooking(true);
    try {
      const rideId = await createRideRequest({
        userId: auth.currentUser.uid,
        pickupLocation: {
          address: pickupLocation,
          latitude: pickupCoords.latitude,
          longitude: pickupCoords.longitude
        },
        dropLocation: {
          address: dropLocation,
          latitude: dropCoords.latitude,
          longitude: dropCoords.longitude
        },
        vehicleType: selectedVehicle,
        estimatedPrice,
        tip,
        allowPassengers
      });

  // update UI to searching state and navigate to tracking
  setRideId(rideId);
  setSearching(true);
  Alert.alert('Booking Confirmed', `Your ride has been booked!\nRide ID: ${rideId}\nEstimated price: ₹${estimatedPrice}`);
  try { await AsyncStorage.setItem('lastRoute', JSON.stringify({ name: 'RideTracking', params: { rideId } })); } catch (e) {}
  navigation.navigate('RideTracking', { rideId });
    } catch (error) {
      console.error('create ride failed:', error);
      Alert.alert('Booking Failed', 'Could not create ride. Please try again.');
    } finally {
      setBooking(false);
    }
  };

  const handleJoinRide = async (rideId) => {
    if (!auth.currentUser) {
      Alert.alert('Not signed in', 'Please sign in to join a ride');
      return;
    }
    try {
      // Only allow students/teachers/staff to join
      const role = userProfile?.role || null;
      if (!role || !['student', 'teacher', 'staff'].includes(role)) {
        Alert.alert('Not permitted', 'Only student, teacher or staff accounts may join broadcast rides.');
        return;
      }
      // Use transactional join to avoid overbooking
      await transactionalJoinRide(rideId, auth.currentUser.uid);
      Alert.alert('Joined', 'You have joined the ride.');
      navigation.navigate('RideTracking', { rideId });
    } catch (err) {
      console.error('join failed', err);
      Alert.alert('Join Failed', err.message || 'Could not join ride');
    }
  };

  const handleLeaveRide = async (rideId) => {
    if (!auth.currentUser) {
      Alert.alert('Not signed in', 'Please sign in to leave a ride');
      return;
    }
    try {
      await leaveRide(rideId, auth.currentUser.uid);
      Alert.alert('Left', 'You have left the ride');
    } catch (err) {
      console.error('leave failed', err);
      Alert.alert('Leave Failed', err.message || 'Could not leave ride');
    }
  };

  const handleCancelRide = async (rideId) => {
    if (!auth.currentUser) {
      Alert.alert('Not signed in', 'Please sign in to cancel a ride');
      return;
    }
    try {
      await cancelRide(rideId, auth.currentUser.uid);
      Alert.alert('Cancelled', 'Ride cancelled');
    } catch (err) {
      console.error('cancel failed', err);
      Alert.alert('Cancel Failed', err.message || 'Could not cancel ride');
    }
  };

  const handleLogout = async () => {
    try {
      await logoutUser();
      // Navigation will be handled by onAuthStateChanged in app/index.js
    } catch (e) {
      Alert.alert('Logout failed', getFriendlyAuthError(e));
    }
  };

  return (
    <SafeAreaView style={[styles.container, { paddingTop: 64 }]}>
  <TopBar navigation={navigation} showLogout={true} />
  {/* Test notification button removed */}
      <View style={styles.mapContainer}>
        <MapComponent
          userLocation={pickupCoords || location || null}
          drivers={[]}
          selectedDriverId={null}
        />
      </View>
      <RideTypeSelector visible={rideTypeVisible} fares={VEHICLE_TYPES} onSelect={async (type) => {
        setRideTypeVisible(false);
        setSelectedVehicle(type);
        await handleBooking();
      }} onClose={() => setRideTypeVisible(false)} />

  <SearchingBottomSheet visible={searching} onCancel={() => { setSearching(false); setRideId(null); }} />
  <DriverCardBottomSheet visible={!!driverInfo} driver={driverInfo} onCall={() => {}} onCancel={() => {}} />

      {/* Ride Booking Panel */}
      <View style={styles.bookingPanel}>
        <ScrollView showsVerticalScrollIndicator={false}>
          {/* Location Inputs */}
          <Text style={styles.sectionTitle}>Book Your Ride</Text>

          <Text style={styles.label}>Pickup Location</Text>
          <View style={[styles.inputRow, { alignItems: 'center' }]}> 
            <Text style={styles.inputIcon}>📍</Text>
            <Text style={styles.inputText}>{pickupLocation || 'Sophia College, Mumbai'}</Text>
          </View>

          <Text style={styles.label}>Drop Location</Text>
          <View style={styles.inputRow}>
            <Text style={styles.inputIcon}>🏁</Text>
            <TextInput
              style={styles.inputTextInput}
              value={dropLocation}
              onChangeText={(t) => {
                setDropLocation(t);
                setDropCoords(null);
                scheduleGeocode(t, 'drop');
              }}
              placeholder="Enter drop location"
            />
          </View>
          {dropSuggestions.length > 0 && (
            <View style={styles.suggestionsBox}>
              {dropSuggestions.map((s, idx) => (
                <TouchableOpacity
                  key={`d-${idx}`}
                  onPress={async () => {
                    if (s.place_id) {
                      const details = await getPlaceDetails(s.place_id);
                      if (details) {
                        console.log('Selected drop details', details);
                        setDropLocation(details.address);
                        setDropCoords({ latitude: details.latitude, longitude: details.longitude });
                        setDropSuggestions([]);
                        return;
                      }
                    }

                    setDropLocation(s.description || s.address || '');
                    if (s.latitude && s.longitude) setDropCoords({ latitude: s.latitude, longitude: s.longitude });
                    setDropSuggestions([]);
                  }}
                  style={styles.suggestionItem}
                >
                  <Text>{s.description || s.address}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Vehicle Selection */}
          <Text style={styles.label}>Select Vehicle</Text>
          <View style={styles.vehicleRow}>
            {Object.entries(VEHICLE_TYPES).map(([key, vehicle]) => (
              <TouchableOpacity
                key={key}
                style={[
                  styles.vehicleBtn,
                  selectedVehicle === key && styles.vehicleBtnActive
                ]}
                onPress={() => setSelectedVehicle(key)}
              >
                <Text style={styles.vehicleEmoji}>{ key === 'GO' ? '🚗' : key === 'SEDAN' ? '🚙' : '🚚' }</Text>
                <Text style={[
                  styles.vehicleBtnText,
                  selectedVehicle === key && styles.vehicleBtnTextActive
                ]}>
                  {vehicle.name}
                </Text>
                <Text style={styles.vehicleCapacity}>
                  Up to {vehicle.capacity} people
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Price Display */}
          <View style={styles.priceContainer}>
            <Text style={styles.priceLabel}>Estimated Fare</Text>
            <Text style={styles.priceValue}>₹{estimatedPrice}</Text>
          </View>

          {/* Allow Passengers Toggle */}
          <Text style={styles.label}>Allow Passengers</Text>
          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>Solo Ride</Text>
            <TouchableOpacity
              style={[styles.toggleBtn, !allowPassengers && styles.toggleBtnActive]}
              onPress={() => setAllowPassengers(false)}
            >
              <Text style={styles.toggleBtnText}>🚗</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.toggleBtn, allowPassengers && styles.toggleBtnActive]}
              onPress={() => setAllowPassengers(true)}
            >
              <Text style={styles.toggleBtnText}>👥</Text>
            </TouchableOpacity>
            <Text style={styles.toggleLabel}>Shared Ride</Text>
          </View>

          {/* Tip Options */}
          <Text style={styles.label}>Add a Tip</Text>
          <View style={styles.tipRow}>
            {[10, 20, 50].map((tipAmount) => (
              <TouchableOpacity
                key={tipAmount}
                style={[
                  styles.tipBtn,
                  tip === tipAmount && styles.tipBtnActive
                ]}
                onPress={() => setTip(tipAmount)}
              >
                <Text style={[
                  styles.tipBtnText,
                  tip === tipAmount && styles.tipBtnTextActive
                ]}>
                  ₹{tipAmount}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Book Button */}
          <TouchableOpacity
            style={[styles.bookBtn, booking && { opacity: 0.7 }]}
            onPress={handleBooking}
            disabled={booking}
          >
            <Text style={styles.bookBtnText}>
              {booking ? 'Booking...' : 'Book Ride'}
            </Text>
          </TouchableOpacity>

          {/* Navigation Buttons */}
          <View style={styles.navRow}>
            <TouchableOpacity
              style={styles.navBtn}
              onPress={async () => { try { await AsyncStorage.setItem('lastRoute', JSON.stringify({ name: 'MyBookings' })); } catch (e) {} ; navigation.navigate('MyBookings'); }}
            >
              <Text style={styles.navBtnText}>My Bookings</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>

      {/* Open rides broadcast panel (2-minute join window) */}
      {openRides.length > 0 && (
        <View style={styles.broadcastPanel}>
          <Text style={styles.broadcastTitle}>Open Rides (Join within)</Text>
          {openRides.map(r => {
            const remainingMs = Math.max(0, r.expiresAt - Date.now());
            const remainingSec = Math.ceil(remainingMs / 1000);
            const mins = Math.floor(remainingSec / 60);
            const secs = remainingSec % 60;
            // Render RideCard and countdown
            return (
              <View key={r.id}>
                <RideCard ride={r} currentUserId={auth.currentUser?.uid} onJoin={handleJoinRide} onLeave={handleLeaveRide} onCancel={handleCancelRide} />
                <Text style={styles.countdown}>{`${mins}:${String(secs).padStart(2, '0')}`}</Text>
              </View>
            );
          })}
        </View>
      )}

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  mapContainer: {
    height: height * 0.4,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    paddingHorizontal: 8
  },
  toggleLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333',
    minWidth: 60
  },
  toggleBtn: {
    width: 50,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f0f0f0',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 8
  },
  toggleBtnActive: {
    backgroundColor: '#22A07A',
  },
  toggleBtnText: {
    fontSize: 20,
    fontWeight: 'bold'
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  mapPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#e0e0e0',
  },
  bookingPanel: {
  flex: 1,
  backgroundColor: '#fff',
  borderTopLeftRadius: 20,
  borderTopRightRadius: 20,
  marginTop: -20,
  padding: 20,
  shadowColor: '#000',
  shadowOffset: { width: 0, height: -6 },
  shadowOpacity: 0.08,
  shadowRadius: 12,
  elevation: 8,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 16,
    color: '#333',
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
    color: '#333',
  },
  input: {
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    fontSize: 16,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 16,
  },
  inputIcon: {
    fontSize: 18,
    marginRight: 10,
  },
  inputText: {
    flex: 1,
    fontSize: 16,
  },
  inputTextInput: {
    flex: 1,
    fontSize: 16,
    padding: 0,
  },
  vehicleRow: {
  flexDirection: 'row',
  justifyContent: 'space-between',
  marginBottom: 16,
  },
  vehicleBtn: {
  flex: 1,
  backgroundColor: '#fafafa',
  padding: 14,
  borderRadius: 12,
  marginHorizontal: 6,
  alignItems: 'center',
  borderWidth: 1,
  borderColor: 'transparent',
  },
  vehicleBtnActive: {
  backgroundColor: '#22A07A',
  borderColor: '#22A07A',
  },
  vehicleBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  vehicleBtnTextActive: {
    color: '#fff',
  },
  vehicleCapacity: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
  },
  priceContainer: {
  flexDirection: 'row',
  justifyContent: 'space-between',
  alignItems: 'center',
  backgroundColor: '#fff',
  padding: 18,
  borderRadius: 12,
  marginBottom: 16,
  borderWidth: 1,
  borderColor: '#f1f1f1',
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.06,
  shadowRadius: 8,
  elevation: 4,
  },
  priceLabel: {
  fontSize: 14,
  fontWeight: '600',
  color: '#666',
  },
  priceValue: {
  fontSize: 22,
  fontWeight: '900',
  color: '#22A07A',
  },
  tipRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 20,
  },
  tipBtn: {
    backgroundColor: '#f0f0f0',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
  },
  tipBtnActive: {
    backgroundColor: '#276EF1',
  },
  tipBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  tipBtnTextActive: {
    color: '#fff',
  },
  bookBtn: {
    backgroundColor: '#22A07A',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 16,
    width: '100%',
    shadowColor: '#22A07A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 6,
  },
  bookBtnText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
  },
  vehicleEmoji: {
    fontSize: 22,
    marginBottom: 6,
  },
  navRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  navBtn: {
    flex: 1,
    backgroundColor: '#276EF1',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  navBtnText: {
    color: '#fff',
    fontWeight: '600',
  },
  suggestionsBox: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    marginBottom: 12,
    maxHeight: 140,
  },
  suggestionItem: {
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f1f1'
  },
  broadcastPanel: {
    position: 'absolute',
    right: 12,
    top: height * 0.12,
    width: 260,
    maxHeight: height * 0.6,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 6,
  },
  broadcastTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 8,
  },
  broadcastItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f1f1',
  },
  rideCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
  },
  rideCardLeft: {
    flex: 1,
    paddingRight: 8,
  },
  broadcastDest: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111',
  },
  broadcastMeta: {
    fontSize: 12,
    color: '#666',
  },
  broadcastRight: {
    alignItems: 'center',
    marginLeft: 8,
  },
  countdown: {
    fontSize: 16,
    fontWeight: '800',
    color: '#d9534f',
    marginBottom: 8,
  },
  joinBtn: {
    backgroundColor: '#276EF1',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    shadowColor: '#276EF1',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 3,
  },
  joinBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
});
