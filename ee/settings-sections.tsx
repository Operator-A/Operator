// Copyright Operator Enterprises and Technologies, LLC. Licensed under ee/LICENSE, not the AGPL-3.0.
// The cloud edition's Settings sections (the settingsSections slot, docs/settings.md): Billing, then
// Shared brain with the Playbook (shown only to the admin business's owners).
import "server-only";
import type { SettingsSection } from "@/core/extension-types";
import { BillingCard } from "./billing-card";
import { BrainCard } from "./brain-card";
import { PlaybookCard } from "./playbook-card";

type Query = Readonly<Record<string, string | undefined>>;

function BrainPage({ query }: { query: Query }) {
  return (
    <>
      <BrainCard query={query} />
      <PlaybookCard query={query} />
    </>
  );
}

export const settingsSections: readonly SettingsSection[] = [
  { slug: "billing", label: "Billing", hint: "Plan and Claude credits", Page: BillingCard },
  { slug: "brain", label: "Shared brain", hint: "What OPERATOR learns", Page: BrainPage },
];
