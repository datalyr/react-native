# 🧪 Datalyr SDK Test App

**Complete test application for the Datalyr React Native SDK**

This is a comprehensive test app that demonstrates all features of the [Datalyr React Native SDK](https://github.com/datalyr/react-native-sdk). Located in the main SDK repository for easy access and testing.

## 🚀 Quick Start

### 1. **Install Dependencies**
```bash
npm install
```

### 2. **Configure Your Credentials**
Edit `App.tsx` and replace the placeholder values:

```typescript
const config = {
  workspaceId: 'your-workspace-id', // Get from Datalyr dashboard
  apiKey: 'dk_your_api_key',       // Get from your web tracking script
  debug: true,
  enableAutoEvents: true,
  enableAttribution: true,
  autoEvents: {
    trackSessions: true,
    trackScreenViews: true,
  }
};
```

### 3. **Run the App**
```bash
# Start Expo development server
npx expo start

# Run on iOS simulator
npx expo start --ios

# Run on Android emulator  
npx expo start --android
```

## 📱 What This App Tests

### **🔥 Automatic Events**
- ✅ `session_start` - Session tracking
- ✅ `app_launch_performance` - App startup timing
- ✅ `pageview` - Screen navigation (automatic)
- ✅ `app_install` - First launch detection with attribution

### **📊 Manual Events**
- ✅ Custom events with `datalyr.track()`
- ✅ User identification with `datalyr.identify()`
- ✅ Screen tracking with `datalyr.screen()`
- ✅ Attribution data retrieval

### **🎯 Attribution Testing**
- ✅ Deep link parameter capture
- ✅ UTM parameter tracking
- ✅ Click ID tracking (fbclid, gclid, ttclid)
- ✅ LYR tag tracking
- ✅ Install attribution

## 🧪 Features Demonstrated

### **Real-time Logging**
- Collapsible logs section with event count
- Real-time SDK status updates
- Attribution data display
- Event success/failure tracking

### **Mobile-Optimized UI**
- 2x2 button grid for easy testing
- Accordion-style logs for better mobile UX
- Clear status indicators
- Responsive design

### **Comprehensive Testing**
- API key authentication testing
- Event payload validation
- Attribution data verification
- SDK initialization monitoring

## 📊 Expected Results

When working correctly, you should see:

```
✅ SDK initialized successfully with API key
🎯 Attribution enabled - will track:
  • UTM parameters (utm_source, utm_medium, utm_campaign, etc.)
  • Click IDs (fbclid, gclid, ttclid, msclkid)
  • LYR tags (lyr, ref parameters)
  • Deep link install attribution
✅ Test event sent successfully
✅ Screen/pageview sent successfully
✅ User identification sent successfully
```

## 🔗 Related Links

- **[Main SDK Repository](https://github.com/datalyr/react-native-sdk)** - Complete SDK source code
- **[Installation Guide](https://github.com/datalyr/react-native-sdk/blob/main/INSTALL.md)** - Setup instructions
- **[Attribution Example](https://github.com/datalyr/react-native-sdk/blob/main/examples/attribution-example.tsx)** - Advanced attribution testing
- **[Auto Events Example](https://github.com/datalyr/react-native-sdk/blob/main/examples/auto-events-example.tsx)** - Automatic events demo

## 🎯 Use Cases

### **For Developers**
- Test SDK integration before production
- Verify attribution tracking setup
- Debug event tracking issues
- Validate API key configuration

### **For QA Teams**
- Comprehensive SDK testing
- Event verification workflows
- Attribution testing scenarios
- Mobile app testing

### **For Product Teams**
- See all SDK capabilities in action
- Understand automatic vs manual events
- Test attribution flows
- Verify dashboard integration

---

**🔥 This test app demonstrates the complete Datalyr SDK - attribution tracking + automatic events like Mixpanel!** 