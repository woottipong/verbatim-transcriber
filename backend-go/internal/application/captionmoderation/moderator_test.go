package captionmoderation

import (
	"errors"
	"fmt"
	"testing"
	"time"
)

func TestModeratorReplacesDraftAndKeepsFinalsInOrder(t *testing.T) {
	moderator := New("google", time.Now)

	moderator.Ingest(SourceSegment{
		ID: "google-1", Provider: "google", Text: "ผู้ป่วย", Sequence: 1,
	})
	snapshot := moderator.Snapshot()
	if snapshot.Draft == nil || snapshot.Draft.Text != "ผู้ป่วย" {
		t.Fatalf("first Draft = %#v", snapshot.Draft)
	}

	moderator.Ingest(SourceSegment{
		ID: "google-1", Provider: "google", Text: "ผู้ป่วยมีอาการ", Sequence: 2,
	})
	snapshot = moderator.Snapshot()
	if snapshot.Draft == nil || snapshot.Draft.Text != "ผู้ป่วยมีอาการ" {
		t.Fatalf("revised Draft = %#v", snapshot.Draft)
	}

	moderator.Ingest(SourceSegment{
		ID: "google-1", Provider: "google", Text: "ผู้ป่วยมีอาการ", IsFinal: true, Sequence: 3,
	})
	moderator.Ingest(SourceSegment{
		ID: "google-2", Provider: "google", Text: "เจ็บหน้าอก", IsFinal: true, Sequence: 4,
	})
	snapshot = moderator.Snapshot()

	if snapshot.Draft != nil {
		t.Fatalf("Draft remained after matching final: %#v", snapshot.Draft)
	}
	if got, want := pendingIDs(snapshot), []string{"google-1", "google-2"}; !equalStrings(got, want) {
		t.Fatalf("pending IDs = %v, want %v", got, want)
	}
}

func TestModeratorInterimModeKeepsBacklogAndLatestDraft(t *testing.T) {
	moderator := New("google", time.Now)
	ingestFinals(moderator, "google-1", "google-2", "google-3")

	snapshot := moderator.SetUseInterim(true)
	if got, want := pendingIDs(snapshot), []string{"google-1", "google-2", "google-3"}; !equalStrings(got, want) {
		t.Fatalf("pending after interim mode = %v, want %v", got, want)
	}
	moderator.Ingest(SourceSegment{
		ID: "google-4", Provider: "google", Text: "ข้อความสด", Sequence: 4,
	})
	moderator.Ingest(SourceSegment{
		ID: "google-4", Provider: "google", Text: "ข้อความ final", IsFinal: true, Sequence: 5,
	})
	moderator.Ingest(SourceSegment{
		ID: "google-5", Provider: "google", Text: "ข้อความสดใหม่", Sequence: 6,
	})
	snapshot = moderator.Snapshot()
	if got, want := pendingIDs(snapshot), []string{"google-1", "google-2", "google-3", "google-4"}; !equalStrings(got, want) {
		t.Fatalf("pending snapshot = %v, want %v", got, want)
	}
	if snapshot.Draft == nil || snapshot.Draft.ID != "google-5" {
		t.Fatalf("latest draft = %#v", snapshot.Draft)
	}
}

func TestModeratorPublishesAccumulatedFinalsAndDraftWithRemainder(t *testing.T) {
	moderator := New("google", time.Now)
	moderator.SetUseInterim(true)
	ingestFinals(moderator, "google-1", "google-2")
	moderator.Ingest(SourceSegment{
		ID: "google-3", Provider: "google", Text: "ข้อความสด", Sequence: 3,
	})

	_, _, err := moderator.Publish(PublishCommand{
		RequestID: "request-accumulated", Provider: "google",
		SourceSegmentIDs: []string{"google-1", "google-2", "google-3"},
		Text:             "ส่วนที่เผยแพร่",
		RemainingText:    "ส่วนที่เหลือ",
	})
	if err != nil {
		t.Fatalf("Publish(accumulated) error = %v", err)
	}
	snapshot := moderator.Snapshot()
	if snapshot.Draft != nil {
		t.Fatalf("draft remained after publish: %#v", snapshot.Draft)
	}
	if len(snapshot.Pending) != 1 || snapshot.Pending[0].ID != "google-3" ||
		snapshot.Pending[0].Text != "ส่วนที่เหลือ" {
		t.Fatalf("remaining pending = %#v", snapshot.Pending)
	}
}

func TestModeratorIgnoresOtherProvider(t *testing.T) {
	moderator := New("google", time.Now)
	accepted := moderator.Ingest(SourceSegment{
		ID: "gemini-1", Provider: "gemini", Text: "ไม่ควรเข้า", IsFinal: true, Sequence: 1,
	})
	if accepted {
		t.Fatal("other provider was accepted")
	}
	snapshot := moderator.Snapshot()
	if snapshot.Draft != nil || len(snapshot.Pending) != 0 {
		t.Fatalf("other provider changed snapshot: %#v", snapshot)
	}
}

func TestModeratorBoundsPendingSegmentsAtFiveHundred(t *testing.T) {
	moderator := New("google", time.Now)
	for index := 1; index <= 501; index++ {
		moderator.Ingest(SourceSegment{
			ID:       fmt.Sprintf("google-%d", index),
			Provider: "google",
			Text:     fmt.Sprintf("ข้อความ %d", index),
			IsFinal:  true,
			Sequence: uint64(index),
		})
	}

	snapshot := moderator.Snapshot()
	if got, want := len(snapshot.Pending), 500; got != want {
		t.Fatalf("pending length = %d, want %d", got, want)
	}
	if got, want := snapshot.Pending[0].ID, "google-2"; got != want {
		t.Fatalf("oldest pending ID = %q, want %q", got, want)
	}
}

func TestModeratorStartReviewWindowKeepsActiveDraftAndDropsPreJoinFinals(t *testing.T) {
	moderator := New("google", time.Now)
	ingestFinals(moderator, "google-1", "google-2")
	moderator.Ingest(SourceSegment{
		ID: "google-3", Provider: "google", Text: "draft", Sequence: 3,
	})

	snapshot := moderator.StartReviewWindow()
	if snapshot.Draft == nil || snapshot.Draft.ID != "google-3" || snapshot.Draft.Text != "draft" {
		t.Fatalf("review window Draft = %#v, want active google-3 Draft", snapshot.Draft)
	}
	if len(snapshot.Pending) != 0 {
		t.Fatalf("review window pending = %#v, want no pre-join finals", snapshot.Pending)
	}

	moderator.Ingest(SourceSegment{
		ID: "google-4", Provider: "google", Text: "new final", IsFinal: true, Sequence: 4,
	})
	snapshot = moderator.Snapshot()
	if got, want := pendingIDs(snapshot), []string{"google-4"}; !equalStrings(got, want) {
		t.Fatalf("post-join pending = %v, want %v", got, want)
	}
}

func TestModeratorPublishesPendingPrefix(t *testing.T) {
	now := time.Date(2026, 7, 28, 10, 0, 0, 0, time.UTC)
	moderator := New("google", func() time.Time { return now })
	ingestFinals(moderator, "google-1", "google-2", "google-3")

	publication, replayed, err := moderator.Publish(PublishCommand{
		RequestID:        "request-1",
		Provider:         "google",
		SourceSegmentIDs: []string{"google-1", "google-2"},
		Text:             "ข้อความที่ตรวจแล้ว",
	})
	if err != nil {
		t.Fatalf("Publish() error = %v", err)
	}
	if replayed {
		t.Fatal("first Publish() reported replay")
	}
	if publication.ID == "" || publication.PublishedAt != now {
		t.Fatalf("publication metadata = %#v", publication)
	}
	if got, want := publication.SourceSegmentIDs, []string{"google-1", "google-2"}; !equalStrings(got, want) {
		t.Fatalf("publication source IDs = %v, want %v", got, want)
	}
	if got, want := pendingIDs(moderator.Snapshot()), []string{"google-3"}; !equalStrings(got, want) {
		t.Fatalf("remaining pending IDs = %v, want %v", got, want)
	}
}

func TestModeratorPreservesOperatorFormatting(t *testing.T) {
	moderator := New("google", time.Now)
	ingestFinals(moderator, "google-1")
	formatted := "  บรรทัดแรก\\n  บรรทัดถัดไป  "

	publication, _, err := moderator.Publish(PublishCommand{
		RequestID:        "request-formatted",
		Provider:         "google",
		SourceSegmentIDs: []string{"google-1"},
		Text:             formatted,
	})
	if err != nil {
		t.Fatalf("Publish() error = %v", err)
	}
	if publication.Text != formatted {
		t.Fatalf("publication text = %q, want %q", publication.Text, formatted)
	}
}

func TestModeratorPublishesDraftAndSuppressesItsFinal(t *testing.T) {
	moderator := New("google", time.Now)
	moderator.Ingest(SourceSegment{
		ID: "google-1", Provider: "google", Text: "ข้อความระหว่างถอด", Sequence: 1,
	})

	publication, replayed, err := moderator.Publish(PublishCommand{
		RequestID: "request-draft", Provider: "google",
		SourceSegmentIDs: []string{"google-1"}, Text: "ข้อความที่ตรวจแล้ว",
	})
	if err != nil || replayed {
		t.Fatalf("Publish(draft) = (%#v, %v, %v)", publication, replayed, err)
	}
	accepted := moderator.Ingest(SourceSegment{
		ID: "google-1", Provider: "google", Text: "ข้อความ final", IsFinal: true, Sequence: 2,
	})
	if accepted {
		t.Fatal("consumed draft final was accepted")
	}
	snapshot := moderator.Snapshot()
	if snapshot.Draft != nil || len(snapshot.Pending) != 0 {
		t.Fatalf("consumed draft final was not suppressed: %#v", snapshot)
	}
}

func TestModeratorDraftRemainderStaysPendingAndFinalDoesNotReplaceIt(t *testing.T) {
	moderator := New("google", time.Now)
	moderator.Ingest(SourceSegment{
		ID: "google-1", Provider: "google", Text: "ส่วนแรก ส่วนที่เหลือ", Sequence: 1,
	})
	if _, _, err := moderator.Publish(PublishCommand{
		RequestID: "request-draft", Provider: "google",
		SourceSegmentIDs: []string{"google-1"},
		Text:             "ส่วนแรก",
		RemainingText:    "ส่วนที่เหลือ",
	}); err != nil {
		t.Fatalf("Publish(draft remainder) error = %v", err)
	}
	if moderator.Ingest(SourceSegment{
		ID: "google-1", Provider: "google", Text: "provider final", IsFinal: true, Sequence: 2,
	}) {
		t.Fatal("provider final replaced a consumed draft remainder")
	}
	snapshot := moderator.Snapshot()
	if len(snapshot.Pending) != 1 || snapshot.Pending[0].Text != "ส่วนที่เหลือ" {
		t.Fatalf("pending remainder = %#v", snapshot.Pending)
	}
}

func TestModeratorRollbackDraftPublicationRestoresDraft(t *testing.T) {
	moderator := New("google", time.Now)
	moderator.Ingest(SourceSegment{
		ID: "google-1", Provider: "google", Text: "ข้อความระหว่างถอด", Sequence: 1,
	})
	if _, _, err := moderator.Publish(PublishCommand{
		RequestID: "request-draft", Provider: "google",
		SourceSegmentIDs: []string{"google-1"}, Text: "ข้อความที่ตรวจแล้ว",
	}); err != nil {
		t.Fatalf("Publish(draft) error = %v", err)
	}
	if !moderator.Rollback("request-draft") {
		t.Fatal("Rollback(draft) = false")
	}
	snapshot := moderator.Snapshot()
	if snapshot.Draft == nil || snapshot.Draft.ID != "google-1" || len(snapshot.Pending) != 0 {
		t.Fatalf("snapshot after draft rollback = %#v", snapshot)
	}
}

func TestModeratorRejectsUnknownNonPrefixAndCrossProviderIDs(t *testing.T) {
	tests := []struct {
		name    string
		command PublishCommand
		wantErr error
	}{
		{
			name: "unknown ID",
			command: PublishCommand{
				RequestID: "unknown", Provider: "google",
				SourceSegmentIDs: []string{"google-9"}, Text: "ข้อความ",
			},
			wantErr: ErrSourceMismatch,
		},
		{
			name: "skips oldest pending",
			command: PublishCommand{
				RequestID: "non-prefix", Provider: "google",
				SourceSegmentIDs: []string{"google-2"}, Text: "ข้อความ",
			},
			wantErr: ErrSourceMismatch,
		},
		{
			name: "cross provider",
			command: PublishCommand{
				RequestID: "cross-provider", Provider: "gemini",
				SourceSegmentIDs: []string{"google-1"}, Text: "ข้อความ",
			},
			wantErr: ErrProviderMismatch,
		},
		{
			name: "empty text",
			command: PublishCommand{
				RequestID: "empty", Provider: "google",
				SourceSegmentIDs: []string{"google-1"}, Text: "  ",
			},
			wantErr: ErrInvalidCommand,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			moderator := New("google", time.Now)
			ingestFinals(moderator, "google-1", "google-2", "google-3")
			if _, _, err := moderator.Publish(tt.command); !errors.Is(err, tt.wantErr) {
				t.Fatalf("Publish() error = %v, want %v", err, tt.wantErr)
			}
		})
	}
}

func TestModeratorReplaysRequestIDWithoutPublishingTwice(t *testing.T) {
	moderator := New("google", time.Now)
	ingestFinals(moderator, "google-1", "google-2")
	command := PublishCommand{
		RequestID: "request-1", Provider: "google",
		SourceSegmentIDs: []string{"google-1"}, Text: "ข้อความแรก",
	}

	first, replayed, err := moderator.Publish(command)
	if err != nil || replayed {
		t.Fatalf("first Publish() = (%#v, %v, %v)", first, replayed, err)
	}
	second, replayed, err := moderator.Publish(command)
	if err != nil || !replayed {
		t.Fatalf("second Publish() = (%#v, %v, %v)", second, replayed, err)
	}
	if second.ID != first.ID || second.Text != first.Text {
		t.Fatalf("replayed publication = %#v, want %#v", second, first)
	}
	if got, want := pendingIDs(moderator.Snapshot()), []string{"google-2"}; !equalStrings(got, want) {
		t.Fatalf("remaining pending IDs = %v, want %v", got, want)
	}
}

func TestModeratorRollbackRestoresPublishedPrefix(t *testing.T) {
	moderator := New("google", time.Now)
	ingestFinals(moderator, "google-1", "google-2", "google-3")
	if _, _, err := moderator.Publish(PublishCommand{
		RequestID: "request-1", Provider: "google",
		SourceSegmentIDs: []string{"google-1", "google-2"}, Text: "ข้อความ",
	}); err != nil {
		t.Fatalf("Publish() error = %v", err)
	}

	if !moderator.Rollback("request-1") {
		t.Fatal("Rollback() = false, want true")
	}
	if got, want := pendingIDs(moderator.Snapshot()), []string{"google-1", "google-2", "google-3"}; !equalStrings(got, want) {
		t.Fatalf("pending IDs after rollback = %v, want %v", got, want)
	}
	if moderator.Rollback("request-1") {
		t.Fatal("second Rollback() = true, want false")
	}
}

func TestModeratorPublishesPartAndRetainsRemainderOnSameSource(t *testing.T) {
	moderator := New("google", time.Now)
	moderator.Ingest(SourceSegment{
		ID: "google-1", Provider: "google", Text: "ประโยคแรก ประโยคถัดไป", IsFinal: true, Sequence: 1,
	})

	if _, _, err := moderator.Publish(PublishCommand{
		RequestID: "request-1", Provider: "google",
		SourceSegmentIDs: []string{"google-1"},
		Text:             "ประโยคแรก",
		RemainingText:    "ประโยคถัดไป",
	}); err != nil {
		t.Fatalf("Publish() error = %v", err)
	}
	snapshot := moderator.Snapshot()
	if len(snapshot.Pending) != 1 || snapshot.Pending[0].ID != "google-1" ||
		snapshot.Pending[0].Text != "ประโยคถัดไป" {
		t.Fatalf("remaining pending = %#v", snapshot.Pending)
	}

	if _, _, err := moderator.Publish(PublishCommand{
		RequestID: "request-2", Provider: "google",
		SourceSegmentIDs: []string{"google-1"}, Text: "ประโยคถัดไป",
	}); err != nil {
		t.Fatalf("Publish(remainder) error = %v", err)
	}
	if len(moderator.Snapshot().Pending) != 0 {
		t.Fatalf("pending after remainder = %#v, want empty", moderator.Snapshot().Pending)
	}
}

func TestModeratorRollbackRestoresSourceBeforePartialPublish(t *testing.T) {
	moderator := New("google", time.Now)
	moderator.Ingest(SourceSegment{
		ID: "google-1", Provider: "google", Text: "ประโยคแรก ประโยคถัดไป", IsFinal: true, Sequence: 1,
	})
	if _, _, err := moderator.Publish(PublishCommand{
		RequestID: "request-1", Provider: "google",
		SourceSegmentIDs: []string{"google-1"},
		Text:             "ประโยคแรก",
		RemainingText:    "ประโยคถัดไป",
	}); err != nil {
		t.Fatalf("Publish() error = %v", err)
	}
	if !moderator.Rollback("request-1") {
		t.Fatal("Rollback() = false, want true")
	}
	snapshot := moderator.Snapshot()
	if len(snapshot.Pending) != 1 || snapshot.Pending[0].Text != "ประโยคแรก ประโยคถัดไป" {
		t.Fatalf("pending after rollback = %#v", snapshot.Pending)
	}
}

func TestModeratorBoundsProcessedRequestsAtTwoHundredFiftySix(t *testing.T) {
	moderator := New("google", time.Now)
	for index := 1; index <= 257; index++ {
		id := fmt.Sprintf("google-%d", index)
		moderator.Ingest(SourceSegment{
			ID: id, Provider: "google", Text: id, IsFinal: true, Sequence: uint64(index),
		})
		if _, _, err := moderator.Publish(PublishCommand{
			RequestID: fmt.Sprintf("request-%d", index),
			Provider:  "google", SourceSegmentIDs: []string{id}, Text: id,
		}); err != nil {
			t.Fatalf("Publish(%d) error = %v", index, err)
		}
	}

	if got, want := moderator.processedCount(), 256; got != want {
		t.Fatalf("processed request count = %d, want %d", got, want)
	}
}

func TestModeratorConcurrentIngestAndPublish(t *testing.T) {
	moderator := New("google", time.Now)
	done := make(chan struct{})

	go func() {
		defer close(done)
		for index := 1; index <= 100; index++ {
			id := fmt.Sprintf("google-%d", index)
			moderator.Ingest(SourceSegment{
				ID: id, Provider: "google", Text: id, IsFinal: true, Sequence: uint64(index),
			})
			moderator.Snapshot()
		}
	}()

	for index := 1; index <= 50; index++ {
		id := fmt.Sprintf("google-%d", index)
		moderator.Ingest(SourceSegment{
			ID: id, Provider: "google", Text: id, IsFinal: true, Sequence: uint64(index),
		})
		_, _, _ = moderator.Publish(PublishCommand{
			RequestID:        fmt.Sprintf("req-%d", index),
			Provider:         "google",
			SourceSegmentIDs: []string{id},
			Text:             id,
		})
	}
	<-done
}

func ingestFinals(moderator *Moderator, ids ...string) {
	for index, id := range ids {
		moderator.Ingest(SourceSegment{
			ID: id, Provider: "google", Text: id, IsFinal: true, Sequence: uint64(index + 1),
		})
	}
}

func pendingIDs(snapshot Snapshot) []string {
	ids := make([]string, 0, len(snapshot.Pending))
	for _, segment := range snapshot.Pending {
		ids = append(ids, segment.ID)
	}
	return ids
}

func equalStrings(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}
