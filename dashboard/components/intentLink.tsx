"use client";
// A navigation link that starts loading its whole page (data too) the moment the owner shows intent:
// the pointer enters it, a finger touches it, or the keyboard focuses it (card 301, docs/speed.md).
// Until then it pre-loads only up to the loading frame, like any Link. The server gets a head start of
// a few hundred milliseconds on the click, and a page the owner never points at costs nothing.
// What it loads is kept as long as next.config.ts staleTimes says (30 s), then loaded again.
import Link, { useLinkStatus } from "next/link";
import { useState, type ComponentProps } from "react";

type Props = Omit<ComponentProps<typeof Link>, "prefetch">;

export function IntentLink({ onMouseEnter, onTouchStart, onFocus, children, ...p }: Props) {
  const [warm, setWarm] = useState(false);
  const go = () => { if (!warm) setWarm(true); };
  return (
    <Link {...p} prefetch={warm ? true : null}
      onMouseEnter={(e) => { go(); onMouseEnter?.(e); }}
      onTouchStart={(e) => { go(); onTouchStart?.(e); }}
      onFocus={(e) => { go(); onFocus?.(e); }}>
      {children}
      <Pending />
    </Link>
  );
}

/** A small pulsing dot on the link that was just clicked, until its page shows (click-speed slice 4). */
function Pending() {
  const { pending } = useLinkStatus();
  return pending ? <i className="link-pending" aria-hidden="true" /> : null;
}
