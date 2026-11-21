import { ACCEPT_ATTRIBUTE, CURRENT_YEAR_MAX, RESOURCE_TYPES, SEMESTERS, YEAR_MIN } from '../../lib/supabase';
import { loadCourses } from '../../lib/catalog-data';
import ActionForm, { ActionButton } from '../../components/ActionForm';
import { submitResource } from './actions';

export const dynamic = 'force-dynamic';

export default async function UploadPage() {
  let courses;
  try {
    courses = await loadCourses();
  } catch (error) {
    return <p className="panel" role="alert">{error.message || '课程加载失败。'}</p>;
  }
  return (
    <div className="mx-auto max-w-2xl space-y-6 sm:space-y-8">
      <h1>上传资料</h1>
      <p className="muted">上传后，资料通过审核即可在课程列表中查看。</p>
      <ActionForm className="panel grid gap-6" action={submitResource} reset>
        <label>资料标题<input name="title" required minLength={2} maxLength={120} /></label>
        <label>课程
          <select name="courseId" required defaultValue="">
            <option value="" disabled>选择课程</option>
            {courses.map((course) => <option key={course.id} value={course.id}>{course.name} · {course.colleges.name}</option>)}
          </select>
        </label>
        <div className="grid gap-5 sm:grid-cols-2">
          <label>年份<input name="year" type="number" min={YEAR_MIN} max={CURRENT_YEAR_MAX} defaultValue={CURRENT_YEAR_MAX - 1} required /></label>
          <label>学期<select name="semester">{SEMESTERS.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>资料类型<select name="type">{RESOURCE_TYPES.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>教师（选填）<input name="teacher" maxLength={60} /></label>
        </div>
        <label>昵称（选填）<input name="uploaderName" maxLength={24} placeholder="留空则显示为匿名" /></label>
        <label>资料文件<input name="file" type="file" accept={ACCEPT_ATTRIBUTE} required /></label>
        <p className="muted text-sm">支持 PDF、常见图片和 Word 文档，最大 50 MB。</p>
        <div><ActionButton>提交审核</ActionButton></div>
      </ActionForm>
    </div>
  );
}
