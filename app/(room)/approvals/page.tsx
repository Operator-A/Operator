import { redirect } from "next/navigation";
import { companyHref } from "@/dashboard/company-rules";

// Everything the Approvals page held now lives on Company > Approvals (docs/department-pages.md, slice 10).
// Old links and bookmarks land there.
export default function Approvals() {
  redirect(companyHref("approvals"));
}
