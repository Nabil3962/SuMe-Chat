#SuMe-Chat

SuMe-Chat is a secure, encrypted peer-to-peer chat web app.  
Chat directly between two browsers or via Bluetooth — messages never touch a central server.  


#Features:
- Private ID-to-ID chat: Only you and your friend can communicate.  
- AES-256 encryption: All messages encrypted end-to-end using AES-GCM.  
- Peer-to-Peer Online Mode: Uses PeerJS / WebRTC for real-time online chat.  
- Offline Mode (Bluetooth): Send messages when offline via Web Bluetooth.  
- Automatic Peer Switching: Tries multiple PeerJS hosts for smooth connectivity.  
- Typing Indicator: Shows when your friend is typing.  
- Read Receipts: Know when messages are delivered and read.  
- Group Chat Support: Optional multiple peers in the same chat.  
- Custom Themes: Light, Dark, and Hacker mode UI.  
- Secure Key Exchange: AES-GCM key exchange between peers.  
- Web-based: Works in any modern browser.  
- No central server: Messages stay private on devices.  


#How to Use:
1. Open `index.html` in your browser.  
2. Your browser generates a **Peer ID** in the format `xxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`.  
3. Share your Peer ID with your friend.  
4. Enter your friend's ID in the **Friend's ID** box and click **Connect**.  
5. If offline, click **Connect via Bluetooth** to chat without internet.  
6. Start chatting securely.  
7. Optional: Switch between **Light**, **Dark**, or **Hacker** themes.  


#Installation / Setup:
- No installation required. Open in a modern browser (Chrome, Edge, Firefox).  
- Bluetooth requires a browser supporting the Web Bluetooth API.  
- Optional: Use a local server (`Live Server` in VSCode) for better PeerJS reliability.  


#Recommended Workflow:
- **Always save your Peer ID**.  
- Use the **copy button** to share easily.  
- Switch themes from the UI if needed.  
- In offline mode, manually connect via Bluetooth first.  


#Security Notes:
- All messages are **encrypted end-to-end**.  
- AES-GCM ensures message integrity and confidentiality.  
- No message metadata or content is sent to any server.  
- Use **strong random Peer IDs** to prevent unauthorized access.  

