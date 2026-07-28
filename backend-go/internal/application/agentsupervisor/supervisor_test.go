package agentsupervisor

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"thai-transcriber-backend/internal/application/captionmoderation"
)

func TestSupervisorRejectsDuplicateWhileStarting(t *testing.T) {
	agent := newFakeAgent()
	supervisor := New(func(string, captionmoderation.Mode) Agent { return agent })

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

func TestSupervisorPreservesModeratedModeInStatus(t *testing.T) {
	agent := newFakeAgent()
	var factoryMode captionmoderation.Mode
	supervisor := New(func(_ string, mode captionmoderation.Mode) Agent {
		factoryMode = mode
		return agent
	})

	if err := supervisor.Start(context.Background(), "room-a", "google", captionmoderation.ModeModerated); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	waitForSignal(t, agent.started)

	if factoryMode != captionmoderation.ModeModerated {
		t.Fatalf("factory mode = %q, want moderated", factoryMode)
	}
	status := supervisor.Status()
	if len(status) != 1 || status[0].Mode != captionmoderation.ModeModerated {
		t.Fatalf("Status() = %#v, want moderated agent", status)
	}

	if err := supervisor.Stop("room-a", "google"); err != nil {
		t.Fatalf("Stop() error = %v", err)
	}
	waitForSignal(t, agent.finished)
}

func TestSupervisorDefaultsMissingModeToLive(t *testing.T) {
	agent := newFakeAgent()
	var factoryMode captionmoderation.Mode
	supervisor := New(func(_ string, mode captionmoderation.Mode) Agent {
		factoryMode = mode
		return agent
	})

	if err := supervisor.Start(context.Background(), "room-a", "google"); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	waitForSignal(t, agent.started)
	if factoryMode != captionmoderation.ModeLive {
		t.Fatalf("factory mode = %q, want live", factoryMode)
	}
	if err := supervisor.Stop("room-a", "google"); err != nil {
		t.Fatalf("Stop() error = %v", err)
	}
	waitForSignal(t, agent.finished)
}

func TestSupervisorStopsAgentWhileStarting(t *testing.T) {
	agent := newFakeAgent()
	supervisor := New(func(string, captionmoderation.Mode) Agent { return agent })

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
	supervisor := New(func(string, captionmoderation.Mode) Agent {
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
	supervisor := New(func(provider string, _ captionmoderation.Mode) Agent {
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
	supervisor := New(func(string, captionmoderation.Mode) Agent { return agent })

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
	supervisor := New(func(string, captionmoderation.Mode) Agent { return agent })

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
	supervisor := New(func(string, captionmoderation.Mode) Agent {
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
	started chan struct{}
}

func newCompletedFakeAgent() *completedFakeAgent {
	return &completedFakeAgent{started: make(chan struct{})}
}

func (a *completedFakeAgent) Start(context.Context, string) error {
	a.mu.Lock()
	a.running = true
	a.mu.Unlock()
	close(a.started)
	return nil
}

func (a *completedFakeAgent) Stop() {
	a.mu.Lock()
	a.running = false
	a.mu.Unlock()
}

func (a *completedFakeAgent) IsRunning() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.running
}
