export function shouldAutoConnectViewer(input: {
  autoConnect: boolean;
  roomName: string;
  attempted: boolean;
  connected: boolean;
}): boolean {
  return input.autoConnect
    && input.roomName.trim().length > 0
    && !input.attempted
    && !input.connected;
}
