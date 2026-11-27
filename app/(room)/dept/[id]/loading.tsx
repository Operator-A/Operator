// The loading frame at this level too, so moving between departments shows it at once (click-speed slice 4).
// It is the department page's own frame, so phones keep the floating header and tab bar while the next one loads.
import { DeptSkel } from "@/dashboard/components/skeletons";

export default function Loading() {
  return <DeptSkel />;
}
