# App Store submission — Lodestar Dashboard

Reference for filling out App Store Connect. Bundle `com.lodestar.dashboard`, team `TRG36N45GH`.

## Required URLs (now live)
- **Privacy Policy URL:** https://www.lodestar-dashboard.com/privacy
- **Support URL:** https://www.lodestar-dashboard.com/support
- **Marketing URL (optional):** https://www.lodestar-dashboard.com

## App information
- **Name:** Lodestar Dashboard
- **Subtitle (≤30):** `The Graph staking analytics`
- **Primary category:** Finance · **Secondary:** Utilities
- **Keywords (≤100):** `the graph,grt,indexer,delegator,staking,subgraph,web3,crypto,analytics,thegraph,defi`

### Promotional text (≤170, editable anytime)
> Staking analytics, indexer intelligence, and portfolio tracking for The Graph Protocol — now with native alerts for events affecting your delegations.

### Description
> Lodestar is a fast, focused dashboard for The Graph Protocol — staking analytics, indexer intelligence, and portfolio tracking in one place.
>
> Whether you delegate GRT, run an indexer, or build subgraphs, Lodestar helps you stay oriented:
>
> • Indexer intelligence — APR, effective cut, allocations, QoS quality scores, and health at a glance
> • Delegation & portfolio tracking — follow your stake, rewards, and the indexers you delegate to
> • Network & protocol analytics — epochs, disputes, data services, and Horizon activity
> • Subgraph tools — explore deployments, query live data, and track sync status
> • Native alerts — opt in to be notified about on-chain events that affect your delegations
>
> Lodestar is non-custodial and read-only over public on-chain data. It never takes custody of your funds or keys; connecting a wallet is optional.
>
> Stay oriented.

## App Privacy ("nutrition label") — answers
Toggle **"Data Not Used to Track You"** (no cross-app/site tracking; Vercel Analytics & Sentry are first-party).

| Data type | Collected | Linked to user | Tracking | Purpose |
|---|---|---|---|---|
| Identifiers → **User ID** (wallet address) | Yes — only on notification opt-in | Yes | No | App Functionality |
| Identifiers → **Device ID** (push token) | Yes — iOS, on opt-in | Yes | No | App Functionality |
| Usage Data → **Product Interaction** | Yes | No | No | Analytics |
| Diagnostics → **Crash Data** | Yes | No | No | App Functionality |
| Diagnostics → **Performance Data** | Yes | No | No | App Functionality |

**Not collected:** name, email, phone, precise/coarse location, contacts, health, financial/payment info, browsing/search history, purchases, sensitive info. (A wallet address is declared as a User ID identifier, not Financial Info.)

## Age rating
Answer the questionnaire honestly — no objectionable content (no violence, gambling, mature themes). Expected **4+**. Note: Apple sometimes bumps crypto/financial apps; if asked about "unrestricted web access," answer **No** (the app loads a single controlled site, it is not a web browser).

## App Review notes (paste into "Notes")
> Lodestar Dashboard is a read-only analytics dashboard for The Graph Protocol, a public blockchain network. It is non-custodial: there are no in-app purchases, no trading, and no custody of funds or private keys.
>
> No account or login is required — the app is fully usable without signing in. Just open it to browse analytics.
>
> Native functionality beyond a website (re: guideline 4.2): native push notifications (APNs) that alert users to on-chain events affecting the indexers they delegate to (e.g. disputes); a home-screen app experience; and deep-linking to wallet apps.
>
> Optional wallet connection: a user may connect an Ethereum wallet to personalise the dashboard to their delegations. The only signature the app ever requests is a plain message ("Subscribe to Lodestar notifications…") to prove wallet ownership when opting into notifications — no transactions are signed or sent in-app.
>
> To test notifications: open the app, connect any wallet, tap "Enable alerts", grant the iOS permission, and sign the message. (Notifications are otherwise event-driven from public on-chain activity.)
>
> Privacy policy: https://www.lodestar-dashboard.com/privacy

## Still needed (yours)
- **Screenshots** — 6.7" (1290×2796) required; 6.9" recommended. Can be generated from the iOS simulator running the app, or from a real device.
- **Export compliance** — already answered in-app (`ITSAppUsesNonExemptEncryption=false`), no prompt expected.
- Final review of the privacy/support page wording, then **Submit for Review** in App Store Connect (attach the processed TestFlight build).
