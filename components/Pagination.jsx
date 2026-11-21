import Link from 'next/link';

export default function Pagination({ results: { page, pageSize, total }, searchParams, pageKey = 'page' }) {
  const pages = Math.ceil(total / pageSize);
  if (pages <= 1 && page <= 1) return null;

  function href(target) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (typeof value === 'string' && value) params.set(key, value);
    }
    params.set(pageKey, String(target));
    return `?${params}`;
  }

  return (
    <nav aria-label="分页" className="flex flex-wrap items-center gap-3 pt-3">
      {page > 1 && <Link prefetch={false} className="btn secondary" href={href(Math.min(page - 1, Math.max(1, pages)))}>上一页</Link>}
      <span className="muted">第 {page} 页</span>
      {page < pages && <Link prefetch={false} className="btn secondary" href={href(page + 1)}>下一页</Link>}
    </nav>
  );
}
