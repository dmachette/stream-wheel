(async function(){
const api = async (path, opts={})=>{ const r = await fetch(path, opts); if(!r.ok){ const t = await r.text(); throw new Error(t||r.status); } return r.json(); };
document.body.insertAdjacentHTML('beforeend', '<div style="padding:12px"><em>Open the full admin HTML in browser to use the UI.</em></div>');
})();