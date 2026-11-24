import { redirect } from "next/navigation";
import { SCHEDULE_HREF, deptViewHref } from "@/dashboard/company-rules";

// Crew split up (docs/department-pages.md, slice 11): the canvas and the chart editor are views of Company > Departments,
// and Schedule is a Settings section. Old links and bookmarks land where each part went.
export default async function Crew({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const q = (await searchParams).view;
  redirect(q === "schedule" ? SCHEDULE_HREF : deptViewHref(q === "edit" ? "edit" : "chart"));
}
