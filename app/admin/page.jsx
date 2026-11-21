import { isAdmin } from './access';
import { enterAdmin, exitAdmin } from './actions';
import AdminQueue from './queue';
import { ActionFeedback } from '../../components/ActionForm';

export const dynamic = 'force-dynamic';

export default function AdminPage({ searchParams }) {
  const password = process.env.ADMIN_PASSWORD;
  const authorized = isAdmin();
  return (
    <div className="space-y-7 sm:space-y-9">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1>管理后台</h1>
        {authorized && <form action={exitAdmin}><button className="btn secondary">退出后台</button></form>}
      </div>
      {authorized ? <ActionFeedback><AdminQueue searchParams={searchParams} /></ActionFeedback> : (
        <form className="panel max-w-md space-y-5" action={enterAdmin}>
          <label>管理密码<input name="password" type="password" required autoComplete="current-password" /></label>
          <button className="btn" disabled={!password}>进入后台</button>
          {!password && <p role="status">请先配置服务端环境变量 ADMIN_PASSWORD。</p>}
          {password && searchParams.error && <p role="alert">管理密码不正确。</p>}
        </form>
      )}
    </div>
  );
}
