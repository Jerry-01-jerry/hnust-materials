import Catalog from '../../components/Catalog';

export const dynamic = 'force-dynamic';

export default function CoursesPage({ searchParams }) {
  return <Catalog searchParams={searchParams} />;
}
