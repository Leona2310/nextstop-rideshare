import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { registerRootComponent } from 'expo';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { onAuthStateChanged } from 'firebase/auth';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, View } from 'react-native';
import { auth } from './firebase/firebaseConfig';
import * as FirebaseNotificationsService from './firebase/notificationsService';

// Ensure notifications are displayed when received
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// Import profile services
import { getDriverProfile } from './firebase/driverService';
import { getProfile } from './firebase/profileService';

// screens (auth)
import ForgotPassword from './screens/ForgotPassword';
import LoginScreen from './screens/LoginScreen';
import OTPScreen from './screens/OTPScreen';
import ProfileSetupScreen from './screens/ProfileSetupScreen';
import SignupScreen from './screens/SignupScreen';

// role stacks' screens
import AdminDashboard from './screens/admin/AdminDashboard';
import ManageUsers from './screens/admin/ManageUsers';
import DriverDashboard from './screens/driver/DriverDashboard';
import DriverPendingScreen from './screens/driver/DriverPendingScreen';
import DriverTrips from './screens/driver/DriverTrips';
import HomeScreen from './screens/HomeScreen'; // keep existing simple Home for fallback/logout
import MyBookings from './screens/user/MyBookings';
import RideTrackingScreen from './screens/user/RideTrackingScreen';
import UserHome from './screens/user/UserHome';

const RootStack = createNativeStackNavigator();

function App() {
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState(null);
  const [profileExists, setProfileExists] = useState(false);
  const [role, setRole] = useState(null); // 'student' | 'staff' | 'teacher' | 'driver' | 'admin' | null
  const [restoreRideId, setRestoreRideId] = useState(null);

  useEffect(() => {
    // Request permission and register for notifications on app start
    async function registerForPushNotifications() {
      try {
        if (!Device || !Device.isDevice) {
          console.log('Push notifications require a physical device');
          return;
        }
        const { status: existingStatus } = await Notifications.getPermissionsAsync();
        let finalStatus = existingStatus;
        if (existingStatus !== 'granted') {
          const { status } = await Notifications.requestPermissionsAsync();
          finalStatus = status;
        }
        if (finalStatus !== 'granted') {
          console.log('Permission not granted');
          return;
        }
      } catch (e) {
        console.warn('registerForPushNotifications failed', e);
      }
    }

    registerForPushNotifications();

    // Log receipt of notifications for debug
    const recvSub = Notifications.addNotificationReceivedListener(notification => {
      console.log('Notification received:', notification);
    });

    // Register for push notifications (minimal client-side flow using expo-notifications)
    (async function registerOnStart() {
      try {
        // request permission and log token
        const token = await (async function registerForPushNotificationsAsyncLocal() {
          try {
            const { status: existingStatus } = await Notifications.getPermissionsAsync();
            let finalStatus = existingStatus;
            if (existingStatus !== 'granted') {
              const { status } = await Notifications.requestPermissionsAsync();
              finalStatus = status;
            }
            if (finalStatus !== 'granted') {
              Alert.alert('Notifications', 'Permission for notifications was not granted');
              return null;
            }
            const tokenObj = await Notifications.getExpoPushTokenAsync();
            const token = tokenObj?.data;
            console.log('Expo push token (local):', token);
            return token;
          } catch (err) {
            console.warn('registerForPushNotificationsAsyncLocal failed', err);
            return null;
          }
        })();

        // If token obtained and a Firebase helper exists, defer storing to that service when user logs in
        if (token) {
          // no-op here; the firebase service used after auth will persist token per-user
        }
      } catch (e) {
        console.warn('registerForPushNotificationsAsync failed on startup', e?.message || e);
      }
    })();

    // Fallback: if auth doesn't respond within 3s, stop loading and show auth stack
    let authTimeout = setTimeout(() => {
      console.warn('Auth initialization timed out — showing auth stack');
      setLoading(false);
      setReady(true);
      setUser(null);
      setProfileExists(false);
      setRole(null);
    }, 3000);

    const unsub = onAuthStateChanged(auth, async (u) => {
      clearTimeout(authTimeout);
      console.log('AUTH CHANGE -> uid:', u?.uid, 'emailVerified:', u?.emailVerified);
      setUser(u);
      setProfileExists(false);
      setRole(null);
      setReady(false);

      if (u && u.emailVerified) {
        try {
          // Get base user profile
          const baseProfile = await getProfile(u.uid);
          
          if (baseProfile) {
            setProfileExists(true);
            const userRole = baseProfile.role;
            setRole(userRole);

            // Register for push notifications server-side (non-blocking)
            (async () => {
              try {
                await FirebaseNotificationsService.registerForPushNotificationsAsync(u.uid);
                console.log('Push token registered for', u.uid);
              } catch (e) {
                console.warn('Push registration failed', e.message || e);
              }
            })();

            // Special handling for drivers - check approval status
            if (userRole === 'driver') {
              const driverProfile = await getDriverProfile(u.uid);
              if (driverProfile && driverProfile.status !== 'approved') {
                setRole('driver_pending');
              }
            }
            // If this is a normal user, check for active ride to restore
            if (userRole === 'student' || userRole === 'teacher') {
              try {
                const { getActiveRideForUser } = await import('./firebase/rideService');
                const active = await getActiveRideForUser(u.uid);
                if (active) {
                  setRestoreRideId(active.id);
                }
              } catch (e) {
                console.warn('Failed checking for active ride', e);
              }
            }
          } else {
            setProfileExists(false);
            setRole(null);
          }
        } catch (e) {
          console.warn('profile check failed', e.message);
          setProfileExists(false);
          setRole(null);
        }
      }

      setLoading(false);
      setReady(true);
    });

    return () => {
  try { clearTimeout(authTimeout); } catch (e) {}
  try { if (recvSub && typeof recvSub.remove === 'function') recvSub.remove(); } catch (e) {}
  try { if (recvSub && typeof recvSub.unsubscribe === 'function') recvSub.unsubscribe(); } catch (e) {}
  unsub();
    };
  }, []);

  if (loading || !ready) {
    return (
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  // Build stacks inline for simplicity
  const AuthStack = () => (
    <RootStack.Navigator screenOptions={{ headerShown: false }}>
      <RootStack.Screen name="Login" component={LoginScreen} />
      <RootStack.Screen name="Signup" component={SignupScreen} />
      <RootStack.Screen name="ForgotPassword" component={ForgotPassword} />
      <RootStack.Screen name="OTP" component={OTPScreen} />
      <RootStack.Screen name="ProfileSetup" component={ProfileSetupScreen} />
    </RootStack.Navigator>
  );

  const UserStack = () => (
    <RootStack.Navigator screenOptions={{ headerShown: false }}>
  {/* Always register RideTracking so navigation('RideTracking') is valid from anywhere in UserStack. */}
  <RootStack.Screen name="UserHome" component={UserHome} />
  <RootStack.Screen name="RideTracking" component={RideTrackingScreen} initialParams={restoreRideId ? { rideId: restoreRideId } : undefined} />
      <RootStack.Screen name="MyBookings" component={MyBookings} />
      
      <RootStack.Screen name="ProfileSetup" component={ProfileSetupScreen} />
      <RootStack.Screen name="Home" component={HomeScreen} />
    </RootStack.Navigator>
  );

  const DriverStack = () => (
    <RootStack.Navigator screenOptions={{ headerShown: false }}>
      <RootStack.Screen name="DriverDashboard" component={DriverDashboard} />
      <RootStack.Screen name="DriverTrips" component={DriverTrips} />
      <RootStack.Screen name="ProfileSetup" component={ProfileSetupScreen} />
      <RootStack.Screen name="Home" component={HomeScreen} />
    </RootStack.Navigator>
  );

  const AdminStack = () => (
    <RootStack.Navigator screenOptions={{ headerShown: false }}>
      <RootStack.Screen name="AdminDashboard" component={AdminDashboard} />
      <RootStack.Screen name="ManageUsers" component={ManageUsers} />
      <RootStack.Screen name="Home" component={HomeScreen} />
    </RootStack.Navigator>
  );

  let ActiveStack = AuthStack;
  if (user && !user.emailVerified) ActiveStack = () => <RootStack.Navigator screenOptions={{ headerShown: false }}><RootStack.Screen name="OTP" component={OTPScreen} /></RootStack.Navigator>;
  else if (user && user.emailVerified && !profileExists) ActiveStack = () => <RootStack.Navigator screenOptions={{ headerShown: false }}><RootStack.Screen name="ProfileSetup" component={ProfileSetupScreen} /></RootStack.Navigator>;
  else if (user && user.emailVerified && profileExists) {
  if (role === 'driver') ActiveStack = DriverStack;
    else if (role === 'driver_pending') ActiveStack = () => <RootStack.Navigator screenOptions={{ headerShown: false }}><RootStack.Screen name="DriverPending" component={DriverPendingScreen} /></RootStack.Navigator>;
    else if (role === 'admin') ActiveStack = AdminStack;
    else if (role === 'student' || role === 'teacher') ActiveStack = UserStack;
    else ActiveStack = UserStack; // fallback
  }

  return (
    <NavigationContainer key={`${user?.uid ?? 'anon'}-${role}-${profileExists}`}>
      <ActiveStack />
    </NavigationContainer>
  );
}

registerRootComponent(App);
export default App;
