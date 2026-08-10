package agentsupervisor

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

func TestSupervisorRejectsDuplicateWhileStarting(t *testing.T) {
	agent := newFakeAgent()
	supervisor := New(func(string) Agent { return agent })

	if err := supervisor.Start(context.Background(), "room-a", "google"); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	waitForSignal(t, agent.started)

	if err := supervisor.Start(context.Background(), "room-a", "google"); !errors.Is(err, ErrAgentAlreadyExists) {
		t.Fatalf("duplicate Start() error = %v, want %v", err, ErrAgentAlreadyExists)
	}

	if err := supervisor.Stop("room-a", "google"); err != nil {
		t.Fatalf("Stop() error = %v", err)
	}
	waitForSignal(t, agent.finished)
}

func TestSupervisorStopsAgentWhileStarting(t *testing.T) {
	agent := newFakeAgent()
	supervisor := New(func(string) Agent { return agent })

	if err := supervisor.Start(context.Background(), "room-a", "google"); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	waitForSignal(t, agent.started)

	if err := supervisor.Stop("room-a", "google"); err != nil {
		t.Fatalf("Stop() error = %v", err)
	}
	waitForSignal(t, agent.finished)

	if got := agent.stopCount(); got != 1 {
		t.Fatalf("Stop() calls = %d, want 1", got)
	}
	if got := supervisor.Status(); len(got) != 0 {
		t.Fatalf("Status() = %#v, want no agents", got)
	}
}

func TestSupervisorStaleStartCompletionDoesNotRemoveReplacement(t *testing.T) {
	first := newFakeAgent()
	second := newFakeAgent()
	var factoryMu sync.Mutex
	factoryCalls := 0
	supervisor := New(func(string) Agent {
		factoryMu.Lock()
		defer factoryMu.Unlock()
		factoryCalls++
		if factoryCalls == 1 {
			return first
		}
		return second
	})

	if err := supervisor.Start(context.Background(), "room-a", "google"); err != nil {
		t.Fatalf("first Start() error = %v", err)
	}
	waitForSignal(t, first.started)
	if err := supervisor.Stop("room-a", "google"); err != nil {
		t.Fatalf("first Stop() error = %v", err)
	}

	if err := supervisor.Start(context.Background(), "room-a", "google"); err != nil {
		t.Fatalf("replacement Start() error = %v", err)
	}
	waitForSignal(t, second.started)
	waitForSignal(t, first.finished)

	status := supervisor.Status()
	if len(status) != 1 || status[0].Room != "room-a" || status[0].Provider != "google" {
		t.Fatalf("Status() = %#v, want replacement agent", status)
	}

	if err := supervisor.Stop("room-a", "google"); err != nil {
		t.Fatalf("replacement Stop() error = %v", err)
	}
	waitForSignal(t, second.finished)
}

func TestSupervisorStopRoomStopsEveryProvider(t *testing.T) {
	google := newFakeAgent()
	gemini := newFakeAgent()
	supervisor := New(func(provider string) Agent {
		if provider == "google" {
			return google
		}
		return gemini
	})

	if err := supervisor.Start(context.Background(), "room-a", "google"); err != nil {
		t.Fatal(err)
	}
	if err := supervisor.Start(context.Background(), "room-a", "gemini"); err != nil {
		t.Fatal(err)
	}
	waitForSignal(t, google.started)
	waitForSignal(t, gemini.started)

	supervisor.StopRoom("room-a")
	waitForSignal(t, google.finished)
	waitForSignal(t, gemini.finished)

	if got := supervisor.Status(); len(got) != 0 {
		t.Fatalf("Status() = %#v, want no agents", got)
	}
}

func TestSupervisorShutdownStopsAndWaitsForAgents(t *testing.T) {
	agent := newFakeAgent()
	agent.blockStop = make(chan struct{})
	agent.stopStarted = make(chan struct{})
	supervisor := New(func(string) Agent { return agent })

	if err := supervisor.Start(context.Background(), "room-a", "google"); err != nil {
		t.Fatal(err)
	}
	waitForSignal(t, agent.started)

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	shutdownDone := make(chan error, 1)
	go func() {
		shutdownDone <- supervisor.Shutdown(ctx)
	}()

	waitForSignal(t, agent.stopStarted)
	select {
	case err := <-shutdownDone:
		t.Fatalf("Shutdown() returned before Stop completed: %v", err)
	default:
	}

	close(agent.blockStop)
	if err := <-shutdownDone; err != nil {
		t.Fatalf("Shutdown() error = %v", err)
	}
	waitForSignal(t, agent.finished)
}

func TestSupervisorShutdownHonorsContext(t *testing.T) {
	agent := newFakeAgent()
	agent.blockStop = make(chan struct{})
	agent.stopStarted = make(chan struct{})
	supervisor := New(func(string) Agent { return agent })

	if err := supervisor.Start(context.Background(), "room-a", "google"); err != nil {
		t.Fatal(err)
	}
	waitForSignal(t, agent.started)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := supervisor.Shutdown(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("Shutdown() error = %v, want context cancellation", err)
	}
	close(agent.blockStop)
	waitForSignal(t, agent.finished)
}

func TestSupervisorRemovesAgentThatStoppedAfterConnecting(t *testing.T) {
	agent := newCompletedFakeAgent()
	replacement := newCompletedFakeAgent()
	factoryCalls := 0
	supervisor := New(func(string) Agent {
		factoryCalls++
		if factoryCalls == 1 {
			return agent
		}
		return replacement
	})

	if err := supervisor.Start(context.Background(), "room-a", "google"); err != nil {
		t.Fatal(err)
	}
	waitForSignal(t, agent.started)
	if got := supervisor.Status(); len(got) != 1 {
		t.Fatalf("Status() = %#v, want connected agent", got)
	}

	agent.Stop()
	if got := supervisor.Status(); len(got) != 0 {
		t.Fatalf("Status() = %#v, want stopped agent removed", got)
	}
	if err := supervisor.Start(context.Background(), "room-a", "google"); err != nil {
		t.Fatalf("replacement Start() error = %v", err)
	}
	waitForSignal(t, replacement.started)
	if err := supervisor.Stop("room-a", "google"); err != nil {
		t.Fatalf("replacement Stop() error = %v", err)
	}
}

// Replacing an agent that stopped on its own must release it, not merely drop
// it from tracking: an untracked agent still holding a live context and room
// connection would sit in the room alongside its replacement.
func TestSupervisorReleasesReplacedAgent(t *testing.T) {
	stopped := newCompletedFakeAgent()
	replacement := newCompletedFakeAgent()
	agents := []Agent{stopped, replacement}
	index := 0
	supervisor := New(func(string) Agent {
		agent := agents[index]
		index++
		return agent
	})

	if err := supervisor.Start(context.Background(), "room-a", "google"); err != nil {
		t.Fatal(err)
	}
	waitForSignal(t, stopped.started)
	stopped.Stop()

	if err := supervisor.Start(context.Background(), "room-a", "google"); err != nil {
		t.Fatalf("replacement Start() error = %v", err)
	}
	waitForSignal(t, replacement.started)

	if got := stopped.stopCount(); got < 2 {
		t.Fatalf("replaced agent Stop() calls = %d, want the supervisor to stop it too", got)
	}
	if err := stopped.contextErr(); err == nil {
		t.Fatal("replaced agent context was never cancelled")
	}
	if err := replacement.contextErr(); err != nil {
		t.Fatalf("replacement context = %v, want live", err)
	}
}

// Status reaps agents that stopped on their own; reaping must release them for
// the same reason replacing does.
func TestSupervisorReleasesAgentReapedByStatus(t *testing.T) {
	agent := newCompletedFakeAgent()
	supervisor := New(func(string) Agent { return agent })

	if err := supervisor.Start(context.Background(), "room-a", "google"); err != nil {
		t.Fatal(err)
	}
	waitForSignal(t, agent.started)
	agent.Stop()

	if got := supervisor.Status(); len(got) != 0 {
		t.Fatalf("Status() = %#v, want stopped agent removed", got)
	}
	if got := agent.stopCount(); got < 2 {
		t.Fatalf("reaped agent Stop() calls = %d, want the supervisor to stop it too", got)
	}
	if err := agent.contextErr(); err == nil {
		t.Fatal("reaped agent context was never cancelled")
	}
}

// Room names may contain the same separator once used to join room and
// provider into a key, so distinct pairs must never share a map entry.
func TestSupervisorKeysDoNotCollideAcrossRoomAndProvider(t *testing.T) {
	first := newCompletedFakeAgent()
	second := newCompletedFakeAgent()
	agents := []Agent{first, second}
	index := 0
	supervisor := New(func(string) Agent {
		agent := agents[index]
		index++
		return agent
	})

	if err := supervisor.Start(context.Background(), "room-a", "google"); err != nil {
		t.Fatal(err)
	}
	waitForSignal(t, first.started)
	if err := supervisor.Start(context.Background(), "room", "a-google"); err != nil {
		t.Fatalf("second pair rejected as a duplicate: %v", err)
	}
	waitForSignal(t, second.started)

	if got := supervisor.Status(); len(got) != 2 {
		t.Fatalf("Status() = %#v, want both pairs tracked separately", got)
	}
}

type fakeAgent struct {
	started     chan struct{}
	finished    chan struct{}
	result      chan error
	stopOnce    sync.Once
	mu          sync.Mutex
	stops       int
	blockStop   chan struct{}
	stopStarted chan struct{}
	running     bool
}

func newFakeAgent() *fakeAgent {
	return &fakeAgent{
		started:  make(chan struct{}),
		finished: make(chan struct{}),
		result:   make(chan error, 1),
	}
}

func (a *fakeAgent) Start(ctx context.Context, _ string) error {
	a.mu.Lock()
	a.running = true
	a.mu.Unlock()
	close(a.started)
	defer func() {
		a.mu.Lock()
		a.running = false
		a.mu.Unlock()
		close(a.finished)
	}()
	select {
	case err := <-a.result:
		return err
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (a *fakeAgent) Stop() {
	a.mu.Lock()
	a.stops++
	a.running = false
	a.mu.Unlock()
	if a.blockStop != nil {
		if a.stopStarted != nil {
			close(a.stopStarted)
		}
		<-a.blockStop
	}
	a.stopOnce.Do(func() {
		a.result <- context.Canceled
	})
}

func (a *fakeAgent) IsRunning() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.running
}

func (a *fakeAgent) stopCount() int {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.stops
}

func waitForSignal(t *testing.T, signal <-chan struct{}) {
	t.Helper()
	select {
	case <-signal:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for lifecycle signal")
	}
}

type completedFakeAgent struct {
	mu      sync.Mutex
	running bool
	stops   int
	ctx     context.Context
	started chan struct{}
}

func newCompletedFakeAgent() *completedFakeAgent {
	return &completedFakeAgent{started: make(chan struct{})}
}

func (a *completedFakeAgent) Start(ctx context.Context, _ string) error {
	a.mu.Lock()
	a.running = true
	a.ctx = ctx
	a.mu.Unlock()
	close(a.started)
	return nil
}

func (a *completedFakeAgent) Stop() {
	a.mu.Lock()
	a.running = false
	a.stops++
	a.mu.Unlock()
}

func (a *completedFakeAgent) stopCount() int {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.stops
}

// contextErr reports whether the supervisor cancelled the context it handed to
// this agent, which is the observable signal that the entry was released
// rather than dropped from tracking and left running.
func (a *completedFakeAgent) contextErr() error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.ctx == nil {
		return nil
	}
	return a.ctx.Err()
}

func (a *completedFakeAgent) IsRunning() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.running
}
