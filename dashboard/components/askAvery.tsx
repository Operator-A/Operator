// Card 440: a button on a server-drawn card that asks Avery something. Since overview slice 3 her chat sits behind
// the Company page's Ask Avery sheet, so the button opens that sheet with the words typed in (?say=…); the owner
// reads them and sends. Back closes the sheet.
import Link from "next/link";
import { companyAskHref } from "@/dashboard/company-rules";

export function AskAveryButton({ say, className, children }: { say: string; className?: string; children: React.ReactNode }) {
  return <Link href={companyAskHref("overview", say)} scroll={false} className={className}>{children}</Link>;
}
