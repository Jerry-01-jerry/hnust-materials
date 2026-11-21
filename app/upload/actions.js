'use server';

import { createResourceSubmission } from '../../lib/supabase';

export async function submitResource(_previous, form) {
  const file = form.get('file');
  try {
    const result = await createResourceSubmission({
      title: form.get('title'),
      courseId: form.get('courseId'),
      year: form.get('year'),
      semester: form.get('semester'),
      type: form.get('type'),
      teacher: form.get('teacher'),
      uploaderName: form.get('uploaderName'),
    }, { file });
    return { ok: true, message: result.message, id: result.id };
  } catch (error) {
    return { ok: false, message: error.message || '上传失败，请重试。' };
  }
}
