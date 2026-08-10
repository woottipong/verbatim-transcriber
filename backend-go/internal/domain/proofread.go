package domain

import "context"

const MaxCaptionTextBytes = 16_000

type ProofreadRequest struct {
	RequestID   string
	Revision    uint64
	TargetText  string
	ContextText string
}

type ProofreadUsage struct {
	PromptTokens int
	OutputTokens int
	TotalTokens  int
}

type ProofreadResult struct {
	RequestID     string
	Revision      uint64
	SuggestedText string
	Changed       bool
	Usage         ProofreadUsage
}

type Proofreader interface {
	Proofread(context.Context, ProofreadRequest) (ProofreadResult, error)
}
