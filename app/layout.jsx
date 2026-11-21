import Link from 'next/link';
import './globals.css';

export const metadata = { title: '湖科资料库', description: '湖南科技大学学生免费学习资料库' };

export default function Layout({ children }) {
  return (
    <html lang="zh-CN">
      <body>
        <header className="border-b border-line bg-canvas">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-0 px-5 py-2 sm:px-8 sm:py-3">
            <Link href="/" className="flex min-h-11 items-center text-lg font-extrabold tracking-tight text-ink">
              <span className="hidden" aria-hidden="true">湖</span>
              湖科资料库
            </Link>
            <nav aria-label="主导航" className="flex flex-wrap gap-x-4 text-sm font-medium text-muted sm:gap-x-7">
              <Link className="inline-flex min-h-11 items-center py-2 hover:text-ink" href="/">首页</Link>
              <Link className="inline-flex min-h-11 items-center py-2 hover:text-ink" href="/courses">课程</Link>
              <Link className="inline-flex min-h-11 items-center py-2 hover:text-ink" href="/upload">上传资料</Link>
              <Link className="inline-flex min-h-11 items-center py-2 hover:text-ink" href="https://ai-code-pool.netlify.app" target="_blank" rel="noopener noreferrer">AI 码池</Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto min-h-[75vh] max-w-6xl px-5 py-10 sm:px-8 sm:py-16">{children}</main>
        <footer className="mx-auto flex max-w-6xl flex-wrap justify-between gap-3 border-t border-line px-5 py-8 text-sm text-muted sm:px-8">
          <span>湖科资料库 · 湖南科技大学学生学习资料共享</span>
          <Link href="/admin" className="font-medium underline-offset-4 hover:text-ink hover:underline">管理后台</Link>
        </footer>
      </body>
    </html>
  );
}
