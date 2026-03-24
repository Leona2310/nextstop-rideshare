import { SafeAreaView, Text } from 'react-native';
import TopBar from '../../components/TopBar';

export default function ManageUsers({ navigation }) {
  return (
    <SafeAreaView style={{ flex: 1, padding: 20 }}>
      <TopBar navigation={navigation} showLogout={true} />
      <Text style={{ fontSize: 18 }}>Manage Users (placeholder)</Text>
    </SafeAreaView>
  );
}