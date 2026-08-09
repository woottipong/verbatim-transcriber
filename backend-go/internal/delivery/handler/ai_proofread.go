package handler

import (
	"errors"

	"thai-transcriber-backend/internal/application/captionproofread"
	"thai-transcriber-backend/internal/domain"

	"github.com/gofiber/fiber/v2"
)

type AIProofreadRequest struct {
	RequestID   string `json:"requestId"`
	Revision    uint64 `json:"revision"`
	TargetText  string `json:"targetText"`
	ContextText string `json:"contextText,omitempty"`
}

type AIProofreadResponse struct {
	RequestID     string `json:"requestId"`
	Revision      uint64 `json:"revision"`
	SuggestedText string `json:"suggestedText"`
	Changed       bool   `json:"changed"`
}

func HandleAIProofread(c *fiber.Ctx, service *captionproofread.Service) error {
	var request AIProofreadRequest
	if err := c.BodyParser(&request); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid JSON payload"})
	}

	result, err := service.Proofread(c.Context(), domain.ProofreadRequest{
		RequestID:   request.RequestID,
		Revision:    request.Revision,
		TargetText:  request.TargetText,
		ContextText: request.ContextText,
	})
	if err != nil {
		switch {
		case errors.Is(err, captionproofread.ErrInvalidTarget):
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "targetText is required"})
		case errors.Is(err, captionproofread.ErrTargetTooLarge):
			return c.Status(fiber.StatusRequestEntityTooLarge).JSON(fiber.Map{"error": "targetText exceeds the Caption Desk limit"})
		case errors.Is(err, captionproofread.ErrDisabled):
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"error": "AI proofreading is not configured"})
		case errors.Is(err, captionproofread.ErrSuggestionEmpty),
			errors.Is(err, captionproofread.ErrSuggestionTooBig),
			errors.Is(err, captionproofread.ErrSuggestionUnsafe):
			return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": "AI proofreading returned an invalid result"})
		default:
			return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": "AI proofreading service unavailable"})
		}
	}

	return c.JSON(AIProofreadResponse{
		RequestID:     result.RequestID,
		Revision:      result.Revision,
		SuggestedText: result.SuggestedText,
		Changed:       result.Changed,
	})
}
