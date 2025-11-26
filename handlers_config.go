package main

import (
	"encoding/json"
	"fmt"
	"net/http"
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
			// If not found, return empty config or 404?
			// Let's return empty config with 200 to make frontend easier
			s.Respond(w, r, http.StatusOK, map[string]interface{}{})
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

		var config ChatwootConfig
		if err := json.NewDecoder(r.Body).Decode(&config); err != nil {
			s.Respond(w, r, http.StatusBadRequest, fmt.Errorf("invalid json"))
			return
		}

		config.UserID = txtid

		// If token is masked (starts with ****), we might want to preserve the old token if not changed.
		// However, for simplicity, we assume the frontend sends the full token if it's being changed,
		// or we handle this logic.
		// If the user sends "****", we should probably fetch the existing config and keep the old token.
		if len(config.Token) >= 4 && config.Token[:4] == "****" {
			existingConfig, err := s.GetChatwootConfig(txtid)
			if err == nil && existingConfig != nil {
				config.Token = existingConfig.Token
			}
		}

		if err := s.SaveChatwootConfig(&config); err != nil {
			s.Respond(w, r, http.StatusInternalServerError, err)
			return
		}

		s.Respond(w, r, http.StatusOK, `{"status":"success"}`)
	}
}
