'use server';

import { createComment, createReport, getResource } from '../../../lib/supabase';

export async function submitComment(id, _previous, form) {
  try {
    await getResource(id);
    const result = await createComment({ resourceId: id, content: form.get('content') });
    return { ok: true, message: result.message };
  } catch (error) {
    return { ok: false, message: error.message || '评论提交失败。' };
  }
}

export async function submitReport(id, _previous, form) {
  try {
    await getResource(id);
    const result = await createReport({
      resourceId: id, reason: form.get('reason'), detail: form.get('detail'), contact: form.get('contact'),
    });
    return { ok: true, message: result.message };
  } catch (error) {
    return { ok: false, message: error.message || '举报提交失败。' };
  }
}
