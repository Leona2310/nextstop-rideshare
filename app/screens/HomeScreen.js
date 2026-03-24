import React, { useEffect, useState } from 'react';
import { Alert, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { logoutUser, getFriendlyAuthError } from '../firebase/authService';
import TopBar from '../components/TopBar';
import { getProfile } from '../firebase/profileService';
import { getDriverProfile } from '../firebase/driverService';
import { auth } from '../firebase/firebaseConfig';

export default function HomeScreen({ navigation }) {
  const [profile, setProfile] = useState(null);
  const [driverProfile, setDriverProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const handleLogout = async () => {
    try {
      await logoutUser();
      // onAuthStateChanged in app/index.js will detect sign-out and show the Login screen.
    } catch (e) {
      Alert.alert('Logout failed', getFriendlyAuthError(e));
    }
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      try {
        const p = await getProfile();
        if (!mounted) return;
        setProfile(p);
        if (p?.role === 'driver') {
          const dp = await getDriverProfile();
          if (!mounted) return;
          setDriverProfile(dp);
        }
      } catch (e) {
        console.warn('load profile failed', e);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <TopBar navigation={navigation} showLogout={true} />

      <View style={styles.card}>
        {loading ? (
          <Text style={styles.title}>Loading profile...</Text>
        ) : profile ? (
          <>
            <Text style={styles.title}>{profile.name || auth.currentUser?.email || 'No name'}</Text>
            <Text style={styles.subtitle}>{(profile.role || '').toUpperCase()}</Text>

            {profile.role === 'driver' && driverProfile ? (
              <View style={styles.profileInfo}>
                <Text style={styles.infoText}>Email: {driverProfile.email || profile.email || '-'}</Text>
                <Text style={styles.infoText}>Phone: {driverProfile.phone || profile.phone || '-'}</Text>
                <Text style={styles.infoText}>Vehicle: {driverProfile.vehicleModel || '-'} ({driverProfile.vehicleNumber || '-'})</Text>
                <Text style={styles.infoText}>License: {driverProfile.licenseNumber || '-'}</Text>
                <Text style={styles.infoText}>Status: {driverProfile.status || '-'}</Text>
              </View>
            ) : (
              <View style={styles.profileInfo}>
                <Text style={styles.infoText}>Email: {profile.email || auth.currentUser?.email || '-'}</Text>
                <Text style={styles.infoText}>Phone: {profile.phone || '-'}</Text>
                {profile.vehicleModel || profile.vehicleNumber ? (
                  <Text style={styles.infoText}>Vehicle: {profile.vehicleModel || '-'} ({profile.vehicleNumber || '-'})</Text>
                ) : null}
              </View>
            )}

            <TouchableOpacity style={styles.btn} onPress={handleLogout}>
              <Text style={styles.btnText}>Logout</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.title}>Profile not found</Text>
            <Text style={styles.subtitle}>Please complete your profile.</Text>
            <TouchableOpacity style={styles.btn} onPress={() => navigation.navigate('ProfileSetup')}>
              <Text style={styles.btnText}>Set up profile</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f7f8fb' },
  card: { margin: 20, padding: 20, backgroundColor: '#fff', borderRadius: 12, elevation: 3, alignItems: 'center' },
  title: { fontSize: 20, fontWeight: '600', marginBottom: 6 },
  subtitle: { color: '#555', marginBottom: 16 },
  btn: { backgroundColor: '#276EF1', padding: 12, borderRadius: 8 },
  btnText: { color: '#fff', fontWeight: '600' }
});