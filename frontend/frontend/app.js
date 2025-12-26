// フロントロジック：端末作成・命名・スナップショット(localStorage)・テーマ・サイズ切替・メッセージ・録画・簡易WebRTC(シグナル経由)
(() => {
  const phonesRoot = document.getElementById('phones');
  const createBtn = document.getElementById('createPhone');
  const create10Btn = document.getElementById('create10');
  const countSpan = document.getElementById('count');
  const themeSelect = document.getElementById('themeSelect');
  const sizeSelect = document.getElementById('sizeSelect');
  const serverUrlInput = document.getElementById('serverUrl');
  const connectServerBtn = document.getElementById('connectServer');
  const serverStatus = document.getElementById('serverStatus');

  let idCounter = 0;
  const phones = [];
  let ws = null;
  let serverUrl = '';

  createBtn.addEventListener('click', () => { createPhone(); updateCount(); });
  create10Btn.addEventListener('click', ()=>{ for(let i=0;i<10;i++) createPhone(); updateCount(); });
  connectServerBtn.addEventListener('click', ()=> {
    serverUrl = serverUrlInput.value.trim();
    if(!serverUrl){ alert('サーバURLを入力してください'); return; }
    connectToServer(serverUrl);
  });

  function updateCount(){ countSpan.textContent = phones.length; }

  function createPhone(){
    const id = ++idCounter;
    const el = document.createElement('div');
    el.className = 'phone';
    if(themeSelect.value === 'ios') el.classList.add('ios');
    el.classList.add(sizeSelect.value === 'large' ? 'large' : sizeSelect.value === 'small' ? 'small' : '');

    el.innerHTML = `
      <div class="screen" data-state="off">
        <div class="topbar">
          <input class="nameInput" value="Device-${id}" />
        </div>
        <div class="appgrid">
          <div class="icon">A</div><div class="icon">B</div><div class="icon">C</div>
          <div class="icon">D</div><div class="icon">E</div><div class="icon">F</div>
        </div>
        <div style="display:flex;gap:6px;padding:8px;justify-content:center">
          <button class="btn powerBtn">電源</button>
          <button class="btn snapBtn">スナップ</button>
          <button class="btn msgBtn">メッセージ</button>
          <button class="btn recordBtn">録画</button>
          <button class="btn rtcBtn">ライブ</button>
        </div>
        <div class="meta">状態: <span class="stateText">オフ</span></div>
      </div>
    `;
    phonesRoot.appendChild(el);
    const phone = {
      id,
      el,
      name: `Device-${id}`,
      state: 'off',
      mediaRecorder: null,
      recordedBlobs: [],
      pc: null, // WebRTC PeerConnection
    };
    phones.push(phone);

    // UI hooks
    const nameInput = el.querySelector('.nameInput');
    const powerBtn = el.querySelector('.powerBtn');
    const snapBtn = el.querySelector('.snapBtn');
    const msgBtn = el.querySelector('.msgBtn');
    const recordBtn = el.querySelector('.recordBtn');
    const rtcBtn = el.querySelector('.rtcBtn');
    const stateText = el.querySelector('.stateText');

    nameInput.addEventListener('input', e => { phone.name = e.target.value; });
    powerBtn.addEventListener('click', () => {
      if(phone.state === 'off') bootPhone(phone);
      else shutdownPhone(phone);
    });
    snapBtn.addEventListener('click', () => takeSnapshot(phone));
    msgBtn.addEventListener('click', () => openMessageDialog(phone));
    recordBtn.addEventListener('click', () => toggleRecord(phone));
    rtcBtn.addEventListener('click', () => startLive(phone));

    return phone;
  }

  function bootPhone(phone){
    phone.state = 'booting';
    const stateText = phone.el.querySelector('.stateText');
    stateText.textContent = '起動中...';
    // simple boot animation
    let p = 0;
    const scr = phone.el.querySelector('.appgrid');
    scr.style.opacity = '0.2';
    const t = setInterval(()=>{
      p += 12;
      if(p >= 100){ p = 100; clearInterval(t); phone.state = 'on'; scr.style.opacity = '1'; stateText.textContent = '起動完了'; }
      else { stateText.textContent = `Boot ${p}%`; }
    }, 200);
  }

  function shutdownPhone(phone){
    phone.state = 'off';
    const stateText = phone.el.querySelector('.stateText');
    stateText.textContent = 'オフ';
    // stop recording or live
    if(phone.mediaRecorder && phone.mediaRecorder.state !== 'inactive') phone.mediaRecorder.stop();
    if(phone.pc){ phone.pc.close(); phone.pc = null; }
  }

  // snapshot -> localStorage + optionでサーバへPOST
  function takeSnapshot(phone){
    const name = phone.name || `Device-${phone.id}`;
    const scr = phone.el.querySelector('.screen');
    // snapshot: we simulate by saving metadata + current time and theme
    const snapshot = {
      id: phone.id,
      name,
      state: phone.state,
      theme: themeSelect.value,
      size: sizeSelect.value,
      time: new Date().toISOString()
    };
    // localStorage key
    const key = `snapshot:${name}:${snapshot.time}`;
    localStorage.setItem(key, JSON.stringify(snapshot));
    alert('スナップショット保存（localStorage）: ' + key);

    // optional: send to server if connected
    if(ws && ws.readyState === WebSocket.OPEN){
      ws.send(JSON.stringify({ type:'snapshot', payload: snapshot }));
    }
  }

  // 内部メッセージ機能（サーバ未接続時はローカルの簡易ブロードキャスト）
  function openMessageDialog(phone){
    const text = prompt('送信メッセージを入力（他端末へ）:');
    if(!text) return;
    const payload = { from: phone.name, text, time: new Date().toISOString() };
    if(ws && ws.readyState === WebSocket.OPEN){
      ws.send(JSON.stringify({ type:'message', payload }));
    } else {
      // local broadcast
      phones.forEach(p => {
        if(p !== phone) showToast(p, `メッセージ from ${payload.from}: ${payload.text}`);
      });
    }
  }

  function showToast(phone, msg){
    const area = phone.el.querySelector('.topbar');
    const prev = area.querySelector('.toast');
    if(prev) prev.remove();
    const t = document.createElement('div');
    t.className = 'toast small';
    t.textContent = msg;
    area.appendChild(t);
    setTimeout(()=> t.remove(), 4000);
  }

  // 録画：画面（要表示要素）を MediaRecorder で取得してダウンロード
  async function toggleRecord(phone){
    if(phone.mediaRecorder && phone.mediaRecorder.state === 'recording'){
      phone.mediaRecorder.stop();
      return;
    }
    const screenEl = phone.el.querySelector('.screen');
    // use captureStream if the browser supports it, else fallback to canvas capture (simplified)
    let stream = null;
    if(screenEl.captureStream){
      stream = screenEl.captureStream(30);
    } else {
      alert('このブラウザは画面キャプチャの captureStream をサポートしていません');
      return;
    }
    const options = { mimeType: 'video/webm; codecs=vp9' };
    const mediaRecorder = new MediaRecorder(stream, options);
    phone.recordedBlobs = [];
    mediaRecorder.ondataavailable = (e) => { if(e.data && e.data.size) phone.recordedBlobs.push(e.data); };
    mediaRecorder.onstop = () => {
      const blob = new Blob(phone.recordedBlobs, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `${phone.name || 'device'}_${Date.now()}.webm`;
      document.body.appendChild(a);
      a.click();
      setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); }, 1000);
    };
    phone.mediaRecorder = mediaRecorder;
    mediaRecorder.start();
    alert('録画開始。もう一度「録画」ボタンで停止してダウンロードします。');
  }

  // WebRTC ライブ: シンプルにPeerConnectionを作ってシグナリング経由で接続（STUNのみ）
  async function startLive(phone){
    if(!serverUrl){ alert('まずサーバ(シグナリング)に接続してください'); return; }
    if(!ws || ws.readyState !== WebSocket.OPEN){ alert('WebSocket未接続: サーバに接続してください'); return; }

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    phone.pc = pc;

    // add local stream (screen capture)
    const screenEl = phone.el.querySelector('.screen');
    let stream = null;
    if(screenEl.captureStream) stream = screenEl.captureStream(30);
    else { alert('captureStream未対応'); return; }
    stream.getTracks().forEach(track => pc.addTrack(track, stream));

    pc.onicecandidate = (ev) => {
      if(ev.candidate) ws.send(JSON.stringify({ type:'ice', payload:{ candidate: ev.candidate, from: phone.name } }));
    };

    pc.onconnectionstatechange = () => {
      console.log('PC state:', pc.connectionState);
      if(pc.connectionState === 'connected') alert('ライブ接続成功（P2P確立）');
    };

    // シグナリング: offer 作成
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    ws.send(JSON.stringify({ type:'offer', payload:{ sdp: offer.sdp, from: phone.name } }));

    // サーバ経由で answer を受け取る（server.js 側で broadcast する想定）
    // server.js が answer を送ると、ws.onmessage 側で setRemoteDescription を呼ぶ処理がある
  }

  // WebSocket server 接続
  function connectToServer(url){
    try {
      ws = new WebSocket(url);
    } catch(e){
      alert('WebSocket 接続に失敗しました: ' + e.message);
      return;
    }
    ws.onopen = () => { serverStatus.textContent = '接続済み'; };
    ws.onclose = () => { serverStatus.textContent = '切断'; };
    ws.onerror = (e) => { serverStatus.textContent = 'エラー'; console.error(e); };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        handleServerMessage(msg);
      } catch(e){ console.warn('invalid server message', ev.data); }
    };
  }

  // サーバメッセージハンドリング（offer/answer/ice/message/snapshot）
  function handleServerMessage(msg){
    const { type, payload } = msg;
    if(type === 'message'){
      // broadcast to all devices
      phones.forEach(p => showToast(p, `サーバ: ${payload.from} -> ${payload.text}`));
    } else if(type === 'snapshot'){
      alert('サーバにスナップショット保存されました: ' + JSON.stringify(payload));
    } else if(type === 'offer'){
      // 他端末から送られたOfferに対してAnswerを返す (簡易: サーバ側で接続相手を仲介する想定)
      // ここではクライアント側がAnswerを生成する実装はサーバの設計によるため簡略化
      console.log('offer 受信（クライアント側処理は簡略）', payload);
    } else if(type === 'answer'){
      // setRemoteDescription
      // find pc by name
      const from = payload.from;
      const pcPhone = phones.find(p => p.name === from);
      if(pcPhone && pcPhone.pc){
        const desc = new RTCSessionDescription({ type:'answer', sdp: payload.sdp });
        pcPhone.pc.setRemoteDescription(desc).catch(console.error);
      }
    } else if(type === 'ice'){
      const from = payload.from;
      const pcPhone = phones.find(p => p.name === from);
      if(pcPhone && pcPhone.pc){
        pcPhone.pc.addIceCandidate(new RTCIceCandidate(payload.candidate)).catch(console.error);
      }
    }
  }

  // デモ用に少し作っておく
  for(let i=0;i<3;i++) createPhone();
  updateCount();
})();
