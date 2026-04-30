export default function InputForm({ value, onChange, onSubmit, loading }) {
  function handleKey(e) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSubmit();
  }

  return (
    <div className="w-full flex flex-col gap-4">
      <textarea
        className="w-full min-h-48 rounded-2xl border-2 border-orange-400/40 bg-zinc-900/80
                   p-4 text-zinc-100 placeholder-zinc-500 font-mono text-sm
                   resize-none focus:outline-none focus:border-orange-400
                   transition-colors duration-200"
        placeholder={`Paste anything you want roasted:\n• Your code\n• Your README\n• Your LinkedIn bio\n• Your startup idea`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKey}
        disabled={loading}
      />
      <button
        onClick={onSubmit}
        disabled={loading || !value.trim()}
        className="w-full py-4 rounded-2xl font-bold text-lg tracking-wide
                   bg-orange-500 hover:bg-orange-400 disabled:bg-zinc-700
                   disabled:text-zinc-500 text-white
                   transition-all duration-200 active:scale-95
                   disabled:cursor-not-allowed cursor-pointer"
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Cooking the roast…
          </span>
        ) : (
          "🔥 Roast Me"
        )}
      </button>
      <p className="text-center text-zinc-600 text-xs">⌘+Enter to submit</p>
    </div>
  );
}