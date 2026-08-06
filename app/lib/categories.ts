export interface Category {
  id: string;
  label: string;
  default: boolean;
  chipClass: string;
}

export const CATEGORIES: Category[] = [
  { id: 'scripture', label: 'Scriptures', default: true, chipClass: 'bg-indigo-100 text-indigo-800 border-indigo-200' },
  { id: 'conference', label: 'Conference', default: true, chipClass: 'bg-blue-100 text-blue-800 border-blue-200' },
  { id: 'manual', label: 'Manuals', default: true, chipClass: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  { id: 'devotional', label: 'Devotionals', default: true, chipClass: 'bg-cyan-100 text-cyan-800 border-cyan-200' },
  { id: 'history', label: 'History', default: false, chipClass: 'bg-amber-100 text-amber-800 border-amber-200' },
];

export const DEFAULT_CATEGORIES = CATEGORIES.filter((c) => c.default).map((c) => c.id);

export const ALL_CATEGORY_IDS = CATEGORIES.map((c) => c.id);

export function getCategory(id: string): Category {
  return CATEGORIES.find((c) => c.id === id) || { id, label: id, default: false, chipClass: 'bg-gray-100 text-gray-700 border-gray-200' };
}