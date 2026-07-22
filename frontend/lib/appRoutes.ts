export type AppPage = 'admin' | 'stream' | 'viewer';

export interface AppRoute {
  page: AppPage;
  roomName: string;
  autoConnect: boolean;
}

export function parseAppRoute(hash: string): AppRoute {
  const normalizedHash = hash.startsWith('#') ? hash.slice(1) : hash;
  const [path, query = ''] = normalizedHash.split('?', 2);
  const params = new URLSearchParams(query);
  const roomName = params.get('room')?.trim() || '';

  if (path === 'stream') {
    return { page: 'stream', roomName, autoConnect: false };
  }
  if (path === 'viewer') {
    return {
      page: 'viewer',
      roomName,
      autoConnect: params.get('autoconnect') === '1' && roomName.length > 0,
    };
  }
  return { page: 'admin', roomName: '', autoConnect: false };
}

export function buildStreamUrl(baseUrl: string, roomName: string): string {
  return buildRouteUrl(baseUrl, 'stream', roomName, false);
}

export function buildViewerUrl(baseUrl: string, roomName: string): string {
  return buildRouteUrl(baseUrl, 'viewer', roomName, Boolean(roomName));
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
