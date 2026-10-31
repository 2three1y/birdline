# Birdline v0.2 test notes (2026-10-31): the classic look + Reply / Retweet / Like

Automated: `npm test` — 27 tests, all passing. New in `tests/actions.test.mjs`: reply tags (NIP-10 root/reply markers, p tags for everyone in the thread, hashtags), reply-to-a-reply keeps the root, old positional e tags, Retweet = kind 6 carrying the original, Like = kind 7 "+", undo = kind 5, the tally (each person once, dislikes and deleted events ignored, knows your own), button labels ("Like, 3" / "Reply"), compact counts, trends, who-to-follow. `tests/static.test.mjs` also checks the actions are real `<button>`s with aria-pressed, the profile uses real tabs, there are no single-letter shortcuts, and the three-column grid is in the CSS.

Live, on https://2three1y.github.io/birdline/ (v0.2.1) in headless Chrome, throwaway accounts only (@bltest17942 "Test Robin", @bltestb6856 "Test Finch"; nobody real touched):

| case | width | result |
| --- | --- | --- |
| Sign in with username + password, Home in three columns | 1280 | pass: one h1 ("Home", visually hidden), mini profile, trends, who to follow, no sideways scroll |
| Like / remove like | 1280 | pass: "Liked Test Robin’s Tweet." → button "Like, 1", pressed; again → "Removed your like…" → "Like", not pressed (a stale-count race found here in v0.2.0 is fixed in 0.2.1) |
| Retweet / undo | 1280 | pass: "Retweeted … to your followers." → "Retweet, 1", pressed; undo → "Retweet", not pressed |
| Reply | 1280 | pass: Reply button expands a box labeled "Reply to Test Robin", focus goes into it; Ctrl+Enter → "Reply sent to 2 of 3 relays.", box closes, focus back on "Reply, 1"; the reply tops the timeline |
| More menu | 1280 | pass: opens with focus on the first item (Open / Copy link / Copy Nostr ID / Delete), Escape closes and focus returns to "More options" |
| Profile tabs | 1280 | pass: arrow key moves selection and focus, aria-selected and tabindex follow, panel labelled by the active tab; Likes tab says "No likes yet." when empty |
| Top bar Tweet button on another page | 1280 | pass: modal compose, focus in the box; Escape closes and focus returns to the button |
| A Tweet's page (#/post/id) | 1280 | pass: h1 "Tweet by Test Robin", its reply listed under "Replies" |
| Phone top bar + Home | 390 | pass: five icon tabs with small labels (aria-current on Home), round "New Tweet" button, search and account menu hidden (Discover / Me cover them), no sideways scroll |
| Phone profile | 390 | pass: banner, avatar, Follow, stats, then name/bio (h1), tabs, Tweets; like button tap target 56×44 |
| Notifications across accounts | 390 + 1280 | pass: Finch likes Robin's Tweet → Robin's top bar shows "Notifications, 1 new" → page lists "Test Finch … liked your Tweet, new" → badge clears. Finch then took the like back |

Not tested: real iPhone + VoiceOver (needs the owner), NIP-07 extension sign-in, dark theme screenshots (tokens checked for contrast only).

Relays: same as v0.1 (damus flaky, primal confirms everything), so "N of 3 relays" can undercount.
