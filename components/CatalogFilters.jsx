'use client';

import { useEffect, useState } from 'react';

export default function CatalogFilters({ filters, colleges, majors, courses, years, home }) {
  const [college, setCollege] = useState(filters.collegeSlug);
  const [major, setMajor] = useState(filters.majorSlug);
  const [course, setCourse] = useState(filters.courseSlug);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const resetPending = () => setPending(false);
    window.addEventListener('pageshow', resetPending);
    return () => window.removeEventListener('pageshow', resetPending);
  }, []);

  return (
    <form className="grid items-end gap-x-5 gap-y-4 lg:grid-cols-[minmax(0,1fr)_auto]" action={home ? '/' : '/courses'} onSubmit={() => setPending(true)}>
      {home && (
        <label className="motion-hero motion-hero-search mx-auto mb-3 w-full max-w-2xl lg:col-span-2">搜索资料
          <input className="min-h-14 border-accent px-4 sm:min-h-16 sm:px-5" type="search" name="q" defaultValue={filters.query} maxLength={100} placeholder="输入资料标题或教师名" />
        </label>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        <label>学院
          <select name="college" value={college} onChange={(event) => {
            setCollege(event.target.value);
            setMajor('');
            setCourse('');
          }}>
            <option value="">全部学院</option>
            {colleges.map((item) => <option value={item.slug} key={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label>专业
          <select name="major" value={major} onChange={(event) => {
            setMajor(event.target.value);
            setCourse('');
          }}>
            <option value="">全部专业</option>
            {majors.filter((item) => !college || item.colleges.slug === college).map((item) =>
              <option value={item.slug} key={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label>课程
          <select name="course" value={course} onChange={(event) => setCourse(event.target.value)}>
            <option value="">全部课程</option>
            {courses.filter((item) => (!college || item.colleges.slug === college) &&
              (!major || item.majors?.slug === major)).map((item) =>
              <option value={item.slug} key={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label>年份
          <select name="year" defaultValue={filters.year ?? ''}>
            <option value="">全部年份</option>
            {years.map((year) => <option key={year}>{year}</option>)}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2.5">
        <button className="btn" aria-busy={pending}>
          <span className="motion-button-label">{home ? '搜索资料' : '筛选课程'}</span>
          {pending && <span className="motion-spinner" aria-hidden="true" />}
        </button>
        <span className="sr-only" role="status">{pending ? '正在读取结果。' : ''}</span>
        <a className="btn secondary border-transparent bg-transparent" href={home ? '/' : '/courses'}>清空筛选</a>
      </div>
    </form>
  );
}
