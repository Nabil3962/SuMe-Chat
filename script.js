// ---------- CORE VARIABLES ----------
let conn, cryptoKey;
let onlineMode = navigator.onLine;
let offlineQueue = [];
let btDevice, btServer, btCharacteristic;

// ---------- UTILITIES ----------
function sanitize(str){return str.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}
function setStatus(text,cls){const s=document.getElementById('status'); s.innerText="Status: "+text; s.className=cls;}
function addMsg(text,type){const chat=document.getElementById('chat'); const div=document.createElement('div'); div.className= type==='me'?'message me':type==='friend'?'message friend':'message system'; div.innerHTML=sanitize(text)+`<div class="timestamp">${new Date().toLocaleTimeString()}</div>`; chat.appendChild(div); chat.scrollTo({top:chat.scrollHeight,behavior:'smooth'});}
function copyPeerId(){const id=document.getElementById('myPeerId').innerText; if(id && id!=='Generating...'){navigator.clipboard.writeText(id).then(()=>alert('Peer ID copied!')).catch(()=>alert('Clipboard error!'));}}

// ---------- ENCRYPTION ----------
async function generateKey(){ cryptoKey = await crypto.subtle.generateKey({name:"AES-GCM",length:256},true,["encrypt","decrypt"]); }
async function exportKey(){ const raw = await crypto.subtle.exportKey("raw",cryptoKey); return btoa(String.fromCharCode(...new Uint8Array(raw))); }
async function importKey(base64){ try{ const raw=Uint8Array.from(atob(base64),c=>c.charCodeAt(0)); cryptoKey=await crypto.subtle.importKey("raw",raw,"AES-GCM",true,["encrypt","decrypt"]); }catch(e){ addMsg("❌ Key exchange failed!","system"); console.error(e); } }
async function encryptMsg(msg){ const enc=new TextEncoder().encode(msg); const iv=crypto.getRandomValues(new Uint8Array(12)); const ciphertext=await crypto.subtle.encrypt({name:"AES-GCM",iv},cryptoKey,enc); return {iv:Array.from(iv),data:Array.from(new Uint8Array(ciphertext))}; }
async function decryptMsg(payload){ try{ const iv=new Uint8Array(payload.iv); const data=new Uint8Array(payload.data); const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv},cryptoKey,data); return new TextDecoder().decode(plain); }catch{ addMsg("⚠ Decryption failed. Possibly tampered message.","system"); return null; } }

// ---------- PEERJS ----------
function uuidv4(){return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0,v=c==='x'?r:(r&0x3|0x8);return v.toString(16);});}
const myPeerId = localStorage.getItem('myPeerId') || uuidv4();
localStorage.setItem('myPeerId', myPeerId);

const peer = new Peer(myPeerId,{
  host:'0.peerjs.com', port:443, secure:true, path:'/', debug:1,
  config:{iceServers:[
    {urls:['stun:stun.l.google.com:19302','stun:stun1.l.google.com:19302']},
    {urls:'turn:relay1.expressturn.com:3478',username:'efYQXKAB2wxWtdjKOf',credential:'W9qTXeDtvz7cOZZv'}
  ], sdpSemantics:'unified-plan'}
});

peer.on('open',async id=>{document.getElementById('myPeerId').innerText=id; await generateKey(); setStatus('Ready to connect','disconnected');});
peer.on('error',err=>{console.error('PeerJS Error:',err); setStatus('Error: '+err.type,'disconnected'); addMsg('⚠ '+err.message,'system');});

// ---------- CONNECTION ----------
function connectPeer(){const peerId=document.getElementById('peerIdInput').value.trim();if(!peerId) return alert('Enter Peer ID!'); if(peerId===peer.id) return alert('You cannot connect to yourself!'); setStatus('Connecting...','connecting'); conn=peer.connect(peerId,{reliable:true}); const timeout=setTimeout(()=>{if(!conn.open){ setStatus('Failed to connect','disconnected'); addMsg('⚠ Connection timeout. Peer may be offline.','system'); }},10000); setupConnectionEvents(conn,timeout);}
function setupConnectionEvents(c,timeout=null){ c.on('open',async ()=>{if(timeout) clearTimeout(timeout); setStatus('Connected to '+c.peer,'connected'); addMsg('✅ Connected to '+c.peer,'system'); enableChat(true); try{c.send({key:await exportKey()});}catch(e){addMsg('⚠ Could not send key.','system'); console.error(e);}}); c.on('data',handleData); c.on('close',()=>{ setStatus('Disconnected','disconnected'); addMsg('❌ Connection closed','system'); enableChat(false);}); c.on('error',err=>{ setStatus('Error: '+err.type,'disconnected'); addMsg('⚠ Connection error.','system'); console.error(err);});}
function enableChat(enabled){document.getElementById('sendBtn').disabled=!enabled; document.getElementById('msgInput').disabled=!enabled;}
peer.on('connection',c=>{if(conn && conn.open){c.close(); return;} conn=c; setupConnectionEvents(conn); setStatus('Connected to '+conn.peer,'connected'); addMsg('🔔 Someone connected to you!','system'); enableChat(true);});

// ---------- MESSAGE ----------
async function handleData(data){if(data.key){ await importKey(data.key); addMsg('🔐 Secure channel established!','system'); } else if(data.msg){ const text=await decryptMsg(data.msg); if(text) addMsg(text,'friend'); }}
async function sendMsg(){const msgInput=document.getElementById('msgInput'); const msg=msgInput.value.trim(); if(!msg) return; if(onlineMode && conn && conn.open){ const encrypted=await encryptMsg(msg); conn.send({msg:encrypted}); addMsg(msg,'me'); } else { sendBtMsg(msg); } msgInput.value='';}

// ---------- BLUETOOTH ----------
async function connectBluetooth(){try{ btDevice=await navigator.bluetooth.requestDevice({acceptAllDevices:true, optionalServices:['0000ffe0-0000-1000-8000-00805f9b34fb']}); btServer=await btDevice.gatt.connect(); const service=await btServer.getPrimaryService('0000ffe0-0000-1000-8000-00805f9b34fb'); btCharacteristic=await service.getCharacteristic('0000ffe1-0000-1000-8000-00805f9b34fb'); btCharacteristic.startNotifications(); btCharacteristic.addEventListener('characteristicvaluechanged',handleBtMsg); addMsg('🔵 Bluetooth connected!','system'); flushOfflineQueue();}catch(e){addMsg('⚠ Bluetooth connect failed','system'); console.error(e);}}
async function sendBtMsg(msg){if(!btCharacteristic){offlineQueue.push(msg); addMsg('⚠ Offline message queued','system'); return;} const encrypted=await encryptMsg(msg); const data=new Uint8Array(JSON.stringify(encrypted).split('').map(c=>c.charCodeAt(0))); await btCharacteristic.writeValue(data); addMsg(msg,'me'); }
function handleBtMsg(event){const raw=new TextDecoder().decode(event.target.value); const payload=JSON.parse(raw); decryptMsg(payload).then(text=>{if(text) addMsg(text,'friend');});}
function flushOfflineQueue(){offlineQueue.forEach(m=>sendBtMsg(m)); offlineQueue=[];}

// ---------- ONLINE/OFFLINE ----------
window.addEventListener('online',()=>{onlineMode=true; addMsg('🌐 Online mode','system'); flushOfflineQueue();});
window.addEventListener('offline',()=>{onlineMode=false; addMsg('🔵 Offline mode (Bluetooth)','system');});
