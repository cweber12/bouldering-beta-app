import Link from "next/link";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-10 px-6 py-16">
      <div className="flex flex-col items-center gap-3 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-zinc-100">
          Bouldering Beta
        </h1>
        <p className="max-w-md text-sm text-zinc-400">
          Upload a climbing video to extract pose data, then match it against a
          route photo to generate an annotated overlay — entirely in your browser.
        </p>
      </div>

      <div className="flex flex-col items-center gap-4 sm:flex-row">
        <Link
          href="/upload?mode=indoor"
          className="flex w-52 flex-col items-center gap-3 rounded-xl border border-zinc-700 bg-zinc-900 px-8 py-7 text-center transition hover:border-zinc-400 hover:bg-zinc-800"
        >
          <span className="text-4xl" aria-hidden="true">🏋️</span>
          <div>
            <p className="font-semibold text-zinc-100">Indoor</p>
            <p className="mt-1 text-xs text-zinc-500">
              Pose detection on every frame
            </p>
          </div>
        </Link>

        <Link
          href="/upload?mode=outdoor"
          className="flex w-52 flex-col items-center gap-3 rounded-xl border border-zinc-700 bg-zinc-900 px-8 py-7 text-center transition hover:border-zinc-400 hover:bg-zinc-800"
        >
          <span className="text-4xl" aria-hidden="true">🧗</span>
          <div>
            <p className="font-semibold text-zinc-100">Outdoor</p>
            <p className="mt-1 text-xs text-zinc-500">
              Hip-crop + interpolation for wide-angle footage
            </p>
          </div>
        </Link>
      </div>

      <p className="text-xs text-zinc-600">
        Not sure which to pick?{" "}
        <Link href="/docs#modes" className="text-zinc-400 underline hover:text-zinc-200 transition">
          Read the docs
        </Link>
      </p>
    </main>
  );
}
