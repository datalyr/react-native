# 🎯 React Native CLI vs Expo - SDK Compatibility Guide

## 🔍 Quick Decision Matrix

**Need maximum attribution accuracy?** → **React Native CLI**  
**Want easier development?** → **Expo Managed Workflow**  
**Want best of both worlds?** → **Expo Bare Workflow**

---

## 📊 Feature Comparison

| Feature | React Native CLI | Expo Managed | Expo Bare |
|---------|------------------|--------------|-----------|
| **Setup Complexity** | Medium | Easy | Medium |
| **Attribution Accuracy** | 100% | 90% | 100% |
| **IDFA/GAID Collection** | ✅ Full | ⚠️ Limited | ✅ Full |
| **Auto Events** | ✅ Full | ✅ Full | ✅ Full |
| **Deep Link Attribution** | ✅ Full | ✅ Full | ✅ Full |
| **Device Fingerprinting** | ✅ Full | ⚠️ Limited | ✅ Full |
| **Build/Deploy Ease** | Complex | Easy | Easy |
| **App Store Submission** | Manual | Automated | Automated |
| **OTA Updates** | Custom | ✅ Built-in | ✅ Built-in |

---

## 🚀 React Native CLI (Recommended for Attribution)

### ✅ **Pros:**
- **Maximum attribution accuracy** (100%)
- Full IDFA/GAID support for iOS/Android
- Complete device fingerprinting
- Access to all native modules
- Best performance for tracking

### ❌ **Cons:**
- More complex setup and configuration
- Manual build and deployment process
- Requires native development knowledge
- No built-in OTA updates

### 🎯 **Best For:**
- Apps where attribution accuracy is critical
- Teams comfortable with native development
- Apps that need custom native functionality
- Maximum tracking capabilities

### 📋 **Installation:**
Follow the main [INSTALL.md](./INSTALL.md) guide.

---

## 🎨 Expo Managed Workflow

### ✅ **Pros:**
- **Super easy setup** and development
- Automatic build and deployment (EAS)
- Built-in OTA updates
- No native code complexity
- Great development experience

### ❌ **Cons:**
- **Limited IDFA/GAID collection** (needs extra setup)
- Some device info not available
- Can't use custom native modules
- Slightly less attribution accuracy (90%)

### 🎯 **Best For:**
- Teams prioritizing development speed
- Apps where core attribution is sufficient
- First-time React Native developers
- Rapid prototyping and MVP development

### 📋 **Installation:**
Follow the [EXPO_INSTALL.md](./EXPO_INSTALL.md) guide.

---

## ⚡ Expo Bare Workflow (Best of Both)

### ✅ **Pros:**
- **Full React Native CLI features**
- Easy build/deployment with EAS
- Built-in OTA updates
- Maximum attribution accuracy (100%)
- Can eject to full native if needed

### ❌ **Cons:**
- Slightly more complex than managed workflow
- Need to manage native dependencies
- Larger app bundle size

### 🎯 **Best For:**
- Teams wanting maximum features + easy deployment
- Apps that might need native modules later
- Best compromise between power and simplicity

### 📋 **Installation:**
Follow the main [INSTALL.md](./INSTALL.md) guide (same as React Native CLI).

---

## 📱 Attribution Accuracy Breakdown

### **React Native CLI / Expo Bare: 100% Accuracy**
```typescript
✅ UTM parameters (utm_source, utm_medium, etc.)
✅ Click IDs (fbclid, ttclid, gclid)  
✅ LYR tags (lyr, datalyr, dl_tag)
✅ IDFA collection (iOS with permission)
✅ GAID collection (Android)
✅ Full device fingerprinting
✅ Carrier information
✅ Precise device specifications
```

### **Expo Managed: 90% Accuracy**
```typescript
✅ UTM parameters (utm_source, utm_medium, etc.)
✅ Click IDs (fbclid, ttclid, gclid)
✅ LYR tags (lyr, datalyr, dl_tag)  
⚠️ IDFA collection (requires expo-ads-admob setup)
⚠️ GAID collection (requires expo-ads-admob setup)
⚠️ Limited device fingerprinting
❌ Carrier information not available
⚠️ Basic device specifications
```

## 🎯 **Recommendation by Use Case**

### **🔥 High-Value Apps (E-commerce, Finance, Gaming)**
**→ React Native CLI** or **Expo Bare**
- Need maximum attribution accuracy
- IDFA/GAID collection critical for ROAS optimization
- Can justify development complexity

### **📱 Content Apps (News, Social, Productivity)**  
**→ Expo Managed Workflow**
- Core attribution (UTM, click IDs) is sufficient
- Development speed more important
- Easy deployment and updates preferred

### **🚀 Startups/MVPs**
**→ Expo Managed Workflow**
- Ship fast and iterate
- Core attribution covers most needs
- Can migrate to bare/CLI later if needed

### **🏢 Enterprise Apps**
**→ React Native CLI** or **Expo Bare**
- Need full control and customization
- Security and compliance requirements
- Custom native integrations likely

---

## 💡 **Migration Path**

**You can always upgrade!**

```
Expo Managed → Expo Bare → React Native CLI
    ↓              ↓             ↓
   Easy          Medium        Complex
   90%           100%          100%
```

**Start with Expo Managed if unsure** - you can eject to bare workflow or migrate to React Native CLI when you need more features.

---

## 🚀 **Bottom Line**

- **Most apps:** Start with **Expo Managed** (90% attribution accuracy is excellent)
- **Attribution-critical apps:** Use **React Native CLI** or **Expo Bare**  
- **Want easy deployment:** Use **Expo Bare** (best compromise)

**All workflows support the automatic events system and core attribution tracking!** 🎉 