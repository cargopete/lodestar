import type { CapacitorConfig } from '@capacitor/cli';

// Native iOS shell for Lodestar. The app is a full server-rendered Next.js site,
// so the shell loads the live production deployment in a WKWebView rather than
// bundling a (impossible) static export. `mobile-shell/` is a tiny offline
// fallback that ships inside the app.
const config: CapacitorConfig = {
  appId: 'com.lodestar.dashboard',
  appName: 'Lodestar',
  webDir: 'mobile-shell',
  server: {
    url: 'https://www.lodestar-dashboard.com',
    cleartext: false,
    // Keep these domains inside the webview; everything else (wallet custom
    // schemes, external links) opens out to Safari / the wallet app.
    allowNavigation: [
      'lodestar-dashboard.com',
      '*.lodestar-dashboard.com',
      '*.walletconnect.com',
      '*.walletconnect.org',
    ],
  },
  ios: {
    backgroundColor: '#141034',
    // We manage safe areas in CSS (viewport-fit=cover + env()).
    contentInset: 'never',
    limitsNavigationsToAppBoundDomains: false,
  },
  backgroundColor: '#141034',
};

export default config;
