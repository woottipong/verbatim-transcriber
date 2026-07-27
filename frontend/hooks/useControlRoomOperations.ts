import { useCallback, useEffect, useRef, useState } from 'react';
import {
    type AgentStatus,
    type RoomDetails,
    type RunningAgent,
    type TranscriptTokenResponse,
    createRoom as createRoomRequest,
    createTranscriptToken,
    deleteRoom as deleteRoomRequest,
    fetchAgentStatus,
    fetchDetailedRooms,
    removeRoomParticipant,
    startRoomAgent,
    stopRoomAgent,
} from '../lib/api';
import {
    describeTranscriptFeedError,
    isTranscriptTokenResponse,
    isTranscriptLinkUsable,
} from '../lib/adminRooms';
import type { AgentProvider } from '../lib/providers';

interface TranscriptLinkState {
    roomName: string;
    provider: AgentProvider;
    response: TranscriptTokenResponse;
}

interface TranscriptFeedErrorState {
    roomName: string;
    message: string;
}

interface UseControlRoomOperationsOptions {
    backendUrl: string;
    onRoomsError: (message: string) => void;
}

export function useControlRoomOperations({
    backendUrl,
    onRoomsError,
}: UseControlRoomOperationsOptions) {
    const [rooms, setRooms] = useState<RoomDetails[]>([]);
    const [agentStatus, setAgentStatus] = useState<AgentStatus>({ count: 0, agents: [] });
    const [agentStatusError, setAgentStatusError] = useState<string | null>(null);
    const [isLoadingRooms, setIsLoadingRooms] = useState(false);
    const [isCreatingRoom, setIsCreatingRoom] = useState(false);
    const [isStartingAgent, setIsStartingAgent] = useState(false);
    const [stoppingAgentKey, setStoppingAgentKey] = useState<string | null>(null);
    const [isRemovingParticipant, setIsRemovingParticipant] = useState(false);
    const [isDeletingRoom, setIsDeletingRoom] = useState(false);
    const [generatingTranscriptProvider, setGeneratingTranscriptProvider] = useState<AgentProvider | null>(null);
    const [transcriptLinks, setTranscriptLinks] = useState<Partial<Record<AgentProvider, TranscriptLinkState>>>({});
    const [transcriptFeedErrors, setTranscriptFeedErrors] = useState<Partial<Record<AgentProvider, TranscriptFeedErrorState>>>({});
    const roomsRequestRef = useRef(0);
    const agentStatusRequestRef = useRef(0);

    const refreshRooms = useCallback(async () => {
        const requestId = ++roomsRequestRef.current;
        setIsLoadingRooms(true);
        try {
            const nextRooms = await fetchDetailedRooms(backendUrl);
            if (requestId === roomsRequestRef.current) setRooms(nextRooms);
        } catch (error) {
            if (requestId === roomsRequestRef.current) {
                onRoomsError(error instanceof Error ? error.message : 'Failed to load rooms');
            }
        } finally {
            if (requestId === roomsRequestRef.current) setIsLoadingRooms(false);
        }
    }, [backendUrl, onRoomsError]);

    const refreshAgentStatus = useCallback(async () => {
        const requestId = ++agentStatusRequestRef.current;
        try {
            const nextStatus = await fetchAgentStatus(backendUrl);
            if (requestId !== agentStatusRequestRef.current) return;
            setAgentStatus(nextStatus);
            setAgentStatusError(null);
        } catch (error) {
            if (requestId !== agentStatusRequestRef.current) return;
            console.warn('[Admin] Agent status unavailable:', error);
            setAgentStatusError('Could not refresh provider status. Showing the last known state.');
        }
    }, [backendUrl]);

    useEffect(() => {
        let disposed = false;
        let nextPoll: number | undefined;
        const scheduleNextPoll = () => {
            if (!disposed) nextPoll = window.setTimeout(poll, 5000);
        };
        const poll = async () => {
            if (!document.hidden) {
                await Promise.allSettled([refreshRooms(), refreshAgentStatus()]);
            }
            scheduleNextPoll();
        };
        const handleVisibilityChange = () => {
            if (document.hidden || disposed) return;
            if (nextPoll !== undefined) window.clearTimeout(nextPoll);
            void poll();
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        void poll();
        return () => {
            disposed = true;
            roomsRequestRef.current++;
            agentStatusRequestRef.current++;
            if (nextPoll !== undefined) window.clearTimeout(nextPoll);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [refreshAgentStatus, refreshRooms]);

    const createRoom = useCallback(async (name: string): Promise<RoomDetails> => {
        setIsCreatingRoom(true);
        try {
            const room = await createRoomRequest(backendUrl, name);
            const normalizedRoom = { ...room, participants: room.participants || [] };
            setRooms(current => [
                ...current.filter(existing => existing.name !== room.name),
                normalizedRoom,
            ]);
            return normalizedRoom;
        } finally {
            setIsCreatingRoom(false);
        }
    }, [backendUrl]);

    const startAgent = useCallback(async (roomName: string, provider: AgentProvider): Promise<void> => {
        setIsStartingAgent(true);
        try {
            await startRoomAgent(backendUrl, roomName, provider);
            await refreshAgentStatus();
        } finally {
            setIsStartingAgent(false);
        }
    }, [backendUrl, refreshAgentStatus]);

    const stopAgent = useCallback(async (agent: RunningAgent): Promise<void> => {
        setStoppingAgentKey(agent.key);
        try {
            await stopRoomAgent(backendUrl, agent.room, agent.provider);
            await refreshAgentStatus();
        } finally {
            setStoppingAgentKey(current => current === agent.key ? null : current);
        }
    }, [backendUrl, refreshAgentStatus]);

    const removeParticipant = useCallback(async (roomName: string, identity: string): Promise<void> => {
        setIsRemovingParticipant(true);
        try {
            await removeRoomParticipant(backendUrl, roomName, identity);
            await refreshRooms();
        } finally {
            setIsRemovingParticipant(false);
        }
    }, [backendUrl, refreshRooms]);

    const deleteRoom = useCallback(async (roomName: string): Promise<void> => {
        setIsDeletingRoom(true);
        try {
            await deleteRoomRequest(backendUrl, roomName);
            setRooms(current => current.filter(room => room.name !== roomName));
            setTranscriptLinks(current => removeRoomEntries(current, roomName));
            setTranscriptFeedErrors(current => removeRoomEntries(current, roomName));
        } finally {
            setIsDeletingRoom(false);
        }
    }, [backendUrl]);

    const generateTranscriptLink = useCallback(async (
        roomName: string,
        provider: AgentProvider,
    ): Promise<TranscriptTokenResponse> => {
        setGeneratingTranscriptProvider(provider);
        setTranscriptFeedErrors(current => omitProvider(current, provider));
        try {
            const response = await createTranscriptToken(backendUrl, roomName, provider);
            if (!isTranscriptTokenResponse(response) || response.provider !== provider) {
                throw new Error('Backend returned an invalid transcript link');
            }
            setTranscriptLinks(current => ({
                ...current,
                [provider]: { roomName, provider, response },
            }));
            return response;
        } catch (error) {
            const message = describeTranscriptFeedError(
                error instanceof Error ? error.message : 'Failed to generate transcript link',
            );
            setTranscriptFeedErrors(current => ({
                ...current,
                [provider]: { roomName, message },
            }));
            throw new Error(message);
        } finally {
            setGeneratingTranscriptProvider(current => current === provider ? null : current);
        }
    }, [backendUrl]);

    const activeTranscriptLink = useCallback((
        roomName: string,
        provider: AgentProvider,
    ): TranscriptTokenResponse | null => {
        const link = transcriptLinks[provider];
        return link?.roomName === roomName
            && link.provider === provider
            && isTranscriptTokenResponse(link.response)
            && isTranscriptLinkUsable(link.response)
            ? link.response
            : null;
    }, [transcriptLinks]);

    return {
        rooms,
        agentStatus,
        agentStatusError,
        isLoadingRooms,
        isCreatingRoom,
        isStartingAgent,
        stoppingAgentKey,
        isRemovingParticipant,
        isDeletingRoom,
        generatingTranscriptProvider,
        transcriptFeedErrors,
        refreshRooms,
        refreshAgentStatus,
        createRoom,
        startAgent,
        stopAgent,
        removeParticipant,
        deleteRoom,
        generateTranscriptLink,
        activeTranscriptLink,
    };
}

function omitProvider<T>(
    current: Partial<Record<AgentProvider, T>>,
    provider: AgentProvider,
): Partial<Record<AgentProvider, T>> {
    const next = { ...current };
    delete next[provider];
    return next;
}

function removeRoomEntries<T extends { roomName: string }>(
    current: Partial<Record<AgentProvider, T>>,
    roomName: string,
): Partial<Record<AgentProvider, T>> {
    const next = { ...current };
    for (const provider of Object.keys(next) as AgentProvider[]) {
        if (next[provider]?.roomName === roomName) delete next[provider];
    }
    return next;
}
