import { client } from './api-client/client.gen';
import { getApiBaseUrl } from './config/env';
import { getAccessToken, refreshToken, notifyAuthFailure } from './utils/tokenService';

export function configureApiClient() {
  // The generated SDK URLs already include the /api prefix (e.g. /api/auth/login),
  // so baseUrl should be empty for web (Vite proxy handles /api) or the server origin for Electron.
  const baseUrl = getApiBaseUrl();
  // Strip the /api suffix since it's already in the generated paths
  const clientBaseUrl = baseUrl.endsWith('/api') ? baseUrl.slice(0, -4) : baseUrl;
  client.setConfig({ baseUrl: clientBaseUrl });

  client.interceptors.request.use((request) => {
    const token = getAccessToken();
    if (token) {
      request.headers.set('Authorization', `Bearer ${token}`);
    }
    return request;
  });

  client.interceptors.response.use(async (response, request) => {
    if (response.status === 401) {
      // Don't intercept 401s from auth endpoints — those mean "bad credentials",
      // not "expired token". The old RTK Query code used a separate base query
      // without this interceptor for login/register/refresh.
      const url = new URL(request.url, window.location.origin);
      const isAuthEndpoint = url.pathname.startsWith('/api/auth/');
      if (isAuthEndpoint) {
        return response;
      }

      const newToken = await refreshToken();
      if (newToken) {
        // Retry the original request with the new token
        const retryRequest = request.clone();
        retryRequest.headers.set('Authorization', `Bearer ${newToken}`);
        return fetch(retryRequest);
      }

      // Refresh failed — notify the auth layer (AuthGate) to handle cleanup
      // and redirect. Don't perform side effects here (navigation, socket
      // teardown) — that's the UI layer's responsibility.
      const publicPrefixes = ['/login', '/register', '/join', '/onboarding'];
      const currentPath = window.location.hash.replace('#', '') || '/';
      const isPublicRoute = publicPrefixes.some(p => currentPath === p || currentPath.startsWith(p + '/'));
      if (!isPublicRoute) {
        notifyAuthFailure();
      }
    }
    return response;
  });
}
