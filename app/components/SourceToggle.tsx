interface SourceToggleProps {
  label: string;
  enabled: boolean;
  onToggle: () => void;
}

export default function SourceToggle({ label, enabled, onToggle }: SourceToggleProps) {
  return (
    <button
      onClick={onToggle}
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
        enabled
          ? 'bg-primary text-white border-primary hover:bg-primary-light'
          : 'bg-white text-gray-500 border-gray-300 hover:border-gray-400'
      }`}
    >
      <span className={`w-3 h-3 rounded-full border ${enabled ? 'bg-white border-white' : 'border-gray-400'}`}>
        {enabled && <span className="block w-full h-full bg-white rounded-full" />}
      </span>
      {label}
    </button>
  );
}
