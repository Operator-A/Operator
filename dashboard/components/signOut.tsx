// Sign out from anywhere (card 204): the one button that ends a session, in the sidebar, the phone
// menu, setup's top bar and Settings. It posts to the existing signOut action, which deletes the
// session cookie and goes to /login. A form, so it works before any script loads.
import { signOut } from "@/dashboard/authActions";
import { Icon } from "./Icon";

/** `row` looks like a sidebar link (sidebar, phone menu); `button` is a small pill (setup, Settings). */
export function SignOutButton({ look = "row" }: { look?: "row" | "button" }) {
  return (
    <form action={signOut} style={look === "row" ? { width: "100%" } : undefined}>
      {look === "row" ? (
        <button type="submit" className="side-item"><Icon name="log-out" size={17} /><span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap" }}>Sign out</span></button>
      ) : (
        <button type="submit" className="btn outline sm signout-btn" aria-label="Sign out"><Icon name="log-out" size={15} /><span className="signout-word">Sign out</span></button>
      )}
    </form>
  );
}
