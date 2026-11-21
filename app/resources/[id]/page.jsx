import Link from 'next/link';
import { getCourse, getResource, listComments, REPORT_REASONS } from '../../../lib/supabase';
import ResourceFile from '../../../components/ResourceFile';
import ActionForm, { ActionButton } from '../../../components/ActionForm';
import Pagination from '../../../components/Pagination';
import { submitComment, submitReport } from './actions';

export const dynamic = 'force-dynamic';

export default async function ResourcePage({ params, searchParams }) {
  const id = params.id;
  let resource, course, comments;
  try {
    resource = await getResource(id);
    [course, comments] = await Promise.all([
      getCourse({ slug: resource.course_id }),
      listComments(id, { page: searchParams.page }),
    ]);
  } catch (error) {
    return (
      <section className="panel space-y-4">
        <h1>资料暂不可查看</h1>
        <p role="alert">{error.message}</p>
        <Link className="btn" href="/courses">返回课程列表</Link>
      </section>
    );
  }

  return (
    <article className="mx-auto max-w-3xl space-y-7 sm:space-y-9">
      <Link href="/courses" className="inline-flex min-h-11 items-center text-sm font-semibold text-accent underline-offset-4 hover:underline">返回课程列表</Link>
      <header className="space-y-3">
        <span className="tag">{resource.type}</span>
        <h1 className="break-words">{resource.title}</h1>
        <p className="muted">{course.name} · {resource.year} 年 · {resource.semester}{resource.teacher && ` · ${resource.teacher}`}</p>
        <p className="muted text-sm">上传者 {resource.uploader} · {resource.downloads} 次下载</p>
      </header>
      <section className="panel space-y-4">
        <h2>文件预览</h2>
        <ResourceFile resource={resource} url={resource.download_url} />
      </section>
      <section className="panel space-y-4">
        <h2>评论（{comments.total}）</h2>
        <ActionForm action={submitComment.bind(null, id)} reset>
          <label>匿名评论<textarea name="content" rows={3} required maxLength={1000} /></label>
          <ActionButton>提交评论</ActionButton>
        </ActionForm>
        {comments.data.length === 0 && <p className="muted">暂无已发布评论。</p>}
        <ul className="divide-y divide-line">
          {comments.data.map((comment) => (
            <li className="py-3" key={comment.id}>
              <p className="text-sm font-semibold">{comment.author_name}</p>
              <p className="whitespace-pre-wrap break-words">{comment.content}</p>
            </li>
          ))}
        </ul>
        <Pagination results={comments} searchParams={searchParams} />
      </section>
      <details className="panel">
        <summary className="cursor-pointer font-semibold">举报资料</summary>
        <ActionForm action={submitReport.bind(null, id)} className="mt-4 space-y-3" reset>
          <label>举报原因<select name="reason">{REPORT_REASONS.map((reason) => <option key={reason}>{reason}</option>)}</select></label>
          <label>补充说明（选填）<textarea name="detail" rows={3} maxLength={500} /></label>
          <label>联系方式（选填）<input name="contact" maxLength={100} /></label>
          <ActionButton secondary>提交举报</ActionButton>
        </ActionForm>
      </details>
    </article>
  );
}
