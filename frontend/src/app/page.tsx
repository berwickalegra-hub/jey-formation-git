import { redirect } from 'next/navigation';

export const runtime = 'nodejs';

export default function Home() {
  redirect('/a-propos');
}
