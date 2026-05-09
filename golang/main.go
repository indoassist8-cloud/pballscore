package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	firebase "firebase.google.com/go/v4"
	"firebase.google.com/go/v4/auth"
	"github.com/go-sql-driver/mysql"
	_ "github.com/go-sql-driver/mysql"
	"github.com/gorilla/mux"
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

type SetScore struct {
	SetNumber  int `json:"set_number"`
	ScoreTeamA int `json:"score_team_a"`
	ScoreTeamB int `json:"score_team_b"`
}

type Community struct {
	ID          int       `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	CreatorID   string    `json:"creator_id"`
	InviteCode  string    `json:"invite_code"`
	CreatedAt   time.Time `json:"created_at"`
	MemberCount int       `json:"member_count,omitempty"`
	UserRole    string    `json:"user_role,omitempty"` // populated when fetching user's communities
}

// ─────────────────────────────────────────
// Request Payloads (what the frontend sends)
// ─────────────────────────────────────────

// POST /communities
//
//	{
//	  "name": "Downtown Picklers",
//	  "description": "Weekly games at downtown courts",
//	  "creator_id": 42
//	}
type CreateCommunityRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	CreatorID   string `json:"creator_id"`
}

// PUT /communities/{id}
//
//	{
//	  "name": "Updated Name",
//	  "description": "Updated description"
//	}
type UpdateCommunityRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

// POST /communities/join
//
//	{
//	  "user_id": 42,
//	  "invite_code": "ABC123XY"
//	}
type JoinCommunityRequest struct {
	UserID     string `json:"user_id"`
	InviteCode string `json:"invite_code"`
}

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
	UserID         *string `json:"user_id"`
	GuestName      *string `json:"guest_name"`
	TeamIdentifier string  `json:"team_identifier"` // "A" or "B"
	Score          int     `json:"score"`
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
	Sets         []SetScore         `json:"sets"`
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
	Sets        []SetScore              `json:"sets"`
}

// TeamMember is one row from match_results joined with users.

type TeamMember struct {
	UserID    *string `json:"user_id"`    // pointer = nullable
	Username  *string `json:"username"`   // pointer = nullable
	GuestName *string `json:"guest_name"` // only for guests
	Score     int     `json:"score"`
	IsWinner  bool    `json:"is_winner"`
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
	r := mux.NewRouter()

	r.Methods("OPTIONS").HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		setCORSHeaders(w, r)
	})

	// 3. Register routes
	r.HandleFunc("/api/signup", signupHandler).Methods("POST", "OPTIONS")
	r.HandleFunc("/api/matches", CreateMatchHandler(db)).Methods("POST", "OPTIONS")
	// Add this line with your other r.HandleFunc lines
	r.HandleFunc("/api/matches", ListUserMatchesHandler(db)).Methods("GET", "OPTIONS")
	// handler for community
	RegisterCommunityRoutes(r, db)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8083"
	}

	fmt.Printf("Backend running on port %s\n", port)
	log.Fatal(http.ListenAndServe(":"+port, corsMiddleware(r)))
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

	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS") // ← added GET, PUT, DELETE
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
	w.Header().Set("Access-Control-Max-Age", "86400")

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return true
	}
	return false
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "https://pball-score.web.app")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		w.Header().Set("Access-Control-Max-Age", "86400")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
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

		for _, p := range req.Participants {
			if p.TeamIdentifier != "A" && p.TeamIdentifier != "B" {
				writeError(w, http.StatusBadRequest, "team_identifier must be 'A' or 'B'")
				return
			}
			// add this:
			if (p.UserID == nil) == (p.GuestName == nil) {
				writeError(w, http.StatusBadRequest, "each participant must have either user_id or guest_name, not both or neither")
				return
			}
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
			`INSERT INTO match_results (match_id, user_id, guest_name, team_identifier, score, is_winner)
			 VALUES (?, ?, ?, ?, ?, ?)`,
		)
		if err != nil {
			log.Printf("prepare match_results: %v", err)
			writeError(w, http.StatusInternalServerError, "database error")
			return
		}
		defer stmt.Close()

		for _, p := range req.Participants {
			isWinner := p.TeamIdentifier == winner
			if _, err = stmt.Exec(matchID, p.UserID, p.GuestName, p.TeamIdentifier, p.Score, isWinner); err != nil {
				log.Printf("insert match_results: %v", err)
				if me, ok2 := err.(*mysql.MySQLError); ok2 && me.Number == 1452 {
					writeError(w, http.StatusBadRequest, "invalid user_id")
					return
				}
				writeError(w, http.StatusInternalServerError, "failed to record participant")
				return
			}
		}

		// Insert sets if provided
		if len(req.Sets) > 0 {
			setStmt, err := tx.Prepare(
				`INSERT INTO match_sets (match_id, set_number, score_team_a, score_team_b)
         VALUES (?, ?, ?, ?)`,
			)
			if err != nil {
				writeError(w, http.StatusInternalServerError, "database error")
				return
			}
			defer setStmt.Close()

			for _, s := range req.Sets {
				if _, err = setStmt.Exec(matchID, s.SetNumber, s.ScoreTeamA, s.ScoreTeamB); err != nil {
					writeError(w, http.StatusInternalServerError, "failed to record set scores")
					return
				}
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
			`SELECT mr.user_id, u.username, mr.guest_name, mr.team_identifier, mr.score, mr.is_winner
			FROM match_results mr
			LEFT JOIN users u ON u.firebase_uid = mr.user_id  -- LEFT JOIN so guests still appear
			WHERE mr.match_id = ?`,
			matchID,
		)
		if err != nil {
			log.Printf("query participants: %v", err)
			writeError(w, http.StatusInternalServerError, "database error")
			return
		}
		defer rows.Close()

		// after fetching participants, add:
		setRows, err := db.Query(
			`SELECT set_number, score_team_a, score_team_b 
       FROM match_sets 
      WHERE match_id = ? 
      ORDER BY set_number`,
			matchID,
		)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "database error")
			return
		}
		defer setRows.Close()

		resp.Sets = []SetScore{}
		for setRows.Next() {
			var s SetScore
			if err = setRows.Scan(&s.SetNumber, &s.ScoreTeamA, &s.ScoreTeamB); err != nil {
				writeError(w, http.StatusInternalServerError, "database error")
				return
			}
			resp.Sets = append(resp.Sets, s)
		}

		resp.Teams = map[string][]TeamMember{"A": {}, "B": {}}
		for rows.Next() {
			var m TeamMember
			var team string
			if err = rows.Scan(&m.UserID, &m.Username, &m.GuestName, &team, &m.Score, &m.IsWinner); err != nil {
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

/*
backup ori from claude*/

func ListUserMatchesHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := r.URL.Query().Get("user_id")
		if userID == "" {
			writeError(w, http.StatusBadRequest, "user_id query param is required")
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

/*
func ListUserMatchesHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := r.URL.Query().Get("user_id")
		if userID == "" {
			writeError(w, http.StatusBadRequest, "user_id query param is required")
			return
		}

		limit := 20
		if l := r.URL.Query().Get("limit"); l != "" {
			if parsed, err2 := strconv.Atoi(l); err2 == nil && parsed > 0 {
				limit = parsed
			}
		}

		// 1. Fetch match summaries
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
			MatchID   int        `json:"match_id"`
			SportType string     `json:"sport_type"`
			Location  string     `json:"location"`
			MatchDate time.Time  `json:"match_date"`
			Team      string     `json:"team"`
			Score     int        `json:"score"`
			IsWinner  bool       `json:"is_winner"`
			Sets      []SetScore `json:"sets"`
		}

		var matches []MatchSummary
		var matchIDs []interface{} // Needs to be interface{} to be passed directly to db.Query

		for rows.Next() {
			var ms MatchSummary
			if err = rows.Scan(&ms.MatchID, &ms.SportType, &ms.Location, &ms.MatchDate, &ms.Team, &ms.Score, &ms.IsWinner); err != nil {
				log.Printf("scan match summary: %v", err)
				writeError(w, http.StatusInternalServerError, "database error")
				return
			}
			ms.Sets = []SetScore{} // Initialize to empty slice so JSON is [] instead of null
			matches = append(matches, ms)
			matchIDs = append(matchIDs, ms.MatchID)
		}
		if matches == nil {
			matches = []MatchSummary{}
		}

		// 2. Fetch set details only for the fetched matches
		if len(matchIDs) > 0 {
			// Build the dynamic SQL placeholders: (?, ?, ?, ...)
			placeholders := make([]string, len(matchIDs))
			for i := range matchIDs {
				placeholders[i] = "?"
			}

			// Construct query: SELECT ... WHERE match_id IN (?, ?, ?) ORDER BY set_number
			query := fmt.Sprintf(
				`SELECT match_id, set_number, score_team_a, score_team_b
                 FROM match_sets
                 WHERE match_id IN (%s)
                 ORDER BY set_number`,
				strings.Join(placeholders, ","),
			)

			// Pass the constructed query and spread the matchIDs slice as arguments
			setRows, err := db.Query(query, matchIDs...)
			if err != nil {
				log.Printf("query match sets: %v", err)
				writeError(w, http.StatusInternalServerError, "database error")
				return
			}
			defer setRows.Close()

			// Map each set to its respective match
			for setRows.Next() {
				var mid int
				var s SetScore
				if err = setRows.Scan(&mid, &s.SetNumber, &s.ScoreTeamA, &s.ScoreTeamB); err != nil {
					log.Printf("scan match set: %v", err)
					writeError(w, http.StatusInternalServerError, "database error")
					return
				}

				// Find the match this set belongs to and append it
				for i := range matches {
					if matches[i].MatchID == mid {
						matches[i].Sets = append(matches[i].Sets, s)
					}
				}
			}
		}

		writeJSON(w, http.StatusOK, matches)
	}
}
*/
/////////
//// 6 May 2026 - add communities helper
/////////

// ─────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────

func generateInviteCode(n int) string {
	const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	rand.Seed(time.Now().UnixNano())
	b := make([]byte, n)
	for i := range b {
		b[i] = letters[rand.Intn(len(letters))]
	}
	return string(b)
}

// ─────────────────────────────────────────
// Handlers
// ─────────────────────────────────────────

// GET /communities
// Returns all communities with member count.
func GetAllCommunities(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rows, err := db.Query(`
			SELECT c.id, c.name, c.description, c.creator_id, c.invite_code, c.created_at,
			       COUNT(cm.user_id) AS member_count
			FROM communities c
			LEFT JOIN community_members cm ON c.id = cm.community_id
			GROUP BY c.id
			ORDER BY c.created_at DESC
		`)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to query communities")
			return
		}
		defer rows.Close()

		var communities []Community
		for rows.Next() {
			var c Community
			if err := rows.Scan(&c.ID, &c.Name, &c.Description, &c.CreatorID, &c.InviteCode, &c.CreatedAt, &c.MemberCount); err != nil {
				writeError(w, http.StatusInternalServerError, "failed to scan row")
				return
			}
			communities = append(communities, c)
		}
		if communities == nil {
			communities = []Community{}
		}
		writeJSON(w, http.StatusOK, communities)
	}
}

// GET /communities/user/{user_id}
// Returns all communities the user belongs to, with their role.
func GetUserCommunities(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		userID := vars["user_id"]

		rows, err := db.Query(`
			SELECT c.id, c.name, c.description, c.creator_id, c.invite_code, c.created_at,
			       COUNT(cm2.user_id) AS member_count,
			       cm.role AS user_role
			FROM communities c
			JOIN community_members cm  ON c.id = cm.community_id AND cm.user_id = ?
			LEFT JOIN community_members cm2 ON c.id = cm2.community_id
			GROUP BY c.id, cm.role
			ORDER BY c.created_at DESC
		`, userID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to query user communities")
			return
		}
		defer rows.Close()

		var communities []Community
		for rows.Next() {
			var c Community
			if err := rows.Scan(&c.ID, &c.Name, &c.Description, &c.CreatorID, &c.InviteCode, &c.CreatedAt, &c.MemberCount, &c.UserRole); err != nil {
				writeError(w, http.StatusInternalServerError, "failed to scan row")
				return
			}
			communities = append(communities, c)
		}
		if communities == nil {
			communities = []Community{}
		}
		writeJSON(w, http.StatusOK, communities)
	}
}

// POST /communities
// Creates a new community and auto-joins the creator as admin.
//
// Payload:
//
//	{ "name": "Downtown Picklers", "description": "...", "creator_id": 42 }
func CreateCommunity(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req CreateCommunityRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid JSON body")
			return
		}
		req.Name = strings.TrimSpace(req.Name)
		if req.Name == "" {
			writeError(w, http.StatusBadRequest, "name is required")
			return
		}
		if req.CreatorID == "" {
			writeError(w, http.StatusBadRequest, "creator_id is required")
			return
		}

		inviteCode := generateInviteCode(8)

		tx, err := db.Begin()
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to begin transaction")
			return
		}

		res, err := tx.Exec(
			`INSERT INTO communities (name, description, creator_id, invite_code) VALUES (?, ?, ?, ?)`,
			req.Name, req.Description, req.CreatorID, inviteCode,
		)
		if err != nil {
			tx.Rollback()
			writeError(w, http.StatusInternalServerError, "failed to create community")
			return
		}

		communityID, _ := res.LastInsertId()

		// Auto-join creator as admin
		_, err = tx.Exec(
			`INSERT INTO community_members (user_id, community_id, role) VALUES (?, ?, 'admin')`,
			req.CreatorID, communityID,
		)
		if err != nil {
			tx.Rollback()
			writeError(w, http.StatusInternalServerError, "failed to add creator as member")
			return
		}

		if err := tx.Commit(); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to commit transaction")
			return
		}

		community := Community{
			ID:          int(communityID),
			Name:        req.Name,
			Description: req.Description,
			CreatorID:   req.CreatorID,
			InviteCode:  inviteCode,
			CreatedAt:   time.Now(),
			MemberCount: 1,
			UserRole:    "admin",
		}
		writeJSON(w, http.StatusCreated, community)
	}
}

// PUT /communities/{id}
// Updates name / description. Only the creator or an admin may do this.
//
// Payload:
//
//	{ "name": "New Name", "description": "New description" }
func UpdateCommunity(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		id, err := strconv.Atoi(vars["id"])
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid community id")
			return
		}

		var req UpdateCommunityRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid JSON body")
			return
		}
		req.Name = strings.TrimSpace(req.Name)
		if req.Name == "" {
			writeError(w, http.StatusBadRequest, "name is required")
			return
		}

		result, err := db.Exec(
			`UPDATE communities SET name = ?, description = ? WHERE id = ?`,
			req.Name, req.Description, id,
		)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to update community")
			return
		}
		rows, _ := result.RowsAffected()
		if rows == 0 {
			writeError(w, http.StatusNotFound, "community not found")
			return
		}

		writeJSON(w, http.StatusOK, map[string]string{"message": "community updated"})
	}
}

// DELETE /communities/{id}
// Deletes a community. Only the creator should call this (enforce on your auth middleware).
func DeleteCommunity(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		id, err := strconv.Atoi(vars["id"])
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid community id")
			return
		}

		tx, err := db.Begin()
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to begin transaction")
			return
		}

		// Remove all members first (foreign key constraint)
		if _, err := tx.Exec(`DELETE FROM community_members WHERE community_id = ?`, id); err != nil {
			tx.Rollback()
			writeError(w, http.StatusInternalServerError, "failed to remove members")
			return
		}

		result, err := tx.Exec(`DELETE FROM communities WHERE id = ?`, id)
		if err != nil {
			tx.Rollback()
			writeError(w, http.StatusInternalServerError, "failed to delete community")
			return
		}

		rows, _ := result.RowsAffected()
		if rows == 0 {
			tx.Rollback()
			writeError(w, http.StatusNotFound, "community not found")
			return
		}

		tx.Commit()
		writeJSON(w, http.StatusOK, map[string]string{"message": "community deleted"})
	}
}

// POST /communities/join
// Lets a user join a community using an invite code.
//
// Payload:
//
//	{ "user_id": 42, "invite_code": "ABC123XY" }
func JoinCommunity(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req JoinCommunityRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid JSON body")
			return
		}
		if req.UserID == "" || req.InviteCode == "" {
			writeError(w, http.StatusBadRequest, "user_id and invite_code are required")
			return
		}

		var communityID int
		err := db.QueryRow(`SELECT id FROM communities WHERE invite_code = ?`, req.InviteCode).Scan(&communityID)
		if err == sql.ErrNoRows {
			writeError(w, http.StatusNotFound, "invalid invite code")
			return
		} else if err != nil {
			writeError(w, http.StatusInternalServerError, "database error")
			return
		}

		_, err = db.Exec(
			`INSERT IGNORE INTO community_members (user_id, community_id, role) VALUES (?, ?, 'member')`,
			req.UserID, communityID,
		)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to join community")
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"message":      "joined community",
			"community_id": communityID,
		})
	}
}

// DELETE /communities/{id}/leave
// Lets a user leave a community.
// Pass user_id as a query param: /communities/5/leave?user_id=42
func LeaveCommunity(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		communityID, err := strconv.Atoi(vars["id"])
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid community id")
			return
		}
		userID := r.URL.Query().Get("user_id")
		if err != nil || userID == "" {
			writeError(w, http.StatusBadRequest, "user_id query param is required")
			return
		}

		result, err := db.Exec(
			`DELETE FROM community_members WHERE user_id = ? AND community_id = ?`,
			userID, communityID,
		)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to leave community")
			return
		}
		rows, _ := result.RowsAffected()
		if rows == 0 {
			writeError(w, http.StatusNotFound, "membership not found")
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"message": "left community"})
	}
}

// ─────────────────────────────────────────
// Route registration  (call this in main.go)
// ─────────────────────────────────────────
func RegisterCommunityRoutes(r *mux.Router, db *sql.DB) {
	r.HandleFunc("/api/communities", GetAllCommunities(db)).Methods("GET", "OPTIONS")
	r.HandleFunc("/api/communities/user/{user_id}", GetUserCommunities(db)).Methods("GET", "OPTIONS")
	r.HandleFunc("/api/communities", CreateCommunity(db)).Methods("POST", "OPTIONS")
	r.HandleFunc("/api/communities/{id}", UpdateCommunity(db)).Methods("PUT", "OPTIONS")
	r.HandleFunc("/api/communities/{id}", DeleteCommunity(db)).Methods("DELETE", "OPTIONS")
	r.HandleFunc("/api/communities/join", JoinCommunity(db)).Methods("POST", "OPTIONS")
	r.HandleFunc("/api/communities/{id}/leave", LeaveCommunity(db)).Methods("DELETE", "OPTIONS")
}
