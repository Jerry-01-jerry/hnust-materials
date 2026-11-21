import { getResource, incrementDownloads } from '../../../../lib/supabase';

export async function POST(request, { params }) {
  try {
    const resource = await getResource(params.id);
    const url = new URL(resource.download_url, request.url);
    if (!['http:', 'https:'].includes(url.protocol)) {
      return new Response('下载地址无效。', { status: 422 });
    }
    if (url.origin === new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin &&
        url.pathname.startsWith('/storage/v1/object/sign/')) {
      url.searchParams.set('download', resource.file_name || resource.title);
    }
    await incrementDownloads(resource.id);
    return Response.redirect(url, 303);
  } catch (error) {
    return new Response('资料暂时无法下载，请返回详情页重试。', {
      status: error.status || 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}
