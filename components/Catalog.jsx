import Link from 'next/link';
import { CURRENT_YEAR_MAX, YEAR_MIN, listColleges, listCourses, listMajors, listResources } from '../lib/supabase';
import { loadCourses } from '../lib/catalog-data';
import CatalogFilters from './CatalogFilters';
import Pagination from './Pagination';

const years = Array.from({ length: CURRENT_YEAR_MAX - YEAR_MIN + 1 }, (_, index) => CURRENT_YEAR_MAX - index);
const value = (params, key) => typeof params[key] === 'string' ? params[key].trim() : '';

export default async function Catalog({ home = false, searchParams }) {
  const filters = {
    query: home ? value(searchParams, 'q') : '',
    collegeSlug: value(searchParams, 'college'),
    majorSlug: value(searchParams, 'major'),
    courseSlug: value(searchParams, 'course'),
    year: value(searchParams, 'year') || undefined,
  };
  const page = value(searchParams, 'page');
  try {
    const [colleges, majors, courses, results] = await Promise.all([
      listColleges(), listMajors(), loadCourses(),
      home || filters.courseSlug || filters.year
        ? listResources(filters, { page })
        : listCourses({ collegeSlug: filters.collegeSlug, majorSlug: filters.majorSlug, page }),
    ]);
    // The course API embeds majors with a left join, so apply the major filter to its directory rows.
    const directory = !home && !filters.courseSlug && !filters.year;
    const filteredCourses = directory && filters.majorSlug
      ? courses.filter((item) => item.majors?.slug === filters.majorSlug &&
        (!filters.collegeSlug || item.colleges.slug === filters.collegeSlug))
      : null;
    const pageResults = filteredCourses
      ? { ...results, total: filteredCourses.length, data: filteredCourses.slice((results.page - 1) * results.pageSize, results.page * results.pageSize) }
      : results;
    return (
      <div className={home ? "space-y-10 sm:space-y-12" : "space-y-8 sm:space-y-10"}>
        {home ? (
          <header className="mx-auto max-w-2xl pt-4 text-center sm:pt-12">
            <p className="hidden">湖南科技大学 · 学习资料共享</p>
            <h1 className="motion-hero motion-hero-title text-[clamp(2.75rem,7vw,4.5rem)] leading-[1.12] text-accent">湖科资料库</h1>
            <p className="motion-hero motion-hero-subtitle mt-4 text-base leading-relaxed text-muted sm:mt-5 sm:text-lg">免费查找课程笔记、复习资料和练习题。</p>
          </header>
        ) : <h1 className="pt-2 sm:pt-4">课程列表</h1>}
        <CatalogFilters key={JSON.stringify(filters)} {...{ filters, colleges, majors, courses, years, home }} />
        <section className="space-y-4">
          <h2 role="status" className="motion-feedback text-lg sm:text-xl">
            {home && typeof searchParams.q === 'string' && <span className="sr-only">搜索完成。</span>}
            {directory ? '课程' : '公开资料'}（{pageResults.total}）
          </h2>
          {pageResults.data.length === 0 && <p className="muted border-t border-line py-8 text-sm">暂无符合条件的结果。</p>}
          <ul className="motion-list divide-y divide-line border-b border-line empty:hidden [&:not(:empty)]:border-t">
            {pageResults.data.map((item) => directory ? (
              <li key={item.id}>
                <Link className="catalog-row motion-card grid min-h-16 items-center gap-x-8 gap-y-1 px-2 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] sm:px-3" href={`/courses?course=${item.slug}`}>
                  <h3 className="break-words text-base font-bold">{item.name}</h3>
                  <p className="muted text-sm">{item.colleges.name}{item.majors && ` · ${item.majors.name}`}</p>
                </Link>
              </li>
            ) : (
              <li key={item.id}>
                <Link className="catalog-row grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-2 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,19rem)_6rem] sm:gap-x-8 sm:px-3 motion-card" href={`/resources/${item.id}`}>
                  <span className="col-start-2 row-start-1 text-right text-xs font-medium text-accent sm:col-start-3 sm:text-sm">{item.type}</span>
                  <h3 className="col-start-1 row-start-1 break-words text-base font-bold">{item.title}</h3>
                  <p className="muted col-span-2 text-sm sm:col-span-1 sm:col-start-2 sm:row-start-1">{courses.find((course) => course.slug === item.course_id)?.name} · {item.year} 年 · {item.downloads} 次下载</p>
                </Link>
              </li>
            ))}
          </ul>
          <Pagination results={pageResults} searchParams={searchParams} />
        </section>
      </div>
    );
  } catch (error) {
    return <p role="alert" className="panel">{error.message || '数据加载失败，请重试。'}</p>;
  }
}
