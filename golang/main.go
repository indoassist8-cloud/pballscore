package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"

	firebase "firebase.google.com/go/v4"
	"firebase.google.com/go/v4/auth"
	_ "github.com/go-sql-driver/mysql"
	"google.golang.org/api/option"
)

// UserSignupRequest is the JSON body expected from the frontend
type UserSignupRequest struct {
	Token       string `json:"token"`
	Fullname    string `json:"fullname"`
	PhoneNumber string `json:"phone_number"`
}

var db *sql.DB
var authClient *auth.Client

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

	port := os.Getenv("PORT")
	if port == "" {
		port = "8083"
	}

	fmt.Printf("Backend running on port %s\n", port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}

func signupHandler(w http.ResponseWriter, r *http.Request) {
	// --- CORS headers ---
	allowedOrigin := os.Getenv("ALLOWED_ORIGIN")
	w.Header().Set("Access-Control-Allow-Origin", allowedOrigin)
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	// Preflight request
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
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

	if req.Token == "" {
		http.Error(w, "Missing Firebase token", http.StatusBadRequest)
		return
	}
	if req.Fullname == "" {
		http.Error(w, "Fullname is required", http.StatusBadRequest)
		return
	}

	// --- Verify Firebase ID token ---
	decodedToken, err := authClient.VerifyIDToken(context.Background(), req.Token)
	if err != nil {
		log.Printf("Invalid Firebase token: %v", err)
		http.Error(w, "Unauthorized: invalid Firebase token", http.StatusUnauthorized)
		return
	}

	// Extract UID and email from the verified token
	firebaseUID := decodedToken.UID

	email, ok := decodedToken.Claims["email"].(string)
	if !ok || email == "" {
		http.Error(w, "Could not retrieve email from token", http.StatusBadRequest)
		return
	}

	// --- Insert into MySQL ---
	// Column order: firebase_uid, username, email, phone_number
	query := `INSERT INTO users (firebase_uid, fullname, email, phone_number) VALUES (?, ?, ?, ?)`
	_, err = db.ExecContext(context.Background(), query,
		firebaseUID,
		req.Fullname,
		email,
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

	log.Printf("New user registered: uid=%s fullname=%s email=%s", firebaseUID, req.Fullname, email)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{
		"message": "User registered successfully",
	})
}
