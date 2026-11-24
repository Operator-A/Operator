import { redirect } from "next/navigation";
import { ACTIVITY_HREF } from "@/dashboard/activity-rules";

// Status is the top of Activity now (docs/department-pages.md, slice 12): what needs a look, then the runs.
export default function Status() {
  redirect(ACTIVITY_HREF);
}
