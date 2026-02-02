/**
 * API utilities for checking backend provider availability
 */

export interface ProviderStatus {
    enabled: boolean;
    provider: string;
}

export interface ProvidersResponse {
    providers: ProviderStatus[];
    enabledCount: number;
    totalCount: number;
}

/**
 * Check which ASR providers are available on the backend
 */
export async function checkAvailableProviders(backendUrl: string): Promise<ProvidersResponse | null> {
    try {
        // Convert WebSocket URL to HTTP
        const httpUrl = backendUrl.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:');
        const response = await fetch(`${httpUrl}/providers`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            console.warn('Failed to check providers:', response.statusText);
            return null;
        }

        return await response.json();
    } catch (error) {
        console.warn('Could not check available providers:', error);
        return null;
    }
}

/**
 * Check if a specific provider is enabled
 */
export function isProviderEnabled(
    providersResponse: ProvidersResponse | null,
    providerName: string
): boolean {
    // If we haven't checked providers yet (null), return true to allow connection
    // This provides graceful fallback if backend check fails
    if (!providersResponse) return true;

    // Validate that providers array exists
    if (!providersResponse.providers || !Array.isArray(providersResponse.providers)) {
        console.warn('Invalid providers response format, allowing all providers');
        return true;
    }

    const provider = providersResponse.providers.find(
        p => p.provider.toLowerCase() === providerName.toLowerCase()
    );

    return provider?.enabled ?? false;
}
