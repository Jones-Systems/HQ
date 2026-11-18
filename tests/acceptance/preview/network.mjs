import assert from 'node:assert/strict';
import { createServer as httpServer } from 'node:http';
import { createServer as tcpServer, connect } from 'node:net';
import { networkInterfaces } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';

export async function createNetworkCanaries(runtime) {
  const hits = [];
  const http = await runtime.listen(httpServer((req, res) => {
    hits.push({ channel: 'http', path: req.url });
    res.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/plain' }); res.end('synthetic canary');
  }));
  const tcp = await runtime.listen(tcpServer(socket => {
    hits.push({ channel: 'tcp-connect' });
    socket.on('data', bytes => hits.push({ channel: 'tcp-data', length: bytes.length, stun: bytes.length >= 20 && bytes.readUInt32BE(4) === 0x2112a442 }));
  }));
  const ownedAddress=Object.values(networkInterfaces()).flat().find(address=>address && !address.internal && address.family==='IPv4' && /^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(address.address))?.address;
  let privateUrl;
  if(ownedAddress){
    const sockets=new Set();const server=httpServer((req,res)=>{hits.push({channel:'http',path:req.url});res.end('synthetic private canary');});
    server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
    runtime.own('private-address canary',async()=>{for(const socket of sockets)socket.destroy();if(server.listening)await new Promise(resolve=>server.close(resolve));});
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,ownedAddress,resolve);});
    privateUrl=`http://${ownedAddress}:${server.address().port}`;
  }
  const alias = `http://hq-qualification.test:${new URL(http).port}`;
  const turn = `turn:hq-qualification.test:${new URL(tcp).port}?transport=tcp`;
  async function nodeControl() {
    assert.equal(await (await fetch(http + '/node-control')).text(), 'synthetic canary');
    if(privateUrl)assert.equal(await(await fetch(privateUrl+'/node-control')).text(),'synthetic private canary');
    await new Promise((resolve, reject) => {
      const socket = connect({ host: '127.0.0.1', port: Number(new URL(tcp).port) });
      const timer = setTimeout(() => { socket.destroy(); reject(Error('Node TCP control timeout')); }, 2000);
      socket.once('connect', () => { clearTimeout(timer); socket.end(); resolve(); }); socket.once('error', error => { clearTimeout(timer); reject(error); });
    });
  }
  async function httpProbe(cdp, url, token) {
    const before = hits.length;
    await cdp.evaluate(`fetch(${JSON.stringify(url + (url.includes('?') ? '&' : '?') + 'probe=' + token)},{mode:'no-cors'}).then(()=>true,()=>false)`);
    return hits.slice(before).some(hit => hit.channel === 'http' && hit.path.includes(token));
  }
  async function turnProbe(cdp) {
    const before = hits.length;
    await cdp.evaluate(`(async()=>{window.canaryPeer=new RTCPeerConnection({iceServers:[{urls:${JSON.stringify(turn)},username:'synthetic',credential:'synthetic'}],iceTransportPolicy:'relay'});window.canaryPeer.createDataChannel('synthetic');await window.canaryPeer.setLocalDescription(await window.canaryPeer.createOffer());return true})()`);
    try { for (let i=0;i<20;i++) { if (hits.slice(before).some(hit => hit.channel === 'tcp-data' && hit.stun)) return true; await delay(100); } return false; }
    finally { await cdp.evaluate('window.canaryPeer.close()'); }
  }
  return { http, privateUrl, alias, turn, hits, nodeControl, httpProbe, turnProbe };
}
