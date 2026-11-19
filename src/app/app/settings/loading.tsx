export default function Loading() {
  return (
    <div className="animate-pulse space-y-7">
      <div className="h-8 w-64 rounded-xl bg-white/[.05]" />
      <div className="h-px w-full bg-white/[.06]" />
      <div className="h-48 w-full rounded-2xl bg-white/[.03]" />
    </div>
  );
}
