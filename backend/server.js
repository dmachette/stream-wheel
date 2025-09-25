\
import express from 'express';
import http from 'http';
import cors from 'cors';
import path from 'path';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import fs from 'fs';
import multer from 'multer';
import sharp from 'sharp';
import { nanoid } from 'nanoid';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json({ limit:'2mb' }));
app.use(express.urlencoded({ extended:true }));

const PORT = process.env.PORT || 3000;
const PROFILES = path.join(__dirname,'..','profiles');

function ensureDir(p){ if(!fs.existsSync(p)) fs.mkdirSync(p,{recursive:true}); }
function sanitizeProfile(name){ if(!name) return 'default'; return name.replace(/[^a-zA-Z0-9-_]/g,'').slice(0,40) || 'default'; }
function pPath(profile){ return path.join(PROFILES, profile); }
function cfgPath(profile){ return path.join(pPath(profile),'config.json'); }
function lbPath(profile){ return path.join(pPath(profile),'leaderboard.json'); }
function logsPath(profile){ return path.join(pPath(profile),'logs.txt'); }
function uploadsPath(profile){ return path.join(pPath(profile),'uploads'); }
function archiveDir(profile){ return path.join(pPath(profile),'archives'); }

function readJSON(p, fallback){ try{ return JSON.parse(fs.readFileSync(p,'utf8')); }catch(e){ return fallback; } }
function writeJSON(p,obj){ ensureDir(path.dirname(p)); fs.writeFileSync(p, JSON.stringify(obj, null, 2),'utf8'); }

function ensureProfile(profile){
  profile = sanitizeProfile(profile);
  ensureDir(pPath(profile));
  ensureDir(uploadsPath(profile));
  ensureDir(archiveDir(profile));
  if(!fs.existsSync(cfgPath(profile))){
    const cfg = { token: nanoid(12), segments:[{label:'1x Prize',color:''},{label:'2x Prize',color:''},{label:'Nugget',color:''}], logo:'' , logoHistory:[], soundEnabled:true, flashColor:'#ffff00', flashOpacity:0.6, flashDuration:600, showLegend:false };
    writeJSON(cfgPath(profile), cfg);
  }
  if(!fs.existsSync(lbPath(profile))) writeJSON(lbPath(profile), {});
  if(!fs.existsSync(logsPath(profile))) fs.writeFileSync(logsPath(profile), '');
  return profile;
}

ensureDir(PROFILES);
ensureProfile('default');

// static
app.use('/public', express.static(path.join(__dirname,'..','public')));
app.use('/admin', express.static(path.join(__dirname,'..','admin')));
app.use('/leaderboard', express.static(path.join(__dirname,'..','leaderboard')));
app.use('/public/uploads', express.static(path.join(PROFILES))); // serves /public/uploads/<profile>/<file>

const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const clients = new Set();
wss.on('connection', ws=>{
  clients.add(ws);
  ws.on('message', m=>{
    try{ const data = JSON.parse(m.toString()); /* handle if needed */ }catch(e){}
  });
  ws.on('close', ()=> clients.delete(ws));
});
function broadcast(obj){ const s = JSON.stringify(obj); for(const c of clients){ try{ c.send(s); }catch(e){} } }

// Public endpoints
app.get('/public/config', (req,res)=>{
  const profile = sanitizeProfile(req.query.profile||'default'); const token = req.query.token||'';
  const cfg = readJSON(cfgPath(profile), null);
  if(!cfg) return res.status(404).json({ error:'no profile' });
  if(cfg.token !== token) return res.status(403).json({ error:'invalid token' });
  return res.json(cfg);
});
app.get('/public/leaderboard/data/:profile', (req,res)=>{
  const profile = sanitizeProfile(req.params.profile);
  const token = req.query.token||''; const cfg = readJSON(cfgPath(profile), null);
  if(!cfg || token !== cfg.token) return res.status(403).json({ error:'forbidden' });
  return res.json(readJSON(lbPath(profile), {}));
});
app.get('/public/logs/:profile', (req,res)=>{
  const profile = sanitizeProfile(req.params.profile); const token = req.query.token||'';
  const cfg = readJSON(cfgPath(profile), null); if(!cfg || token !== cfg.token) return res.status(403).json({ error:'forbidden' });
  return res.json(fs.existsSync(logsPath(profile)) ? fs.readFileSync(logsPath(profile),'utf8').split('\\n').filter(Boolean) : []);
});

// API spin
app.post('/api/spin', (req,res)=>{
  const key = req.headers['x-api-key'] || ''; const adminPass = req.headers['x-admin-pass'] || '';
  const allowed = (key && key === (process.env.API_KEY || 'changeme_api_key')) || adminPass;
  if(!allowed) return res.status(403).json({ error:'forbidden' });
  const body = req.body || {}; const profile = sanitizeProfile(body.profile||'default'); ensureProfile(profile);
  const cfg = readJSON(cfgPath(profile), null); if(!cfg) return res.status(400).json({ error:'invalid profile' });
  const idx = (typeof body.index === 'number') ? body.index : Math.floor(Math.random()*(cfg.segments.length||1));
  const label = body.label || (cfg.segments[idx] && cfg.segments[idx].label) || '—';
  const isTest = !!body.test; const user = body.user || (adminPass ? 'Admin' : 'Viewer');
  const payload = { type:'spin', profile, index: idx, label, user, test: isTest, ts: new Date().toISOString() };
  try{ fs.appendFileSync(logsPath(profile), `[${new Date().toISOString()}] ${payload.user} -> ${label}${isTest? ' [TEST]':''}\\n`); }catch(e){}
  if(!isTest){ const stats = readJSON(lbPath(profile), {}); stats[label] = (stats[label]||0)+1; writeJSON(lbPath(profile), stats); broadcast({ type:'leaderboard', profile, stats }); }
  broadcast(payload); return res.json({ ok:true, payload });
});

// preview flash
app.post('/api/preview-flash', (req,res)=>{
  const adminPass = req.headers['x-admin-pass']||''; if(!adminPass) return res.status(403).json({ error:'forbidden' });
  const profile = sanitizeProfile(req.body.profile||'default'); ensureProfile(profile); broadcast({ type:'previewFlash', profile }); return res.json({ ok:true });
});

// Admin endpoints
app.get('/admin/list-profiles', (req,res)=>{
  const pass = req.headers['x-admin-pass']||''; if(!pass) return res.status(403).json({ error:'forbidden' });
  const items = fs.readdirSync(PROFILES).filter(n=> fs.statSync(path.join(PROFILES,n)).isDirectory()); return res.json(items);
});
app.get('/admin/config/:profile', (req,res)=>{
  const pass = req.headers['x-admin-pass']||''; if(!pass) return res.status(403).json({ error:'forbidden' });
  const profile = sanitizeProfile(req.params.profile||'default'); ensureProfile(profile); const cfg = readJSON(cfgPath(profile), null); const role = pass === (process.env.ADMIN_PASS || 'changeme_full_admin') ? 'ADMIN_FULL' : 'ADMIN_VIEW'; return res.json({ config: cfg, role });
});
app.post('/admin/config/:profile', (req,res)=>{
  const pass = req.headers['x-admin-pass']||''; if(!pass) return res.status(403).json({ error:'forbidden' });
  const profile = sanitizeProfile(req.params.profile||'default'); ensureProfile(profile); const body = req.body || {}; const cfg = readJSON(cfgPath(profile), {});
  if(Array.isArray(body.segments)) cfg.segments = body.segments; if(typeof body.logo === 'string') cfg.logo = body.logo; if(typeof body.flashColor === 'string') cfg.flashColor = body.flashColor;
  if(typeof body.flashOpacity === 'number') cfg.flashOpacity = body.flashOpacity; if(typeof body.flashDuration === 'number') cfg.flashDuration = body.flashDuration; if(typeof body.soundEnabled === 'boolean') cfg.soundEnabled = body.soundEnabled;
  if(typeof body.showLegend === 'boolean') cfg.showLegend = body.showLegend; writeJSON(cfgPath(profile), cfg); fs.appendFileSync(logsPath(profile), `[${new Date().toISOString()}] ${pass} saved config\\n`); broadcast({ type:'config', profile, config: cfg }); return res.json({ ok:true });
});

// Multer/sharp upload
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: parseInt(process.env.UPLOAD_MAX_BYTES||'2097152',10) } });
app.post('/admin/upload-logo/:profile', upload.single('logo'), async (req,res)=>{
  const pass = req.headers['x-admin-pass']||''; if(!pass) return res.status(403).json({ error:'forbidden' });
  const profile = sanitizeProfile(req.params.profile||'default'); ensureProfile(profile); if(!req.file) return res.status(400).json({ error:'no file' });
  try{
    const ext = (req.file.mimetype.split('/')[1]||'png').split('+')[0]; const name = `${Date.now()}_${nanoid(6)}.${ext}`;
    const outDir = uploadsPath(profile); ensureDir(outDir); const outPath = path.join(outDir,name);
    await sharp(req.file.buffer).resize(512,512,{fit:'inside'}).toFile(outPath);
    const cfg = readJSON(cfgPath(profile), {}); cfg.logoHistory = cfg.logoHistory||[]; cfg.logoHistory.unshift(name); cfg.logo = `/public/uploads/${profile}/${name}`; writeJSON(cfgPath(profile), cfg);
    fs.appendFileSync(logsPath(profile), `[${new Date().toISOString()}] ${pass} uploaded ${name}\\n`); return res.json({ ok:true, url: cfg.logo, filename: name });
  }catch(e){ console.error(e); return res.status(500).json({ error:'processing' }); }
});
app.delete('/admin/upload/:profile/:file', (req,res)=>{
  const pass = req.headers['x-admin-pass']||''; if(pass !== (process.env.ADMIN_PASS || 'changeme_full_admin')) return res.status(403).json({ error:'forbidden' });
  const profile = sanitizeProfile(req.params.profile||'default'); ensureProfile(profile); const file = req.params.file; const p = path.join(uploadsPath(profile), file); if(fs.existsSync(p)) fs.unlinkSync(p);
  const cfg = readJSON(cfgPath(profile), {}); cfg.logoHistory = (cfg.logoHistory||[]).filter(x=> x!==file); writeJSON(cfgPath(profile), cfg); fs.appendFileSync(logsPath(profile), `[${new Date().toISOString()}] ${pass} deleted ${file}\\n`); return res.json({ ok:true });
});

app.post('/admin/clear-logs/:profile', (req,res)=>{
  const pass = req.headers['x-admin-pass']||''; if(pass !== (process.env.ADMIN_PASS || 'changeme_full_admin')) return res.status(403).json({ error:'forbidden' });
  const profile = sanitizeProfile(req.params.profile||'default'); ensureProfile(profile); const lp = logsPath(profile);
  if(fs.existsSync(lp)){ const ts = new Date().toISOString().replace(/[:.]/g,'-'); const dest = path.join(archiveDir(profile), `logs-${ts}.txt`); fs.renameSync(lp, dest); }
  fs.writeFileSync(logsPath(profile), ''); fs.appendFileSync(logsPath(profile), `[${new Date().toISOString()}] ${pass} cleared logs (archived)\\n`); return res.json({ ok:true });
});

app.post('/admin/reset-leaderboard/:profile', (req,res)=>{
  const pass = req.headers['x-admin-pass']||''; if(pass !== (process.env.ADMIN_PASS || 'changeme_full_admin')) return res.status(403).json({ error:'forbidden' });
  const profile = sanitizeProfile(req.params.profile||'default'); ensureProfile(profile); writeJSON(lbPath(profile), {}); fs.appendFileSync(logsPath(profile), `[${new Date().toISOString()}] ${pass} reset leaderboard\\n`); broadcast({ type:'leaderboard', profile, stats:{} }); return res.json({ ok:true });
});

app.get('/admin/logs-archive/:profile', (req,res)=>{
  const pass = req.headers['x-admin-pass']||''; if(pass !== (process.env.ADMIN_PASS || 'changeme_full_admin')) return res.status(403).json({ error:'forbidden' });
  const arr = fs.readdirSync(archiveDir(req.params.profile||'default')).filter(f=> f.endsWith('.txt')).sort().reverse(); return res.json(arr);
});
app.get('/admin/logs-archive-view/:profile/:file', (req,res)=>{
  const pass = req.headers['x-admin-pass']||''; if(pass !== (process.env.ADMIN_PASS || 'changeme_full_admin')) return res.status(403).json({ error:'forbidden' });
  const fp = path.join(archiveDir(req.params.profile||'default'), req.params.file); if(!fs.existsSync(fp)) return res.status(404).json({ error:'notfound' }); return res.type('text/plain').send(fs.readFileSync(fp,'utf8'));
});

// Start
server.listen(PORT, ()=> console.log('Stream Wheel backend listening on', PORT));
