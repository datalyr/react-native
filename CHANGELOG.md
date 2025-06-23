# Changelog

All notable changes to the Datalyr React Native SDK will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.3] - 2025-06-22

### 🔄 Changed
- **BREAKING**: Changed automatic screen tracking event name from `screen_view` to `pageviews` for consistency with web analytics
- Updated session tracking to report `pageviews` instead of `screen_views` in session end events
- Updated session property names: `screen_views_in_session` → `pageviews_in_session`

### 🐛 Fixed  
- Fixed SDK export pattern to use singleton instance instead of class constructor
- Resolved white screen issues caused by incorrect import/export patterns
- Fixed TypeScript compilation errors in example files

### 📚 Documentation
- Updated all documentation to reflect `pageviews` instead of `screen_view`
- Updated README.md, INSTALL.md, and EXPO_INSTALL.md
- Updated SDK_COMPLETION_STATUS.md to show correct event names
- Updated example files to use correct singleton import pattern
- Updated example UI text to show "Pageview" instead of "Screen View"

### 🔧 Technical Details
- Auto-events manager now tracks `pageviews` events for screen navigation
- Main SDK `screen()` method now tracks `pageviews` events
- Maintains backward compatibility for session tracking (still counts as `screenViews` internally)
- Fixed import pattern: `import { datalyr } from '@datalyr/react-native-sdk'`

### 🎯 Impact
- **Web Analytics Consistency**: Mobile screen tracking now uses the same event name (`pageviews`) as web page tracking
- **Improved Developer Experience**: Fixed white screen issues and import errors
- **Better Analytics**: Unified event naming makes cross-platform analytics easier

---

## [1.0.2] - Previous Release

### ✨ Features
- Automatic event tracking (sessions, screen views, app lifecycle)
- Mobile attribution tracking
- React Native and Expo support
- TypeScript support
- Automatic session management
- App install detection
- Performance tracking

### 🔧 Technical
- Event queueing and batching
- Offline support
- Retry mechanisms
- Debug logging
- Storage persistence 