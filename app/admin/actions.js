'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { ADMIN_COOKIE_NAME, adminSessionToken, safeEqual } from '../../lib/supabase/auth';
import { getServiceClient } from '../../lib/supabase/server';
import { approveComment, approveResource, closeReport, rejectComment, rejectResource } from '../../lib/supabase';
import { isAdmin } from './access';

export async function enterAdmin(formData) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password || !safeEqual(formData.get('password'), password)) redirect('/admin?error=1');
  cookies().set(ADMIN_COOKIE_NAME, adminSessionToken(password), {
    httpOnly: true, sameSite: 'strict', path: '/admin', maxAge: 3600,
    secure: process.env.ADMIN_SECURE_COOKIE === 'true',
  });
  redirect('/admin');
}

export async function exitAdmin() {
  cookies().set(ADMIN_COOKIE_NAME, '', { path: '/admin', maxAge: 0 });
  redirect('/admin');
}

export async function moderate(kind, id, _previous, form) {
  if (!isAdmin()) return { ok: false, message: '后台会话已失效，请重新输入管理密码。' };

  const operation = form.get('operation');
  const note = form.get('note');
  try {
    const options = { client: getServiceClient() };
    if (kind === 'resource' && operation === 'approve') {
      await approveResource(id, options);
    } else if (kind === 'resource' && operation === 'reject') {
      await rejectResource(id, note, options);
    } else if (kind === 'comment' && operation === 'approve') {
      await approveComment(id, options);
    } else if (kind === 'comment' && operation === 'reject') {
      await rejectComment(id, options);
    } else if (kind === 'report' && ['resolved', 'dismissed'].includes(operation)) {
      await closeReport(id, { status: operation, note }, options);
    } else {
      return { ok: false, message: '请选择处理操作。' };
    }
    revalidatePath('/admin');
    return { ok: true, message: '处理成功。' };
  } catch (error) {
    return { ok: false, message: error.message || '操作失败，请重试。' };
  }
}
