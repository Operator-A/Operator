# Settings in sections

Settings used to be one long page: thirteen cards one after another, about 12,000px tall on a
desktop with the audit log open, and every visit loaded everything (members, caps, vendors, the
audit log, billing, the shared brain). It is now split into sections. Each section has its own
address and loads only its own data. (Decided 2026-11-22; design canvas "Settings split into
sections".)

## The sections

| Address | Section | What is on it |
| --- | --- | --- |
| `/settings` | General | time zone, theme, who is signed in and sign out; then "How it runs": the org switch, real runs (Controls), the database lock |
| `/settings/business` | Business | The business, Where things go, What agents may say about your products, Daily numbers |
| `/settings/people` | People | everyone who can sign in and their role |
| `/settings/limits` | Limits | money and email caps, vendors, addresses that get no email |
| `/settings/billing` | Billing (cloud edition) | plan, Claude credits, sign-up codes (admin business) |
| `/settings/brain` | Shared brain (cloud edition) | sharing the business's counts; Playbook (admin business owners) |
| `/settings/audit` | Audit log | who did what, the latest 25, "Show more" for 100 |

`app/(room)/settings/layout.tsx` draws the page title and the section menu; each section is a
`page.tsx` under it. On a desktop the menu is a column on the left, each section with a one-line
hint. At 860px and below it becomes a row of chips that scrolls sideways, above the section.

The core sections are listed once, in `dashboard/settings-sections.ts`. The paid layer adds its
sections through the `settingsSections` extension slot (it replaces `SettingsCards`): each entry is a
slug, a label, a hint and a server component. `app/(room)/settings/[section]/page.tsx` draws an
extension section by its slug, and answers not found for any other slug, so the open edition has
no Billing or Shared brain section at all. A core section's own folder always wins over the
dynamic one.

## Links that still say `#billing`

Older links (`/settings#billing`, `#brain`, `#playbook`) land on General. The section menu sees the
hash in the browser and moves to the section once. Every redirect in code now goes to the section
itself (Stripe's return pages, the billing, brain, playbook and sign-up code actions), and server
actions revalidate the whole settings layout, so a change shows on whichever section it was made.

## Dropdowns

Every `select.input` in the app gets one look: no browser arrow, our own chevron, and 40px of room
on the right so the text never runs under it. The chevron has a light and a dark version. The two
selects that had no `input` class (Shared brain's kind, Playbook's "who it's for") get it.

## Playbook and Shared brain

- Shared brain: "Add my business's counts" is a switch on the right of its row (still a checkbox in
  the form, so it posts without script), and the kind of business is a labeled row with the dropdown
  on the right. "What your business adds" stays a fold-out below.
- Playbook: the header row has the count and an "Add a lesson" fold-out button. Each lesson is one
  row: title, who it's for, Draft or Published, and Edit. Edit opens one editor below the row with
  labeled fields and three buttons: Save (keeps it as it is), Publish or Take back to draft (saves the
  edits first, then changes it), and Delete. Publishing with unsaved edits no longer drops them: the
  save action takes `then=publish|unpublish` and does both, each audited as before.

## Phone fixes

- A row with a label on the left and a control on the right (time zone, sign out, the org) stacks
  at 560px and below, so the label is no longer squeezed into a thin column and the sign out button
  no longer touches the card's edge.
- The theme button becomes a Light / Dark switch.

## What is deleted

- The one long `app/(room)/settings/page.tsx` (it becomes General).
- `SettingsCards` slot and `ee/settings-cards.tsx`.
- The `#billing`, `#brain`, `#playbook` anchors in redirects.

## Tests

`npm run check:settings-sections` (pure, reads files):

- every core section in `dashboard/settings-sections.ts` has a `page.tsx` at its address, and every
  folder under `app/(room)/settings/` is a listed section (or `[section]`);
- each section page only imports what it shows (General doesn't load the audit log, members or caps;
  the audit page doesn't load caps);
- no redirect or link in code goes to `/settings?…#…`, and `revalidatePath("/settings")` is always
  called with `"layout"`;
- `app/globals.css` styles `select.input` with `appearance: none` and at least 36px on the right,
  and every `<select` in `dashboard/`, `app/` and `ee/` has the `input` class;
- the open edition has no extension sections; extension slugs never clash with a core section.

`check:open-core`, `check:signout`, `check:product-facts` and `ee/check.ts` are updated for the new
files and return addresses.
