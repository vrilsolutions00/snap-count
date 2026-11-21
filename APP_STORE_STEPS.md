# Shipping Snap Count to the App Store

The web game is already an installable PWA (Safari → Share → Add to Home Screen). Putting a native build on the Apple App Store is a separate, paid process. Do not use “NFL” in the app name, and do not include official league or team logos or official player headshots.

## What you need

1. An [Apple Developer Program](https://developer.apple.com/programs/) membership, **$99 per year**, enrolled on the Apple ID you will use to publish.
2. A Mac with a current version of **Xcode** (from the Mac App Store).
3. This project, with the playable site in `www/` and `capacitor.config.json` already set to `appId: com.vril.snapcount`.

## Build the iOS wrapper

From the project root, on your Mac:

```bash
npm install @capacitor/core @capacitor/cli @capacitor/ios
npx cap add ios
npx cap sync ios
npx cap open ios
```

Xcode will open the `ios/App` workspace. Then:

1. Select the **App** target. Set the display name to **Snap Count** (not any league-trademarked name).
2. Choose your Team under Signing & Capabilities and let Xcode manage a unique bundle identifier if `com.vril.snapcount` is taken.
3. Drop in App Store icons (1024×1024, no alpha) plus the existing `www/icons` assets. Use the lime “S” mark; do not use official logos.
4. Add a Privacy — usage strings only if you later request extra permissions. This version uses no camera, microphone, or tracking. For App Store privacy nutrition labels, declare that you do not collect data (progress stays on-device).
5. In Info, set the launch screen background to `#050506`.
6. Product → Archive, then Distribute to App Store Connect.

## App Store Connect checklist

- **Name:** Snap Count
- **Subtitle:** Guess the Football Player Daily
- **Keywords:** football, daily puzzle, trivia — avoid the league’s trademarks.
- **Category:** Games / Sports or Puzzle.
- **Age rating:** complete the questionnaire honestly (mild sports trivia).
- **Privacy policy URL:** host `www/privacy-policy.html` on the same public site as the game (`https://vrilsolutions00.github.io/snap-count/privacy-policy.html`) and paste that URL.
- **Review notes:** explain that rosters come from nflverse (CC BY 4.0), that silhouettes are original artwork, and that the app is an independent fan project.
- Screenshots: iPhone 6.7" and 6.1" using the real game, with no official marks.

## After rejection risks to avoid

Apple and rights holders commonly reject apps that ship official logos, official player photos, or a trademarked league name in the title. Keep badges as original colored letter tiles, keep the silhouette generic, and keep the legal line visible.

The $99 membership and the App Store submission itself are paid steps you have to complete in your own Apple ID. This repo only prepares the app so those steps are straightforward.
