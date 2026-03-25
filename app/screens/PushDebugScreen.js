import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ScrollView, TextInput } from 'react-native';
import { auth , db } from '../firebase/firebaseConfig';
import { registerForPushNotificationsAsync, sendPushNotifications, broadcastToAllUsers } from '../firebase/notificationsService';
import { doc, getDoc } from 'firebase/firestore';


export default function PushDebugScreen() {
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(false);
  const [manualToken, setManualToken] = useState('');

  useEffect(() => {
    // try to load token from Firestore for current user
    (async () => {
      try {
        const uid = auth.currentUser?.uid;
        if (!uid) return;
        const uref = doc(db, 'users', uid);
        const snap = await getDoc(uref);
        if (snap && snap.exists()) {
          const data = snap.data();
          if (data?.pushToken) setToken(data.pushToken);
        }
      } catch (e) {
        console.warn('load push token failed', e);
      }
    })();
  }, []);

  const handleRegister = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) return Alert.alert('Not signed in', 'Please sign in to register for push');
    setLoading(true);
    try {
      const t = await registerForPushNotificationsAsync(uid);
      setToken(t);
      Alert.alert('Registered', `Token: ${t}`);
    } catch (e) {
      Alert.alert('Registration failed', e.message || String(e));
    } finally { setLoading(false); }
  };

  const handleSendTest = async () => {
    if (!token) return Alert.alert('No token', 'Register first to obtain a token');
    setLoading(true);
    try {
      const res = await sendPushNotifications([token], 'Test push', 'This is a test notification from the app');
      Alert.alert('Push Send Result', JSON.stringify(res, null, 2).slice(0, 1000));
    } catch (e) {
      Alert.alert('Send failed', e.message || String(e));
    } finally { setLoading(false); }
  };

  const handleSendToManual = async () => {
    if (!manualToken) return Alert.alert('No token', 'Paste an Expo push token into the field below');
    setLoading(true);
    try {
      const res = await sendPushNotifications([manualToken.trim()], 'Manual test push', 'This push was sent to a pasted token');
      Alert.alert('Manual push result', JSON.stringify(res, null, 2).slice(0, 1000));
    } catch (e) {
      Alert.alert('Send failed', e.message || String(e));
    } finally { setLoading(false); }
  };

  const handleBroadcastAll = async () => {
    setLoading(true);
    try {
      const res = await broadcastToAllUsers('New ride nearby', 'A new ride was created nearby. Join within 2 minutes.', { test: true });
      Alert.alert('Broadcast result', JSON.stringify(res, null, 2).slice(0, 1000));
    } catch (e) {
      Alert.alert('Broadcast failed', e.message || String(e));
    } finally { setLoading(false); }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Push Debug</Text>
      <Text style={styles.label}>Signed in as:</Text>
      <Text style={styles.value}>{auth.currentUser?.email || 'Not signed in'}</Text>

      <Text style={styles.label}>Stored push token</Text>
      <Text style={styles.value}>{token || '(none)'}</Text>

      <TouchableOpacity style={styles.button} onPress={handleRegister} disabled={loading}>
        <Text style={styles.buttonText}>Register for Push</Text>
      </TouchableOpacity>

      <TouchableOpacity style={[styles.button, { backgroundColor: '#276EF1' }]} onPress={handleSendTest} disabled={loading || !token}>
        <Text style={[styles.buttonText, { color: '#fff' }]}>Send Test Push to this Device</Text>
      </TouchableOpacity>

      <TouchableOpacity style={[styles.button, { backgroundColor: '#444' }]} onPress={handleBroadcastAll} disabled={loading}>
        <Text style={[styles.buttonText, { color: '#fff' }]}>Broadcast to all users (debug)</Text>
      </TouchableOpacity>

      <Text style={[styles.label, { marginTop: 18 }]}>Manual token (paste an Expo token to test send)</Text>
      <TextInput
        style={{ borderWidth: 1, borderColor: '#ddd', padding: 10, borderRadius: 8, marginTop: 8 }}
        placeholder="ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]"
        value={manualToken}
        onChangeText={setManualToken}
        editable={!loading}
        multiline
      />

      <TouchableOpacity style={[styles.button, { backgroundColor: '#6A5ACD' }]} onPress={handleSendToManual} disabled={loading || !manualToken}>
        <Text style={[styles.buttonText, { color: '#fff' }]}>Send to manual token</Text>
      </TouchableOpacity>

      <Text style={styles.note}>Notes: Use a physical device. Grant notification permission when prompted.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 20, backgroundColor: '#fff', alignItems: 'stretch' },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 12 },
  label: { fontSize: 14, fontWeight: '600', marginTop: 12 },
  value: { fontSize: 13, color: '#333', marginTop: 4 },
  button: { marginTop: 16, backgroundColor: '#22A07A', padding: 14, borderRadius: 8, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '700' },
  note: { marginTop: 20, color: '#666', fontSize: 12 }
});
