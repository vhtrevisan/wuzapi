package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/rs/zerolog/log"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	"google.golang.org/protobuf/proto"
)

type ChatwootWebhookPayload struct {
	Event       string `json:"event"`
	MessageType string `json:"message_type"`
	Content     string `json:"content"`
	Private     bool   `json:"private"`
	Attachments []struct {
		DataURL string `json:"data_url"`
	} `json:"attachments"`
	Conversation struct {
		Meta struct {
			Sender struct {
				PhoneNumber string `json:"phone_number"`
			} `json:"sender"`
		} `json:"meta"`
	} `json:"conversation"`
	Contact struct {
		PhoneNumber string `json:"phone_number"`
	} `json:"contact"`
}

// respondJSON ensures all webhook responses are valid JSON
func respondJSON(w http.ResponseWriter, status int, payload map[string]string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(payload)
}

func (s *server) HandleChatwootWebhook() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// 1. Authentication (Token from Query String)
		token := r.URL.Query().Get("token")
		if token == "" {
			respondJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing token"})
			return
		}

		// Validate user/token and get User ID
		var userID string
		userinfo, found := userinfocache.Get(token)
		if found {
			userID = userinfo.(Values).Get("Id")
		} else {
			err := s.db.QueryRow("SELECT id FROM users WHERE token=$1", token).Scan(&userID)
			if err != nil {
				respondJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid token"})
				return
			}
		}

		// 2. Parse Payload
		var payload ChatwootWebhookPayload
		body, err := io.ReadAll(r.Body)
		if err != nil {
			respondJSON(w, http.StatusBadRequest, map[string]string{"error": "failed to read body"})
			return
		}
		if err := json.Unmarshal(body, &payload); err != nil {
			respondJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
			return
		}

		// 3. Validation
		if payload.Event != "message_created" {
			respondJSON(w, http.StatusOK, map[string]string{"status": "ignored", "reason": "not message_created"})
			return
		}
		if payload.MessageType != "outgoing" {
			respondJSON(w, http.StatusOK, map[string]string{"status": "ignored", "reason": "not outgoing"})
			return
		}
		if payload.Private {
			respondJSON(w, http.StatusOK, map[string]string{"status": "ignored", "reason": "private message"})
			return
		}

		// 4. Extract Target JID
		phone := payload.Conversation.Meta.Sender.PhoneNumber
		if phone == "" {
			phone = payload.Contact.PhoneNumber
		}
		if phone == "" {
			log.Error().Msg("Chatwoot Webhook: No phone number found")
			respondJSON(w, http.StatusBadRequest, map[string]string{"error": "no phone number found"})
			return
		}

		// Format JID
		phone = strings.TrimPrefix(phone, "+")
		jid := types.NewJID(phone, types.DefaultUserServer)

		// 5. Get WhatsApp Client
		client := clientManager.GetWhatsmeowClient(userID)
		if client == nil || !client.IsConnected() {
			respondJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "whatsapp client not connected"})
			return
		}

		// 6. Send Message Asynchronously
		// Use goroutine to prevent transaction conflicts and return 200 OK immediately
		go func() {
			// Create isolated background context to prevent transaction conflicts
			ctx := context.Background()

			if len(payload.Attachments) > 0 {
				// Handle Attachments (Media)
				for _, attachment := range payload.Attachments {
					err := s.sendMediaFromURL(client, jid, attachment.DataURL, payload.Content)
					if err != nil {
						log.Error().Err(err).Msg("Failed to send media from Chatwoot")
					}
				}
			} else {
				// Handle Text Message
				msg := &waE2E.Message{
					Conversation: proto.String(payload.Content),
				}
				// Use client.SendMessage directly with isolated context
				_, err := client.SendMessage(ctx, jid, msg)
				if err != nil {
					log.Error().Err(err).Msg("Failed to send text message from Chatwoot")
				}
			}
		}()

		// Return success immediately without waiting for delivery
		respondJSON(w, http.StatusOK, map[string]string{"status": "success", "message": "sent"})
	}
}

func (s *server) sendMediaFromURL(client *whatsmeow.Client, jid types.JID, url string, caption string) error {
	// Download media
	resp, err := http.Get(url)
	if err != nil {
		return fmt.Errorf("failed to download media: %w", err)
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("failed to read media body: %w", err)
	}

	mimeType := resp.Header.Get("Content-Type")

	// Upload to WhatsApp
	uploaded, err := client.Upload(context.Background(), data, whatsmeow.MediaImage) // Defaulting to image for upload, but need to detect type
	// Note: whatsmeow.Upload automatically detects type if not strictly enforced, or we should switch based on mimeType.
	// Actually Upload takes a MediaType. Let's try to infer.

	var mediaType whatsmeow.MediaType
	var msg *waE2E.Message

	if strings.HasPrefix(mimeType, "image") {
		mediaType = whatsmeow.MediaImage
		uploaded, err = client.Upload(context.Background(), data, mediaType)
		if err != nil {
			return err
		}

		msg = &waE2E.Message{
			ImageMessage: &waE2E.ImageMessage{
				Caption:       proto.String(caption),
				Mimetype:      proto.String(mimeType),
				URL:           proto.String(uploaded.URL),
				DirectPath:    proto.String(uploaded.DirectPath),
				MediaKey:      uploaded.MediaKey,
				FileEncSHA256: uploaded.FileEncSHA256,
				FileSHA256:    uploaded.FileSHA256,
				FileLength:    proto.Uint64(uint64(len(data))),
			},
		}
	} else if strings.HasPrefix(mimeType, "video") {
		mediaType = whatsmeow.MediaVideo
		uploaded, err = client.Upload(context.Background(), data, mediaType)
		if err != nil {
			return err
		}

		msg = &waE2E.Message{
			VideoMessage: &waE2E.VideoMessage{
				Caption:       proto.String(caption),
				Mimetype:      proto.String(mimeType),
				URL:           proto.String(uploaded.URL),
				DirectPath:    proto.String(uploaded.DirectPath),
				MediaKey:      uploaded.MediaKey,
				FileEncSHA256: uploaded.FileEncSHA256,
				FileSHA256:    uploaded.FileSHA256,
				FileLength:    proto.Uint64(uint64(len(data))),
			},
		}
	} else if strings.HasPrefix(mimeType, "audio") {
		mediaType = whatsmeow.MediaAudio
		uploaded, err = client.Upload(context.Background(), data, mediaType)
		if err != nil {
			return err
		}

		msg = &waE2E.Message{
			AudioMessage: &waE2E.AudioMessage{
				Mimetype:      proto.String(mimeType),
				URL:           proto.String(uploaded.URL),
				DirectPath:    proto.String(uploaded.DirectPath),
				MediaKey:      uploaded.MediaKey,
				FileEncSHA256: uploaded.FileEncSHA256,
				FileSHA256:    uploaded.FileSHA256,
				FileLength:    proto.Uint64(uint64(len(data))),
			},
		}
	} else {
		// Document default
		mediaType = whatsmeow.MediaDocument
		uploaded, err = client.Upload(context.Background(), data, mediaType)
		if err != nil {
			return err
		}

		msg = &waE2E.Message{
			DocumentMessage: &waE2E.DocumentMessage{
				Caption:       proto.String(caption),
				Mimetype:      proto.String(mimeType),
				URL:           proto.String(uploaded.URL),
				DirectPath:    proto.String(uploaded.DirectPath),
				MediaKey:      uploaded.MediaKey,
				FileEncSHA256: uploaded.FileEncSHA256,
				FileSHA256:    uploaded.FileSHA256,
				FileLength:    proto.Uint64(uint64(len(data))),
				FileName:      proto.String("file"), // Could extract from URL or Header
			},
		}
	}

	_, err = client.SendMessage(context.Background(), jid, msg)
	return err
}
