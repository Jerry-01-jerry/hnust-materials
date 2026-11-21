/**
 * 服务端 Supabase 客户端。
 *
 *   createAnonClient()    —— anon key，仍受 RLS 约束，用于「代表匿名用户」写库。
 *   createServiceClient() —— service_role key，绕过 RLS，仅用于管理员审核、目录维护。
 *
 * 安全要求：service_role key 不带 NEXT_PUBLIC_ 前缀，只在服务端读取。
 * 该模块只允许被 Route Handler / Server Action / 脚本导入，禁止进入客户端 bundle。
 */

import { createClient } from '@supabase/supabase-js';
import { readPublicSupabaseEnv } from './config.js';
import { BackendError, ERROR_CODES } from './errors.js';

if (typeof window !== 'undefined') {
  throw new Error('lib/supabase/server.js 只能在服务端导入，客户端请使用 lib/supabase/client.js。');
}

let anonServerClient = null;
let serviceClient = null;

/** anon 身份的服务端客户端：写库时 RLS 依然生效（待审保护由数据库兜底）。 */
export function createAnonClient(options = {}) {
  const env = readPublicSupabaseEnv();
  return createClient(env.url, options.anonKey ?? env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { 'X-Client-Info': 'huke-library/server-anon' } },
  });
}

export function getAnonClient() {
  if (!anonServerClient) anonServerClient = createAnonClient();
  return anonServerClient;
}

/** service_role 客户端：管理员审核、跨行读取待审队列、移动 Storage 对象。 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new BackendError(
      ERROR_CODES.CONFIG_ERROR,
      '缺少 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY，服务端管理能力不可用。',
    );
  }

  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { 'X-Client-Info': 'huke-library/service-role' } },
  });
}

export function getServiceClient() {
  if (!serviceClient) serviceClient = createServiceClient();
  return serviceClient;
}

/**
 * 取客户端：默认 anon（保持最小权限），显式传 'service' 才提权。
 * @param {'anon'|'service'} [mode]
 */
export function resolveClient(mode = 'anon') {
  return mode === 'service' ? getServiceClient() : getAnonClient();
}
