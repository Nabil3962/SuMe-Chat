/* SuMe-Chat  |  Secure P2P + Bluetooth Chat  |  ECDH + AES-GCM */

// ---------- ELEMENTS ----------
const statusEl = document.getElementById("status");
const chatBox = document.getElementById("chatBox");
const msgInput = document.getElementById("msgInput");
const sendBtn = document.getElementById("sendBtn");
const connectBtn = document.getElementById("connectBtn");
const connectId = document.getElementById("connectId");
const btConnectBtn = document.getElementById("btConnectBtn");
const myPeerIdEl = document.getElementById("myPeerId");

// ---------- GLOBAL ----------
let peer, conn;
let btCharacteristic = null;
let messageQueue = [];

// ---------- UI HELPERS ----------
function setStatus(txt, cls = "") {
  statusEl.textContent = txt;
  statusEl.className = cls;
}
function addMsg(text, cls = "system") {
  const div = document.createElement("div");
  div.className = "msg " + cls;
  div.textContent = text;
  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
}
function sanitize(txt) {
  return txt.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

// ---------- ECDH → AES-GCM ----------
let cryptoKey = null, ecdhPair = null;
function ab2b64(buf) { return btoa(String.fromCharCode(...new Uint8Array(buf))); }
function b642ab(b64) { return Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer; }

async function genEcdhPub() {
  ecdhPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey"]);
  const raw = await crypto.subtle.exportKey("raw", ecdhPair.publicKey);
  return ab2b64(raw);
}
async function deriveSharedKey(peerPubB64) {
  const peerRaw = b642ab(peerPubB64);
  const peerPub = await crypto.subtle.importKey("raw", peerRaw, { name: "ECDH", namedCurve: "P-256" }, true, []);
  cryptoKey = await crypto.subtle.deriveKey({ name: "ECDH", public: peerPub },
                                            ecdhPair.privateKey,
                                            { name: "AES-GCM", length: 256 },
                                            false, ["encrypt", "decrypt"]);
  addMsg("🔐 Secure channel established", "system");
}
async function encryptMsg(msg) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv },
                                         cryptoKey, new TextEncoder().encode(msg));
  return { iv: Array.from(iv), data: Array.from(new Uint8Array(ct)) };
}
async function decryptMsg(payload) {
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(payload.iv) },
      cryptoKey, new Uint8Array(payload.data)
    );
    return new TextDecoder().decode(plain);
  } catch {
    addMsg("⚠ Decryption failed", "system");
    return null;
  }
}

// ---------- PEERJS ----------
let myPubKey = null;

peer = new Peer({
  secure: true,
  host: "0.peerjs.com",
  port: 443,
  config: { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] }
});

peer.on("open", async id => {
  myPeerIdEl.textContent = id;
  myPubKey = await genEcdhPub();
  setStatus("Ready to connect", "ok");
});

peer.on("connection", c => {
  conn = c;
  setStatus("Connected to peer", "ok");
  c.on("data", handleData);
  c.send({ pubKey: myPubKey });
  flushQueue();
});
peer.on("error", err => {
  console.error(err);
  setStatus("Error: " + (err.message || err.type));
});

// Connect button
connectBtn.onclick = () => {
  const id = connectId.value.trim();
  if (!id) return alert("Enter peer ID");
  conn = peer.connect(id);
  conn.on("open", () => {
    setStatus("Connected to peer", "ok");
    conn.on("data", handleData);
    conn.send({ pubKey: myPubKey });
    flushQueue();
  });
};

async function handleData(data) {
  if (data.pubKey) await deriveSharedKey(data.pubKey);
  else if (data.msg) {
    const text = await decryptMsg(data.msg);
    if (text) addMsg(text, "friend");
  }
}

async function sendMsg() {
  const msg = msgInput.value.trim();
  if (!msg) return;
  msgInput.value = "";
  addMsg(msg, "me");
  const enc = cryptoKey ? await encryptMsg(msg) : { plain: msg };
  if (conn && conn.open) conn.send({ msg: enc });
  else messageQueue.push(enc);
  if (btCharacteristic) await sendBt(enc);
}

async function flushQueue() {
  if (conn && conn.open && messageQueue.length) {
    for (const m of messageQueue) conn.send({ msg: m });
    messageQueue = [];
  }
}
sendBtn.onclick = sendMsg;
msgInput.addEventListener("keypress", e => { if (e.key === "Enter") sendMsg(); });

// ---------- BLUETOOTH ----------
const CHUNK = 180;
async function connectBluetooth() {
  try {
    const dev = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: [0xFFE0] });
    const server = await dev.gatt.connect();
    const svc = await server.getPrimaryService(0xFFE0);
    btCharacteristic = await svc.getCharacteristic(0xFFE1);
    setStatus("Bluetooth connected", "ok");
    btCharacteristic.addEventListener("characteristicvaluechanged", handleBt);
    await btCharacteristic.startNotifications();
  } catch (e) {
    console.error(e);
    setStatus("Bluetooth failed");
  }
}
btConnectBtn.onclick = connectBluetooth;

async function sendBt(payload) {
  const str = JSON.stringify(payload);
  for (let i = 0; i < str.length; i += CHUNK) {
    const frame = str.slice(i, i + CHUNK);
    const buf = new TextEncoder().encode(frame);
    await btCharacteristic.writeValue(buf);
    await new Promise(r => setTimeout(r, 40));
  }
}
async function handleBt(e) {
  try {
    const str = new TextDecoder().decode(e.target.value);
    const data = JSON.parse(str);
    const text = cryptoKey ? await decryptMsg(data) : data.plain;
    if (text) addMsg(text, "friend");
  } catch (err) {
    console.error("BT parse fail", err);
  }
}
