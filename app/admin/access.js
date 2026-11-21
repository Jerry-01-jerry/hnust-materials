import { cookies } from 'next/headers';
import { ADMIN_COOKIE_NAME, verifyAdminCookie } from '../../lib/supabase/auth';

export function isAdmin() {
  return verifyAdminCookie(cookies().get(ADMIN_COOKIE_NAME)?.value);
}
