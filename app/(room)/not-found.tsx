import { Empty } from "@/dashboard/components/ui";

export default function NotFound() {
  return <Empty title="Nothing here." action={{ href: "/", label: "Back to the Company page" }}>That agent or run doesn’t exist.</Empty>;
}
