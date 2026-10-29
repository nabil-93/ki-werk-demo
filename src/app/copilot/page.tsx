// Der Copilot heißt jetzt „KI-Werksexperte“ – alte Links (/copilot, /copilot?modus=telefon) führen dorthin.
import { redirect } from "next/navigation";

export default async function CopilotRedirect({ searchParams }: { searchParams: Promise<{ modus?: string }> }) {
  const { modus } = await searchParams;
  redirect(`/werksexperte${modus === "telefon" ? "?modus=telefon" : ""}`);
}
