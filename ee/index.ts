// Copyright Operator Enterprises and Technologies, LLC. Licensed under ee/LICENSE, not the AGPL-3.0.
// The cloud edition's slots (docs/extensions.md). Built in only when OPERATOR_EDITION=cloud.
import type { Extensions } from "@/core/extension-types";
import { planBlock } from "./plan";
import { settingsSections } from "./settings-sections";
import { stripeWebhook, syncSeats } from "./billing";
import { SignupPage } from "./signup-page";
import { chargeRun, pooledKey } from "./credits";
import { HostedClaude } from "./hosted-claude";
import { similarBusinesses, syncBrain } from "./brain";

const cloud: Extensions = {
  edition: "cloud",
  planBlock,
  settingsSections,
  HostedClaude,
  SignupPage,
  api: { stripe: stripeWebhook },
  afterMembersChange: syncSeats,
  pooledKey,
  afterRun: chargeRun,
  afterSchedule: syncBrain,
  similarBusinesses,
};

export default cloud;
