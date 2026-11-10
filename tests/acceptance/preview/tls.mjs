import { createServer } from 'node:https';
import { X509Certificate } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function createSyntheticTls(runtime) {
  const keyPath=join(runtime.root,'synthetic-server.key');
  const certPath=join(runtime.root,'synthetic-server.crt');
  const configPath=join(runtime.root,'synthetic-openssl.cnf');
  await writeFile(configPath,'[req]\ndistinguished_name=dn\nx509_extensions=extensions\nprompt=no\n[dn]\nCN=127.0.0.1\n[extensions]\nsubjectAltName=IP:127.0.0.1\nbasicConstraints=CA:TRUE\n',{mode:0o600});
  const child=runtime.spawn('/usr/bin/openssl',['req','-newkey','rsa:2048','-nodes','-x509','-days','1','-config',configPath,'-keyout',keyPath,'-out',certPath],{stdio:['ignore','ignore','pipe']});
  let diagnostic='';child.stderr.on('data',bytes=>{diagnostic=(diagnostic+bytes).slice(-4000);});
  await child.done;
  await runtime.stop(child);
  if(child.exitCode!==0) throw Error('Synthetic certificate generation failed: '+diagnostic);
  const [key,cert]=await Promise.all([readFile(keyPath),readFile(certPath)]);
  const connections=[];
  const server=createServer({key,cert,ca:cert,requestCert:true,rejectUnauthorized:false},(_req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><title>Synthetic client certificate fixture</title>');});
  server.on('secureConnection',socket=>connections.push({authorized:socket.authorized,peerCertificatePresent:Object.keys(socket.getPeerCertificate()).length>0}));
  server.on('tlsClientError',()=>{});
  const address=await runtime.listen(server);
  return {url:address.replace('http:','https:'),fingerprint:new X509Certificate(cert).fingerprint256,connections};
}
