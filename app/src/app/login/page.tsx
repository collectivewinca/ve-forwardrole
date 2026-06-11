export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; err?: string }>;
}) {
  const sp = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <p className="mb-2 text-xs font-bold uppercase tracking-widest text-orange-900">ve-work</p>
      <h1 className="font-serif text-3xl tracking-tight">Sign in</h1>
      <p className="mt-2 mb-8 text-sm text-zinc-500">
        Enter your email and password to access your dashboard.
      </p>
      <form action="/work/api/auth/login" method="post" className="space-y-4">
        <input type="hidden" name="next" value={sp.next || "/work"} />
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Email
          </label>
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
            className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 focus:border-orange-900 focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Password
          </label>
          <input
            type="password"
            name="password"
            required
            autoComplete="current-password"
            className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 focus:border-orange-900 focus:outline-none"
          />
        </div>
        {sp.err && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {sp.err === "invalid"
              ? "Wrong email or password."
              : "Login failed. Try again."}
          </p>
        )}
        <button
          type="submit"
          className="w-full rounded-md bg-orange-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-orange-950"
        >
          Sign in
        </button>
      </form>
    </main>
  );
}
