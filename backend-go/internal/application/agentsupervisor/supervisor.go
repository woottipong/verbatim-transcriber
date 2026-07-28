// Package agentsupervisor owns the lifecycle of room transcription agents.
package agentsupervisor

import (
	"context"
	"errors"
	"fmt"
	"log"
	"sort"
	"sync"

	"thai-transcriber-backend/internal/application/captionmoderation"
)

var (
	ErrAgentAlreadyExists = errors.New("agent already running")
	ErrAgentNotFound      = errors.New("agent not running")
	ErrSupervisorClosed   = errors.New("agent supervisor is shutting down")
)

// Agent is the lifecycle behavior consumed by the supervisor.
type Agent interface {
	Start(ctx context.Context, roomName string) error
	Stop()
	IsRunning() bool
}

// Factory creates an agent for one provider and delivery mode.
type Factory func(provider string, mode captionmoderation.Mode) Agent

// Status describes a supervised room/provider agent.
type Status struct {
	Key       string
	Room      string
	Provider  string
	Mode      captionmoderation.Mode
	Running   bool
	Connected bool
}

type entry struct {
	key       string
	room      string
	provider  string
	mode      captionmoderation.Mode
	agent     Agent
	cancel    context.CancelFunc
	startDone chan struct{}
	connected bool
}

// Supervisor ensures a room has at most one agent for each provider.
type Supervisor struct {
	mu      sync.Mutex
	factory Factory
	agents  map[string]*entry
	closed  bool
}

func New(factory Factory) *Supervisor {
	if factory == nil {
		panic("agentsupervisor: factory is required")
	}
	return &Supervisor{
		factory: factory,
		agents:  make(map[string]*entry),
	}
}

// Start reserves the room/provider pair and starts its agent asynchronously.
func (s *Supervisor) Start(parent context.Context, room, provider string, requestedMode ...captionmoderation.Mode) error {
	key := agentKey(room, provider)
	mode := captionmoderation.ModeLive
	if len(requestedMode) > 0 {
		mode = requestedMode[0]
	}

	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return ErrSupervisorClosed
	}
	if existing, exists := s.agents[key]; exists {
		if !existing.connected || existing.agent.IsRunning() {
			s.mu.Unlock()
			return ErrAgentAlreadyExists
		}
		delete(s.agents, key)
	}

	agent := s.factory(provider, mode)
	if agent == nil {
		s.mu.Unlock()
		return errors.New("agent factory returned nil")
	}
	ctx, cancel := context.WithCancel(context.WithoutCancel(parent))
	current := &entry{
		key:       key,
		room:      room,
		provider:  provider,
		mode:      mode,
		agent:     agent,
		cancel:    cancel,
		startDone: make(chan struct{}),
	}
	s.agents[key] = current
	s.mu.Unlock()

	go s.start(ctx, current)
	return nil
}

// Stop removes and stops one room/provider agent, including an agent that is
// still connecting.
func (s *Supervisor) Stop(room, provider string) error {
	key := agentKey(room, provider)
	s.mu.Lock()
	current, exists := s.agents[key]
	if !exists {
		s.mu.Unlock()
		return ErrAgentNotFound
	}
	delete(s.agents, key)
	s.mu.Unlock()

	stopEntry(current)
	return nil
}

// StopRoom removes and stops every agent belonging to a room.
func (s *Supervisor) StopRoom(room string) {
	entries := s.takeEntries(func(current *entry) bool {
		return current.room == room
	})
	for _, current := range entries {
		stopEntry(current)
	}
}

// Status returns a stable snapshot of supervised agents. A reserved agent is
// reported as running so callers see it throughout the asynchronous start.
func (s *Supervisor) Status() []Status {
	s.mu.Lock()
	status := make([]Status, 0, len(s.agents))
	for key, current := range s.agents {
		if current.connected && !current.agent.IsRunning() {
			delete(s.agents, key)
			continue
		}
		status = append(status, Status{
			Key:       current.key,
			Room:      current.room,
			Provider:  current.provider,
			Mode:      current.mode,
			Running:   true,
			Connected: current.connected && current.agent.IsRunning(),
		})
	}
	s.mu.Unlock()

	sort.Slice(status, func(i, j int) bool {
		return status[i].Key < status[j].Key
	})
	return status
}

// Shutdown prevents new agents, stops all current agents, and waits for their
// startup goroutines to exit or for ctx to expire.
func (s *Supervisor) Shutdown(ctx context.Context) error {
	s.mu.Lock()
	if s.closed && len(s.agents) == 0 {
		s.mu.Unlock()
		return nil
	}
	s.closed = true
	entries := make([]*entry, 0, len(s.agents))
	for key, current := range s.agents {
		delete(s.agents, key)
		entries = append(entries, current)
	}
	s.mu.Unlock()

	done := make(chan struct{})
	go func() {
		var wg sync.WaitGroup
		wg.Add(len(entries))
		for _, current := range entries {
			go func(current *entry) {
				defer wg.Done()
				stopEntry(current)
				<-current.startDone
			}(current)
		}
		wg.Wait()
		close(done)
	}()

	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (s *Supervisor) start(ctx context.Context, current *entry) {
	err := current.agent.Start(ctx, current.room)
	if err == nil {
		s.mu.Lock()
		if s.agents[current.key] == current {
			current.connected = true
		}
		s.mu.Unlock()
		close(current.startDone)
		return
	}

	s.mu.Lock()
	if s.agents[current.key] == current {
		delete(s.agents, current.key)
	}
	s.mu.Unlock()
	close(current.startDone)

	if !errors.Is(err, context.Canceled) {
		log.Printf(
			"❌ [Agent] Failed to start %s agent in room %s: %v",
			current.provider,
			current.room,
			err,
		)
	}
}

func (s *Supervisor) takeEntries(matches func(*entry) bool) []*entry {
	s.mu.Lock()
	defer s.mu.Unlock()

	entries := make([]*entry, 0)
	for key, current := range s.agents {
		if matches(current) {
			delete(s.agents, key)
			entries = append(entries, current)
		}
	}
	return entries
}

func stopEntry(current *entry) {
	current.cancel()
	current.agent.Stop()
}

func agentKey(room, provider string) string {
	return fmt.Sprintf("%s-%s", room, provider)
}
