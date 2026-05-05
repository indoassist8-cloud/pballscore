# --- CONFIGURATION ---
$SERVER_IP = "159.223.84.18"
$REMOTE_PATH = "/opt/n8n-docker-caddy/pball"
$BINARY_NAME = "pballbackend"
$SERVICE_NAME = "pball"

Clear-Host
Write-Host "Deploying Go Backend (Stop -> Upload -> Start)" -ForegroundColor Yellow
Write-Host "-------------------------------------------"

# 0. Stop the Service (to unlock the file)
Write-Host "Stopping $SERVICE_NAME..." -ForegroundColor Gray
ssh root@$SERVER_IP "sudo systemctl stop $SERVICE_NAME"

# 1. Compile for Linux
Write-Host "Compiling binary..." -ForegroundColor Gray
$env:GOOS="linux"; $env:GOARCH="amd64"
go build -o $BINARY_NAME .

# 2. Upload
Write-Host "Uploading to server..." -ForegroundColor Gray
scp ./$BINARY_NAME root@${SERVER_IP}:${REMOTE_PATH}/$BINARY_NAME

# 3. Permissions and Restart
Write-Host "Starting $SERVICE_NAME service..." -ForegroundColor Gray
ssh root@$SERVER_IP "chmod +x ${REMOTE_PATH}/${BINARY_NAME}; sudo systemctl start $SERVICE_NAME"

Write-Host "Backend Updated and Service Restarted!" -ForegroundColor Green