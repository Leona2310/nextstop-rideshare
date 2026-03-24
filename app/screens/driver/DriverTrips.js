import { SafeAreaView, Text } from 'react-native';
import TopBar from '../../components/TopBar';

export default function DriverTrips() {
  return (
    <SafeAreaView style={{ flex: 1, padding: 20 }}>
  <TopBar showLogout={true} />
      <Text style={{ fontSize: 18 }}>Driver Trips (placeholder)</Text>
    </SafeAreaView>
  );
}