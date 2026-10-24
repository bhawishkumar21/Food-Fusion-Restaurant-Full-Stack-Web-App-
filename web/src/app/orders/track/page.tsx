import type { Metadata } from "next";
import { Suspense } from "react";
import { TrackOrderPage } from "@/components/customer/storefront-pages";

export const metadata: Metadata = { title: "Track order" };

// useSearchParams (?id=) needs a Suspense boundary under Cache Components.
export default function Page() {
  return (
    <Suspense>
      <TrackOrderPage />
    </Suspense>
  );
}
