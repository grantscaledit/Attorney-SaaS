import Link from "next/link";

export default function Forbidden() {
  return (
    <div className="mx-auto flex min-h-[60dvh] max-w-md flex-col justify-center px-4">
      <p className="eyebrow mb-2">403</p>
      <h1 className="page-title">You don&apos;t have access to this page</h1>
      <p className="mt-2 text-[13.5px] text-ink-2">
        Your role does not include this area. If you need it for your work, ask your firm&apos;s
        owner attorney.
      </p>
      <Link href="/" className="mt-6 text-[13.5px] text-accent hover:underline">
        Back to overview
      </Link>
    </div>
  );
}
