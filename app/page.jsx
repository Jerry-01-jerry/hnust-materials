import Catalog from '../components/Catalog';

export const dynamic = 'force-dynamic';

export default function HomePage({ searchParams }) {
  return <Catalog home searchParams={searchParams} />;
}
