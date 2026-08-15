import { reportAuthenticationLost } from './authentication-loss';

const DEFAULT_AUTHENTICATION_LOSS_STATUSES = [401] as const;

export function reportIfAuthenticationLost(
  response: Response,
  statuses: readonly number[] = DEFAULT_AUTHENTICATION_LOSS_STATUSES,
): Response {
  if (statuses.includes(response.status)) reportAuthenticationLost();
  return response;
}

export async function protectedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  authenticationLossStatuses: readonly number[] = DEFAULT_AUTHENTICATION_LOSS_STATUSES,
): Promise<Response> {
  const response = await globalThis.fetch(input, init);
  return reportIfAuthenticationLost(response, authenticationLossStatuses);
}
