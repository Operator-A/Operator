// The open edition's slots: nothing is blocked, no extra Settings cards, no sign-up page, no extra
// routes, no pooled Claude key. tsconfig points "operator-extensions" here; next.config.ts points it at ee/index.ts only
// when OPERATOR_EDITION=cloud (docs/extensions.md).
import type { Extensions } from "@/core/extension-types";

const none: Extensions = {
  edition: "open",
  planBlock: async () => null,
  SettingsCards: null,
  // no hosted Claude: setup and Connections offer only the business's own key
  HostedClaude: null,
  SignupPage: null,
  api: {},
  afterMembersChange: async () => undefined,
  // the open edition has no key of its own: every business uses its own Claude key
  pooledKey: async () => null,
  afterRun: async () => undefined,
  // no shared brain: a self-hosted OPERATOR is one company, with nobody to learn from
  afterSchedule: async () => null,
  similarBusinesses: async () => null,
};

export default none;
