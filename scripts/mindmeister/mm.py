#!/usr/bin/env python3
"""Cliente mínimo MindMeister (API v1 vía OAuth2 bearer, token en .env MINDMEISTER_TOKEN).
Uso:
  mm.py list                      -> lista mapas (id | título | modificado)
  mm.py get <map_id>              -> imprime el árbol (con notas y links) en texto
  mm.py export <map_id> out.mm    -> descarga el mapa en FreeMind (para editarlo y reimportar)
  mm.py import file.mm            -> crea un mapa nuevo a partir de un FreeMind
  mm.py delete <map_id>
  mm.py rename <map_id> "título"
Limitación: la API ya no permite editar nodos sueltos; para actualizar un mapa se regenera el .mm y se reimporta (id nuevo), borrando el anterior.
"""
import sys,json,os,urllib.request,urllib.parse,subprocess,html
ENV=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','..','.env')
T=[l.split('=',1)[1].strip() for l in open(ENV) if l.startswith('MINDMEISTER_TOKEN=')][0]
BASE='https://www.mindmeister.com/services/rest/oauth2'
def call(method,**p):
    p.update(method=method,response_format='json')
    req=urllib.request.Request(BASE+'?'+urllib.parse.urlencode(p),headers={'Authorization':'Bearer '+T})
    return json.load(urllib.request.urlopen(req,timeout=60))['rsp']
def maps():
    d=call('mm.maps.getList'); return d['maps']['map'] if isinstance(d['maps'],dict) else d['maps']
def tree(map_id):
    d=call('mm.maps.getMap',map_id=map_id); ideas=d['ideas']['idea'] if isinstance(d['ideas'],dict) else d['ideas']
    kids={}
    for i in ideas: kids.setdefault(str(i.get('parent')),[]).append(i)
    root=[i for i in ideas if str(i.get('parent')) in ('None','0','')][0]
    out=[]
    def walk(n,depth):
        line='  '*depth+'- '+(n.get('title') or '').replace('\n',' ')
        if n.get('link'): line+='  <'+n['link']+'>'
        if n.get('note'): line+='  {'+html.unescape(n['note']).replace('\n',' ')[:300]+'}'
        out.append(line)
        for c in kids.get(str(n['id']),[]): walk(c,depth+1)
    walk(root,0); return '\n'.join(out)
cmd=sys.argv[1] if len(sys.argv)>1 else 'list'
if cmd=='list':
    for m in maps(): print(m['id'],'|',m['title'],'|',m['modified'])
elif cmd=='get': print(tree(sys.argv[2]))
elif cmd=='export':
    d=call('mm.maps.export',map_id=sys.argv[2]); print(json.dumps(d,ensure_ascii=False)[:800])
elif cmd=='import':
    r=subprocess.run(['curl','-s','-H','Authorization: Bearer '+T,'-F','method=mm.maps.import','-F','response_format=json','-F','file=@'+sys.argv[2]+';type=application/x-freemind',BASE],capture_output=True,text=True); print(r.stdout)
elif cmd=='delete': print(call('mm.maps.delete',map_id=sys.argv[2]))
elif cmd=='rename': print(call('mm.maps.setMetaData',map_id=sys.argv[2],title=sys.argv[3]))
