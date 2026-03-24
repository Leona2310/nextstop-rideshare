import React, { useState, useEffect } from 'react';
import { Alert, SafeAreaView, StyleSheet, Text, TouchableOpacity, View, ScrollView, RefreshControl } from 'react-native';
import { logoutUser, getFriendlyAuthError } from '../../firebase/authService';
import { getAdminStats, getAllUsers, getAllRides, deleteUser } from '../../firebase/adminService';
import { getPendingDrivers, approveDriver, rejectDriver } from '../../firebase/driverService';
import { collection, query, where } from 'firebase/firestore';
import { db, safeOnSnapshot } from '../../firebase/firebaseConfig';
import TopBar from '../../components/TopBar';

export default function AdminDashboard({ navigation }) {
  const [stats, setStats] = useState(null);
  const [pendingDrivers, setPendingDrivers] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [allRides, setAllRides] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadData();
    // realtime subscription for pending drivers
    const driversRef = collection(db, 'drivers');
    const pendingQ = query(driversRef, where('status', '==', 'pending'));
    const unsubscribePending = safeOnSnapshot(pendingQ, (snap) => {
      setPendingDrivers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => console.warn('pending drivers snapshot error', err));

    return () => unsubscribePending();
  }, []);

  const loadData = async () => {
    try {
      const [statsData, pendingDriversData, usersData, ridesData] = await Promise.all([
        getAdminStats(),
        getPendingDrivers(),
        getAllUsers(),
        getAllRides()
      ]);

      setStats(statsData);
      setPendingDrivers(pendingDriversData);
      setAllUsers(usersData);
      setAllRides(ridesData);
    } catch (error) {
      console.error('Error loading admin data:', error);
      Alert.alert('Error', 'Failed to load admin data');
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const handleApproveDriver = async (driverId) => {
    try {
      await approveDriver(driverId, 'admin'); // Using 'admin' as adminId for now
      Alert.alert('Success', 'Driver approved successfully');
      loadData(); // Refresh data
    } catch (error) {
      console.error('approveDriver failed:', error);
      Alert.alert('Error', 'Failed to approve driver. Check console for details.');
    }
  };

  const handleRejectDriver = async (driverId) => {
    try {
      await rejectDriver(driverId, 'admin');
      Alert.alert('Success', 'Driver rejected');
      loadData(); // Refresh data
    } catch (error) {
      console.error('rejectDriver failed:', error);
      Alert.alert('Error', 'Failed to reject driver. Check console for details.');
    }
  };

  const handleDeleteUser = async (userId, userName) => {
    Alert.alert(
      'Delete User',
      `Are you sure you want to delete ${userName}? This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteUser(userId);
              Alert.alert('Success', 'User deleted successfully');
              loadData(); // Refresh data
            } catch (error) {
              Alert.alert('Error', 'Failed to delete user');
            }
          }
        }
      ]
    );
  };

  const handleLogout = async () => {
    try {
      await logoutUser();
      // Navigation will be handled by onAuthStateChanged in app/index.js
    } catch (e) {
      Alert.alert('Logout failed', getFriendlyAuthError(e));
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <Text>Loading...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
  <TopBar navigation={navigation} showLogout={true} />
      <ScrollView
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <Text style={styles.title}>Admin Dashboard</Text>

        {/* Statistics */}
        {stats && (
          <View style={styles.statsContainer}>
            <Text style={styles.sectionTitle}>Statistics</Text>
            <View style={styles.statsGrid}>
              <View style={styles.statCard}>
                <Text style={styles.statNumber}>{stats.totalUsers}</Text>
                <Text style={styles.statLabel}>Total Users</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statNumber}>{stats.totalDrivers}</Text>
                <Text style={styles.statLabel}>Total Drivers</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statNumber}>{stats.approvedDrivers}</Text>
                <Text style={styles.statLabel}>Approved Drivers</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statNumber}>{stats.pendingDrivers}</Text>
                <Text style={styles.statLabel}>Pending Drivers</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statNumber}>{stats.totalRides}</Text>
                <Text style={styles.statLabel}>Total Rides</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statNumber}>{stats.activeRides}</Text>
                <Text style={styles.statLabel}>Active Rides</Text>
              </View>
            </View>
          </View>
        )}

        {/* Pending Driver Approvals */}
        {pendingDrivers.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Pending Driver Approvals</Text>
            {pendingDrivers.map((driver) => (
              <View key={driver.id} style={styles.driverCard}>
                <View style={styles.driverInfo}>
                  <Text style={styles.driverName}>{driver.name}</Text>
                  <Text style={styles.driverDetail}>Email: {driver.email}</Text>
                  <Text style={styles.driverDetail}>Phone: {driver.phone}</Text>
                  <Text style={styles.driverDetail}>Vehicle: {driver.vehicleModel}</Text>
                </View>
                <View style={styles.driverActions}>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.approveBtn]}
                    onPress={() => handleApproveDriver(driver.id)}
                  >
                    <Text style={styles.approveBtnText}>Approve</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.rejectBtn]}
                    onPress={() => handleRejectDriver(driver.id)}
                  >
                    <Text style={styles.rejectBtnText}>Reject</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Recent Rides */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recent Rides ({allRides.length})</Text>
          {allRides.slice(0, 10).map((ride) => (
            <View key={ride.id} style={styles.rideCard}>
              <Text style={styles.rideText}>From: {typeof ride.pickupLocation === 'object' ? (ride.pickupLocation.address || `${ride.pickupLocation.latitude}, ${ride.pickupLocation.longitude}`) : ride.pickupLocation}</Text>
              <Text style={styles.rideText}>To: {typeof ride.dropLocation === 'object' ? (ride.dropLocation.address || `${ride.dropLocation.latitude}, ${ride.dropLocation.longitude}`) : ride.dropLocation}</Text>
              <Text style={styles.rideText}>Status: {ride.status}</Text>
              <Text style={styles.rideText}>Fare: ₹{ride.estimatedPrice}</Text>
            </View>
          ))}
        </View>

        {/* User Management */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>User Management ({allUsers.length})</Text>
          {allUsers.slice(0, 20).map((user) => (
            <View key={user.id} style={styles.userCard}>
              <View style={styles.userInfo}>
                <Text style={styles.userName}>{user.name}</Text>
                <Text style={styles.userDetail}>Role: {user.role}</Text>
                <Text style={styles.userDetail}>Email: {user.email}</Text>
              </View>
              <TouchableOpacity
                style={styles.deleteBtn}
                onPress={() => handleDeleteUser(user.id, user.name)}
              >
                <Text style={styles.deleteBtnText}>Delete</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>

        {/* Navigation */}
        <View style={styles.navContainer}>
          <TouchableOpacity style={styles.navBtn} onPress={() => navigation.navigate('ManageUsers')}>
            <Text style={styles.navBtnText}>Manage Users</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.navBtn} onPress={handleLogout}>
            <Text style={styles.navBtnText}>Logout</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginVertical: 20,
    color: '#333',
  },
  statsContainer: {
    backgroundColor: '#fff',
    margin: 16,
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 12,
    color: '#333',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  statCard: {
    width: '48%',
    backgroundColor: '#f8f9fa',
    padding: 16,
    borderRadius: 8,
    marginBottom: 12,
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#276EF1',
  },
  statLabel: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  section: {
    backgroundColor: '#fff',
    margin: 16,
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  driverCard: {
    backgroundColor: '#f8f9fa',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  driverInfo: {
    marginBottom: 12,
  },
  driverName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  driverDetail: {
    fontSize: 14,
    color: '#666',
    marginTop: 2,
  },
  driverActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  actionBtn: {
    flex: 1,
    padding: 10,
    borderRadius: 6,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  approveBtn: {
    backgroundColor: '#28a745',
  },
  approveBtnText: {
    color: '#fff',
    fontWeight: '600',
  },
  rejectBtn: {
    backgroundColor: '#dc3545',
  },
  rejectBtnText: {
    color: '#fff',
    fontWeight: '600',
  },
  rideCard: {
    backgroundColor: '#f8f9fa',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  rideText: {
    fontSize: 14,
    color: '#666',
    marginBottom: 2,
  },
  userCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  userDetail: {
    fontSize: 14,
    color: '#666',
    marginTop: 2,
  },
  deleteBtn: {
    backgroundColor: '#dc3545',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  deleteBtnText: {
    color: '#fff',
    fontWeight: '600',
  },
  navContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    margin: 16,
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
});