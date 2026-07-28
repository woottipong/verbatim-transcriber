# Domain Glossary

## Room

A named LiveKit session where audio sources, transcript viewers, and room agents meet.

## Room Agent

A participant that listens to one room through one configured transcription provider and publishes transcript results back to that room.

## Room Agent Supervisor

The operational owner of room agents. It ensures that a room has at most one room agent for each provider and coordinates their start, stop, room removal, and application shutdown.

## Room Operations

The capabilities used to provision, inspect, and remove rooms and their participants. A failed participant lookup means room details are unavailable; it must not be represented as an empty room.

## Transcript Feed Access Policy

The single authorization policy for issuing and validating read-only transcript feed access. It binds a grant to the room name, LiveKit room identity, transcript generation, and optional provider scope.
