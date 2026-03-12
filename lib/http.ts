export async function parseResponseJson<T>(response: Response, fallback: T): Promise<T> {
  const raw = await response.text();
  if (!raw || raw.trim().length === 0) {
    return fallback;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
