import { cookies } from "next/headers";
import { type Lang } from "./translations";

/** Read the lang cookie from the request — works in Server Components and Route Handlers */
export async function getLang(): Promise<Lang> {
  const store = await cookies();
  const val = store.get("lang")?.value;
  return val === "ja" ? "ja" : "en";
}
