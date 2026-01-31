import { Tabs } from 'expo-router';
import React from 'react';
import { View, StyleSheet } from 'react-native';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function TabLayout() {
  const colorScheme = useColorScheme();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors[colorScheme ?? 'light'].tint,
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarStyle: {
          height: 85,
          paddingTop: 8,
        },
      }}>
      {/* 1. Contacts (left) */}
      <Tabs.Screen
        name="contacts"
        options={{
          title: 'Contacts',
          tabBarIcon: ({ color }) => <IconSymbol size={26} name="person.2.fill" color={color} />,
        }}
      />
      {/* 2. Availability (left-center) */}
      <Tabs.Screen
        name="availability"
        options={{
          title: 'Availability',
          tabBarIcon: ({ color }) => <IconSymbol size={26} name="calendar" color={color} />,
        }}
      />
      {/* 3. Home (center - main) */}
      <Tabs.Screen
        name="index"
        options={{
          title: '',
          tabBarIcon: ({ color, focused }) => (
            <View style={[styles.centerTab, focused && styles.centerTabActive]}>
              <IconSymbol size={28} name="bolt.fill" color={focused ? '#fff' : color} />
            </View>
          ),
        }}
      />
      {/* 4. Matches (right-center) */}
      <Tabs.Screen
        name="matches"
        options={{
          title: 'Matches',
          tabBarIcon: ({ color }) => <IconSymbol size={26} name="sportscourt.fill" color={color} />,
        }}
      />
      {/* 5. Courts (right) */}
      <Tabs.Screen
        name="courts"
        options={{
          title: 'Courts',
          tabBarIcon: ({ color }) => <IconSymbol size={26} name="mappin" color={color} />,
        }}
      />
      {/* Hidden tabs */}
      <Tabs.Screen name="find" options={{ href: null }} />
      <Tabs.Screen name="inbox" options={{ href: null }} />
      <Tabs.Screen name="explore" options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  centerTab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  centerTabActive: {
    backgroundColor: Colors.light.tint,
  },
});
