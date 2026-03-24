import { useEffect, useState } from 'react';
import { Alert, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { getDriverProfile } from '../../firebase/driverService';
import { auth, db, safeOnSnapshot } from '../../firebase/firebaseConfig';
import { doc } from 'firebase/firestore';
import TopBar from '../../components/TopBar';

export default function DriverPendingScreen({ navigation }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadProfile();
    // realtime listen to driver's status
    const driverRef = doc(db, 'drivers', auth.currentUser.uid);
  const unsub = safeOnSnapshot(driverRef, (snap) => {
      if (snap.exists()) {
        const d = snap.data();
        if (d.status === 'approved') {
          // navigate to driver dashboard
          navigation.reset({ index: 0, routes: [{ name: 'DriverDashboard' }] });
        }
      }
    }, (err) => console.warn('driver pending snapshot error', err));

    return () => unsub();
  }, []);

  const loadProfile = async () => {
    try {
      const driverProfile = await getDriverProfile(auth.currentUser.uid);
      setProfile(driverProfile);
    } catch (error) {
      console.error('Error loading driver profile:', error);
      Alert.alert('Error', 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Logout',
          onPress: async () => {
            try {
              await auth.signOut();
              navigation.reset({
                index: 0,
                routes: [{ name: 'Login' }],
              });
            } catch (error) {
              console.error('Error logging out:', error);
            }
          }
        }
      ]
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
  <TopBar navigation={navigation} showLogout={true} />
      <View style={styles.content}>
        <Text style={styles.title}>Application Pending</Text>

        <View style={styles.statusCard}>
          <Text style={styles.statusTitle}>Your driver application is under review</Text>
          <Text style={styles.statusText}>
            Thank you for applying to be a driver with NextStop. Your application is currently being reviewed by our admin team.
          </Text>

          {profile && (
            <View style={styles.profileInfo}>
              <Text style={styles.infoTitle}>Application Details:</Text>
              <Text style={styles.infoText}>Name: {profile.name}</Text>
              <Text style={styles.infoText}>Email: {profile.email}</Text>
              <Text style={styles.infoText}>Phone: {profile.phone}</Text>
              <Text style={styles.infoText}>Vehicle: {profile.vehicleModel} ({profile.vehicleNumber})</Text>
              <Text style={styles.infoText}>License: {profile.licenseNumber}</Text>
            </View>
          )}

          <Text style={styles.noteText}>
            You will receive an email notification once your application is approved. This usually takes 1-2 business days.
          </Text>
        </View>

        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
          <Text style={styles.logoutBtnText}>Logout</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  content: {
    flex: 1,
    padding: 20,
    justifyContent: 'center',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 18,
    color: '#666',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#333',
    textAlign: 'center',
    marginBottom: 30,
  },
  statusCard: {
    backgroundColor: '#fff',
    padding: 20,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    marginBottom: 30,
  },
  statusTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  statusText: {
    fontSize: 16,
    color: '#666',
    lineHeight: 24,
    marginBottom: 20,
  },
  profileInfo: {
    backgroundColor: '#f8f9fa',
    padding: 16,
    borderRadius: 8,
    marginBottom: 20,
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  infoText: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
  noteText: {
    fontSize: 14,
    color: '#888',
    fontStyle: 'italic',
    lineHeight: 20,
  },
  logoutBtn: {
    backgroundColor: '#6c757d',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  logoutBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
