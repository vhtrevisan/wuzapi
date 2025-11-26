package chatwoot

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
)

type Client struct {
	Config Config
	HTTP   *http.Client
}

type Config struct {
	AccountID string
	Token     string
	URL       string
	InboxID   string
}

func NewClient(config Config) *Client {
	return &Client{
		Config: config,
		HTTP:   &http.Client{},
	}
}

func (c *Client) EnsureContact(phone, name string) (int, error) {
	// Search for contact
	searchURL := fmt.Sprintf("%s/api/v1/accounts/%s/contacts/search?q=%s", c.Config.URL, c.Config.AccountID, phone)
	req, err := http.NewRequest("GET", searchURL, nil)
	if err != nil {
		return 0, err
	}
	req.Header.Set("api_access_token", c.Config.Token)

	resp, err := c.HTTP.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("failed to search contact: %s", resp.Status)
	}

	var searchResult struct {
		Payload []struct {
			ID int `json:"id"`
		} `json:"payload"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&searchResult); err != nil {
		return 0, err
	}

	if len(searchResult.Payload) > 0 {
		return searchResult.Payload[0].ID, nil
	}

	// Create contact if not found
	createURL := fmt.Sprintf("%s/api/v1/accounts/%s/contacts", c.Config.URL, c.Config.AccountID)
	payload := map[string]interface{}{
		"inbox_id":     c.Config.InboxID,
		"name":         name,
		"phone_number": phone,
	}
	jsonPayload, _ := json.Marshal(payload)

	req, err = http.NewRequest("POST", createURL, bytes.NewBuffer(jsonPayload))
	if err != nil {
		return 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("api_access_token", c.Config.Token)

	resp, err = c.HTTP.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return 0, fmt.Errorf("failed to create contact: %s - %s", resp.Status, string(bodyBytes))
	}

	var createResult struct {
		Payload struct {
			Contact struct {
				ID int `json:"id"`
			} `json:"contact"`
		} `json:"payload"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&createResult); err != nil {
		return 0, err
	}

	return createResult.Payload.Contact.ID, nil
}

func (c *Client) EnsureConversation(contactID int, sourceID string) (int, error) {
	// Check for existing conversation (optional optimization, but good practice)
	// For now, we'll try to create one, and Chatwoot usually handles duplicates or we can check active ones.
	// The user requirement says: "Verifique se já não existe uma conversa aberta para evitar spam de tickets."
	// We can search for conversations by contact ID.

	searchURL := fmt.Sprintf("%s/api/v1/accounts/%s/conversations?contact_id=%d&status=open", c.Config.URL, c.Config.AccountID, contactID)
	req, err := http.NewRequest("GET", searchURL, nil)
	if err != nil {
		return 0, err
	}
	req.Header.Set("api_access_token", c.Config.Token)

	resp, err := c.HTTP.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusOK {
		var convResult struct {
			Data struct {
				Payload []struct {
					ID int `json:"id"`
				} `json:"payload"`
			} `json:"data"`
		}
		// Chatwoot API structure for conversations list might vary, checking standard response
		// Actually, /api/v1/accounts/{account_id}/conversations returns a payload with meta and payload.
		if err := json.NewDecoder(resp.Body).Decode(&convResult); err == nil {
			if len(convResult.Data.Payload) > 0 {
				return convResult.Data.Payload[0].ID, nil
			}
		}
	}

	// Create new conversation
	createURL := fmt.Sprintf("%s/api/v1/accounts/%s/conversations", c.Config.URL, c.Config.AccountID)
	payload := map[string]interface{}{
		"source_id":  sourceID,
		"inbox_id":   c.Config.InboxID,
		"contact_id": contactID,
		"status":     "open",
	}
	jsonPayload, _ := json.Marshal(payload)

	req, err = http.NewRequest("POST", createURL, bytes.NewBuffer(jsonPayload))
	if err != nil {
		return 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("api_access_token", c.Config.Token)

	resp, err = c.HTTP.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return 0, fmt.Errorf("failed to create conversation: %s - %s", resp.Status, string(bodyBytes))
	}

	var createResult struct {
		ID int `json:"id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&createResult); err != nil {
		return 0, err
	}

	return createResult.ID, nil
}

func (c *Client) SendMessage(conversationID int, msgType string, content string, sourceID string, media []byte, mediaFilename string, mediaType string) error {
	url := fmt.Sprintf("%s/api/v1/accounts/%s/conversations/%d/messages", c.Config.URL, c.Config.AccountID, conversationID)

	if len(media) > 0 {
		// Multipart upload
		body := &bytes.Buffer{}
		writer := multipart.NewWriter(body)

		// Content
		if content != "" {
			_ = writer.WriteField("content", content)
		}
		_ = writer.WriteField("message_type", msgType)
		_ = writer.WriteField("private", "false")
		// _ = writer.WriteField("source_id", sourceID) // Chatwoot might not accept source_id for messages directly in this endpoint easily, but let's try or skip if not needed.
		// Usually source_id is for the conversation or contact. For message, it might be 'external_source_ids' or similar, but standard API uses content/attachments.

		// Attachment
		partHeader := make(textproto.MIMEHeader)
		partHeader.Set("Content-Disposition", fmt.Sprintf(`form-data; name="attachments[]"; filename="%s"`, mediaFilename))
		partHeader.Set("Content-Type", mediaType)
		part, err := writer.CreatePart(partHeader)
		if err != nil {
			return err
		}
		_, err = part.Write(media)
		if err != nil {
			return err
		}

		err = writer.Close()
		if err != nil {
			return err
		}

		req, err := http.NewRequest("POST", url, body)
		if err != nil {
			return err
		}
		req.Header.Set("Content-Type", writer.FormDataContentType())
		req.Header.Set("api_access_token", c.Config.Token)

		resp, err := c.HTTP.Do(req)
		if err != nil {
			return err
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			bodyBytes, _ := io.ReadAll(resp.Body)
			return fmt.Errorf("failed to send media message: %s - %s", resp.Status, string(bodyBytes))
		}
		return nil

	} else {
		// JSON Text message
		payload := map[string]interface{}{
			"content":      content,
			"message_type": msgType,
			"private":      false,
			// "source_id":    sourceID,
		}
		jsonPayload, _ := json.Marshal(payload)

		req, err := http.NewRequest("POST", url, bytes.NewBuffer(jsonPayload))
		if err != nil {
			return err
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("api_access_token", c.Config.Token)

		resp, err := c.HTTP.Do(req)
		if err != nil {
			return err
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			bodyBytes, _ := io.ReadAll(resp.Body)
			return fmt.Errorf("failed to send text message: %s - %s", resp.Status, string(bodyBytes))
		}
		return nil
	}
}
