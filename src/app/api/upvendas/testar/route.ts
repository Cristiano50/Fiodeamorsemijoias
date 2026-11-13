import { erro, ok } from "@/lib/api";
import { testarConexao } from "@/lib/upvendas";

export async function POST() {
  try {
    return ok(await testarConexao());
  } catch (e) {
    return erro(e, 502);
  }
}
