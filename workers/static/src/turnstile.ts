const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type TurnstileResult = "ok" | "failed" | "unavailable";

export async function verifyTurnstile(token: string, secret: string, fetchImpl: typeof fetch): Promise<TurnstileResult> {
  try {
    const response = await fetchImpl(VERIFY_URL, {
      method: "POST",
      body: new URLSearchParams({ secret, response: token }),
    });
    if (!response.ok) return "unavailable";
    const result = (await response.json()) as { success?: unknown };
    return result.success === true ? "ok" : "failed";
  } catch {
    return "unavailable";
  }
}
