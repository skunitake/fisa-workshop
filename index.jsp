'use strict';

const $=id=>document.getElementById(id);
let model=null,stream=null,loopId=null,busy=false;

function status(id,msg,error=false){
    $(id).textContent=msg;
    $(id).classList.toggle('error',error)
}

function resetResult(){
    $('result').hidden=true;
    $('bars').replaceChildren()
}

function stopCamera(){
    if(loopId!==null){
        cancelAnimationFrame(loopId);loopId=null
    }
    if(stream){
        stream.getTracks().forEach(t=>t.stop());stream=null
    }
    $('video').pause();
    $('video').srcObject=null;
    $('video').hidden=true;
    $('stop').disabled=true;
    $('start').disabled=!model;
    status('cameraStatus','カメラは停止しています。')
}

function getFile(zip,name){
    const paths=Object.keys(zip.files);
    return paths.find(p=>!zip.files[p].dir&&(p===name||p.endsWith('/'+name))&&!p.startsWith('__MACOSX/'))
}

$('zipInput').addEventListener('change',async()=>{
    stopCamera();
    resetResult();
    model=null;
    $('start').disabled=true;
    const file=$('zipInput').files[0];
    if(!file){
        status('modelStatus','ZIPファイルを選んでね。');
        return
    }
    
    status('modelStatus','モデルを読み込んでいます…');
    
    try{
        if(!window.tf||!window.tmImage||!window.JSZip)throw Error('必要なライブラリを読み込めません。ネット接続を確認してページを再読み込みしてね。');
        const zip=await JSZip.loadAsync(file);
        const mp=getFile(zip,'model.json'),meta=getFile(zip,'metadata.json');
        
        if(!mp||!meta)throw Error('model.json または metadata.json が見つかりません。TensorFlow.js形式の画像モデルZIPを選んでね。');
        
        const modelJson=JSON.parse(await zip.file(mp).async('string'));
        const paths=(modelJson.weightsManifest||[]).flatMap(x=>x.paths||[]);
        
        if(paths.length!==1)throw Error('このモデルの重みファイル構成には未対応です。通常のTeachable Machine画像モデル（weights.binが1個）を使ってね。');

        const base=mp.slice(0,mp.lastIndexOf('/')+1);
        const weightPath=base+paths[0];

        if(!zip.file(weightPath))throw Error('重みファイルが見つかりません: '+paths[0]);

        const modelFile=new File([await zip.file(mp).async('blob')],'model.json',{type:'application/json'});
        const metadataFile=new File([await zip.file(meta).async('blob')],'metadata.json',{type:'application/json'});
        const weightFile=new File([await zip.file(weightPath).async('blob')],paths[0],{type:'application/octet-stream'});
        model=await tmImage.loadFromFiles(modelFile,weightFile,metadataFile);
        const labels=model.getClassLabels();if(!labels||!labels.length)throw Error('クラス名が見つかりません。');
        status('modelStatus','✅ 読み込み成功！ '+labels.length+'種類を認識できます：'+labels.join('・'));
        $('start').disabled=false;status('cameraStatus','「カメラを起動」を押してね！');
    }catch(e){console.error(e);status('modelStatus','読み込めませんでした：'+e.message,true)}
});

$('start').addEventListener('click',async()=>{
    if(!model)return;$('start').disabled=true;status('cameraStatus','カメラを準備しています…');
    
    try{
        if(!navigator.mediaDevices?.getUserMedia)throw Error('カメラを利用できません。HTTPSのページをEdge/Chromeで開いてね。');
        
        stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:'user',width:{ideal:640},height:{ideal:480}}});
        const video=$('video');
        video.srcObject=stream;
        await video.play();
        video.hidden=false;
        $('stop').disabled=false;
        
        status('cameraStatus','認識中！ カメラにいろいろ映してみよう。');
        const tick=async()=>{if(!stream)return;if(!busy){busy=true;
            
            try{
                const predictions=await model.predict(video);
                if(!stream)return;
                const sorted=[...predictions].sort((a,b)=>b.probability-a.probability);
                const best=sorted[0];
                
                $('result').hidden=false;
                $('topLabel').textContent=best.className;
                $('topScore').textContent='確信度 '+Math.round(best.probability*100)+'%';
                
                const root=$('bars');
                root.replaceChildren();
                for(const p of predictions){
                    const row=document.createElement('div');
                    row.className='barrow';
                    const label=document.createElement('span');
                    label.textContent=p.className;
                    const track=document.createElement('div');
                    track.className='track';
                    const fill=document.createElement('div');
                    fill.className='fill';
                    fill.style.width=(p.probability*100).toFixed(1)+'%';
                    track.append(fill);
                    const score=document.createElement('span');
                    score.textContent=Math.round(p.probability*100)+'%';
                    row.append(label,track,score);
                    root.append(row);
                }
            }catch(e){
                console.error(e);
                status('cameraStatus','認識エラー：'+e.message,true);
                stopCamera();return}finally{
                    busy=false
                }
            }
            
            loopId=requestAnimationFrame(tick)};
            loopId=requestAnimationFrame(tick);
        }catch(e){
            console.error(e);
            status('cameraStatus','カメラを起動できません：'+e.message,true);
            stopCamera();
            status('cameraStatus','カメラを起動できません：'+e.message,true)
        }
    }
);

$('stop').addEventListener('click',stopCamera);window.addEventListener('pagehide',stopCamera);

