import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const zipDest = path.resolve(rootDir, '..', 'MedRemind-Hardened-SourceCode.zip');

if (fs.existsSync(zipDest)) {
  fs.unlinkSync(zipDest);
}

const tempDir = path.join(process.env.TEMP || 'C:\\temp', `medremind_src_${Date.now()}`);
fs.mkdirSync(tempDir, { recursive: true });

console.log('Copying clean source files to temp directory...');
try {
  execSync(
    `robocopy "${rootDir}" "${tempDir}" /E /XD node_modules .git .gradle build .idea .vscode dist backups /XF *.log .auth_secret *.apk *.zip /R:1 /W:1`,
    { stdio: 'ignore' }
  );
} catch (e) {
  // Robocopy returns codes 1-7 when files are copied successfully
}

// Eliminate any residual credentials or patient files
const secretFile = path.join(tempDir, 'backend', 'data', '.auth_secret');
if (fs.existsSync(secretFile)) fs.unlinkSync(secretFile);

const uploadsDir = path.join(tempDir, 'backend', 'uploads');
if (fs.existsSync(uploadsDir)) {
  fs.readdirSync(uploadsDir).forEach(f => {
    if (f !== '.gitkeep') fs.unlinkSync(path.join(uploadsDir, f));
  });
}

const backupsDir = path.join(tempDir, 'backend', 'data', 'backups');
if (fs.existsSync(backupsDir)) {
  fs.readdirSync(backupsDir).forEach(f => {
    if (f !== '.gitkeep') fs.unlinkSync(path.join(backupsDir, f));
  });
}

console.log('Creating ZIP archive with tar...');
execSync(`tar -a -c -f "${zipDest}" -C "${tempDir}" .`, { stdio: 'inherit' });

fs.rmSync(tempDir, { recursive: true, force: true });

const stat = fs.statSync(zipDest);
console.log(`[SUCCESS] Packaged hardened ZIP at: ${zipDest} (${(stat.size / (1024 * 1024)).toFixed(2)} MB)`);
