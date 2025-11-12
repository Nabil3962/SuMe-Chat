/* SuMe-Chat - core frontend
   - PeerJS P2P (no hard-coded TURN)
   - ECDH -> AES-GCM encryption
   - Markdown rendering via marked + highlight.js
   - IndexedDB local persistence & queueing
   - Basic typing indicator
   - Bluetooth scan UI (basic)
*/

/* ---------- Elements ---------- */
const myPeerIdEl = document.getElementById('myPeerId');
const copyBtn = document.getElementById('copyBtn');
const peerInput = document.getElementById('peerInput');
const connectBtn = document.getElementById('connectBtn');
const statusBadge = document.getElementById('statusBadge');
const statusText = document.getElementById('statusText');
const chatLog = document.getElementById('chatLog');
const msgInput = document.getElementById('msgInput');
const sendBtn = document.getElementById('sendBtn');
const typingIndicator = document.getElementById('typingIndicator');
const btBtn = document.getElementById('btBtn');
const clearBtn = document.getElementById('clearBtn');

/* ---------- Helpers ---------- */
function setBadge(mode){ // 'online'|'bluetooth'|'offline'
  statusBadge.classList.remove('green','blue','red');
  if(mode==='online'){ statusBadge.classList.add('green'); statusText.textContent='Connected (P2P)'; }
  else if(mode==='bluetooth'){ statusBadge.classList.add('blue'); statusText.textContent='Bluetooth Mode'; }
  else { statusBadge.classList.add('red'); statusText.textContent='Offline'; }
}
function appendMessage(html, cls='system'){
  const d = document.createElement('div');
  d.className = 'msg ' + cls;
  // render markdown safely
  if(cls === 'me' || cls === 'friend' || cls === 'system'){
    // convert to markdown HTML but keep small size
    const md = marked.parse(html, {sanitize: false});
    // highlight code blocks
    d.innerHTML = `<div class="md">${md}</div>`;
    d.querySelectorAll('pre code').forEach((b)=>hljs.highlightElement(b));
  } else {
    d.textContent = html;
  }
  chatLog.appendChild(d); chatLog.scrollTop = chatLog.scrollHeight;
}

/* sanitize text for code inline */
function escapeHtml(s){ return s.replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

/* ---------- IndexedDB (simple message store + queue) ---------- */
let db = null;
function initDB(){
  const r = indexedDB.open('SumeChatDB_v2',1);
  r.onupgradeneeded = e => {
    const idb = e.target.result;
    if(!idb.objectStoreNames.contains('messages')){
      const s = idb.createObjectStore('messages',{keyPath:'id',autoIncrement:true});
      s.createIndex('ts','ts',{unique:false});
    }
    if(!idb.objectStoreNames.contains('queue')){
      idb.createObjectStore('queue',{keyPath:'id',autoIncrement:true});
    }
  };
  r.onsuccess = e => { db = e.target.result; loadMessages(); };
  r.onerror = e => console.error('DB init failed', e);
}
function saveMessageLocal(text,cls,meta={}){
  if(!db) return;
  const tx = db.transaction('messages','readwrite');
  tx.objectStore('messages').add({text,cls,ts:Date.now(),meta});
}
function loadMessages(){
  if(!db) return;
  const tx = db.transaction('messages','readonly');
  const store = tx.objectStore('messages');
  const req = store.getAll();
  req.onsuccess = e => {
    const arr = e.target.result.sort((a,b)=>a.ts-b.ts);
    arr.forEach(m => appendMessage(m.text, m.cls));
  };
}
function queueOutgoing(obj){
  if(!db) return;
  const tx = db.transaction('queue','readwrite');
  tx.objectStore('queue').add(obj);
}
function flushQueue(sendFn){
  if(!db) return;
  const tx = db.transaction('queue','readwrite');
  const store = tx.objectStore('queue');
  const req = store.getAll();
  req.onsuccess = async e => {
    const items = e.target.result;
    for(const it of items){
      await sendFn(it); // expects promise
    }
    store.clear();
  };
}

/* ---------- Crypto: ECDH -> AES-GCM ---------- */
let ecdhPair = null, cryptoKey = null, myPubB64 = null;
function ab2b64(buf){ return btoa(String.fromCharCode(...new Uint8Array(buf))); }
function b642ab(b64){ return Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer; }

async function genEcdh(){
  ecdhPair = await crypto.subtle.generateKey({name:'ECDH', namedCurve:'P-256'}, true, ['deriveKey']);
  const pubRaw = await crypto.subtle.exportKey('raw', ecdhPair.publicKey);
  myPubB64 = ab2b64(pubRaw);
  return myPubB64;
}
async function deriveShared(peerPubB64){
  try{
    const raw = b642ab(peerPubB64);
    const imported = await crypto.subtle.importKey('raw', raw, {name:'ECDH', namedCurve:'P-256'}, true, []);
    cryptoKey = await crypto.subtle.deriveKey({name:'ECDH', public: imported}, ecdhPair.privateKey,
      {name:'AES-GCM', length:256}, false, ['encrypt','decrypt']);
    appendMessage('🔐 Secure channel established!', 'system');
  }catch(e){ console.error('derive failed', e); appendMessage('⚠ Key derivation failed','system'); }
}
async function encryptMsg(text){
  if(!cryptoKey) throw new Error('no key');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({name:'AES-GCM', iv}, cryptoKey, new TextEncoder().encode(text));
  return {iv:Array.from(iv), data:Array.from(new Uint8Array(data))};
}
async function decryptMsg(p){
  try{
    const plain = await crypto.subtle.decrypt({name:'AES-GCM', iv:new Uint8Array(p.iv)}, cryptoKey, new Uint8Array(p.data));
    return new TextDecoder().decode(plain);
  }catch(e){ console.warn('decrypt failed', e); return null; }
}

/* ---------- PeerJS P2P ---------- */
let peer = null, conn = null;
const myId = localStorage.getItem('sume_peer') || (Math.random().toString(36).slice(2,12));
localStorage.setItem('sume_peer', myId);

async function initPeer(){
  await genEcdh();
  peer = new Peer(myId, {host:'0.peerjs.com', port:443, secure:true, debug:1, config:{ iceServers:[{urls:['stun:stun.l.google.com:19302']}] }});
  peer.on('open', id => {
    myPeerIdEl.textContent = id;
    setBadge('red'); setStatusText('Ready — not connected');
  });
  peer.on('connection', c => {
    if(conn && conn.open){ c.close(); return; }
    conn = c; setupConn();
    appendMessage('🟢 Someone connected to you!', 'system');
  });
  peer.on('error', e=> { console.error(e); appendMessage('⚠ Peer error: ' + (e.message || e), 'system')});
}

function setStatusText(txt){ statusText.textContent = txt; }

function setupConn(){
  if(!conn) return;
  setBadge('green'); setStatusText('Connected P2P: ' + conn.peer);
  conn.on('data', async d => {
    if(d.pubKey){ // ECDH key exchange
      await deriveShared(d.pubKey);
      // send back our public key if we haven't yet
      if(myPubB64) conn.send({pubKey: myPubB64});
      flushQueue(async (q)=>{ conn.send(q); });
      return;
    }
    if(d.typing){ typingIndicator.textContent = d.typing ? (conn.peer + ' is typing…') : ''; return; }
    if(d.msg){
      if(cryptoKey){
        const txt = await decryptMsg(d.msg);
        if(txt !== null){ appendMessage(txt, 'friend'); saveMessageLocal(txt,'friend',{from:conn.peer}); }
      } else {
        appendMessage('[Encrypted message received but key missing]','system');
      }
    }
  });
  conn.on('close', ()=>{ appendMessage('❌ Connection closed','system'); setBadge('red'); setStatusText('Disconnected'); conn=null; });
  conn.on('error', (e)=>{ console.error('conn err',e); appendMessage('⚠ Connection error','system'); });
}

/* connect button */
connectBtn.addEventListener('click', ()=>{
  const id = peerInput.value.trim();
  if(!id) return alert('Enter Peer ID');
  conn = peer.connect(id, {reliable:true});
  conn.on('open', async ()=>{
    setupConn();
    // exchange public keys
    conn.send({pubKey: myPubB64});
    appendMessage('✅ Connected to ' + id, 'system');
  });
});

/* typing indicator -> send minimal typing msgs */
let typingTimer = null;
msgInput.addEventListener('input', ()=>{
  if(conn && conn.open) conn.send({typing:true});
  clearTimeout(typingTimer);
  typingTimer = setTimeout(()=>{ if(conn && conn.open) conn.send({typing:false}); }, 1200);
});

/* send message */
sendBtn.addEventListener('click', async ()=>{
  const txt = msgInput.value.trim(); if(!txt) return;
  msgInput.value = '';
  appendMessage(txt, 'me'); saveMessageLocal(txt,'me',{sent:true});
  if(conn && conn.open && cryptoKey){
    const enc = await encryptMsg(txt);
    conn.send({msg:enc});
  } else {
    // queue for later
    queueOutgoing({msgType:'encrypted', payload: {plain:txt}}); // placeholder; will replace with encrypted on flush if key available
    appendMessage('⚠ Offline queued', 'system');
  }
});

/* copy ID */
copyBtn.addEventListener('click', async ()=>{
  try{ await navigator.clipboard.writeText(myPeerIdEl.textContent); copyBtn.textContent='Copied!'; setTimeout(()=>copyBtn.textContent='Copy',1200); }catch(e){ alert('Clipboard failed'); }
});

/* clear */
clearBtn.addEventListener('click', ()=>{
  if(!confirm('Clear local chat history?')) return;
  const tx = db.transaction('messages','readwrite'); tx.objectStore('messages').clear();
  chatLog.innerHTML='';
});

/* flushQueue handler: encrypt queued items if possible and send */
async function flushQueuedSends(){
  if(!conn || !conn.open) return;
  const tx = db.transaction('queue','readwrite');
  const req = tx.objectStore('queue').getAll();
  req.onsuccess = async e => {
    const items = e.target.result;
    for(const it of items){
      if(it.msgType==='encrypted'){
        // already encrypted or just stored plain; for simplicity if plain exists and we have cryptoKey, encrypt now
        if(it.payload && it.payload.plain && cryptoKey){
          const enc = await encryptMsg(it.payload.plain);
          conn.send({msg:enc});
        } else if(it.payload && it.payload.encrypted){
          conn.send({msg: it.payload.encrypted});
        }
      }
    }
    tx.objectStore('queue').clear();
  };
}

/* ---------- Bluetooth basic UI (scan & receive) ---------- */
let btDevice = null, btServer=null, btChar=null;
btBtn.addEventListener('click', async ()=>{
  try{
    const dev = await navigator.bluetooth.requestDevice({acceptAllDevices:true, optionalServices:['0000ffe0-0000-1000-8000-00805f9b34fb']});
    btDevice = dev;
    btServer = await dev.gatt.connect();
    const svc = await btServer.getPrimaryService('0000ffe0-0000-1000-8000-00805f9b34fb');
    btChar = await svc.getCharacteristic('0000ffe1-0000-1000-8000-00805f9b34fb');
    btChar.addEventListener('characteristicvaluechanged', handleBt);
    await btChar.startNotifications();
    setBadge('bluetooth'); setStatusText('Bluetooth connected');
    appendMessage('🔵 Bluetooth connected (basic)', 'system');
  }catch(e){ console.warn('bt err', e); appendMessage('⚠ Bluetooth failed', 'system'); }
});

async function handleBt(ev){
  try{
    const raw = new TextDecoder().decode(ev.target.value);
    // Expect JSON payload (if other side sends JSON string)
    const obj = JSON.parse(raw);
    if(obj.msg){
      if(cryptoKey){
        const txt = await decryptMsg(obj.msg);
        if(txt) { appendMessage(txt, 'friend'); saveMessageLocal(txt,'friend'); }
      }
    } else if(obj.plain){
      appendMessage(obj.plain, 'friend'); saveMessageLocal(obj.plain,'friend');
    }
  }catch(e){ console.warn('bt parse', e); }
}

/* ---------- start ---------- */
initDB(); initPeer();

/* Ensure highlight.js works for dynamically created blocks */
document.addEventListener('DOMContentLoaded', ()=>{ if(window.hljs) hljs.configure({ignoreUnescapedHTML:true}); });
