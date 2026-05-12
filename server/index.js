import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';
import dotenv from 'dotenv';
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_not_for_production';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// SQLite setup
const db = new Database('database.sqlite');

// Initialize database
db.exec(`
  CREATE TABLE IF NOT EXISTS downloads (
    id TEXT PRIMARY KEY,
    youtube_url TEXT NOT NULL,
    artist TEXT NOT NULL,
    title TEXT NOT NULL,
    file_path TEXT NOT NULL,
    thumbnail_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    is_admin INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Seed initial admin user if none exists
const userCount = db.prepare('SELECT count(*) as count FROM users').get().count;
if (userCount === 0) {
  const adminId = randomUUID();
  const hashedPassword = bcrypt.hashSync('admin_password', 10);
  db.prepare(`
    INSERT INTO users (id, name, username, password_hash, is_active, is_admin)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(adminId, 'Administrator', 'admin', hashedPassword, 1, 1);
  console.log('Initial admin user created: admin / admin_password');
}

app.use(cors());
app.use(express.json());

// Auth Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.sendStatus(401);

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
}

function isAdmin(req, res, next) {
  if (req.user && req.user.is_admin) {
    next();
  } else {
    res.status(403).json({ error: 'Admin access required' });
  }
}

// Ensure downloads directory exists
const downloadsDir = path.join(__dirname, '../downloads');
if (!fs.existsSync(downloadsDir)) {
  fs.mkdirSync(downloadsDir, { recursive: true });
}

// Serve downloads folder as static files
app.use('/files', express.static(downloadsDir));

/**
 * Helper to execute yt-dlp commands
 */
async function runYtDlp(args) {
  // Join arguments and escape them properly for the shell
  const command = `yt-dlp ${args.join(' ')}`;
  console.log(`Executing: ${command}`);
  const { stdout, stderr } = await execAsync(command);
  if (stderr && !stdout) throw new Error(stderr);
  return stdout;
}

// Auth Routes
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1').get(username);

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const token = jwt.sign(
    { id: user.id, username: user.username, is_admin: user.is_admin },
    JWT_SECRET,
    { expiresIn: '24h' }
  );

  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      name: user.name,
      is_admin: user.is_admin
    }
  });
});

app.get('/api/me', authenticateToken, (req, res) => {
  const user = db.prepare('SELECT id, name, username, is_admin, is_active FROM users WHERE id = ?').get(req.user.id);
  res.json(user);
});

// User Management Routes (Admin Only)
app.get('/api/users', authenticateToken, isAdmin, (req, res) => {
  const users = db.prepare('SELECT id, name, username, is_active, is_admin, created_at FROM users').all();
  res.json(users);
});

app.post('/api/users', authenticateToken, isAdmin, (req, res) => {
  const { name, username, password, is_admin } = req.body;
  try {
    const id = randomUUID();
    const hashedPassword = bcrypt.hashSync(password, 10);
    db.prepare(`
      INSERT INTO users (id, name, username, password_hash, is_active, is_admin)
      VALUES (?, ?, ?, ?, 1, ?)
    `).run(id, name, username, hashedPassword, is_admin ? 1 : 0);
    res.status(201).json({ success: true, id });
  } catch (error) {
    res.status(400).json({ error: 'Username already exists or invalid data' });
  }
});

app.patch('/api/users/:id', authenticateToken, isAdmin, (req, res) => {
  const { id } = req.params;
  const { name, username, password, is_active, is_admin } = req.body;
  
  try {
    let query = 'UPDATE users SET name = ?, username = ?, is_active = ?, is_admin = ?';
    const params = [name, username, is_active ? 1 : 0, is_admin ? 1 : 0];

    if (password) {
      query += ', password_hash = ?';
      params.push(bcrypt.hashSync(password, 10));
    }

    query += ' WHERE id = ?';
    params.push(id);

    db.prepare(query).run(...params);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: 'Update failed' });
  }
});

app.delete('/api/users/:id', authenticateToken, isAdmin, (req, res) => {
  const { id } = req.params;
  if (id === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });
  
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ success: true });
});

// Search YouTube - Protected
app.post('/api/search', authenticateToken, async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'Query is required' });

  try {
    // Use the exact flags: ytsearch20, --dump-json, --flat-playlist, --no-warnings
    const output = await runYtDlp([
      `"ytsearch30:${query.replace(/"/g, '')}"`,
      '--dump-json',
      '--flat-playlist',
      '--no-warnings'
    ]);

    // yt-dlp returns one JSON object per line for search results
    const videos = output.split('\n')
      .filter(line => line.trim())
      .map(line => {
        try {
          const data = JSON.parse(line);
          return {
            id: data.id,
            title: data.title,
            url: data.url || `https://www.youtube.com/watch?v=${data.id}`,
            thumbnails: data.thumbnails || [{ url: `https://i.ytimg.com/vi/${data.id}/hqdefault.jpg` }]
          };
        } catch (e) {
          return null;
        }
      })
      .filter(v => v !== null);

    res.json(videos);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Failed to search YouTube.' });
  }
});

// Download Video Logic - Protected
app.post('/api/download', authenticateToken, async (req, res) => {
  const { url, artist, title, thumbnailUrl } = req.body;

  try {
    const fileName = `${artist} - ${title} [YT].mp4`;
    const filePath = path.join(downloadsDir, fileName);

    // Execute download command
    await runYtDlp([
      `"${url}"`,
      '-f', '"bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best"',
      '--merge-output-format', 'mp4',
      '-o', `"${filePath}"`,
      '--no-playlist',
      '--no-warnings'
    ]);

    const id = randomUUID();
    const stmt = db.prepare(`
      INSERT INTO downloads (id, youtube_url, artist, title, file_path, thumbnail_url)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(id, url, artist, title, fileName, thumbnailUrl);

    const record = db.prepare('SELECT * FROM downloads WHERE id = ?').get(id);

    res.json({ success: true, data: record });
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: 'Failed to download video' });
  }
});

app.get('/api/history', authenticateToken, (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM downloads ORDER BY created_at DESC').all();
    res.json(rows);
  } catch (error) {
    console.error('History fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

app.get('/api/status/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const record = db.prepare('SELECT * FROM downloads WHERE id = ?').get(id);

    if (!record) return res.status(404).json({ error: 'Record not found' });

    const filePath = path.join(downloadsDir, record.file_path);
    const exists = fs.existsSync(filePath);

    res.json({
      exists,
      record,
      downloadUrl: exists ? `/files/${encodeURIComponent(record.file_path)}` : null
    });
  } catch (error) {
    res.status(500).json({ error: 'Status check failed' });
  }
});

app.post('/api/regenerate/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const record = db.prepare('SELECT * FROM downloads WHERE id = ?').get(id);

    if (!record) return res.status(404).json({ error: 'Record not found' });

    const filePath = path.join(downloadsDir, record.file_path);
    await runYtDlp([
      `"${record.youtube_url}"`,
      '-f', '"bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best"',
      '--merge-output-format', 'mp4',
      '-o', `"${filePath}"`,
      '--no-playlist',
      '--no-warnings'
    ]);

    db.prepare('UPDATE downloads SET created_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);

    res.json({ success: true });
  } catch (error) {
    console.error('Regeneration error:', error);
    res.status(500).json({ error: 'Failed to regenerate file' });
  }
});


app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
