package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"

	firebase "firebase.google.com/go/v4"
	"firebase.google.com/go/v4/auth"
	_ "github.com/go-sql-driver/mysql"
	"google.golang.org/api/option"
)

type UserSignupRequest struct {
	Token    string `json:"token"`
	Username string `json:"username"`
}

var db *sql.DB
var authClient *auth.Client

func main() {
	// 1. Initialize Database
	dsn := fmt.Sprintf("%s:%s@tcp(%s)/%s?parseTime=true",
		os.Getenv("DB_USER"), os.Getenv("DB_PASSWORD"), os.Getenv("DB_HOST"), os.Getenv("DB_NAME"))

	var err error
	db, err = sql.Open("mysql", dsn)
	if err != nil {
		log.Fatal(err)
	}

	// 2. Initialize Firebase Admin
	// Ensure you upload your firebase-service-account.json to the server
	opt := option.WithCredentialsFile("firebase-service-account.json")
	app, err := firebase.NewApp(context.Background(), nil, opt)
	if err != nil {
		log.Fatalf("error initializing app: %v\n", err)
	}

	authClient, err = app.Auth(context.Background())
	if err != nil {
		log.Fatalf("error getting Auth client: %v\n", err)
	}

	// 3. Routes
	http.HandleFunc("/api/signup", signupHandler)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8083"
	}

	fmt.Printf("PBall Backend running on port %s\n", port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}

func signupHandler(w http.ResponseWriter, r *http.Request) {
	// Handle CORS for Firebase Hosting
	w.Header().Set("Access-Control-Allow-Origin", os.Getenv("ALLOWED_ORIGIN"))
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == "OPTIONS" {
		return
	}

	var req UserSignupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	// Verify the Firebase Token sent from Frontend
	token, err := authClient.VerifyIDToken(context.Background(), req.Token)
	if err != nil {
		http.Error(w, "Invalid Firebase Token", http.StatusUnauthorized)
		return
	}

	email := token.Claims["email"].(string)

	// Save to MariaDB
	query := "INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)"
	_, err = db.Exec(query, req.Username, email, "FIREBASE_AUTH") // password handled by Firebase
	if err != nil {
		http.Error(w, "Database error or User already exists", http.StatusInternalServerError)
		log.Println("DB Error:", err)
		return
	}

	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{"message": "User registered successfully"})
}
