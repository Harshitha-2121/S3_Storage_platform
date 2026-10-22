import { notFound } from "next/navigation";

// Catch-all (lowest priority): any unmatched /<locale>/* path renders the branded 404
// via the sibling not-found.tsx. Specific routes/route-groups always win over this.
export default function CatchAllNotFound() {
  notFound();
}
