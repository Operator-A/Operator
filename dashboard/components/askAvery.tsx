"use client";
// Card 440: a button on a server-drawn card that sends a message into the chat on the same page. The chat
// (HeadChat) listens for SAY_EVENT and sends the text as if typed, so a card never leaves the owner
// guessing what to type. With no chat on the page nothing happens.
import { SAY_EVENT } from "@/dashboard/company-rules";

export function AskAveryButton({ say, className, children }: { say: string; className?: string; children: React.ReactNode }) {
  return (
    <button type="button" className={className} onClick={() => window.dispatchEvent(new CustomEvent(SAY_EVENT, { detail: say }))}>
      {children}
    </button>
  );
}
