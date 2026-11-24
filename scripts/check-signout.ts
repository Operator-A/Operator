// Sign out from anywhere (card 204): `npm run check:signout`. Pure: reads source, no database.
// 1. One button (dashboard/components/signOut.tsx) posts to the signOut action; nothing else makes its own.
// 2. It is in your initial's menu in the top bar AND at the bottom of the phone menu (the sidebar, which
//    slides in from the left on a phone, where your initial's menu is hidden), in setup's top bar, and on Settings.
// 3. signOut deletes the session cookie and goes to /login.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");
const button = read("dashboard/components/signOut.tsx");
assert.match(button, /import \{ signOut \} from "@\/dashboard\/authActions"/, "the button uses the existing signOut action");
assert.match(button, /<form action=\{signOut\}/, "the button is a form posting to signOut, so it works before scripts load");
assert.equal((button.match(/type="submit"/g) ?? []).length, 3, "all three looks submit the form");

// the layout: one in your initial's menu in the top bar (slice 9), one in the sidebar's phone-only foot
const layout = read("app/(room)/layout.tsx");
const side = layout.slice(layout.indexOf("<SideMenu>"), layout.indexOf("</SideMenu>"));
const phoneFoot = side.slice(side.indexOf('<div className="side-me phone-only">'));
const meMenu = layout.slice(layout.indexOf('<HeaderPop label="Your account"'), layout.indexOf("</header>"));
assert.ok(side.length > 0 && meMenu.length > 0 && side.includes('className="side-me phone-only"'), "layout still has the sidebar, its phone foot and your initial's menu");
assert.match(phoneFoot, /<SignOutButton \/>/, "the phone menu has Sign out at its foot");
assert.match(meMenu, /<SignOutButton look="menu" \/>/, "your initial's menu has Sign out");
assert.equal((side.match(/<SignOutButton/g) ?? []).length, 1, "the sidebar's only Sign out is the phone-only one (wide screens use your initial's menu)");

// setup: in the top bar, so a founder mid-setup can leave
const start = read("app/start/page.tsx");
const top = start.slice(start.indexOf('<header className="wg-top">'), start.indexOf("</header>"));
assert.match(top, /<SignOutButton look="button" \/>/, "setup's top bar has Sign out");

// Settings keeps one, through the same button
const settings = read("app/(room)/settings/page.tsx");
assert.match(settings, /<SignOutButton look="button" \/>/, "Settings has Sign out");

// nobody posts to signOut except the shared button
for (const [p, src] of [["app/(room)/layout.tsx", layout], ["app/start/page.tsx", start], ["app/(room)/settings/page.tsx", settings]] as const)
  assert.doesNotMatch(src, /action=\{signOut\}/, `${p} uses SignOutButton instead of its own form`);

// the action: delete the session cookie, then /login
const auth = read("dashboard/authActions.ts");
const body = auth.slice(auth.indexOf("export async function signOut"));
assert.match(body, /\.delete\(SESSION_COOKIE\)/, "signOut deletes the session cookie");
assert.match(body, /redirect\("\/login"\)/, "signOut goes to /login");
assert.ok(body.indexOf(".delete(SESSION_COOKIE)") < body.indexOf('redirect("/login")'), "the cookie goes before the redirect");

console.log("check:signout ok");
