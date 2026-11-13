'use strict';

const $ = (id) => document.getElementById(id);
const HANDS = ['グー', 'チョキ', 'パー'];
const EMOJI = {'グー': '✊', 'チョキ': '✌️', 'パー': '✋'};
const MIN_CONFIDENCE = 0.75;
let model = null;
let stream = null;
let running = false;
let predictionBusy = false;
let latest = null;
let scores = {win: 0, lose: 0, draw: 0};
let modelVersion = 0;

function setStatus(id, message) { 
  $(id).textContent = message; 
}

function normalizeHand(label) {
  const s = String(label).trim().replace(/[\s　_-]/g, '').toLowerCase();
  if (s === 'グー' || s === 'ぐー' || s === 'gu' || s === 'goo' || s === 'rock') return 'グー';
  if (s === 'チョキ' || s === 'ちょき' || s === 'choki' || s === 'scissors') return 'チョキ';
  if (s === 'パー' || s === 'ぱー' || s === 'pa' || s === 'paper') return 'パー';
  if (s === '手なし' || s === '手無し' || s === 'てなし' || s === 'nohand' || s === 'none' || s === 'empty') return '手なし';
  return null;
}

function stopCamera() {
  running = false;
  if (stream) stream.getTracks().forEach(track => track.stop());
  stream = null;
  $('video').srcObject = null;
  $('video').classList.remove('active');
  $('cameraPlaceholder').hidden = false;
  $('start').disabled = !model;
  $('stop').disabled = true;
  $('play').disabled = true;
  latest = null;
  $('playerHand').textContent = '？';
  $('confidence').textContent = '認識待ち';
  setStatus('cameraStatus', 'カメラは停止しています。');
}

async function loadZip(file) {
  const version = ++modelVersion;
  stopCamera();
  model = null;
  $('start').disabled = true;
  setStatus('modelStatus', 'ZIPファイルを読み込んでいます…');
  try {
    if (!window.JSZip || !window.tmImage) throw new Error('必要なライブラリを読み込めませんでした。インターネット接続を確認してください。');
    const zip = await JSZip.loadAsync(file);
    const find = (name) => Object.values(zip.files).find(f => !f.dir && f.name.split('/').pop().toLowerCase() === name);
    const modelEntry = find('model.json');
    const metadataEntry = find('metadata.json');
    if (!modelEntry || !metadataEntry) throw new Error('model.json または metadata.json が見つかりません。Teachable MachineのTensorFlow.js形式のZIPを選んでください。');
    const modelText = await modelEntry.async('string');
    const manifest = JSON.parse(modelText).weightsManifest;
    if (!Array.isArray(manifest) || manifest.length === 0) throw new Error('モデル内に重みファイルの情報がありません。');
    const paths = [...new Set(manifest.flatMap(m => m.paths))];
    if (paths.length !== 1) throw new Error('このZIPは複数の重みファイルを使用しています。Teachable Machineの標準ZIPを書き出してください。');
    const weightName = paths[0].split('/').pop();
    const weightsEntry = find(weightName);
    if (!weightsEntry) throw new Error('重みファイル ' + weightName + ' が見つかりません。');
    const [weightBytes, metadataText] = await Promise.all([weightsEntry.async('uint8array'), metadataEntry.async('string')]);
    const metadata = JSON.parse(metadataText);
    const classes = (metadata.labels || []).map(normalizeHand);
    if (classes.length !== 4 || new Set(classes).size !== 4 || classes.some(x => !x)) throw new Error('クラス名を「グー」「チョキ」「パー」の3種類にしてください（現在: ' + (metadata.labels || []).join('、') + '）。');
    const modelFile = new File([modelText], 'model.json', {type:'application/json'});
    const weightFile = new File([weightBytes], weightName, {type:'application/octet-stream'});
    const metadataFile = new File([metadataText], 'metadata.json', {type:'application/json'});
    const loaded = await tmImage.loadFromFiles(modelFile, weightFile, metadataFile);
    
    if (version !== modelVersion) { 
      loaded.dispose?.(); return; 
    }
    
    model = loaded;
    $('start').disabled = false;
    setStatus('modelStatus', '✅ 読み込み成功！「カメラを起動」を押してね。');
    setStatus('cameraStatus', 'カメラを起動できます。');
  } catch (err) {
    if (version !== modelVersion) return;
    setStatus('modelStatus', '⚠️ ' + err.message);
    console.error(err);
  }
}

async function startCamera() {
  if (!model || running) return;
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('カメラを使用できません。HTTPSの公開ページで開いてください。');
    stream = await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:'user'}});
    const video = $('video');
    video.srcObject = stream;
    await video.play();
    running = true;
    video.classList.add('active');
    $('cameraPlaceholder').hidden = true;
    $('start').disabled = true;
    $('stop').disabled = false;
    $('play').disabled = false;
    setStatus('cameraStatus', '✅ カメラ起動中！手を映してね。');
    requestAnimationFrame(predictLoop);
  } catch (err) {
    stopCamera();
    setStatus('cameraStatus', '⚠️ カメラを起動できませんでした。ブラウザのカメラ許可を確認してください。' + (err.message || ''));
    console.error(err);
  }
}

async function predictLoop() {
  if (!running) return;
  if (!predictionBusy) {
    predictionBusy = true;
    try {
      const predictions = await model.predict($('video'));
      if (!running) return;
      const top = predictions.reduce((best, x) => x.probability > best.probability ? x : best, predictions[0]);
      const hand = normalizeHand(top.className);
      latest = {hand, confidence: top.probability, time: performance.now()};
      $('playerHand').textContent = hand === '手なし' ? '🖐️ 手なし' : (hand ? EMOJI[hand] + ' ' + hand : '認識できません');
      $('confidence').textContent = 'AIの認識率：' + Math.round(top.probability * 100) + '%';
    } catch (err) {
      console.error(err);
      stopCamera();
      setStatus('cameraStatus', '⚠️ 画像認識中にエラーが発生しました。');
    } finally { predictionBusy = false; }
  }
  if (running) requestAnimationFrame(predictLoop);
}

function playGame() {
  if (!running || !model) return;
  if (latest?.hand === '手なし' && latest.confidence >= MIN_CONFIDENCE && performance.now() - latest.time <= 1500) {
    $('result').textContent = '🖐️ カメラに手を映してね！';
    return;
  }
  if (!latest || !latest.hand || latest.confidence < MIN_CONFIDENCE || performance.now() - latest.time > 1500) {
    $('result').textContent = '🤔 手がよく見えないみたい。カメラにしっかり映してね！';
    return;
  }
  const player = latest.hand;
  const ai = HANDS[Math.floor(Math.random() * HANDS.length)];
  $('aiHand').textContent = EMOJI[ai];
  $('aiName').textContent = ai;
  if (player === ai) { scores.draw++; $('result').textContent = '🤝 あいこ！もう一回！'; }
  else if ((player === 'グー' && ai === 'チョキ') || (player === 'チョキ' && ai === 'パー') || (player === 'パー' && ai === 'グー')) {
    scores.win++; $('result').textContent = '🎉 あなたの勝ち！';
  } else { scores.lose++; $('result').textContent = '🤖 AIの勝ち！次は勝てるかな？'; }
  updateScore();
}

function updateScore() { $('score').textContent = `あなたの勝ち ${scores.win}回 ／ AIの勝ち ${scores.lose}回 ／ あいこ ${scores.draw}回`; }
$('zipInput').addEventListener('change', e => { if (e.target.files[0]) loadZip(e.target.files[0]); });
$('start').addEventListener('click', startCamera);
$('stop').addEventListener('click', stopCamera);
$('play').addEventListener('click', playGame);
$('reset').addEventListener('click', () => { scores = {win:0,lose:0,draw:0}; updateScore(); $('result').textContent = '成績をリセットしたよ！'; });
window.addEventListener('pagehide', stopCamera);
