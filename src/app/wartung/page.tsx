// „Predictive Maintenance“ ist in der Rubrik Maschinengesundheit · KI-Wächter aufgegangen (Maschinen-Akte).
// Alte Links (/wartung?m=SG-04) führen direkt dorthin.
import { redirect } from "next/navigation";

export default async function WartungPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const { m } = await searchParams;
  redirect(`/waechter?tab=akte${m ? `&m=${encodeURIComponent(m)}` : ""}`);
}
