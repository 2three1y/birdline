# Birdline components (first build)

Own look: warm paper background, white cards, deep teal accent, system font (no licensed fonts, no icons copied from anyone; the app mark is an original "line with a dot" drawn for Birdline). Tokens live in `css/tokens.css` (light + dark, contrast-checked: `contrast-light.txt`, `contrast-dark.txt`, 0 AA failures).

Every size is in `rem` so iOS Dynamic Type (larger text) scales the whole app. Every tap target is at least 44 × 44 px.

```
Button
  variants  primary (accent bg), secondary (surface bg, border), quiet (text only, underline on focus)
  sizes     one size: min-height 44px, padding 0 1rem, radius pill
  states    default, hover (accent-strong), active, focus-visible (3px ring, focus color, 2px offset), busy (aria-busy=true, label stays, text changes to say what is happening)
  a11y      real <button>; never disabled while it is the only way forward: on an invalid tap it says why through the announcer instead
  used on   Join, Sign in, Home (Post), Profile (Follow/Unfollow), Settings

Toggle button (Follow)
  states    "Follow" / "Unfollow" (visible text changes; announcer says "Following @name." / "Unfollowed @name.")
  a11y      plain button whose text is the action; no aria-pressed so VoiceOver reads exactly what a tap will do

Text field
  parts     <label> above, input, hint line (id *-hint), error line (id *-error) both tied with aria-describedby
  states    default, focus (2px border-input -> accent + ring), invalid (aria-invalid=true + danger text), valid hint (success text)
  a11y      autocomplete set (username, new-password, current-password, name); errors written as sentences

Password field
  extra     "Show password" button after the field (aria-pressed true/false, aria-controls the input); strength line under it

Checkbox row
  parts     native checkbox + label + one-line explanation (aria-describedby)

Compose box ("What's on your mind?")
  parts     <label> (visible), textarea #compose-text, counter #compose-count (visible, aria-hidden), hidden description #compose-count-desc ("140 characters left", updated on input; read when the field gets focus), Post button #compose-send
  rules     counts grapheme clusters (one emoji = 1); the announcer speaks once at 20 left, 10 left, 0 left and when over; Ctrl/Cmd+Enter posts; after posting, focus stays in the empty box
  states    empty, typing, near limit (counter text-muted -> danger at 10), over (counter shows negative in danger), posting (button busy "Posting…"), failed (announcer + text kept)

Post (timeline item)
  parts     <article>, <h2> author line (display name, then @username·key tail), text paragraph, footer with <time> (relative "5m", full spoken label), "Show more" button when longer than 280 characters
  a11y      swipe order: name -> text -> time; rotor Headings jumps post to post; links are real <a> (rel noopener noreferrer, open in a new tab); hashtags read "hashtag word" when the setting is on (hidden "hashtag " text + aria-hidden "#")

New posts button
  parts     button #new-posts "3 new posts" at the top of the timeline; hidden when 0
  rules     new posts never shift the list; announcer says "3 new posts. The Show button is at the top of your timeline." at most every 30 s; tapping inserts them and moves focus to the first new post's heading

Profile header
  parts     banner strip (banner color or the person's banner image, decorative), avatar (their picture, or a generated initial; alt = "" because the name follows), <h1> display name, @username·key tail, bio, website link, joined-on if known, counts list (Posts / Following / Followers seen), Follow button
  states    loading ("Looking for this person on your relays…"), not found, own profile (Edit profile link instead of Follow)

Tab bar (signed in)
  parts     <nav aria-label="Main"> with 4 links: Home, Connect, Discover, Me; aria-current="page" on the active one
  layout    fixed to the bottom on phones with env(safe-area-inset-bottom) padding; a top row on wide screens

Announcer
  one element in the whole app: #announcer, role=status, aria-live=polite. Never a second live region.

Skip link
  first focusable element: "Skip to main content" -> #main (focusable heading inside gets focus)

Footer
  "Co-written with Tab" on every view, above the tab bar.
```

Motion: only a 120 ms fade on the new-posts button and focus rings; all of it is off when the system asks for reduced motion or the Settings switch "Reduce motion" is on.
