package asr

import (
	"context"
	"sync"

	speech "cloud.google.com/go/speech/apiv1"
	speechpb "cloud.google.com/go/speech/apiv1/speechpb"
	"google.golang.org/api/option"
)

type GoogleProvider struct {
	client     *speech.Client
	stream     speech.Speech_StreamingRecognizeClient
	results    chan TranscriptResult
	sampleRate int
	mu         sync.Mutex
	stopped    bool
}

func NewGoogleProvider(credentialFile string, sampleRate int) (*GoogleProvider, error) {
	ctx := context.Background()
	var client *speech.Client
	var err error

	if credentialFile != "" {
		client, err = speech.NewClient(ctx, option.WithCredentialsFile(credentialFile))
	} else {
		client, err = speech.NewClient(ctx)
	}

	if err != nil {
		return nil, err
	}

	return &GoogleProvider{
		client:     client,
		results:    make(chan TranscriptResult, 100),
		sampleRate: sampleRate,
	}, nil
}

func (g *GoogleProvider) GetStreamingConfig() *speechpb.StreamingRecognitionConfig {
	return &speechpb.StreamingRecognitionConfig{
		Config: &speechpb.RecognitionConfig{
			Encoding:                   speechpb.RecognitionConfig_LINEAR16,
			SampleRateHertz:            int32(g.sampleRate),
			LanguageCode:               "th-TH",
			Model:                      "latest_long",
			UseEnhanced:                true,
			EnableAutomaticPunctuation: true,
		},
		InterimResults: true,
	}
}

func (g *GoogleProvider) Start(ctx context.Context) error {
	stream, err := g.client.StreamingRecognize(ctx)
	if err != nil {
		return err
	}

	g.mu.Lock()
	g.stopped = false
	g.mu.Unlock()

	config := g.GetStreamingConfig()
	if err := stream.Send(&speechpb.StreamingRecognizeRequest{
		StreamingRequest: &speechpb.StreamingRecognizeRequest_StreamingConfig{
			StreamingConfig: config,
		},
	}); err != nil {
		return err
	}

	go g.processResponses(stream)
	g.stream = stream
	return nil
}

func (g *GoogleProvider) SendAudio(data []byte) error {
	g.mu.Lock()
	defer g.mu.Unlock()

	if g.stopped || g.stream == nil {
		return nil
	}

	return g.stream.Send(&speechpb.StreamingRecognizeRequest{
		StreamingRequest: &speechpb.StreamingRecognizeRequest_AudioContent{
			AudioContent: data,
		},
	})
}

func (g *GoogleProvider) Results() <-chan TranscriptResult {
	return g.results
}

func (g *GoogleProvider) Stop() error {
	g.mu.Lock()
	g.stopped = true
	g.mu.Unlock()

	if g.stream != nil {
		return g.stream.CloseSend()
	}
	return nil
}

func (g *GoogleProvider) Close() error {
	if g.client != nil {
		return g.client.Close()
	}
	return nil
}

func (g *GoogleProvider) processResponses(stream speech.Speech_StreamingRecognizeClient) {
	for {
		resp, err := stream.Recv()
		if err != nil {
			close(g.results)
			return
		}

		if len(resp.Results) == 0 {
			continue
		}

		result := resp.Results[0]
		if len(result.Alternatives) == 0 {
			continue
		}

		alt := result.Alternatives[0]
		g.results <- TranscriptResult{
			Text:       alt.Transcript,
			IsFinal:    result.IsFinal,
			Confidence: float64(alt.Confidence),
		}
	}
}
