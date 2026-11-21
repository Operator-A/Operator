// Copyright Operator Enterprises and Technologies, LLC. Licensed under ee/LICENSE, not the AGPL-3.0.
// The cloud edition's cards at the bottom of Settings (the SettingsCards slot): Billing, then Shared brain.
import "server-only";
import { BillingCard } from "./billing-card";
import { BrainCard } from "./brain-card";

export async function SettingsCards({ query }: { query: Readonly<Record<string, string | undefined>> }) {
  return (
    <>
      <BillingCard query={query} />
      <BrainCard query={query} />
    </>
  );
}
