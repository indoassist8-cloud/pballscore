package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	firebase "firebase.google.com/go/v4"
	"firebase.google.com/go/v4/auth"
	"github.com/go-sql-driver/mysql"
	_ "github.com/go-sql-driver/mysql"
	"google.golang.org/api/option"
)

// UserSignupRequest is the JSON body expected from the frontend
type UserSignupRequest struct {
	Token       string `json:"token"`
	Fullname    string `json:"fullname"`
	Email       string `json:"email"`
	PhoneNumber string `json:"phone_number"`
}

var db *sql.DB
var authClient *auth.Client

// ─────────────────────────────────────────────
// REQUEST / RESPONSE STRUCTS
// ─────────────────────────────────────────────

// MatchParticipant represents a single player in the match.
// team_identifier must be "A" or "B".
//
// Frontend JSON example (one entry in the "participants" array):
//
//	{
//	  "user_id": 42,
//	  "team_identifier": "A",
//	  "score": 11
//	}
type MatchParticipant struct {
	UserID         int    `json:"user_id"`
	TeamIdentifier string `json:"team_identifier"` // "A" or "B"
	Score          int    `json:"score"`
}

// CreateMatchRequest is the full JSON body the frontend sends to POST /matches.
//
// Minimal singles example:
//
//	{
//	  "sport_type_id": 1,
//	  "community_id": null,
//	  "location": "Culver City Sports Center",
//	  "participants": [
//	    { "user_id": 1, "team_identifier": "A", "score": 11 },
//	    { "user_id": 2, "team_identifier": "B", "score": 8  }
//	  ]
//	}
//
// Doubles example (add a second player per team):
//
//	{
//	  "sport_type_id": 2,
//	  "community_id": 5,
//	  "location": "Venice Beach Courts",
//	  "participants": [
//	    { "user_id": 1, "team_identifier": "A", "score": 11 },
//	    { "user_id": 3, "team_identifier": "A", "score": 11 },
//	    { "user_id": 2, "team_identifier": "B", "score": 9  },
//	    { "user_id": 4, "team_identifier": "B", "score": 9  }
//	  ]
//	}
//
// Rules enforced server-side:
//   - At least 2 participants required (1v1 minimum).
//   - All participants on the same team must have the same score.
//   - Exactly one team wins (higher score); ties are rejected.
type CreateMatchRequest struct {
	SportTypeID  int                `json:"sport_type_id"`
	CommunityID  *int               `json:"community_id"` // nullable → pointer
	Location     string             `json:"location"`
	Participants []MatchParticipant `json:"participants"`
}

// CreateMatchResponse is returned on success.
type CreateMatchResponse struct {
	MatchID int    `json:"match_id"`
	Message string `json:"message"`
}

// GetMatchResponse is returned by GET /matches/{id}.
type GetMatchResponse struct {
	MatchID     int                     `json:"match_id"`
	SportType   string                  `json:"sport_type"`
	CommunityID *int                    `json:"community_id"`
	Location    string                  `json:"location"`
	MatchDate   time.Time               `json:"match_date"`
	Teams       map[string][]TeamMember `json:"teams"`  // "A" → [...], "B" → [...]
	Winner      string                  `json:"winner"` // "A" or "B"
}

// TeamMember is one row from match_results joined with users.
type TeamMember struct {
	UserID   int    `json:"user_id"`
	Username string `json:"username"`
	Score    int    `json:"score"`
	IsWinner bool   `json:"is_winner"`
}

func main() {
	// 1. Initialize MySQL connection
	dsn := fmt.Sprintf("%s:%s@tcp(%s)/%s?parseTime=true",
		os.Getenv("DB_USER"),
		os.Getenv("DB_PASSWORD"),
		os.Getenv("DB_HOST"),
		os.Getenv("DB_NAME"),
	)

	var err error
	db, err = sql.Open("mysql", dsn)
	if err != nil {
		log.Fatalf("Failed to open DB connection: %v", err)
	}
	defer db.Close()

	// Verify DB is reachable at startup
	if err = db.Ping(); err != nil {
		log.Fatalf("Failed to ping DB: %v", err)
	}
	log.Println("Database connection established.")

	// 2. Initialize Firebase Admin SDK
	// firebase-service-account.json must be in the same directory as the binary
	opt := option.WithCredentialsFile("firebase-service-account.json")
	app, err := firebase.NewApp(context.Background(), nil, opt)
	if err != nil {
		log.Fatalf("Error initializing Firebase app: %v", err)
	}

	authClient, err = app.Auth(context.Background())
	if err != nil {
		log.Fatalf("Error getting Firebase Auth client: %v", err)
	}
	log.Println("Firebase Admin SDK initialized.")

	// 3. Register routes
	http.HandleFunc("/api/signup", signupHandler)
	http.HandleFunc("/api/matches", CreateMatchHandler(db))

	port := os.Getenv("PORT")
	if port == "" {
		port = "8083"
	}

	fmt.Printf("Backend running on port %s\n", port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}

func setCORSHeaders(w http.ResponseWriter, r *http.Request) bool {
	allowedOrigin := os.Getenv("ALLOWED_ORIGIN")
	if allowedOrigin == "" {
		allowedOrigin = "https://pball-score.web.app"
	}

	origin := r.Header.Get("Origin")
	if origin == allowedOrigin {
		w.Header().Set("Access-Control-Allow-Origin", origin)
	} else {
		log.Printf("CORS blocked origin: %s (expected: %s)", origin, allowedOrigin)
	}

	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
	w.Header().Set("Access-Control-Max-Age", "86400")

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return true
	}
	return false
}

func signupHandler(w http.ResponseWriter, r *http.Request) {
	log.Println("signupHandler called successfully")
	if setCORSHeaders(w, r) {
		return
	}

	// Only allow POST
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// --- Decode request body ---
	var req UserSignupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON request body", http.StatusBadRequest)
		return
	}

	// --- Basic input validation ---
	req.Fullname = strings.TrimSpace(req.Fullname)
	req.PhoneNumber = strings.TrimSpace(req.PhoneNumber)
	log.Println("signupHandler :: Fullname and Phonenumber validation START")
	if req.Token == "" {
		http.Error(w, "Missing Firebase token", http.StatusBadRequest)
		return
	}
	if req.Fullname == "" {
		http.Error(w, "Fullname is required", http.StatusBadRequest)
		return
	}
	log.Println("signupHandler :: Fullname and Phonenumber validation END")
	log.Println("signupHandler :: verify Firebase ID Token START")
	// --- Verify Firebase ID token ---
	decodedToken, err := authClient.VerifyIDToken(context.Background(), req.Token)
	if err != nil {
		log.Printf("Invalid Firebase token: %v", err)
		http.Error(w, "Unauthorized: invalid Firebase token", http.StatusUnauthorized)
		return
	}

	// Extract UID and email from the verified token
	firebaseUID := decodedToken.UID
	log.Println("signupHandler :: verify Firebase ID Token END")
	log.Println("signupHandler :: db INSERT START")
	// --- Insert into MySQL ---
	// Column order: firebase_uid, username, email, phone_number
	query := `INSERT INTO users (firebase_uid, fullname, email, phone_number) VALUES (?, ?, ?, ?)`
	_, err = db.ExecContext(context.Background(), query,
		firebaseUID,
		req.Fullname,
		req.Email,
		req.PhoneNumber,
	)
	if err != nil {
		log.Printf("DB insert error for UID %s: %v", firebaseUID, err)

		// Detect duplicate entry (MySQL error 1062)
		if strings.Contains(err.Error(), "Duplicate entry") {
			http.Error(w, "User already exists", http.StatusConflict)
			return
		}

		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}
	log.Println("signupHandler :: db INSERT END")
	log.Printf("New user registered: uid=%s fullname=%s email=%s", firebaseUID, req.Fullname, req.Email)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{
		"message": "User registered successfully",
	})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("writeJSON encode error: %v", err)
	}
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// determineWinner returns the team identifier ("A" or "B") with the
// higher total score. Returns "", false if scores are tied.
func determineWinner(participants []MatchParticipant) (winner string, ok bool) {
	scores := map[string]int{}
	for _, p := range participants {
		scores[p.TeamIdentifier] = p.Score // all members of a team share the same score
	}
	if scores["A"] == scores["B"] {
		return "", false // tie – reject
	}
	if scores["A"] > scores["B"] {
		return "A", true
	}
	return "B", true
}

// ─────────────────────────────────────────────
// HANDLER: POST /matches  –  Record a new match
// ─────────────────────────────────────────────

// CreateMatchHandler inserts a new match + all participant rows in a single
// transaction. Wire it in main.go like:
//
//	http.HandleFunc("/matches", CreateMatchHandler(db))
func CreateMatchHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}

		// ── 1. Parse body ──────────────────────────────────────────────
		var req CreateMatchRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
			return
		}

		// ── 2. Validate ────────────────────────────────────────────────
		if req.SportTypeID == 0 {
			writeError(w, http.StatusBadRequest, "sport_type_id is required")
			return
		}
		if len(req.Participants) < 2 {
			writeError(w, http.StatusBadRequest, "at least 2 participants required")
			return
		}
		for _, p := range req.Participants {
			if p.TeamIdentifier != "A" && p.TeamIdentifier != "B" {
				writeError(w, http.StatusBadRequest, "team_identifier must be 'A' or 'B'")
				return
			}
		}
		winner, ok := determineWinner(req.Participants)
		if !ok {
			writeError(w, http.StatusBadRequest, "tied scores are not allowed; a winner must be determined")
			return
		}

		// ── 3. Transaction ─────────────────────────────────────────────
		tx, err := db.Begin()
		if err != nil {
			log.Printf("db.Begin: %v", err)
			writeError(w, http.StatusInternalServerError, "database error")
			return
		}
		defer func() {
			if err != nil {
				_ = tx.Rollback()
			}
		}()

		// Insert into matches
		var communityVal interface{} = nil
		if req.CommunityID != nil {
			communityVal = *req.CommunityID
		}
		res, err := tx.Exec(
			`INSERT INTO matches (sport_type_id, community_id, location) VALUES (?, ?, ?)`,
			req.SportTypeID, communityVal, req.Location,
		)
		if err != nil {
			log.Printf("insert match: %v", err)
			// surface FK violation clearly
			if me, ok2 := err.(*mysql.MySQLError); ok2 && me.Number == 1452 {
				writeError(w, http.StatusBadRequest, "invalid sport_type_id or community_id")
				return
			}
			writeError(w, http.StatusInternalServerError, "failed to create match")
			return
		}
		matchID64, _ := res.LastInsertId()
		matchID := int(matchID64)

		// Insert each participant into match_results
		stmt, err := tx.Prepare(
			`INSERT INTO match_results (match_id, user_id, team_identifier, score, is_winner)
			 VALUES (?, ?, ?, ?, ?)`,
		)
		if err != nil {
			log.Printf("prepare match_results: %v", err)
			writeError(w, http.StatusInternalServerError, "database error")
			return
		}
		defer stmt.Close()

		for _, p := range req.Participants {
			isWinner := p.TeamIdentifier == winner
			if _, err = stmt.Exec(matchID, p.UserID, p.TeamIdentifier, p.Score, isWinner); err != nil {
				log.Printf("insert match_results: %v", err)
				if me, ok2 := err.(*mysql.MySQLError); ok2 && me.Number == 1452 {
					writeError(w, http.StatusBadRequest, "invalid user_id: "+strconv.Itoa(p.UserID))
					return
				}
				writeError(w, http.StatusInternalServerError, "failed to record participant")
				return
			}
		}

		if err = tx.Commit(); err != nil {
			log.Printf("tx.Commit: %v", err)
			writeError(w, http.StatusInternalServerError, "failed to commit match")
			return
		}

		writeJSON(w, http.StatusCreated, CreateMatchResponse{
			MatchID: matchID,
			Message: "match recorded successfully",
		})
	}
}

// ─────────────────────────────────────────────
// HANDLER: GET /matches/{id}  –  Fetch a match
// ─────────────────────────────────────────────

// GetMatchHandler retrieves a match with all participant details.
// Wire it in main.go like:
//
//	http.HandleFunc("/matches/", GetMatchHandler(db))
//
// The trailing slash means the mux will forward /matches/42 here.
// Extract the ID with: id := strings.TrimPrefix(r.URL.Path, "/matches/")
func GetMatchHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}

		// Extract match ID from path  /matches/{id}
		idStr := r.PathValue("id") // Go 1.22+ net/http path params
		if idStr == "" {
			writeError(w, http.StatusBadRequest, "match id is required")
			return
		}
		matchID, err := strconv.Atoi(idStr)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid match id")
			return
		}

		// ── Fetch match header ─────────────────────────────────────────
		var resp GetMatchResponse
		resp.MatchID = matchID
		var communityID sql.NullInt64
		err = db.QueryRow(
			`SELECT st.name, m.community_id, m.location, m.match_date
			   FROM matches m
			   JOIN sport_types st ON st.id = m.sport_type_id
			  WHERE m.id = ?`,
			matchID,
		).Scan(&resp.SportType, &communityID, &resp.Location, &resp.MatchDate)
		if err == sql.ErrNoRows {
			writeError(w, http.StatusNotFound, "match not found")
			return
		}
		if err != nil {
			log.Printf("query match: %v", err)
			writeError(w, http.StatusInternalServerError, "database error")
			return
		}
		if communityID.Valid {
			v := int(communityID.Int64)
			resp.CommunityID = &v
		}

		// ── Fetch participants ─────────────────────────────────────────
		rows, err := db.Query(
			`SELECT mr.user_id, u.username, mr.team_identifier, mr.score, mr.is_winner
			   FROM match_results mr
			   JOIN users u ON u.id = mr.user_id
			  WHERE mr.match_id = ?`,
			matchID,
		)
		if err != nil {
			log.Printf("query participants: %v", err)
			writeError(w, http.StatusInternalServerError, "database error")
			return
		}
		defer rows.Close()

		resp.Teams = map[string][]TeamMember{"A": {}, "B": {}}
		for rows.Next() {
			var m TeamMember
			var team string
			if err = rows.Scan(&m.UserID, &m.Username, &team, &m.Score, &m.IsWinner); err != nil {
				log.Printf("scan participant: %v", err)
				writeError(w, http.StatusInternalServerError, "database error")
				return
			}
			if m.IsWinner {
				resp.Winner = team
			}
			resp.Teams[team] = append(resp.Teams[team], m)
		}

		writeJSON(w, http.StatusOK, resp)
	}
}

// ─────────────────────────────────────────────
// HANDLER: GET /matches?user_id=X  –  List recent matches for a user
// ─────────────────────────────────────────────

// ListUserMatchesHandler returns the last N matches for a given user.
// Wire it in main.go like:
//
//	http.HandleFunc("/matches", func(w http.ResponseWriter, r *http.Request) {
//	    if r.Method == http.MethodGet { ListUserMatchesHandler(db)(w, r) } else { CreateMatchHandler(db)(w, r) }
//	})
func ListUserMatchesHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userIDStr := r.URL.Query().Get("user_id")
		if userIDStr == "" {
			writeError(w, http.StatusBadRequest, "user_id query param is required")
			return
		}
		userID, err := strconv.Atoi(userIDStr)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid user_id")
			return
		}
		limit := 20
		if l := r.URL.Query().Get("limit"); l != "" {
			if parsed, err2 := strconv.Atoi(l); err2 == nil && parsed > 0 {
				limit = parsed
			}
		}

		rows, err := db.Query(
			`SELECT m.id, st.name, m.location, m.match_date,
			        mr.team_identifier, mr.score, mr.is_winner
			   FROM match_results mr
			   JOIN matches m     ON m.id  = mr.match_id
			   JOIN sport_types st ON st.id = m.sport_type_id
			  WHERE mr.user_id = ?
			  ORDER BY m.match_date DESC
			  LIMIT ?`,
			userID, limit,
		)
		if err != nil {
			log.Printf("ListUserMatches query: %v", err)
			writeError(w, http.StatusInternalServerError, "database error")
			return
		}
		defer rows.Close()

		type MatchSummary struct {
			MatchID   int       `json:"match_id"`
			SportType string    `json:"sport_type"`
			Location  string    `json:"location"`
			MatchDate time.Time `json:"match_date"`
			Team      string    `json:"team"`
			Score     int       `json:"score"`
			IsWinner  bool      `json:"is_winner"`
		}

		var matches []MatchSummary
		for rows.Next() {
			var ms MatchSummary
			if err = rows.Scan(&ms.MatchID, &ms.SportType, &ms.Location, &ms.MatchDate, &ms.Team, &ms.Score, &ms.IsWinner); err != nil {
				log.Printf("scan match summary: %v", err)
				writeError(w, http.StatusInternalServerError, "database error")
				return
			}
			matches = append(matches, ms)
		}
		if matches == nil {
			matches = []MatchSummary{} // return [] not null
		}

		writeJSON(w, http.StatusOK, matches)
	}
}
