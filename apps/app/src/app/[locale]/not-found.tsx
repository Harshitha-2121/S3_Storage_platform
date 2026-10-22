import { Button } from "@v1/ui/button";
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-secondary px-6 text-center dark:bg-black">
      <h1 className="font-mono text-5xl font-bold text-primary">404</h1>
      <p className="text-sm text-primary/60">This page could not be found.</p>
      <Link href="/">
        <Button>Go home</Button>
      </Link>
    </div>
  );
}
