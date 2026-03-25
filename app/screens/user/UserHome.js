import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { collection, query, where } from 'firebase/firestore';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Dimensions,
  Linking,
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
import RideTypeSelector from '../../components/RideTypeSelector';
import SearchingBottomSheet from '../../components/SearchingBottomSheet';
import TopBar from '../../components/TopBar';
import { calculateFare } from '../../config/fareConfig';
import { getFriendlyAuthError, logoutUser } from '../../firebase/authService';
import { auth, db, safeOnSnapshot } from '../../firebase/firebaseConfig';
import { getProfile } from '../../firebase/profileService';
import { joinRide as clientJoinRide } from '../../firebase/rideClientService';
import { createRideRequest } from '../../firebase/rideService';
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
  const [permissionDenied, setPermissionDenied] = useState(false);
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

  useEffect(() => {
    initializeLocation();
    // Load fixed Sophia pickup coordinates
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
      } catch (_e) { console.warn('failed to load profile', _e); }
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
  // listen for both 'OPEN' and legacy 'searching' statuses so broadcasts created
  // by createRideRequest are visible to other users during the 2-minute window
  const q = query(ridesCol, where('status', 'in', ['OPEN', 'searching']));
      unsub = safeOnSnapshot(q, (snap) => {
        const now = Date.now();
        const items = [];
        snap.docs.forEach(d => {
          const data = d.data();
          // Only include rides that have expiresAt in future
          const expiresAt = data.expiresAt && typeof data.expiresAt.toMillis === 'function' ? data.expiresAt.toMillis() : (data.expiresAt ? (new Date(data.expiresAt)).getTime() : null);
          if (!expiresAt || expiresAt <= now) return;
          items.push({ id: d.id, ...data, expiresAt });
        });
        // sort by soonest expiry
        items.sort((a, b) => a.expiresAt - b.expiresAt);
        setOpenRides(items);
      });
    } catch (_e) {
      console.warn('subscribe open rides failed', _e);
    }
    return () => { if (typeof unsub === 'function') unsub(); };
  }, []);

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
              try { navigation.navigate(parsed.name, parsed.params || {}); } catch (_e) { /* ignore */ }
            }, 300);
          }
        }
      } catch (e) { /* ignore */ }
    })();
  }, []);

  const initializeLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        console.warn('UserHome: location permission denied');
        setPermissionDenied(true);
        Alert.alert('Location Permission', 'Location permission was denied. Map features will be limited.');
        return;
      }

      // Try to get current position safely
      try {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        if (loc && loc.coords) {
          setLocation({ latitude: loc.coords.latitude, longitude: loc.coords.longitude, speed: loc.coords.speed || 0, heading: loc.coords.heading || 0 });
        }
      } catch (_err) {
        console.error('UserHome: getCurrentPositionAsync failed', _err);
      }
    } catch (_err) {
      console.error('UserHome: initializeLocation failed', _err);
    }
  };

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
      // Use Google Places Autocomplete when API key available
      const preds = await getPlacePredictions(text);
      if (forField === 'pickup') setPickupSuggestions(preds);
      else setDropSuggestions(preds);
    } catch (_err) {
      console.warn('place predictions failed, falling back to geocode', _err);
      try {
        const results = await Location.geocodeAsync(text);
        const formatted = results.map(r => {
          const parts = [];
          if (r.name) parts.push(r.name);
          if (r.street) parts.push(r.street);
          if (r.city) parts.push(r.city);
          if (r.region) parts.push(r.region);
          if (r.country) parts.push(r.country);
          const address = parts.join(', ') || `${r.latitude.toFixed(4)}, ${r.longitude.toFixed(4)}`;
          return {
            description: address,
            place_id: null,
            latitude: r.latitude,
            longitude: r.longitude
          };
        });
        if (forField === 'pickup') setPickupSuggestions(formatted);
        else setDropSuggestions(formatted);
      } catch (_e) {
        console.warn('geocode fallback failed', _e);
        if (forField === 'pickup') setPickupSuggestions([]);
        else setDropSuggestions([]);
      }
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
      } catch (_err) {
        console.warn('Could not fetch Sophia pickup', _err);
      }
    }

    // If dropCoords missing, try to resolve the typed dropLocation using predictions or geocode
    if (!dropCoords) {
      if (dropLocation && dropLocation.trim().length > 0) {
        // Try Nominatim predictions
        try {
          const preds = await getPlacePredictions(dropLocation);
          if (Array.isArray(preds) && preds.length > 0) {
            const p = preds[0];
            setDropLocation(p.address || p.description || dropLocation);
            setDropCoords({ latitude: p.latitude, longitude: p.longitude });
          } else {
            // Fallback to expo Location geocode
            try {
              const results = await Location.geocodeAsync(dropLocation);
              if (results && results.length > 0) {
                const r = results[0];
                setDropCoords({ latitude: r.latitude, longitude: r.longitude });
              }
            } catch (_e) {
              console.warn('Geocode fallback failed', _e);
            }
          }
        } catch (_err) {
          console.warn('Resolving dropLocation failed', _err);
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
        tip
      });

  // update UI to searching state and navigate to tracking
  setRideId(rideId);
  setSearching(true);
  Alert.alert('Booking Confirmed', `Your ride has been booked!\nRide ID: ${rideId}\nEstimated price: ₹${estimatedPrice}`);
  try { await AsyncStorage.setItem('lastRoute', JSON.stringify({ name: 'RideTracking', params: { rideId } })); } catch (_e) {}
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
  await clientJoinRide(rideId, auth.currentUser.uid);
      Alert.alert('Joined', 'You have joined the ride.');
      // Optionally navigate to RideTracking
      navigation.navigate('RideTracking', { rideId });
    } catch (_err) {
      console.error('join failed', _err);
      Alert.alert('Join Failed', _err.message || 'Could not join ride');
    }
  };

  const handleLogout = async () => {
    try {
      await logoutUser();
      // Navigation will be handled by onAuthStateChanged in app/index.js
    } catch (_e) {
      Alert.alert('Logout failed', getFriendlyAuthError(_e));
    }
  };

  return (
    <SafeAreaView style={[styles.container, { paddingTop: 64 }]}>
  <TopBar navigation={navigation} showLogout={true} />
      {/* Map View */}
      <View style={styles.mapContainer}>
        <MapComponent
          userLocation={location || null}
          drivers={[]}
          selectedDriverId={null}
        />
        {permissionDenied && (
          <View style={styles.permissionNotice} pointerEvents="box-none">
            <View style={styles.permissionInner}>
              <Text style={styles.permissionText}>Location permission was denied. Open settings to enable map features.</Text>
              <TouchableOpacity style={styles.permissionBtn} onPress={() => { try { Linking.openSettings(); } catch (_e) { console.warn('openSettings failed', _e); } }}>
                <Text style={styles.permissionBtnText}>Open Settings</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
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
          <View style={[styles.input, { justifyContent: 'center' }]}> 
            <Text>{pickupLocation || 'Sophia College, Mumbai'}</Text>
          </View>

          <Text style={styles.label}>Drop Location</Text>
          <TextInput
            style={styles.input}
            value={dropLocation}
            onChangeText={(t) => {
              setDropLocation(t);
              setDropCoords(null);
              scheduleGeocode(t, 'drop');
            }}
            placeholder="Enter drop location"
          />
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
            <Text style={styles.priceLabel}>Estimated Price:</Text>
            <Text style={styles.priceValue}>₹{estimatedPrice}</Text>
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
            style={styles.bookBtn}
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
            return (
              <View key={r.id} style={styles.broadcastItem}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.broadcastDest}>{r.dropLocation && (r.dropLocation.name || r.dropLocation.address) ? (r.dropLocation.name || r.dropLocation.address) : 'Unknown destination'}</Text>
                  <Text style={styles.broadcastMeta}>ETA: {r.etaToPickup ?? '-'} min • ₹{r.estimatedPrice ?? (r.fare && r.fare.total) ?? '-'}</Text>
                </View>
                <View style={styles.broadcastRight}>
                  <Text style={styles.countdown}>{`${mins}:${String(secs).padStart(2, '0')}`}</Text>
                  <TouchableOpacity style={styles.joinBtn} onPress={() => handleJoinRide(r.id)}>
                    <Text style={{ color: 'white' }}>Join</Text>
                  </TouchableOpacity>
                </View>
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
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  // mapPlaceholder styles removed; MapComponent handles its own layout
  permissionNotice: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    right: 12,
    alignItems: 'center',
  },
  permissionInner: {
    backgroundColor: 'rgba(0,0,0,0.7)',
    padding: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  permissionText: {
    color: '#fff',
    marginBottom: 8,
    textAlign: 'center',
  },
  permissionBtn: {
    backgroundColor: '#276EF1',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
  },
  permissionBtnText: {
    color: '#fff',
    fontWeight: '700',
  },
  bookingPanel: {
    flex: 1,
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    marginTop: -20,
    padding: 20,
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
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    fontSize: 16,
  },
  vehicleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  vehicleBtn: {
    flex: 1,
    backgroundColor: '#f0f0f0',
    padding: 12,
    borderRadius: 8,
    marginHorizontal: 4,
    alignItems: 'center',
  },
  vehicleBtnActive: {
    backgroundColor: '#276EF1',
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
    backgroundColor: '#f8f9fa',
    padding: 16,
    borderRadius: 8,
    marginBottom: 16,
  },
  priceLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  priceValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#276EF1',
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
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 16,
  },
  bookBtnText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
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
  broadcastDest: {
    fontSize: 14,
    fontWeight: '600',
    color: '#222',
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
    fontWeight: '700',
    color: '#d9534f',
    marginBottom: 6,
  },
  joinBtn: {
    backgroundColor: '#276EF1',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
});
