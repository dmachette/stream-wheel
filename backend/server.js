import express from 'express';
import fs from 'fs';
import path from 'path';
import http from 'http';
import { WebSocketServer } from 'ws';
import multer from 'multer';
import sharp from 'sharp';
import crypto from 'crypto';
import cors from 'cors';
import { nanoid } from 'nanoid';
import dotenv from 'dotenv';
dotenv.config();

const REPO_ROOT = path.resolve(path.join(path.dirname(new URL(import.meta.url).pathname), '..'));
const PROFILES_DIR = path.join(REPO_ROOT, 'profiles');
if (!fs.existsSync(PROFILES_DIR)) fs.mkdirSync(PROFILES_DIR, { recursive: true });

const ADMIN_PASS = process.env.ADMIN_PASS || 'changeme_full_admin';
const ADMIN_VIEW_PASS = process.env.ADMIN_VIEW_PASS || 'changeme_view_only';
const API_KEY = process.env.API_KEY || 'changeme_api_key';
const UPLOAD_MAX = parseInt(process.env.UPLOAD_MAX_BYTES || '2097152', 10);
const PORT = parseInt(process.env.PORT || '3000', 10);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// static
app.use('/public', express.static(path.join(REPO_ROOT, 'public')));
app.use('/admin', express.static(path.join(REPO_ROOT, 'admin')));
app.use('/leaderboard', express.static(path.join(REPO_ROOT, 'leaderboard')));
app.use('/public/uploads', express.static(path.join(REPO_ROOT, 'profiles')));

function sanitizeProfile(name){ if(!name) return 'default'; return name.replace(/[^a-zA-Z0-9-_]/g,'').slice(0,40) || 'default'; }
function profilePath(profile){ return path.join(PROFILES_DIR, profile); }
function configPath(profile){ return path.join(profilePath(profile),'config.json'); }
function uploadsPath(profile){ return path.join(profilePath(profile),'uploads'); }
function logsPath(profile){ return path.join(profilePath(profile),'logs.txt'); }
function archiveDir(profile){ return path.join(profilePath(profile),'archives'); }
function leaderboardPath(profile){ return path.join(profilePath(profile),'leaderboard.json'); }

function ensureProfile(profile){
  profile = sanitizeProfile(profile);
  const pdir = profilePath(profile);
  if(!fs.existsSync(pdir)) fs.mkdirSync(pdir, { recursive:true });
  if(!fs.existsSync(uploadsPath(profile))) fs.mkdirSync(uploadsPath(profile), { recursive:true });
  if(!fs.existsSync(archiveDir(profile))) fs.mkdirSync(archiveDir(profile), { recursive:true });
  if(!fs.existsSync(configPath(profile))){
    const defaultCfg = {
      segments: [{label:"1x Prize", color:""},{label:"2x Prize", color:""},{label:"Nugget", color:""}],
      logo: "",
      logoHistory: [],
      soundEnabled: true,
      flashColor: "#ffff00",
      flashOpacity: 0.6,
      flashDuration: 600,
      showLegend: false,
      token: nanoid(12),
      lastSpins: [],
      stats: {}
    };
    fs.writeFileSync(configPath(profile), JSON.stringify(defaultCfg, null, 2));
  }
  if(!fs.existsSync(leaderboardPath(profile))) fs.writeFileSync(leaderboardPath(profile), JSON.stringify({}, null, 2));
  return profile;
}
function loadConfig(profile){ ensureProfile(profile); return JSON.parse(fs.readFileSync(configPath(profile), 'utf8')); }
function saveConfig(profile, cfg){ ensureProfile(profile); fs.writeFileSync(configPath(profile), JSON.stringify(cfg, null, 2)); }

function appendLog(profile, line){
  ensureProfile(profile);
  const lp = logsPath(profile);
  const entry = `[${new Date().toISOString()}] ${line}\n`;
  fs.appendFileSync(lp, entry);
}

// multer memory storage
const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: UPLOAD_MAX } });

// Public endpoints (token protected)
app.get('/public/config', (req,res)=>{
  const profile = sanitizeProfile(req.query.profile || 'default');
  const token = req.query.token || '';
  ensureProfile(profile);
  const cfg = loadConfig(profile);
  if(!token || token !== cfg.token) return res.status(403).json({ error:'invalid token' });
  return res.json(cfg);
});

app.get('/public/leaderboard/data/:profile', (req,res)=>{
  const profile = sanitizeProfile(req.params.profile);
  const token = req.query.token || '';
  ensureProfile(profile);
  const cfg = loadConfig(profile);
  if(token !== cfg.token) return res.status(403).json({ error:'invalid token' });
  const stats = JSON.parse(fs.readFileSync(leaderboardPath(profile),'utf8'));
  return res.json(stats);
});

app.get('/public/logs/:profile', (req,res)=>{
  const profile = sanitizeProfile(req.params.profile);
  const token = req.query.token || '';
  ensureProfile(profile);
  const cfg = loadConfig(profile);
  if(token !== cfg.token) return res.status(403).json({ error:'invalid token' });
  const lp = logsPath(profile);
  if(!fs.existsSync(lp)) return res.json([]);
  const lines = fs.readFileSync(lp,'utf8').trim().split('\\n').filter(Boolean);
  return res.json(lines);
});

// auth helper
function authRole(header){
  if(!header) return null;
  if(header === ADMIN_PASS) return 'ADMIN_FULL';
  if(header === ADMIN_VIEW_PASS) return 'ADMIN_VIEW';
  return null;
}

// admin create profile
app.post('/admin/create-profile', (req,res)=>{
  const role = authRole(req.headers['x-admin-pass']);
  if(role !== 'ADMIN_FULL') return res.status(403).json({ error:'forbidden' });
  const name = sanitizeProfile(req.body.name || (`profile_${Date.now()}`));
  const pdir = profilePath(name);
  if(fs.existsSync(pdir)) return res.status(409).json({ error:'exists' });
  ensureProfile(name);
  appendLog(name, `[ADMIN_FULL] Profile created`);
  return res.json({ ok:true, profile:name, token: loadConfig(name).token });
});

// admin get config
app.get('/admin/config/:profile', (req,res)=>{
  const role = authRole(req.headers['x-admin-pass']);
  if(!role) return res.status(403).json({ error:'forbidden' });
  const profile = ensureProfile(sanitizeProfile(req.params.profile));
  const cfg = loadConfig(profile);
  return res.json({ config: cfg, role });
});

// save config (editor+full)
app.post('/admin/config/:profile', (req,res)=>{
  const role = authRole(req.headers['x-admin-pass']);
  if(!role) return res.status(403).json({ error:'forbidden' });
  const profile = ensureProfile(sanitizeProfile(req.params.profile));
  const body = req.body || {};
  const cfg = loadConfig(profile);
  if(Array.isArray(body.segments)) cfg.segments = body.segments;
  if(typeof body.logo === 'string') cfg.logo = body.logo;
  if(typeof body.soundEnabled === 'boolean') cfg.soundEnabled = body.soundEnabled;
  if(typeof body.flashColor === 'string') cfg.flashColor = body.flashColor;
  if(typeof body.flashOpacity === 'number') cfg.flashOpacity = body.flashOpacity;
  if(typeof body.flashDuration === 'number') cfg.flashDuration = body.flashDuration;
  if(typeof body.showLegend === 'boolean') cfg.showLegend = body.showLegend;
  saveConfig(profile, cfg);
  appendLog(profile, `[${role}] Config saved`);
  broadcast({ type:'config', profile, config: cfg });
  return res.json({ ok:true });
});

// regenerate token (full only)
app.post('/admin/regenerate-token/:profile', (req,res)=>{
  const role = authRole(req.headers['x-admin-pass']);
  if(role !== 'ADMIN_FULL') return res.status(403).json({ error:'forbidden' });
  const profile = ensureProfile(sanitizeProfile(req.params.profile));
  const cfg = loadConfig(profile);
  cfg.token = nanoid(16);
  saveConfig(profile, cfg);
  appendLog(profile, `[ADMIN_FULL] Token regenerated`);
  broadcast({ type:'config', profile, config: cfg });
  return res.json({ ok:true, token: cfg.token });
});

// upload logo (editor+full)
app.post('/admin/upload-logo/:profile', upload.single('logo'), async (req,res)=>{
  const role = authRole(req.headers['x-admin-pass']);
  if(!role) return res.status(403).json({ error:'forbidden' });
  const profile = ensureProfile(sanitizeProfile(req.params.profile));
  if(!req.file) return res.status(400).json({ error:'no file' });
  try{
    const ext = (req.file.mimetype.split('/')[1] || 'jpg').split('+')[0];
    const name = `${Date.now()}_${crypto.randomBytes(6).toString('hex')}.${ext}`;
    const outDir = uploadsPath(profile);
    const outPath = path.join(outDir, name);
    await sharp(req.file.buffer).resize(512,512,{fit:'inside'}).toFile(outPath);
    const cfg = loadConfig(profile);
    cfg.logoHistory = cfg.logoHistory || [];
    cfg.logoHistory.unshift(name);
    saveConfig(profile, cfg);
    appendLog(profile, `[${role}] Uploaded logo ${name}`);
    return res.json({ ok:true, filename: name, url:`/public/uploads/${profile}/${name}` });
  }catch(err){ console.error(err); return res.status(500).json({ error:'processing failed' }); }
});

// delete upload (full only)
app.delete('/admin/upload/:profile/:file', (req,res)=>{
  const role = authRole(req.headers['x-admin-pass']); if(role !== 'ADMIN_FULL') return res.status(403).json({ error:'forbidden' });
  const profile = ensureProfile(sanitizeProfile(req.params.profile)); const file = req.params.file;
  const p = path.join(uploadsPath(profile), file); if(fs.existsSync(p)) fs.unlinkSync(p);
  const cfg = loadConfig(profile); cfg.logoHistory = (cfg.logoHistory||[]).filter(x=>x!==file); saveConfig(profile, cfg);
  appendLog(profile, `[ADMIN_FULL] Deleted upload ${file}`); return res.json({ ok:true });
});

// archives list & view (full only)
app.get('/admin/logs-archive/:profile', (req,res)=>{ const role = authRole(req.headers['x-admin-pass']); if(role!=='ADMIN_FULL') return res.status(403).json({ error:'forbidden' }); const profile = ensureProfile(sanitizeProfile(req.params.profile)); const arr = fs.readdirSync(archiveDir(profile)).filter(f=>f.endsWith('.txt')).sort().reverse(); return res.json(arr); });
app.get('/admin/logs-archive/:profile/:file', (req,res)=>{ const role = authRole(req.headers['x-admin-pass']); if(role!=='ADMIN_FULL') return res.status(403).json({ error:'forbidden' }); const profile = ensureProfile(sanitizeProfile(req.params.profile)); const fp = path.join(archiveDir(profile), req.params.file); if(!fs.existsSync(fp)) return res.status(404).json({ error:'notfound' }); return res.download(fp); });
app.get('/admin/logs-archive-view/:profile/:file', (req,res)=>{ const role = authRole(req.headers['x-admin-pass']); if(role!=='ADMIN_FULL') return res.status(403).json({ error:'forbidden' }); const profile = ensureProfile(sanitizeProfile(req.params.profile)); const fp = path.join(archiveDir(profile), req.params.file); if(!fs.existsSync(fp)) return res.status(404).json({ error:'notfound' }); return res.type('text/plain').send(fs.readFileSync(fp,'utf8')); });

// view live logs (admin or token)
app.get('/admin/logs/:profile', (req,res)=>{
  const profile = ensureProfile(sanitizeProfile(req.params.profile));
  const auth = req.headers['x-admin-pass']||''; const token = req.query.token||''; const role=authRole(auth); const cfg=loadConfig(profile);
  if(role || token===cfg.token){ const lp = logsPath(profile); if(!fs.existsSync(lp)) return res.json([]); return res.json(fs.readFileSync(lp,'utf8').trim().split('\\n').filter(Boolean)); }
  return res.status(403).json({ error:'forbidden' });
});

// clear logs (full admin) with archive
app.post('/admin/clear-logs/:profile', (req,res)=>{
  const role = authRole(req.headers['x-admin-pass']); if(role!=='ADMIN_FULL') return res.status(403).json({ error:'forbidden' });
  const profile = ensureProfile(sanitizeProfile(req.params.profile)); const lp = logsPath(profile);
  if(fs.existsSync(lp)){ const ts = new Date().toISOString().replace(/[:.]/g,'-'); const dest = path.join(archiveDir(profile), `logs-${ts}.txt`); fs.renameSync(lp, dest); }
  fs.writeFileSync(lp,'');
  appendLog(profile, `[ADMIN_FULL] Cleared logs (archived)`);
  return res.json({ ok:true });
});

// reset leaderboard (full admin only)
app.post('/admin/reset-leaderboard/:profile', (req,res)=>{
  const role = authRole(req.headers['x-admin-pass']); if(role!=='ADMIN_FULL') return res.status(403).json({ error:'forbidden' });
  const profile = ensureProfile(sanitizeProfile(req.params.profile)); fs.writeFileSync(leaderboardPath(profile), JSON.stringify({})); appendLog(profile, `[ADMIN_FULL] Leaderboard reset`); broadcast({ type:'leaderboard', profile, stats:{} }); return res.json({ ok:true });
});

// list profiles (admin view)
app.get('/admin/list-profiles', (req,res)=>{ const role = authRole(req.headers['x-admin-pass']); if(!role) return res.status(403).json({ error:'forbidden' }); const names = fs.readdirSync(PROFILES_DIR).filter(f=> fs.statSync(path.join(PROFILES_DIR,f)).isDirectory() ); return res.json(names); });

// spin API
app.post('/api/spin', (req,res)=>{
  const key = req.headers['x-api-key'] || req.headers['x-admin-pass'] || '';
  const role = authRole(req.headers['x-admin-pass']);
  if(key !== API_KEY && !role) return res.status(403).json({ error:'forbidden' });
  const body = req.body || {}; const profile = ensureProfile(sanitizeProfile(body.profile || 'default')); const cfg = loadConfig(profile);
  const idx = (typeof body.index==='number')? body.index : Math.floor(Math.random()*(cfg.segments.length||1));
  const label = body.label || (cfg.segments[idx] && cfg.segments[idx].label) || '—';
  const isTest = !!body.test; const user = body.user || (role?role:'Viewer');
  const payload = { type:'spin', profile, index:idx, label, user, test:isTest, ts:new Date().toISOString() };
  appendLog(profile, `${payload.user} Spin -> ${label}${isTest? ' [TEST]':''}`);
  if(!isTest){
    const stats = JSON.parse(fs.readFileSync(leaderboardPath(profile),'utf8'));
    stats[label] = (stats[label]||0)+1; fs.writeFileSync(leaderboardPath(profile), JSON.stringify(stats,null,2));
    broadcast({ type:'leaderboard', profile, stats });
  }
  broadcast(payload); return res.json({ ok:true });
});

// preview flash endpoint
app.post('/api/preview-flash', (req,res)=>{ const role = authRole(req.headers['x-admin-pass']); if(!role) return res.status(403).json({ error:'forbidden' }); const profile = ensureProfile(sanitizeProfile(req.body.profile||'default')); appendLog(profile, `[${role}] Preview flash`); broadcast({ type:'previewFlash', profile }); return res.json({ ok:true }); });

// WebSocket handling
const clients = new Map();
wss.on('connection', ws=>{
  ws.isAlive = true;
  ws.on('pong', ()=> ws.isAlive = true);
  ws.on('message', msg=>{
    try{
      const data = JSON.parse(msg.toString());
      if(data.type === 'subscribe'){
        const profile = ensureProfile(sanitizeProfile(data.profile));
        const cfg = loadConfig(profile);
        if(data.token && data.token === cfg.token){
          clients.set(ws, { profile, role:'TOKEN' });
          ws.send(JSON.stringify({ type:'config', profile, config: cfg }));
          const stats = JSON.parse(fs.readFileSync(leaderboardPath(profile),'utf8')); ws.send(JSON.stringify({ type:'leaderboard', profile, stats }));
        } else {
          const role = authRole(data.adminPass);
          if(role){ clients.set(ws, { profile, role }); ws.send(JSON.stringify({ type:'config', profile, config: loadConfig(profile), role })); const stats = JSON.parse(fs.readFileSync(leaderboardPath(profile),'utf8')); ws.send(JSON.stringify({ type:'leaderboard', profile, stats })); }
          else { ws.send(JSON.stringify({ error:'unauthorized' })); ws.close(); }
        }
      }
    }catch(e){ console.error('ws err', e); }
  });
  ws.on('close', ()=> clients.delete(ws));
});

function broadcast(obj){ for(const [ws, meta] of clients.entries()){ try{ ws.send(JSON.stringify(obj)); }catch(e){} } }

// pings
setInterval(()=>{ for(const ws of wss.clients){ try{ ws.ping(); }catch(e){} } }, 30000);

server.listen(PORT, ()=> console.log('Server listening on', PORT));
