package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"

	"wuzapi/pkg/chatwoot"
)

func (s *server) GetChatwootConfigHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		txtid := r.Context().Value("userinfo").(Values).Get("Id")
		if txtid == "" {
			s.Respond(w, r, http.StatusUnauthorized, fmt.Errorf("unauthorized"))
			return
		}

		config, err := s.GetChatwootConfig(txtid)
		if err != nil {
			// CORREÇÃO AQUI: Retornar string vazia de JSON, não map
			s.Respond(w, r, http.StatusOK, "{}")
			return
		}

		// Mask token for security
		if len(config.Token) > 4 {
			config.Token = "****" + config.Token[len(config.Token)-4:]
		} else if len(config.Token) > 0 {
			config.Token = "****"
		}

		responseJson, err := json.Marshal(config)
		if err != nil {
			s.Respond(w, r, http.StatusInternalServerError, err)
			return
		}

		s.Respond(w, r, http.StatusOK, string(responseJson))
	}
}

func (s *server) SetChatwootConfigHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		txtid := r.Context().Value("userinfo").(Values).Get("Id")
		if txtid == "" {
			s.Respond(w, r, http.StatusUnauthorized, fmt.Errorf("unauthorized"))
			return
		}

		// Get user token and name from database
		var userToken, userName string
		err := s.db.QueryRow("SELECT token, name FROM users WHERE id=$1", txtid).Scan(&userToken, &userName)
		if err != nil {
			s.Respond(w, r, http.StatusInternalServerError, fmt.Errorf("failed to get user: %w", err))
			return
		}

		var config ChatwootConfig
		if err := json.NewDecoder(r.Body).Decode(&config); err != nil {
			s.Respond(w, r, http.StatusBadRequest, fmt.Errorf("invalid json"))
			return
		}

		config.UserID = txtid

		// If token is masked (starts with ****), preserve the old token
		if len(config.Token) >= 4 && config.Token[:4] == "****" {
			existingConfig, err := s.GetChatwootConfig(txtid)
			if err == nil && existingConfig != nil {
				config.Token = existingConfig.Token
			}
		}

		// Auto-creation logic: if InboxID is empty or "0", create inbox automatically
		if config.InboxID == "" || config.InboxID == "0" {
			log.Println("InboxID is empty, starting auto-creation flow...")

			// 1. Validate SERVER_URL environment variable
			serverURL := os.Getenv("SERVER_URL")
			if serverURL == "" {
				s.Respond(w, r, http.StatusBadRequest, fmt.Errorf("SERVER_URL environment variable is not set. Cannot auto-create inbox"))
				return
			}

			// 2. Build webhook URL with user token
			webhookURL := fmt.Sprintf("%s/chatwoot/webhook?token=%s", serverURL, userToken)
			log.Printf("Webhook URL: %s", webhookURL)

			// 3. Initialize Chatwoot client
			chatwootClient := chatwoot.NewClient(chatwoot.Config{
				AccountID: config.AccountID,
				Token:     config.Token,
				URL:       config.URL,
			})

			// 4. Check if Inbox Exists OR Create New
			log.Println("Checking for existing inbox...")
			inboxID, err := chatwootClient.FindInboxByName(userName)

			if err != nil {
				log.Printf("Error checking inbox existence (will try to create): %v", err)
			}

			if inboxID > 0 {
				log.Printf("Found existing inbox with ID: %d", inboxID)
			} else {
				log.Println("Creating new Chatwoot inbox...")
				inboxID, err = chatwootClient.CreateInbox(userName, webhookURL)
				if err != nil {
					s.Respond(w, r, http.StatusInternalServerError, fmt.Errorf("failed to create inbox: %w", err))
					return
				}
				log.Printf("Inbox created successfully with ID: %d", inboxID)
			}

			// Update config with new InboxID
			config.InboxID = fmt.Sprintf("%d", inboxID)
			chatwootClient.Config.InboxID = config.InboxID

			// 5. Create system contact
			log.Println("Creating system contact...")
			contactID, err := chatwootClient.CreateContact("Wuzapi System", "+123456")
			if err != nil {
				log.Printf("Warning: Failed to create system contact: %v", err)
			} else {
				log.Printf("System contact created with ID: %d", contactID)

				// 6. Send initial welcome message
				log.Println("Sending initial welcome message...")
				err = chatwootClient.SendInitMessage(contactID, inboxID)
				if err != nil {
					log.Printf("Warning: Failed to send initial message: %v", err)
				} else {
					log.Println("Initial message sent successfully")
				}
			}
		}

		// Save configuration to database
		if err := s.SaveChatwootConfig(&config); err != nil {
			s.Respond(w, r, http.StatusInternalServerError, err)
			return
		}

		s.Respond(w, r, http.StatusOK, `{"status":"success"}`)
	}
}
