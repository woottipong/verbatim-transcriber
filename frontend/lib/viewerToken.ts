export function shouldFallbackViewerToken(
    status: number,
    payload: unknown,
    hasFallbackEndpoint: boolean,
): boolean {
    if (!hasFallbackEndpoint || status !== 404) return false;
    if (!payload || typeof payload !== 'object') return true;
    return (payload as { code?: unknown }).code !== 'room_not_found';
}

export function buildLegacyViewerTokenRequest(roomName: string): Record<string, string | boolean> {
    return {
        identity: `viewer-${crypto.randomUUID()}`,
        roomName,
        canPublish: false,
        canSubscribe: true,
        canPublishData: false,
    };
}
