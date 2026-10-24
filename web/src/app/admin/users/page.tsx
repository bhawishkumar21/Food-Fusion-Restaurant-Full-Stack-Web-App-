import type { Metadata } from "next";
import { StaffManagement } from "@/components/admin/staff-management";

export const metadata: Metadata = { title: "User management" };

export default function AdminUsersPage() {
  return <StaffManagement />;
}
