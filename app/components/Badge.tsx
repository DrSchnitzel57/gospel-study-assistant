interface BadgeProps {
  variant: string;
  label: string;
}

const variantClasses: Record<string, string> = {
  primary: 'bg-blue-100 text-blue-800 border-blue-200',
  secondary: 'bg-gray-100 text-gray-700 border-gray-200',
  official: 'bg-green-100 text-green-800 border-green-200',
  unofficial: 'bg-orange-100 text-orange-800 border-orange-200',
  core: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  supporting: 'bg-teal-100 text-teal-800 border-teal-200',
  policy: 'bg-purple-100 text-purple-800 border-purple-200',
  esoteric: 'bg-red-100 text-red-800 border-red-200',
};

export default function Badge({ variant, label }: BadgeProps) {
  const className = variantClasses[variant] || 'bg-gray-100 text-gray-700 border-gray-200';

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${className}`}>
      {label}
    </span>
  );
}
