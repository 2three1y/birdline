# Birdline v0.1 test notes (2026-10-31)

Automated: `npm test` — 17 tests, all passing (counter thresholds, grapheme counting, password and username rules, text tokens, follow-list merging, relative time, NIP-49 round trip and wrong-password failure, vendored nostr-tools version, one h1 / one live region / skip link / footer / no CDNs / no markup injection / word rules / versioned imports).

Live, on https://2three1y.github.io/birdline/ in a cloud Chrome at 390 × 844 (throwaway accounts only, nobody real followed):

| case | result |
| --- | --- |
| F01-H1 Join (name, username, password) | pass: key made, locked (scrypt 2^18 took 2.0–2.3 s), kind 0 + 10002 + username claim + synced sign-in event published; landed on Home with a welcome and an announcement |
| F01-E1 username taken (claimed on relays) | pass: "@… is taken." + 3 suggestion buttons |
| F01-E2 username saved on this device | pass: "already saved on this device. Sign in instead…" |
| F01-N1 common password ("password123") | pass: refused with a sentence, focus moved to the field, "One thing to fix." announced |
| F02-H1 sign in on a fresh device (storage wiped) with username + password | pass: locked key found on relays, unlocked in 2.2 s (4.8 s total incl. relay lookup), Home shows own post |
| F02-N1 wrong password | pass: "That username and password don’t match…" (7.1 s: a wrong password costs a full unlock) |
| F03-H1 post | pass: "Posted to 2 of 3 relays.", box cleared, focus stays in the box, post shows at the top |
| F03-E1 counter | pass: announced "15 characters left." (jump past 20), "9 characters left.", "No characters left.", "Over the limit by 1…"; posting over the limit refused with "Too long by 1…" |
| F03-H2 new post arrives while reading | pass: "1 new post" button appears, list doesn't move, announced once; tapping inserts it and focuses its heading |
| F07-H1 follow / unfollow from a profile (opened by @username) | pass: "Now following Test Wren." / "Unfollowed Test Wren.", button text flips, followed account's posts appear on Home |
| Profile opened directly by URL | pass after fix: knows you already follow them |
| Tab bar | pass: aria-current on the active tab (Me stays current on Settings), focus moves to the h1 on every route change, no horizontal scroll at 390 px |
| Settings | pass: 5 sections, unlock timing shown, hashtag reading toggle announces |

Not tested yet: NIP-07 extension sign-in (no extension in the test browser), nsec / ncryptsec paste sign-in, real iPhone + VoiceOver (needs the owner), Home Screen install, Dynamic Type at the largest sizes on a device.

Relays during the test: relay.damus.io answered 520/521 (its server was down, also from this box), nos.lol stored every event but often didn't confirm within 6 s, relay.primal.net confirmed everything. So "N of 3 relays" undercounts while damus is down.

Throwaway test accounts (public relays, can be ignored):
- @bltest17942 "Test Robin" — npub1h2dm8nuv7j5tul5vl6w2mv48uqsqne0jaydxkycqk3aqhl8v4ersn5fw09 (made through the live Join form; one test post)
- @bltestb6856 "Test Finch" — npub1xsnluny02vnu8tp05gr7m76psnj9h69gu5d4mft55j7vwent4lks09gs8x (made through the live Join form; followed then unfollowed Test Wren)
- @bltestc4155 "Test Wren" — npub1ev6ctjmlcy7x6zt8uaqlha73xxm9z54w5vz0kkum662w5hdhp6kseqcwcg (made from a script to test new-post arrival; two posts)

## Bugs found and fixed during the build

| id | sev | what | fix |
| --- | --- | --- | --- |
| B1 | S3 | Hidden buttons ("Load older posts") showed because `.btn` display overrode `hidden` | global `[hidden] { display: none !important }` |
| B2 | S2 | Your own new post went behind the "1 new post" button instead of showing | own posts insert at the top right away |
| B3 | S3 | Profile header showed the word "null" when there was no website | null children filtered |
| B4 | S2 | Profile opened directly said "Follow" for someone you already follow | profile loads your follow list first |
| B5 | S3 | Join waited for each publish in turn (17 s) | all Join events publish at once (11 s, mostly a slow relay) |
| B6 | S4 | "1 posts" | singular counts |
| B7 | S3 | Updates took up to 10 minutes to reach browsers (Pages cache) | version-stamped imports + `tools/bump-version.mjs` |
