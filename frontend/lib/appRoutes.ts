export type AppPage = 'admin' | 'stream' | 'viewer' | 'caption-desk';

export interface AppRoute {
  page: AppPage;
  roomName: string;
  providerName: string;
  autoConnect: boolean;
}

export function parseAppRoute(hash: string): AppRoute {
  const normalizedHash = hash.startsWith('#') ? hash.slice(1) : hash;
  const [path, query = ''] = normalizedHash.split('?', 2);
  const params = new URLSearchParams(query);
  const roomName = params.get('room')?.trim() || '';
  const providerName = params.get('provider')?.trim().toLowerCase() || '';

  if (path === 'stream') {
    return { page: 'stream', roomName, providerName: '', autoConnect: false };
  }
  if (path === 'viewer') {
    return {
      page: 'viewer',
      roomName,
      providerName: '',
      autoConnect: params.get('autoconnect') === '1' && roomName.length > 0,
    };
  }
  if (path === 'caption-desk') {
    return { page: 'caption-desk', roomName, providerName, autoConnect: false };
  }
  return { page: 'admin', roomName: '', providerName: '', autoConnect: false };
}

export function buildStreamUrl(baseUrl: string, roomName: string): string {
  return buildRouteUrl(baseUrl, 'stream', roomName, false);
}

export function buildViewerUrl(baseUrl: string, roomName: string): string {
  return buildRouteUrl(baseUrl, 'viewer', roomName, Boolean(roomName));
}

export function buildCaptionDeskSessionKey(
  roomName: string,
  providerName: string,
): string {
  return `${roomName}:${providerName}`;
}

export function buildCaptionDeskUrl(
  baseUrl: string,
  roomName: string,
  providerName: string,
): string {
  const url = new URL(baseUrl);
  url.hash = '';
  const params = new URLSearchParams();
  if (roomName.trim()) params.set('room', roomName.trim());
  if (providerName.trim()) params.set('provider', providerName.trim().toLowerCase());
  url.hash = `caption-desk?${params.toString()}`;
  return url.toString();
}

function buildRouteUrl(baseUrl: string, page: AppPage, roomName: string, autoConnect: boolean): string {
  const url = new URL(baseUrl);
  url.hash = '';

  const params = new URLSearchParams();
  const normalizedRoom = roomName.trim();
  if (normalizedRoom) params.set('room', normalizedRoom);
  if (page === 'viewer' && autoConnect && normalizedRoom) params.set('autoconnect', '1');

  const query = params.toString();
  url.hash = `${page}${query ? `?${query}` : ''}`;
  return url.toString();
}
