# 💊 MedRemind – Smart Medicine & Health Routine Manager

MedRemind is a medicine and health routine management application designed to make medication tracking and daily health routines simpler.

It helps users manage medicines, organize schedules, receive reminders, and scan prescriptions.

## ✨ Features

- **Medicine Management** – Add, update, and manage medicines.
- **Smart Reminders** – Schedule medication reminders with custom timings.
- **Prescription Scanner** – Scan prescriptions and extract medicine information.
- **Health Dashboard** – Track medication routines and activity.
- **Caregiver Support** – Support for patients and caregivers.
- **Multilingual Interface** – Designed to be accessible to a wider audience.

## 📥 Download the App

The Android APK will be available under [GitHub Releases](https://github.com/Zxuri-E/MedRemind/releases).

1. Open the Releases section.
2. Download the latest APK.
3. Open the downloaded APK on your Android device.
4. Follow Android's installation prompts.

Always download releases from this official repository.

## 🛠️ Run from Source

### Requirements
- Node.js and npm
- Git
- Android Studio (for Android development)

### 1. Clone the repository

\`\`\`bash
git clone https://github.com/Zxuri-E/MedRemind.git
cd MedRemind
\`\`\`

### 2. Install frontend dependencies

\`\`\`bash
npm install
\`\`\`

### 3. Start the frontend

\`\`\`bash
npm run dev
\`\`\`

### 4. Set up the backend

Open another terminal:

\`\`\`bash
cd backend
npm install
npm start
\`\`\`

Configure the required environment variables before starting the backend. Never commit API keys, passwords, or private credentials.

## 📱 Android Build

The project uses Capacitor for Android integration.

\`\`\`bash
npm run build
npx cap sync android
\`\`\`

Open the \`android\` folder in Android Studio to build and test the application.

## ⚠️ Disclaimer

MedRemind is a medication organization and reminder tool. It does not replace professional medical advice, diagnosis, or treatment. Always verify prescription information with a qualified healthcare professional.

## 👥 Developed By

**NTS – Team 3**

- Aaryan Singhania
- Naman Thard
- Tanishq Ghosh

Developed as a hackathon project.
