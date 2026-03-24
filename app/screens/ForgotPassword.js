import { useState } from "react";
import { ActivityIndicator, Alert, SafeAreaView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { resetPassword, getFriendlyAuthError } from "../firebase/authService";
import { isValidDomain } from "../utils/domainValidator";

export default function ForgotPassword({ navigation }) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  const reset = async () => {
    const e = (email || "").trim();
    if (!isValidDomain(e)) {
      Alert.alert("Invalid Email", "Use your sophiacollege.edu.in email");
      return;
    }
    setLoading(true);
    try {
      await resetPassword(e);
      Alert.alert("Email Sent", "Reset link sent to your email (check spam).");
      navigation.navigate('Login');
    } catch (err) {
      const msg = getFriendlyAuthError(err);
      Alert.alert("Error", msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.inner}>
        <Text style={styles.title}>Reset Password</Text>
        <TextInput style={styles.input} placeholder="yourname@sophiacollege.edu.in" keyboardType="email-address" autoCapitalize="none" value={email} onChangeText={setEmail} />
        <TouchableOpacity style={styles.primaryBtn} onPress={reset} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Send reset email</Text>}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f7f8fb' },
  inner: { padding: 20, justifyContent: 'center', flex: 1 },
  title: { fontSize: 20, fontWeight: '600', marginBottom: 12 },
  input: { borderWidth: 1, borderColor: '#e3e6ee', padding: 12, borderRadius: 8, marginBottom: 12, color: '#111' },
  primaryBtn: { backgroundColor: '#276EF1', padding: 14, borderRadius: 10, alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontWeight: '600' }
});
