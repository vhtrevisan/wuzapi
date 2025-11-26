package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

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
	Sender struct {
		Type string `json:"type"` // "user" or "contact" or "agent_bot"
	} `json:"sender"`
	ContentAttributes struct {
		InReplyTo string `json:"in_reply_to"`
	} `json:"content_attributes"`
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

		// DEBUG: Log the payload to understand what Chatwoot is sending
		log.Debug().
			Str("event", payload.Event).
			Str("messageType", payload.MessageType).
			Bool("private", payload.Private).
			Str("content", payload.Content).
			Str("senderType", payload.Sender.Type).
			Msg("Chatwoot webhook payload received")

		// 3. Validation
		if payload.Event != "message_created" {
			respondJSON(w, http.StatusOK, map[string]string{"status": "ignored", "reason": "not message_created"})
			return
		}
		if payload.MessageType != "outgoing" {
			log.Debug().Str("messageType", payload.MessageType).Msg("Ignoring non-outgoing message")
			respondJSON(w, http.StatusOK, map[string]string{"status": "ignored", "reason": "not outgoing"})
			return
		}
		// CRITICAL: Ignore messages created by "contact" sender type
		// When we forward WhatsApp messages to Chatwoot as "outgoing", Chatwoot fires a webhook back
		// with sender.type = "contact". We must ignore these to prevent infinite loops!
		if payload.Sender.Type == "contact" || payload.Sender.Type == "agent_bot" {
			log.Debug().Str("senderType", payload.Sender.Type).Msg("Ignoring message from contact/bot to prevent loop")
			respondJSON(w, http.StatusOK, map[string]string{"status": "ignored", "reason": "sender is contact/bot"})
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

		// CRITICAL: Mark this chat as "currently sending via Chatwoot"
		// This prevents re-forwarding the sent message back to Chatwoot
		chatKey := fmt.Sprintf("%s:%s", userID, phone)
		chatwootSentCache.Store(chatKey, time.Now())
		go func(key string) {
			time.Sleep(10 * time.Second) // Keep for 10 seconds
			chatwootSentCache.Delete(key)
		}(chatKey)

		// 5. Get WhatsApp Client
		client := clientManager.GetWhatsmeowClient(userID)
		if client == nil || !client.IsConnected() {
			respondJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "whatsapp client not connected"})
			return
		}

		// 6. Send Message
		// Send synchronously to avoid SQL transaction conflicts
		if len(payload.Attachments) > 0 {
			// Handle Attachments (Media)
			for _, attachment := range payload.Attachments {
				err := s.sendMediaFromURL(client, jid, attachment.DataURL, payload.Content)
				if err != nil {
					log.Error().Err(err).Msg("Failed to send media from Chatwoot")
					respondJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to send media"})
					return
				}
			}
		} else {
			// Handle Text Message
			msg := &waE2E.Message{
				Conversation: proto.String(payload.Content),
			}
			_, err := client.SendMessage(r.Context(), jid, msg)
			if err != nil {
				log.Error().Err(err).Msg("Failed to send text message from Chatwoot")
				respondJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to send message"})
				return
			}
		}

		// Return success after sending
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
