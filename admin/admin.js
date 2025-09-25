
(async ()=>{
  const profileSelect = document.getElementById('profileSelect');
  const content = document.getElementById('content');
  function promptPass(){ return prompt('Admin password (Full or View):') || ''; }
  async function listProfiles(){
    try{
      const pass = promptPass();
      const res = await fetch('/admin/list-profiles', { headers: {'x-admin-pass': pass} });
      if(!res.ok) return alert('Unauthorized');
      const arr = await res.json(); profileSelect.innerHTML=''; arr.forEach(p=>{ const o=document.createElement('option'); o.value=p; o.textContent=p; profileSelect.appendChild(o); });
    }catch(e){ console.error(e); alert('Error'); }
  }
  document.getElementById('createProfile').onclick = async ()=>{
    const name = prompt('New profile name:'); if(!name) return; const pass = promptPass();
    const res = await fetch('/admin/create-profile', { method:'POST', headers:{ 'Content-Type':'application/json','x-admin-pass': pass }, body: JSON.stringify({ name }) });
    if(!res.ok) return alert('Create failed'); alert('Profile created'); await listProfiles();
  };
  document.getElementById('showSegments').onclick = async ()=>{
    const profile = profileSelect.value || 'default'; const pass = promptPass();
    const res = await fetch('/admin/config/'+encodeURIComponent(profile), { headers:{ 'x-admin-pass': pass } });
    if(!res.ok) return alert('Unauthorized');
    const j = await res.json(); renderSegments(profile, j.config, pass);
  };
  function renderSegments(profile, cfg, pass){
    content.innerHTML = ''; const wrap=document.createElement('div'); wrap.className='panel';
    const title=document.createElement('h3'); title.textContent='Segments'; wrap.appendChild(title);
    const list=document.createElement('div');
    (cfg.segments||[]).forEach((s,i)=>{
      const row=document.createElement('div'); row.className='segment-row';
      const txt=document.createElement('input'); txt.type='text'; txt.value=s.label; txt.oninput = e=> s.label = e.target.value;
      const color=document.createElement('input'); color.type='color'; color.value = s.color || '#'+Math.floor(Math.random()*16777215).toString(16); color.oninput = e=> s.color = e.target.value;
      const del=document.createElement('button'); del.textContent='Del'; del.onclick = ()=>{ cfg.segments.splice(i,1); renderSegments(profile,cfg,pass); };
      row.append(txt,color,del); list.appendChild(row);
    });
    const add=document.createElement('button'); add.textContent='+ Add'; add.onclick = ()=>{ cfg.segments.push({label:'New', color:''}); renderSegments(profile,cfg,pass); };
    const rand=document.createElement('button'); rand.textContent='Randomize Colors (blank only)'; rand.onclick = ()=>{ cfg.segments.forEach(s=>{ if(!s.color) s.color = '#'+Math.floor(Math.random()*16777215).toString(16); }); renderSegments(profile,cfg,pass); };
    const save=document.createElement('button'); save.textContent='Save'; save.onclick = async ()=>{ const pass2 = prompt('Admin pass:'); const res = await fetch('/admin/config/'+encodeURIComponent(profile), { method:'POST', headers:{ 'Content-Type':'application/json','x-admin-pass': pass2 }, body: JSON.stringify(cfg) }); if(!res.ok) return alert('Save failed'); alert('Saved'); };
    wrap.append(list, add, rand, save); content.appendChild(wrap);
  }
  document.getElementById('showLogo').onclick = async ()=>{
    const profile = profileSelect.value || 'default'; const pass = promptPass(); const res = await fetch('/admin/config/'+encodeURIComponent(profile), { headers:{ 'x-admin-pass': pass } }); if(!res.ok) return alert('Unauthorized');
    const j = await res.json(); renderLogo(profile, j.config, pass);
  };
  function renderLogo(profile, cfg, pass){
    content.innerHTML=''; const wrap=document.createElement('div'); wrap.className='panel';
    const title=document.createElement('h3'); title.textContent='Logo'; wrap.appendChild(title);
    const img=document.createElement('img'); img.src = cfg.logo || '/admin/assets/lock-icon.svg'; img.style.maxWidth='220px'; img.style.display='block'; img.style.marginBottom='8px';
    const file=document.createElement('input'); file.type='file';
    const uploadBtn=document.createElement('button'); uploadBtn.textContent='Upload'; uploadBtn.onclick = async ()=>{
      const f = file.files[0]; if(!f) return alert('Pick a file'); const pass2 = prompt('Admin pass:'); const fd = new FormData(); fd.append('logo', f);
      const res = await fetch('/admin/upload-logo/'+encodeURIComponent(profile), { method:'POST', headers:{ 'x-admin-pass': pass2 }, body: fd });
      if(!res.ok) return alert('Upload failed'); const j = await res.json(); alert('Uploaded'); img.src = j.url;
    };
    const urlInp=document.createElement('input'); urlInp.type='text'; urlInp.placeholder='External URL'; const setUrl=document.createElement('button'); setUrl.textContent='Set as Logo'; setUrl.onclick = async ()=>{
      const pass2 = prompt('Admin pass:'); const res = await fetch('/admin/config/'+encodeURIComponent(profile), { method:'POST', headers:{ 'Content-Type':'application/json','x-admin-pass': pass2 }, body: JSON.stringify(Object.assign({}, cfg, { logo: urlInp.value })) }); if(!res.ok) return alert('Save failed'); alert('Saved'); img.src = urlInp.value;
    };
    wrap.append(img, file, uploadBtn, urlInp, setUrl); content.appendChild(wrap);
  }
  document.getElementById('showLogs').onclick = async ()=>{
    const profile = profileSelect.value || 'default'; const pass = promptPass(); const res = await fetch('/admin/logs-archive/'+encodeURIComponent(profile), { headers:{ 'x-admin-pass': pass } }); // check archives
    const logsRes = await fetch('/admin/logs-archive/'+encodeURIComponent(profile), { headers:{ 'x-admin-pass': pass } }).catch(()=>null);
    const logsText = await (await fetch('/admin/logs-archive-view/'+encodeURIComponent(profile)+'/'+(await (await fetch('/admin/logs-archive/'+encodeURIComponent(profile), { headers:{ 'x-admin-pass': pass } })).json())[0], { headers:{ 'x-admin-pass': pass } }).catch(()=>({text:async()=>''}))).text().catch(()=>'');
    const r = await fetch('/admin/logs/'+encodeURIComponent(profile), { headers:{ 'x-admin-pass': pass } }); if(!r.ok) return alert('Unauthorized'); const j = await r.json();
    content.innerHTML = ''; const wrap=document.createElement('div'); wrap.className='panel'; const pre=document.createElement('pre'); pre.style.maxHeight='320px'; pre.style.overflow='auto'; pre.textContent = j.logs || ''; const clearBtn=document.createElement('button'); clearBtn.textContent='Clear Logs (Full Admin only)'; clearBtn.onclick = async ()=>{ const pass2 = prompt('Admin pass:'); const rr = await fetch('/admin/clear-logs/'+encodeURIComponent(profile), { method:'POST', headers:{ 'x-admin-pass': pass2 } }); if(!rr.ok) return alert('Clear failed'); alert('Cleared'); };
    wrap.append(pre, clearBtn); content.appendChild(wrap);
  };
  document.getElementById('showLeaderboard').onclick = async ()=>{
    const profile = profileSelect.value || 'default'; const pass = promptPass();
    const cfgRes = await fetch('/admin/config/'+encodeURIComponent(profile), { headers:{ 'x-admin-pass': pass } }); if(!cfgRes.ok) return alert('Unauthorized');
    const cfg = (await cfgRes.json()).config;
    const t = cfg.token || '';
    const res = await fetch('/public/leaderboard/data/'+encodeURIComponent(profile)+'?token='+encodeURIComponent(t));
    if(!res.ok) return alert('Failed loading leaderboard');
    const stats = await res.json();
    content.innerHTML = '<pre>'+JSON.stringify(stats,null,2)+'</pre>';
  };
  await listProfiles();
})();
