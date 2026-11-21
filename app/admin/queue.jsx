import { listCommentsForModeration, listModerationQueue, listReports } from '../../lib/supabase';
import { getServiceClient } from '../../lib/supabase/server';
import ResourceFile from '../../components/ResourceFile';
import ActionForm, { ActionButton } from '../../components/ActionForm';
import Pagination from '../../components/Pagination';
import { moderate } from './actions';

export default async function AdminQueue({ searchParams }) {
  let lists;
  try {
    const client = getServiceClient();
    lists = await Promise.allSettled([
      listModerationQueue({ client, page: searchParams.resources }),
      listCommentsForModeration({ client, page: searchParams.comments }),
      listReports({ client, page: searchParams.reports }),
    ]);
  } catch (error) {
    return <p className="panel" role="alert">{error.message}</p>;
  }
  return (
    <div className="grid items-start gap-5 lg:grid-cols-2 lg:gap-7">
      <Queue title="上传审核" result={lists[0]} {...{ searchParams }} pageKey="resources">
        {(resource) => (
          <>
            <h3 className="break-words font-bold">{resource.title}</h3>
            <p className="muted text-sm">{resource.course?.name} · {resource.year} 年 · {resource.semester} · {resource.type} · {resource.uploader_name}</p>
            <details>
              <summary className="mb-3 cursor-pointer font-medium">查看文件</summary>
              <ResourceFile resource={resource} url={resource.preview_url ?? resource.file_url} admin />
            </details>
            <ActionForm action={moderate.bind(null, 'resource', resource.id)} announceApproval>
              <label>驳回理由（选填）<input name="note" maxLength={200} /></label>
              <div className="flex flex-wrap gap-2">
                <ActionButton value="approve">通过</ActionButton>
                <ActionButton value="reject" secondary>驳回</ActionButton>
              </div>
            </ActionForm>
          </>
        )}
      </Queue>
      <Queue title="投诉处理" result={lists[2]} {...{ searchParams }} pageKey="reports">
        {(report) => (
          <>
            <h3 className="break-words font-bold">{report.resource?.title}</h3>
            <p className="tag">{report.reason}</p>
            <p className="whitespace-pre-wrap break-words">{report.detail}</p>
            {report.contact && <p className="muted break-words">联系方式 {report.contact}</p>}
            <ActionForm action={moderate.bind(null, 'report', report.id)}>
              <label>处理说明（选填）<textarea name="note" maxLength={500} /></label>
              <div className="flex flex-wrap gap-2">
                <ActionButton value="resolved">标记已处理</ActionButton>
                <ActionButton value="dismissed" secondary>驳回举报</ActionButton>
              </div>
            </ActionForm>
          </>
        )}
      </Queue>
      <Queue title="评论审核" result={lists[1]} {...{ searchParams }} pageKey="comments">
        {(comment) => (
          <>
            <h3 className="break-words font-bold">{comment.resource?.title} · {comment.author_name}</h3>
            <p className="whitespace-pre-wrap break-words">{comment.content}</p>
            <ActionForm action={moderate.bind(null, 'comment', comment.id)} className="flex flex-wrap gap-2">
              <ActionButton value="approve">通过评论</ActionButton>
              <ActionButton value="reject" secondary>驳回评论</ActionButton>
            </ActionForm>
          </>
        )}
      </Queue>
    </div>
  );
}

function Queue({ title, result, children, searchParams, pageKey }) {
  if (result.status === 'rejected') return (
    <section className="panel space-y-5">
      <h2>{title}</h2>
      <p role="alert">{result.reason.message || '无法加载队列。'}</p>
    </section>
  );
  const results = result.value;
  return (
    <section className="panel space-y-5">
      <h2>{title}（{results.total} 待处理）</h2>
      {!results.data.length && <p className="muted">本页暂无待处理记录。</p>}
      {results.data.map((item) => (
        <div key={item.id} className="space-y-4 border-t border-line pt-5">{children(item)}</div>
      ))}
      <Pagination {...{ results, searchParams, pageKey }} />
    </section>
  );
}
