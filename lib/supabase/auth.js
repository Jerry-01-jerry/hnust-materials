/**
 * auth 预留层（当前不做登录）。
 *
 * 现状：
 *   - 站点匿名可用，Supabase 用 anon key + RLS。
 *   - 管理后台沿用它现有的 ADMIN_PASSWORD + HttpOnly Cookie（app/admin/access.js），
 *     这里只镜像同一套 HMAC 逻辑，供未来的 Route Handler 校验。
 *   - uploader_id / author_id / reporter_id 一律为 null。
 *
 * 将来接入登录时只需改这一层：
 *   1. 开启 Supabase Auth（邮箱/微信），anon key 保持公开；
 *   2. 用 JWT 的 app_metadata.role = 'admin' 替代共享密码；
 *   3. 把 getAuthUser() 换成 client.auth.getUser()，其余调用方无需改动。
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

if (typeof window !== 'undefined') {
  throw new Error('lib/supabase/auth.js 只能在服务端导入。');
}

/** 与 app/admin/access.js 完全一致的 Cookie 名，避免两边打架。 */
export const ADMIN_COOKIE_NAME = 'huke-admin';

const SESSION_SALT = 'huke-admin-session-v1';

/** 由 ADMIN_PASSWORD 派生会话令牌（HMAC-SHA256）。 */
export function adminSessionToken(password) {
  if (!password) throw new Error('ADMIN_PASSWORD 未配置。');
  return createHmac('sha256', password).update(SESSION_SALT).digest('hex');
}

/** 常量时间比较，避免长度/内容侧信道。 */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * 校验后台 Cookie（供 app/api/** 的 Route Handler 在调用 lib 管理员函数前使用）。
 * @param {string|undefined} cookieValue cookies().get(ADMIN_COOKIE_NAME)?.value
 * @param {string|undefined} [password] 默认读 process.env.ADMIN_PASSWORD
 */
export function verifyAdminCookie(cookieValue, password = process.env.ADMIN_PASSWORD) {
  if (!cookieValue || !password) return false;
  return safeEqual(cookieValue, adminSessionToken(password));
}

/** 预留：当前恒为 null，因为站点不做登录。 */
export async function getAuthUser(/* client */) {
  return null;
}

/** 预留：JWT 管理员判定，与数据库 public.is_admin() 保持一致。 */
export function isAdminUser(user) {
  return user?.app_metadata?.role === 'admin';
}

/**
 * 统一的「谁能审核」判定：
 *   1) 后台 Cookie 通过 → 管理员；
 *   2) 将来 JWT app_metadata.role=admin → 管理员；
 *   3) 其余一律拒绝。
 */
export async function requireAdmin({ cookieValue, user } = {}) {
  if (verifyAdminCookie(cookieValue)) return { ok: true, role: 'admin', via: 'cookie' };
  if (isAdminUser(user)) return { ok: true, role: 'admin', via: 'jwt' };
  return { ok: false, role: 'anon' };
}
