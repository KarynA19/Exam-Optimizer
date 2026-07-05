# Exam Optimizer

## Local Run

### Prerequisites
- Python 3.11+
- Node.js 20+
- npm 10+
- MongoDB (optional, only needed for saved setups)

### 1) Run Backend (FastAPI)
From the project root:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Backend URL: http://localhost:8000
Health check: http://localhost:8000/health

Optional backend env file: `backend/.env`

```env
ALLOWED_ORIGINS=http://localhost:5173
MONGODB_URI=mongodb://localhost:27017
MONGODB_DATABASE=exam_optimizer
SINGLE_USER_ID=your-username
SINGLE_USER_PASSWORD=your-password
JWT_SECRET=change-this-secret-in-production
JWT_EXPIRATION_MINUTES=10080
```

### 2) Run Frontend (Vite + React)
Open a new terminal, from the project root:

```powershell
cd frontend
npm install
npm run dev
```

Frontend URL: http://localhost:5173

Optional frontend env file: `frontend/.env`

```env
VITE_API_BASE=http://localhost:8000/api
```

## Notes
- In dev mode, frontend API base defaults to http://localhost:8000/api.
