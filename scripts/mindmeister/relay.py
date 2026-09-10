#!/usr/bin/env python3
"""Relay MindMeister para agentes de la tailnet (Cloudflare bloquea las IPs de los VPS).
Escucha en la IP Tailscale del Mac (puerto 8766). Reenvía cualquier petición a https://www.mindmeister.com
añadiendo el Bearer de .env; el cliente solo necesita la cabecera X-Relay-Key (MINDMEISTER_RELAY_KEY)."""
import os,sys,http.server,urllib.request,urllib.error,socketserver
ENV=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','..','.env')
env={l.split('=',1)[0]:l.split('=',1)[1].strip() for l in open(ENV) if '=' in l and not l.startswith('#')}
TOKEN=env['MINDMEISTER_TOKEN']; KEY=env['MINDMEISTER_RELAY_KEY']
HOST=os.environ.get('RELAY_HOST','100.126.157.7'); PORT=int(os.environ.get('RELAY_PORT','8766'))
class H(http.server.BaseHTTPRequestHandler):
    def _fwd(self):
        if self.headers.get('X-Relay-Key')!=KEY: self.send_response(401); self.end_headers(); return
        n=int(self.headers.get('Content-Length') or 0); body=self.rfile.read(n) if n else None
        hdr={'Authorization':'Bearer '+TOKEN,'Accept':'application/json'}
        if self.headers.get('Content-Type'): hdr['Content-Type']=self.headers['Content-Type']
        req=urllib.request.Request('https://www.mindmeister.com'+self.path,data=body,headers=hdr,method=self.command)
        try: r=urllib.request.urlopen(req,timeout=120); code,data,ct=r.status,r.read(),r.headers.get('Content-Type','application/json')
        except urllib.error.HTTPError as e: code,data,ct=e.code,e.read(),e.headers.get('Content-Type','text/plain')
        self.send_response(code); self.send_header('Content-Type',ct); self.send_header('Content-Length',str(len(data))); self.end_headers(); self.wfile.write(data)
    do_GET=do_POST=do_PUT=do_DELETE=_fwd
    def log_message(self,f,*a): sys.stderr.write('%s %s\n'%(self.address_string(),f%a))
class S(socketserver.ThreadingMixIn,http.server.HTTPServer): daemon_threads=True; allow_reuse_address=True
S((HOST,PORT),H).serve_forever()
