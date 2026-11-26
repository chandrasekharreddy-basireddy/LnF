const paths: Record<string, string> = {
  electronics: 'M9 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm0 4h6',
  bags: 'M6 8h12l-1 12H7L6 8Zm3 0V6a3 3 0 0 1 6 0v2',
  documents: 'M7 3h7l4 4v14H7V3Zm7 0v5h4',
  accessories: 'M3 12h6a3 3 0 0 1 6 0h6M12 15v3',
  clothing: 'M8 4 4 7l2 4 2-1v10h8V10l2 1 2-4-4-3-4 2-4-2Z',
  keys: 'M15 4a5 5 0 1 1-4.6 7H8v2H6v2H3v-3l7.4-7.4A5 5 0 0 1 15 4Z',
  books: 'M5 4h9a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4Zm12 3v13',
  sports: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 0v18M3 12h18',
  other: 'M12 4v.01M12 12v.01M12 20v.01',
};

export function CategoryIcon({ category, size = 26 }: { category: string; size?: number }) {
  const d = paths[category] ?? paths.other;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ color: 'var(--brand)' }}
    >
      <path d={d} />
    </svg>
  );
}
