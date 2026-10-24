import type { Metadata } from "next";
import { StaffManagement } from "@/components/admin/staff-management";

export const metadata: Metadata = { title: "Staff management" };

export default function AdminStaffPage() {
  return <StaffManagement />;
}
