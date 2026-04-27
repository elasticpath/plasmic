import type { EpTokenData } from "./cookies";

export async function resolveEpToken(
  clientId: string,
  host: string
): Promise<EpTokenData> {
  const url = `${host}/oauth/access_token`;
  const body = new URLSearchParams({
    grant_type: "implicit",
    client_id: clientId,
  });

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `EP OAuth failed (${response.status}): ${text}`
    );
  }

  const data = await response.json();

  return {
    accessToken: data.access_token,
    expires: data.expires,
    expiresIn: data.expires_in,
    tokenType: data.token_type,
    clientId,
    host,
  };
}
