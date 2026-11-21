/**
 * lib/supabase 统一出口。
 *
 * 这里只汇总「浏览器/服务端都能安全导入」的模块。
 * 以下两个模块必须按路径直接导入，且只在服务端使用：
 *   import { getServiceClient } from '@/lib/supabase/server';
 *   import { verifyAdminCookie } from '@/lib/supabase/auth';
 */

export * from './config.js';
export * from './errors.js';
export * from './validation.js';
export * from './client.js';
export * from './storage.js';
export * from './catalog.js';
export * from './resources.js';
export * from './comments.js';
export * from './reports.js';
