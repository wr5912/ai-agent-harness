/** 驱动客户端实际收帧回调，验证按句让位、PCM 顺序及取消代次。 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transform } from 'esbuild'

const source = readFileSync('src/client.tsx', 'utf8')
const start = source.indexOf('  audioListeners.add((frame) => {')
const end = source.indexOf('\n  })', start) + '\n  })'.length
assert.ok(start > 0 && end > start)
const callback = source.slice(start, end)
const { code } = await transform(`
export function harness() {
 const TAB_ID='tab', activeSessionId='s'
 const ui={readSessionId:null,visibleSessionId:null,manualReadSessionId:'other'}
 const minimumEpoch=new Map(), rejectSeqUpTo=new Map(), lastFinalSeq=new Map(), frameBuffers=new Map()
 let backchannelHoldUntil=0, manualAudioSeen=false, manualPlaybackEnded=false, accept
 const played=[], ended=[], logs=[]
 const engine={push:frame=>played.push(frame),finish:(...args)=>ended.push(args)}
 const stampTelemetry=()=>{}, debugLog=(...args)=>logs.push(args)
 const audioListeners={add:fn=>{accept=fn}}
 ${callback}
 return {accept,played,ended,logs,minimumEpoch,setHold:until=>{backchannelHoldUntil=until},get hold(){return backchannelHoldUntil}}
}`, { loader: 'ts', format: 'esm' })
const { harness } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
const data = (sentenceId, chunkId=0, sid='s') => ({ sessionId:sid,targetTabId:'tab',sentenceId,chunkId,final:false,audio:'AQA=',encoding:'pcm-s16le',sampleRate:24000,epoch:1,text:'尚未确认' })
const final = (sentenceId, chunkId, sid='s') => ({ ...data(sentenceId,chunkId,sid),final:true,audio:'' })
let passed=0
const t=(name,fn)=>{fn();passed++;console.log('  ✓ '+name)}

t('让位期间任意数量的 PCM 分块都不提前解除，完整句结束后恢复',()=>{
 const h=harness();h.setHold(Date.now()+10000)
 for(let i=0;i<8;i++)h.accept(data(1,i))
 assert.equal(h.played.length,0);assert.ok(h.hold>0)
 h.accept(final(1,8));assert.equal(h.hold,0)
 h.accept(data(2));assert.equal(h.played.length,1)
 h.accept(final(2,1));assert.deepEqual(h.ended,[['s',2]])
})
t('让位超时后不从半句重新开始，下一完整句可播放',()=>{
 const h=harness();h.setHold(Date.now()+10000);h.accept(data(1))
 h.setHold(Date.now()-1);h.accept(data(1,1));h.accept(final(1,2))
 assert.equal(h.played.length,0)
 assert.ok(h.logs.some(x=>x[0]==='tts-drop-sentence'))
 h.accept(data(2));h.accept(final(2,1));assert.equal(h.played.length,1)
})
t('旧 WAV/MP3 仍收齐 final 后才解码，完整性失败留诊断',()=>{
 const h=harness();const raw=Buffer.from([255,251,144,0]).toString('base64')
 h.accept({...data(1),encoding:undefined,audio:raw});assert.equal(h.played.length,0)
 h.accept(final(1,1));assert.equal(h.played.length,1);assert.equal(h.played[0].audio[0],255)
 h.accept(final(2,1));assert.ok(h.logs.some(x=>x[0]==='tts-drop-sentence'))
})
t('较旧 epoch 的在途帧不会被重新播放',()=>{
 const h=harness();h.minimumEpoch.set('s',2)
 h.accept(data(1));h.accept(final(1,1));assert.equal(h.played.length,0)
 h.accept({...data(2),epoch:2});assert.equal(h.played.length,1)
})
t('不同会话的相同句序号分开校验，不混合分块计数',()=>{
 const h=harness();h.accept(data(1));h.accept(data(1,0,'other'))
 h.accept(final(1,1));h.accept(final(1,1,'other'))
 assert.equal(h.played.length,2);assert.equal(h.logs.length,2)
 assert.deepEqual(h.ended,[['s',1],['other',1]])
})
t('缺块或失败流会取消该句，合法后续句继续',()=>{
 const h=harness();h.accept(data(1));h.accept(data(1,2))
 assert.deepEqual(h.ended,[['s',1,true]])
 h.accept(data(2));h.accept({...final(2,1),failed:true})
 assert.deepEqual(h.ended.at(-1),['s',2,true])
 h.accept(data(3));h.accept(final(3,1));assert.deepEqual(h.ended.at(-1),['s',3])
})
t('新代次重建队列后允许从零开始的句序号，旧拒绝线不误丢新句',()=>{
 const h=harness();h.accept(data(4));h.accept(data(4,2))
 const before=h.played.length
 h.accept({...data(0),epoch:2});h.accept({...final(0,1),epoch:2})
 assert.equal(h.played.length,before+1)
 assert.deepEqual(h.ended.at(-1),['s',0])
})
console.log(`按句让位、真实客户端收帧、取消代次与会话隔离：${passed} 项通过`)
