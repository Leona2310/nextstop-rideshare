import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet } from 'react-native';
import BottomSheet from './BottomSheet';
import { sendChatMessage, subscribeToChat } from '../firebase/chatService';

export default function ChatModal({ visible, rideId, onClose }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');

  useEffect(() => {
    if (!rideId) return;
    const unsub = subscribeToChat(rideId, setMessages);
    return () => unsub && unsub();
  }, [rideId]);

  const handleSend = async () => {
    if (!text || !rideId) return;
    try { await sendChatMessage(rideId, text); setText(''); } catch (e) { console.warn(e); }
  };

  return (
    <BottomSheet visible={visible} heightRatio={0.6} onClose={onClose}>
      <View style={{ flex: 1 }}>
        <FlatList data={messages} keyExtractor={i => i.id} renderItem={({ item }) => (
          <View style={styles.msg}><Text style={styles.msgText}>{item.text}</Text></View>
        )} />
        <View style={styles.inputRow}>
          <TextInput style={styles.input} value={text} onChangeText={setText} placeholder="Type a message" />
          <TouchableOpacity style={styles.sendBtn} onPress={handleSend}><Text style={{ color: '#fff' }}>Send</Text></TouchableOpacity>
        </View>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  msg: { padding: 8, borderRadius: 6, backgroundColor: '#f1f3f5', marginVertical: 4 },
  msgText: { color: '#111' },
  inputRow: { flexDirection: 'row', paddingTop: 8 },
  input: { flex: 1, padding: 10, backgroundColor: '#fff', borderRadius: 8, borderWidth: 1, borderColor: '#eee' },
  sendBtn: { marginLeft: 8, backgroundColor: '#276EF1', padding: 12, borderRadius: 8, justifyContent: 'center' },
});
