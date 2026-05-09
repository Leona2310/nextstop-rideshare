import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export default function RideCard({ ride, currentUserId, onJoin, onLeave, onCancel }) {
  const joined = ride.joinedUsers || ride.passengers || [];
  const carType = ride.vehicleType || ride.carType || 'GO';
  const totalSeats = ride.totalSeats || ride.maxSeats || 4;
  const seatsLeft = totalSeats - joined.length;
  const allowPassengers = ride.allowPassengers !== undefined ? ride.allowPassengers : true;
  const isOwner = String(currentUserId) === String(ride.userId);
  const isPassenger = Array.isArray(joined) && joined.includes(currentUserId);

  let btnText = 'Join Ride';
  let disabled = false;
  let showButton = true;
  let buttonStyle = styles.buttonJoin;
  let onPressAction = () => onJoin && onJoin(ride.id);

  if (!allowPassengers) {
    btnText = 'Solo Ride';
    showButton = false;
  } else if (isOwner) {
    // Owner can cancel the ride
    btnText = 'Cancel Ride';
    buttonStyle = styles.buttonCancel;
    onPressAction = () => onCancel && onCancel(ride.id);
  } else if (isPassenger) {
    // Passenger can leave the ride
    btnText = 'Leave Ride';
    buttonStyle = styles.buttonCancel;
    onPressAction = () => onLeave && onLeave(ride.id);
  } else if (seatsLeft <= 0) {
    btnText = 'Full';
    disabled = true;
    buttonStyle = styles.buttonDisabled;
  }

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Text style={styles.driver}>🚗 {carType.toUpperCase()}</Text>
        <Text style={styles.driver}>Driver: {ride.driverId || ride.createdBy || 'n/a'}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.seats}>Total Seats: {totalSeats}</Text>
        <Text>🟢 Left: {seatsLeft}</Text>
      </View>
      <View style={styles.row}>
        <Text>👥 Joined: {joined.length}</Text>
        {allowPassengers !== undefined && (
          <Text style={[styles.status, { color: allowPassengers ? '#2ecc71' : '#e74c3c' }]}>
            {allowPassengers ? 'Open' : 'Solo'}
          </Text>
        )}
      </View>
      <View style={styles.actions}>
        {/* Single button logic:
            - Owner: Cancel Ride
            - Passenger: Leave Ride
            - Else: if allowPassengers && seatsLeft>0 -> Join Ride
            - Else: show disabled Full or Solo text
        */}
        {(() => {
          const isOwner = String(ride.userId) === String(currentUserId);
          const isPassenger = Array.isArray(ride.passengers) && ride.passengers.includes(currentUserId);

          if (isOwner) {
            return (
              <TouchableOpacity
                style={[styles.button, styles.buttonCancel]}
                onPress={() => onCancel && onCancel(ride.id)}
              >
                <Text style={styles.buttonText}>Cancel Ride</Text>
              </TouchableOpacity>
            );
          }

          if (isPassenger) {
            return (
              <TouchableOpacity
                style={[styles.button, styles.buttonCancel]}
                onPress={() => onLeave && onLeave(ride.id)}
              >
                <Text style={styles.buttonText}>Leave Ride</Text>
              </TouchableOpacity>
            );
          }

          // Not owner or passenger
          if (!allowPassengers) {
            return <Text style={styles.soloText}>Solo Ride</Text>;
          }

          if (seatsLeft <= 0) {
            return (
              <TouchableOpacity style={[styles.button, styles.buttonDisabled]} disabled={true}>
                <Text style={styles.buttonText}>Full</Text>
              </TouchableOpacity>
            );
          }

          // Eligible to join
          return (
            <TouchableOpacity
              style={[styles.button, styles.buttonJoin]}
              onPress={() => onJoin && onJoin(ride.id)}
            >
              <Text style={styles.buttonText}>Join Ride</Text>
            </TouchableOpacity>
          );
        })()}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { 
    backgroundColor: '#fff', 
    padding: 16, 
    marginVertical: 8, 
    marginHorizontal: 12, 
    borderRadius: 12, 
    shadowColor: '#000', 
    shadowOpacity: 0.08, 
    shadowRadius: 8, 
    elevation: 4 
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  driver: { fontWeight: '700', fontSize: 16 },
  seats: { color: '#666', fontSize: 14 },
  status: { fontWeight: '600', fontSize: 12 },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  button: { 
    flex: 1, 
    paddingVertical: 12, 
    paddingHorizontal: 20, 
    borderRadius: 10, 
    alignItems: 'center',
    marginRight: 12
  },
  buttonJoin: { backgroundColor: '#2ecc71' },
  buttonCancel: { backgroundColor: '#e74c3c' },
  buttonDisabled: { backgroundColor: '#ccc' },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  soloText: { 
    flex: 1, 
    paddingVertical: 12, 
    paddingHorizontal: 20, 
    textAlign: 'center',
    color: '#95a5a6', 
    fontWeight: '600', 
    fontSize: 16 
  },
  countdown: { color: '#666', fontSize: 12 }
});
