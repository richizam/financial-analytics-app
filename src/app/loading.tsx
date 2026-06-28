function SkeletonLine({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-gray-200 ${className}`} />
}

export default function Loading() {
  return (
    <main className="min-h-screen bg-gray-50 px-4 py-4 sm:px-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-4">
        <div className="border-b border-gray-200 bg-white/80 px-1 py-3">
          <SkeletonLine className="h-5 w-44" />
          <div className="mt-4 flex flex-wrap gap-2">
            <SkeletonLine className="h-9 w-20" />
            <SkeletonLine className="h-9 w-20" />
            <SkeletonLine className="h-9 w-20" />
            <SkeletonLine className="h-9 w-20" />
          </div>
        </div>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SkeletonLine className="h-28" />
          <SkeletonLine className="h-28" />
          <SkeletonLine className="h-28" />
          <SkeletonLine className="h-28" />
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.3fr_0.7fr]">
          <SkeletonLine className="h-80" />
          <div className="space-y-3">
            <SkeletonLine className="h-20" />
            <SkeletonLine className="h-20" />
            <SkeletonLine className="h-20" />
          </div>
        </section>
      </div>
    </main>
  )
}
