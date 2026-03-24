import { signOut } from "firebase/auth";
import { getFriendlyAuthError } from '../firebase/authService';
import { useState } from "react";
import {
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import TopBar from '../components/TopBar';

import { auth } from "../firebase/firebaseConfig";
import { saveProfile } from "../firebase/profileService";
import { ROLES } from "../utils/roleConstants";

export default function ProfileSetupScreen({ navigation }) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [department, setDepartment] = useState("");
  const [gender, setGender] = useState("");
  const [phone, setPhone] = useState("");
  const [vehicleModel, setVehicleModel] = useState("");
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [saving, setSaving] = useState(false);

  /* ================= LOGOUT ================= */

  const logout = () => {
    Alert.alert(
      "Logout",
      "Are you sure you want to logout?",
      [
        { text: "Cancel", style: "cancel" },
            {
              text: "Logout",
              style: "destructive",
              onPress: async () => {
                try {
                  await signOut(auth);
                } catch (e) {
                  Alert.alert("Error", getFriendlyAuthError(e));
                }
              }
            }
      ]
    );
  };

  /* ================= SUBMIT PROFILE ================= */

  const submit = async () => {
    if (!name.trim()) {
      Alert.alert("Missing", "Please enter your name");
      return;
    }

    if (!role) {
      Alert.alert("Missing", "Please select a role");
      return;
    }

    setSaving(true);
    try {
      await saveProfile({
        name: name.trim(),
        role,
        department: department.trim(),
        gender: gender.trim(),
        phone: phone.trim(),
        vehicleModel: vehicleModel.trim(),
        vehicleNumber: vehicleNumber.trim(),
        licenseNumber: licenseNumber.trim()
      });

      // After creating a profile, sign the user out and redirect to Login
      // so they can re-login and pick up any server-side changes (claims, flows).
  await signOut(auth);

    } catch (e) {
      console.error('saveProfile failed', e);
      Alert.alert("Error", "Failed to save profile. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const roleButton = (r, label) => (
    <TouchableOpacity
      key={r}
      onPress={() => setRole(r)}
      style={[
        styles.roleBtn,
        role === r && styles.roleBtnActive
      ]}
    >
      <Text
        style={role === r ? styles.roleBtnTextActive : styles.roleBtnText}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
  <TopBar navigation={navigation} showLogout={true} />
  <View style={styles.inner}>

        <Text style={styles.label}>Name</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
        />

        <Text style={styles.label}>Role</Text>
        <View style={styles.roleRow}>
          {roleButton(ROLES.STUDENT, "Student")}
          {roleButton(ROLES.TEACHER, "Teacher")}
          {roleButton(ROLES.DRIVER, "Driver")}
          {roleButton(ROLES.ADMIN, "Admin")}
        </View>

        <Text style={styles.label}>Department</Text>
        <TextInput
          style={styles.input}
          value={department}
          onChangeText={setDepartment}
        />

        <Text style={styles.label}>Gender</Text>
        <TextInput
          style={styles.input}
          value={gender}
          onChangeText={setGender}
        />

        <Text style={styles.label}>Phone</Text>
        <TextInput
          style={styles.input}
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
        />

        {role === 'driver' && (
          <>
            <Text style={styles.label}>Vehicle (model/name)</Text>
            <TextInput style={styles.input} value={vehicleModel} onChangeText={setVehicleModel} placeholder="e.g. Swift Dzire" />

            <Text style={styles.label}>Vehicle number</Text>
            <TextInput style={styles.input} value={vehicleNumber} onChangeText={setVehicleNumber} placeholder="e.g. MH01AB1234" />

            <Text style={styles.label}>License number</Text>
            <TextInput style={styles.input} value={licenseNumber} onChangeText={setLicenseNumber} placeholder="License number" />
          </>
        )}

        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={submit}
          disabled={saving}
        >
          <Text style={styles.primaryBtnText}>
            {saving ? "Saving..." : "Save Profile"}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

/* ================= STYLES ================= */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f7f8fb"
  },
  inner: {
    padding: 20
  },
  logoutBtn: {
    alignSelf: "flex-end",
    marginBottom: 10,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  logoutText: {
    color: "#E53935",
    fontWeight: "600"
  },
  label: {
    marginTop: 8,
    marginBottom: 4,
    color: "#333"
  },
  input: {
    borderWidth: 1,
    borderColor: "#e3e6ee",
    padding: 12,
    borderRadius: 8,
    color: "#111"
  },
  primaryBtn: {
    backgroundColor: "#22A07A",
    padding: 14,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 16
  },
  primaryBtnText: {
    color: "#fff",
    fontWeight: "600"
  },
  roleRow: {
    flexDirection: "row",
    justifyContent: "space-between"
  },
  roleBtn: {
    flex: 1,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e3e6ee",
    margin: 4,
    alignItems: "center"
  },
  roleBtnActive: {
    backgroundColor: "#276EF1",
    borderColor: "#276EF1"
  },
  roleBtnText: {
    color: "#333"
  },
  roleBtnTextActive: {
    color: "#fff"
  }
});
