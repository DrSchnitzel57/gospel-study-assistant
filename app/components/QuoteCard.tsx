import Badge from './Badge';

interface QuoteCardProps {
  quote: {
    quote: string;
    source: string;
    reference: string;
    source_type: string;
    official_status: string;
    doctrinal_weight: string;
    content_category: string;
  };
}

export default function QuoteCard({ quote }: QuoteCardProps) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm hover:shadow-md transition-shadow">
      <blockquote className="text-gray-800 text-lg leading-relaxed mb-4 italic border-l-4 border-primary pl-4">
        "{quote.quote}"
      </blockquote>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="text-sm">
          <span className="font-semibold text-primary">{quote.source}</span>
          {quote.reference && (
            <span className="text-gray-500 ml-2">— {quote.reference}</span>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Badge variant={quote.source_type} label={quote.source_type === 'primary' ? 'Primary Source' : 'Secondary Source'} />
          <Badge variant={quote.official_status} label={quote.official_status === 'official' ? 'Official' : 'Unofficial'} />
          <Badge variant={quote.doctrinal_weight} label={quote.doctrinal_weight.charAt(0).toUpperCase() + quote.doctrinal_weight.slice(1) + ' Doctrine'} />
        </div>
      </div>
    </div>
  );
}
