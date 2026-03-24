import React from 'react';
import { SafeAreaView, View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { logoutUser } from '../firebase/authService';

export default function TopBar({ navigation, showLogout = false, showOnlineToggle = false, isOnline = false, onToggleOnline = null }) {
  const handleBack = () => {
    try {
      if (navigation && typeof navigation.canGoBack === 'function' && navigation.canGoBack()) {
        navigation.goBack();
        return;
      }
      // fallback routes - try to navigate to a reasonable home
      if (navigation && typeof navigation.navigate === 'function') {
        if (navigation.navigate) navigation.navigate('Home');
        else if (navigation.navigate) navigation.navigate('UserHome');
      }
    } catch (e) { /* swallow */ }
  };

  return (
    <SafeAreaView pointerEvents="box-none" style={styles.safe}>
      <View style={styles.container} pointerEvents="box-none">
        <View style={styles.leftContainer}>
          <TouchableOpacity accessibilityLabel="Back" accessibilityRole="button" style={styles.backBtn} onPress={handleBack}>
            <Text style={styles.backText}>{'‹'}</Text>
          </TouchableOpacity>

          {showOnlineToggle ? (
            <TouchableOpacity
              accessibilityLabel="Go Online Toggle"
              accessibilityRole="button"
              style={[styles.onlineToggle, { backgroundColor: isOnline ? '#22A07A' : '#dc3545' }]}
              onPress={() => { try { if (typeof onToggleOnline === 'function') onToggleOnline(); } catch (e) {} }}
            >
              <Text style={styles.onlineText}>{isOnline ? 'Go Offline' : 'Go Online'}</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {showLogout ? (
          <TouchableOpacity style={styles.logoutBtn} onPress={async () => { try { await logoutUser(); } catch (e) { console.warn('logout failed', e); } }}>
            <Text style={styles.logoutText}>Logout</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 9999 },
  container: { height: 88, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  leftContainer: { flexDirection: 'column', alignItems: 'flex-start' },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.95)',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
  },
  backText: { fontSize: 28, color: '#222', lineHeight: Platform.OS === 'ios' ? 30 : 28 },
  logoutBtn: { paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#dc3545', borderRadius: 8 },
  logoutText: { color: '#fff', fontWeight: '600' },
  onlineToggle: { marginTop: 8, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, elevation: 3 },
  onlineText: { color: '#fff', fontWeight: '600' },
});
