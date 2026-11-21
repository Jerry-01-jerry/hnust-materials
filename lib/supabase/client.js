/**
 * 浏览器端 / 边缘运行时用的 Supabase 客户端（anon key，受 RLS 约束）。
 *
 * 用途：匿名读取已发布资源、匿名提交待审内容（RLS 强制 status='pending'）。
 * 注意：服务端请用 lib/supabase/server.js，别把 service_role key 带到这里。
 */

import { createClient } from '@supabase/supabase-js';
import { readPublicSupabaseEnv } from './config.js';

let browserClient = null;

/**
 * @param {{ url?: string, anonKey?: string, accessToken?: string }} [options]
 *   accessToken 预留给将来接入登录后，用 JWT 走 authenticated 角色。
 */
export function createBrowserSupabaseClient(options = {}) {
  const env = options.url && options.anonKey ? options : readPublicSupabaseEnv();
  return createClient(env.url, env.anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: options.accessToken
      ? { headers: { Authorization: `Bearer ${options.accessToken}` } }
      : undefined,
  });
}

/** 单例（同一页面复用同一条连接）。 */
export function getBrowserSupabaseClient() {
  if (!browserClient) browserClient = createBrowserSupabaseClient();
  return browserClient;
}
