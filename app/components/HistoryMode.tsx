export default function HistoryMode() {
  const guides = [
    {
      title: 'How to Approach Church History Questions',
      content: [
        'Start with official Church sources before exploring independent material.',
        'Understand that Church members are encouraged to study history with faith and an open mind.',
        'Recognize that historical records from the 19th century have limitations — gaps and contradictions don\'t negate truth.',
        'Focus on the restored gospel\'s fruit in your life as evidence of its truthfulness.',
      ],
    },
    {
      title: 'Navigating Anti-Religious Content Online',
      content: [
        'Avoid rabbit holes: Do not spend hours on websites designed to weaken faith.',
        'The Church acknowledges that its history is complex and sometimes difficult.',
        'Use Gospel Topics Essays as a starting point for common questions.',
        'Talk with your bishop or trusted leaders about concerns.',
        'Remember: Faith and honest questions can coexist.',
      ],
    },
    {
      title: 'Recommended Official Resources',
      content: [
        'Gospel Topics Essays — churchofjesuschrist.org/topics',
        'Come, Follow Me manuals for guided scripture study',
        'General Conference talks from living prophets',
        'The Gospel — The Living Prophet series',
        'Stand Ye in Holy Places — official Church history resource',
      ],
    },
  ];

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="bg-accent/5 border border-accent/20 rounded-lg p-6 mb-8">
        <h2 className="text-2xl font-bold text-primary mb-2">Church History & Anti-Religious Sentiment Guide</h2>
        <p className="text-gray-600">
          This section provides the Church\'s guidance on how to appropriately approach questions about Church history
          and navigate anti-religious content. These are static, pre-written guidelines — not AI-generated.
        </p>
      </div>

      <div className="space-y-6">
        {guides.map((guide, index) => (
          <div key={index} className="bg-white rounded-lg border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-primary mb-3">{guide.title}</h3>
            <ul className="space-y-2">
              {guide.content.map((item, i) => (
                <li key={i} className="flex gap-3 text-gray-700">
                  <span className="text-primary font-bold mt-0.5">•</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="mt-8 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
        <p className="text-sm text-yellow-800">
          <strong>Important:</strong> This guide is based on Church-approved resources and teachings.
          For personal concerns, please speak with your local Church leaders.
        </p>
      </div>
    </div>
  );
}
