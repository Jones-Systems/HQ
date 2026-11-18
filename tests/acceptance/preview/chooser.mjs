export async function observeFileChooser(target, runtime, trigger) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  runtime.own('chooser observer socket', async () => {if(socket.readyState===WebSocket.CLOSED)return;await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Chooser socket cleanup timeout')),2000);socket.addEventListener('close',()=>{clearTimeout(timer);resolve();},{once:true});socket.close();});});
  let sequence = 0;
  const requests = new Map();
  let observation;
  socket.addEventListener('close',()=>{for(const request of requests.values()){clearTimeout(request.timer);request.reject(Error('Chooser socket closed'));}requests.clear();});
  socket.addEventListener('message', ({data}) => {
    const message = JSON.parse(data);
    if (message.method === 'Page.fileChooserOpened') observation = message.params;
    const request = requests.get(message.id);
    if (request) { requests.delete(message.id); clearTimeout(request.timer); message.error ? request.reject(Error(message.error.message)) : request.resolve(message.result); }
  });
  await new Promise((resolve,reject) => { socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true}); });
  const send = (method,params={}) => new Promise((resolve,reject) => {
    const id=++sequence; const timer=setTimeout(()=>{requests.delete(id);reject(Error(`Chooser CDP timeout: ${method}`));},3000);
    requests.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));
  });
  try {
    await send('Page.enable'); await send('Page.setInterceptFileChooserDialog',{enabled:true});
    await trigger();
    const deadline=Date.now()+2000;
    while(!observation && Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,50));
    if(observation?.backendNodeId) await send('DOM.setFileInputFiles',{files:[],backendNodeId:observation.backendNodeId});
    return { observed:!!observation, mode:observation?.mode ?? null, interception:'CDP intercepted; no owner file selected', denialClaim:false };
  } finally { await send('Page.setInterceptFileChooserDialog',{enabled:false}).catch(()=>{});socket.close(); }
}
