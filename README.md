# Birdline

Short Tweets from the people you follow, newest first. No algorithm, no ads, no AI, no paid checkmarks — and because it runs on [Nostr](https://nostr.com), no company owns your account or can ban it.

Birdline brings back the classic timeline: a top bar with Home, Notifications and Messages, your profile card and trends on the left, a "What's happening?" box and the timeline in the middle, who to follow on the right, and a 140-character limit. Built screen-reader-first and tested for VoiceOver on iPhone.

Layout inspired by the classic 2015-era timeline look; all code, styles and icons are original.

Birdline is not affiliated with Twitter or X; 'Tweet' is used descriptively.

**Use it:** https://2three1y.github.io/birdline/ — on iPhone, open it in Safari, tap Share, then **Add to Home Screen**.

## New in v0.2: the classic look, plus Reply, Retweet and Like

- **Three columns on a computer** (1000 px and wider): top bar (Home, Notifications with a count, Messages, Discover, Me; the Birdline mark in the middle; search, account menu and a **Tweet** button on the right). Left: your profile card (banner, picture, name, @username, Tweets / Following / Followers) and Trends (hashtags from your timeline). Middle: the compose box (one line until you focus it), the "Show N new Tweets" button and the timeline. Right: Who to follow (people followed by the people you follow).
- **On a phone**: one column, and the top bar shrinks to five icons with small labels plus a round Tweet button.
- **Every Tweet** has a heading (name and @username), the time (with the full date for screen readers, and a link to the Tweet with its replies), the text, then four real buttons with their counts in their names: "Reply, 2", "Retweet, 1" (a toggle, `aria-pressed`), "Like, 3" (a toggle; Settings can make it a star called "Favorite") and "More options" (open the Tweet, copy its link or Nostr ID, delete your own).
  - Reply opens a reply box right under the Tweet (kind 1 with NIP-10 `root`/`reply` e tags and p tags for everyone in the thread). Retweet is a kind 6 carrying the original; Like is a kind 7 "+". Pressing again undoes it with a kind 5 delete.
- **Profile**: full-width banner, a stats bar (Tweets, Following, Followers, Likes) with Follow / Unfollow on the right, the name, bio and link in the left column, and real tabs (Tweets / Tweets & replies / Likes, arrow keys move between them).
- **Notifications** (the old Connect page): replies, mentions, likes and Retweets of your Tweets; the top bar shows how many are new.
- **A Tweet's own page** with its replies (`#/post/<id>`).
- No single-key shortcuts: nothing fights with VoiceOver. Cmd/Ctrl+Enter sends.

## What came in the first build (v0.1)

- **Join**: name, username, password. Behind the scenes your browser makes a Nostr key, locks it with your password (NIP-49), and publishes your profile. No email, no phone number.
- **Sign in**: username + password, on this device or any other (see "Synced sign-in"). Secondary option: an existing Nostr key (nsec / ncryptsec) or a NIP-07 browser extension.
- **Home**: compose box with a 140-character counter, your timeline from the people you follow (and your own posts), newest first. New posts never shift the list: they wait behind an "N new posts" button. "Load older posts" at the bottom.
- **Profile**: banner, picture, name, @username with a short key tail, bio, website, counts (posts, following, followers your relays have seen), Follow / Unfollow, recent posts.
- **Me** (your profile), **Settings** (edit profile, accessibility, replies, your account and backup, this device), **Connect** (go to a person by npub or username; the rest is coming soon), **Discover** (coming soon).

## Accessibility

- One `h1` per view, focus moves to it on every page change; each post is an `article` whose author line is a heading, so VoiceOver's rotor (Headings) jumps post to post.
- One polite live region for everything Birdline says out loud: "Posted to 3 of 3 relays.", "2 new posts…" (at most every 30 seconds), errors.
- The counter is quiet while you type and speaks once at 20 left, 10 left, 0 left and when you go over. Its current value is part of the text box's description, so it's read when you focus the box. Cmd/Ctrl+Enter posts.
- Settings → Accessibility: **Read # as "hashtag"** (on by default), **Reduce motion** (follow device / on / off). Coming later: open links in a reader-friendly view.
- Skip link, real buttons and links, labels on every field, errors written as sentences, 44 pt tap targets, Dynamic Type (all sizes scale with your iPhone text size), safe areas for the Dynamic Island and home indicator, light and dark themes (contrast checked, 0 failures — `docs/design/contrast-*.txt`), zoom never disabled.

## Defaults (can change)

| setting | default | why |
| --- | --- | --- |
| Synced sign-in | **on** | Your locked key (`ncryptsec`) is published to relays as a kind 30078 event so username + password works on any device, like a normal account. The NIP-49 spec advises against publishing locked keys because attackers can collect them and guess passwords offline, so Birdline requires 10+ characters, refuses common passwords, and uses a slow lock (scrypt cost 2^18). Untick it at Join to keep the key only on that device. |
| Email | **none** | There's no server to use it. Your backup key replaces "forgot password" email. |
| Usernames | **first come, checked on relays, shown with a key tail** | See "Usernames" below. |
| Layout | Home / Connect / Discover / Me tab bar | The 2012 layout, which is also the cleanest for VoiceOver. |
| Reply filter | **off** | Hiding replies from accounts nobody you follow follows is a setting; off means everything, in order. (Replies arrive in a later version.) |
| Relays | relay.damus.io, nos.lol, relay.primal.net | Big public relays. Editable relays are planned. |

## Password cost (NIP-49 scrypt)

Birdline locks keys with scrypt cost **log_n = 18** (2^18, about 256 MB of memory), falling back to 17 if a device runs out of memory. Measured:

- Node on a cloud CPU: log_n 16 ≈ 0.23 s, 17 ≈ 0.47 s, 18 ≈ 0.97 s.
- Chrome on a cloud desktop: see the timing logged in the browser console (`[birdline] unlock with scrypt log_n=18 took … ms`) — recorded in the test notes.
- **iPhone:** after you sign in, Settings → This device shows how long unlocking took on your phone. The target is "a few seconds". If it's much slower, lower `LOG_N` in `js/util.js` (each step down halves the time).

The slow part runs in a Web Worker, so VoiceOver stays responsive while it works ("Signing in…" is announced).

## Usernames

Nostr has no global usernames. Birdline publishes a username claim (kind 30078, `d = birdline/handle`, labeled with NIP-32 `l` tags) at Join, and Join checks the relays first: if someone already claimed the name, it's "taken" and you get suggestions. Everywhere a username is shown, the first 4 characters of the account key follow it (`@river · 3f9a`), so a look-alike can't pass as someone else.

**TODO:** a real taken-list (a `handles.json` kept by a scheduled GitHub Action, first come first served, with proof-of-work against squatting) and NIP-05 names. Designed in the replica architecture; not built yet.

## How it's built

Plain HTML, CSS and JavaScript modules. No build step, no framework, no CDNs, no trackers.

- `index.html` — the shell (skip link, the one `h1`, the one live region, tab bar, footer).
- `js/app.js` — router and views. All text is inserted as text, never as markup (a script injection could steal a key). Strict Content-Security-Policy.
- `js/nostr.js` — relays: publish, query, live subscriptions, profiles, follow lists (kind 3 is always re-fetched and merged before a change, so a follow never wipes your list).
- `js/crypto.js` + `js/crypto-worker.js` — making and locking keys (NIP-49) off the main thread, timings.
- `js/store.js` — what stays on this device. "Keep me signed in" wraps your key with a non-extractable WebCrypto key kept in IndexedDB.
- `js/util.js` — pure helpers (character counting, password and username rules, text tokens, follow-list merging).
- `vendor/nostr-tools-2.25.4.bundle.js` — [nostr-tools](https://github.com/nbd-wtf/nostr-tools) 2.25.4 (Unlicense) with @noble/curves, @noble/hashes, @noble/ciphers and @scure/base (MIT), bundled once with esbuild. See `vendor/LICENSES.md`.
- `docs/design/` — design tokens (light/dark), contrast reports, component specs.

Nostr events used: kind 0 (profile), 1 (posts), 3 (follows), 10002 (relay list), 30078 (username claim and synced sign-in).

## Releasing

GitHub Pages caches files for 10 minutes, so every app file is loaded with a version stamp. After changing code, run `node tools/bump-version.mjs 0.1.2` (next number) so phones get the new files right away.

## Tests

```bash
npm test                    # Node's built-in runner: counter, passwords, usernames, NIP-49, follow merging, site rules
node tests/relay-smoke.mjs  # publishes a throwaway claim to the default relays and reads it back
```

## Not yet

DMs (NIP-17), search, network-wide trends, following/followers lists, lists, mute/block, photo uploads, editable relays, change password / restore from backup, the username taken-list, NIP-05.

## Credits

Inspired by how Twitter looked and worked around 2012–2015 (Birdline is not affiliated with it and uses none of its code, logo, font or images). Thanks to the OldTwitter extension by dimden for showing how good the classic layout and a chronological, buffered timeline can feel — looked at as a reference only; no code, styles, icons or text copied.

Co-written with Tab. MIT license.
