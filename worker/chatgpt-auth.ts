export interface AuthorAccount {
  readonly id: string;
  readonly email: string;
}

const USER_ID_HEADER = 'oai-authenticated-user-id';
const USER_EMAIL_HEADER = 'oai-authenticated-user-email';

export function authorAccountFrom(request: Request): AuthorAccount | null {
  const id = request.headers.get(USER_ID_HEADER)?.trim() ?? '';
  const email = request.headers.get(USER_EMAIL_HEADER)?.trim() ?? '';
  if (id.length === 0 || email.length === 0) return null;
  return { id, email };
}

export function requireSameOriginMutation(request: Request): boolean {
  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;
  const origin = request.headers.get('origin');
  return origin === new URL(request.url).origin
    && request.headers.get('x-specular-intent') === 'mutate';
}

export const CHATGPT_SIGN_IN_URL = '/signin-with-chatgpt?return_to=%2F';
export const CHATGPT_SIGN_OUT_URL = '/signout-with-chatgpt?return_to=%2F';
