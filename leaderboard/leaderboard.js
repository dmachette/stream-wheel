
async function fetchData(){
  const p = document.getElementById('profile').value || 'default';
  const t = document.getElementById('token').value || '';
  const res = await fetch('/public/leaderboard/data/' + encodeURIComponent(p) + '?token=' + encodeURIComponent(t));
  if(!res.ok){ document.getElementById('list').innerHTML = '<li>Forbidden or invalid token</li>'; return; }
  const stats = await res.json();
  const entries = Object.entries(stats).sort((a,b)=>b[1]-a[1]).slice(0,3);
  const list = document.getElementById('list'); list.innerHTML='';
  entries.forEach((e,i)=>{
    const li = document.createElement('li');
    let medal = i===0? '<span class="gold">👑</span>' : i===1? '<span class="silver">🥈</span>' : '<span class="bronze">🥉</span>';
    li.innerHTML = `${medal} <strong>${e[0]}</strong> — ${e[1]}`;
    list.appendChild(li);
  });
}
document.addEventListener('DOMContentLoaded', ()=>{ fetchData(); setInterval(fetchData, 5000); });
