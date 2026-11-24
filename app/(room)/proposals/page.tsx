import { redirect } from "next/navigation";
import { companyHref } from "@/dashboard/company-rules";

// The proposals list now lives on Company > Approvals (docs/department-pages.md, slice 10): pending ones under
// Proposals to decide, decided ones under History. Each proposal keeps its own page, /proposals/[id].
export default function Proposals() {
  redirect(companyHref("approvals"));
}
