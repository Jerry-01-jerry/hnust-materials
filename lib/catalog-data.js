import { listCourses, MAX_PAGE_SIZE } from './supabase';

export async function loadCourses() {
  const first = await listCourses({ pageSize: MAX_PAGE_SIZE });
  const remaining = await Promise.all(
    Array.from({ length: Math.ceil(first.total / first.pageSize) - 1 }, (_, index) =>
      listCourses({ page: index + 2, pageSize: first.pageSize })),
  );
  return [first, ...remaining].flatMap(({ data }) => data);
}
