import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60dvh] max-w-md flex-col justify-center px-4">
      <p className="eyebrow mb-2">404</p>
      <h1 className="page-title">Page not found</h1>
      <p className="mt-2 text-[13.5px] text-ink-2">
        The address may be mistyped, or the record no longer exists.
      </p>
      <Link href="/" className="mt-6 text-[13.5px] text-accent hover:underline">
        Back to overview
      </Link>
    </div>
  );
}
