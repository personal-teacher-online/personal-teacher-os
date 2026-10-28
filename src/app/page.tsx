import { redirect } from "next/navigation";

// O proxy redireciona "/" pelo papel (ou para /login). Fallback defensivo.
export default function Home() {
  redirect("/login");
}
