export default function ResourceFile({ resource, url, admin = false }) {
  if (!url || !/^(https?:\/\/|\/(?!\/))/i.test(url)) return <p className="muted">文件暂时无法读取。</p>;

  const path = resource.file_url?.split('?')[0] ?? '';
  const pdf = resource.mime_type === 'application/pdf' || /\.pdf$/i.test(path);
  const image = /^image\/(jpeg|png|webp|gif)$/.test(resource.mime_type ?? '') || /\.(jpg|jpeg|png|webp|gif)$/i.test(path);
  const text = url.startsWith('/') && /\.txt$/i.test(path);

  return (
    <div className="space-y-4">
      {image ? (
        <img src={url} alt={resource.title} className="max-h-96 max-w-full rounded-md border border-line object-contain" />
      ) : pdf || text ? (
        <iframe className="h-96 w-full rounded-md border border-line" src={url} title="文件预览" />
      ) : <p className="muted">此文件格式请下载后查看。</p>}
      {admin ? <a className="btn" href={url} target="_blank" rel="noreferrer">打开文件</a> : (
        <form method="post" action={`/resources/${resource.id}/download`}>
          <button className="btn">下载资料</button>
        </form>
      )}
    </div>
  );
}
