export default function Page() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
      <h1 className="text-4xl font-bold text-primary mb-4">
        Gospel Study Assistant
      </h1>
      <p className="text-lg text-gray-600 max-w-2xl mb-8">
        Search scriptures, conference talks, and Church-approved resources.
        Get direct quotes with exact source citations — no summaries, no AI interpretation.
      </p>
      <div className="text-sm text-gray-400">
        Logging in...
      </div>
    </div>
  );
}
