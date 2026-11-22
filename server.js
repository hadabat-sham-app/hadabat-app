const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const PORT=process.env.PORT||3000,DIR=process.env.DATA_DIR||path.join(__dirname,'data');
fs.mkdirSync(DIR,{recursive:true});const F=path.join(DIR,'db.json');
let db={users:[],sessions:{},items:[],moves:[],txs:[],seq:1};
try{db=JSON.parse(fs.readFileSync(F))}catch(e){}
const GT=process.env.GH_TOKEN,GR=process.env.GH_REPO,GF='db.json';let gsha=null,gt=null,gbusy=false,gdirty=false;
const gh=(m,b)=>fetch('https://api.github.com/repos/'+GR+'/contents/'+GF,{method:m,headers:{Authorization:'Bearer '+GT,'User-Agent':'hadabat','Accept':'application/vnd.github+json'},body:b?JSON.stringify(b):undefined});
async function gpush(){if(!GT||!GR)return;if(gbusy){gdirty=true;return}gbusy=true;try{do{gdirty=false;
  const r=await gh('PUT',{message:'sync',content:Buffer.from(JSON.stringify(db)).toString('base64'),sha:gsha||undefined});const j=await r.json();
  if(r.ok)gsha=j.content.sha;else{const g=await gh('GET');if(g.ok){gsha=(await g.json()).sha;gdirty=true}else console.log('push fail',r.status)}}while(gdirty)}catch(e){console.log('push err',e.message)}gbusy=false}
async function gload(){if(!GT||!GR)return;try{const r=await gh('GET');if(r.ok){const j=await r.json();gsha=j.sha;db=JSON.parse(Buffer.from(j.content,'base64').toString());console.log('loaded from github')}}catch(e){console.log('load err',e.message)}}
const save=()=>{fs.writeFileSync(F+'.tmp',JSON.stringify(db));fs.renameSync(F+'.tmp',F);clearTimeout(gt);gt=setTimeout(gpush,2500)};
process.on('SIGTERM',async()=>{clearTimeout(gt);await gpush();process.exit(0)});
const hash=(p,s)=>crypto.scryptSync(p,s,32).toString('hex');
function addUser(u,p,role,name){const s=crypto.randomBytes(8).toString('hex');db.users.push({id:db.seq++,username:u,name:name||u,role,salt:s,hash:hash(p,s)});}
const boot=gload().then(()=>{if(!db.users.length){const p=process.env.ADMIN_PASS||'ChangeMe123';addUser(process.env.ADMIN_USER||'admin',p,'admin','المدير');save();}});
const clients=new Set();
const bump=()=>{save();for(const r of clients)r.write('data: change\n\n')};
const send=(res,c,o)=>{res.writeHead(c,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(o))};
const body=req=>new Promise(r=>{let b='';req.on('data',d=>b+=d);req.on('end',()=>{try{r(JSON.parse(b||'{}'))}catch(e){r({})}})});
const num=v=>{v=parseFloat(v);return isFinite(v)?v:NaN};
const qty=id=>db.moves.filter(m=>m.itemId===id).reduce((a,m)=>a+(m.type==='in'?m.qty:m.type==='out'?-m.qty:m.qty),0);
function state(){return{items:db.items.map(i=>({...i,qty:qty(i.id)})),moves:db.moves.slice(-1500),txs:db.txs.slice(-3000),users:db.users.map(u=>({id:u.id,username:u.username,name:u.name,role:u.role}))}}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.webmanifest':'application/json'};
const fails={};
http.createServer(async(req,res)=>{await boot;
 const u=new URL(req.url,'http://x');const p=u.pathname;
 if(!p.startsWith('/api/')){let f=path.join(__dirname,'public',p==='/'?'index.html':p);if(!f.startsWith(path.join(__dirname,'public'))||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);return res.end('404')}
  res.writeHead(200,{'Content-Type':mime[path.extname(f)]||'application/octet-stream'});return fs.createReadStream(f).pipe(res)}
 if(p==='/api/login'&&req.method==='POST'){const b=await body(req),ip=req.socket.remoteAddress;
  if((fails[ip]||0)>=10)return send(res,429,{error:'محاولات كثيرة، حاول بعد قليل'});
  const x=db.users.find(x=>x.username===String(b.username||'').trim().toLowerCase()||x.username===String(b.username||'').trim());
  if(!x||hash(String(b.password||''),x.salt)!==x.hash){fails[ip]=(fails[ip]||0)+1;setTimeout(()=>fails[ip]=0,300000);return send(res,401,{error:'اسم المستخدم أو كلمة المرور غير صحيحة'})}
  fails[ip]=0;const t=crypto.randomBytes(24).toString('hex');db.sessions[t]=x.id;save();return send(res,200,{token:t,user:{id:x.id,name:x.name,username:x.username,role:x.role}})}
 const tok=(req.headers.authorization||'').replace('Bearer ','')||u.searchParams.get('token');
 const me=db.users.find(x=>x.id===db.sessions[tok]);if(!me)return send(res,401,{error:'unauth'});
 if(p==='/api/events'){res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});res.write('retry: 2000\n\n');clients.add(res);
  const hb=setInterval(()=>res.write(': hb\n\n'),20000);req.on('close',()=>{clients.delete(res);clearInterval(hb)});return}
 if(p==='/api/state')return send(res,200,{me:{id:me.id,name:me.name,role:me.role},...state()});
 const b=req.method==='POST'?await body(req):{};const now=new Date().toISOString();
 if(p==='/api/item'&&req.method==='POST'){const n=String(b.name||'').trim();if(!n)return send(res,400,{error:'اكتب اسم الصنف'});
  if(db.items.some(i=>i.name===n))return send(res,400,{error:'الصنف موجود بالفعل'});
  const it={id:db.seq++,name:n,unit:String(b.unit||'كجم'),min:num(b.min)||0,cost:num(b.cost)||0};db.items.push(it);
  const q=num(b.qty);if(q>0)db.moves.push({id:db.seq++,itemId:it.id,type:'in',qty:q,price:it.cost,note:'رصيد افتتاحي',dest:'',user:me.name,at:now});bump();return send(res,200,{ok:1})}
 if(p==='/api/item/edit'&&req.method==='POST'){const it=db.items.find(i=>i.id===b.id);if(!it)return send(res,404,{error:'غير موجود'});
  if(b.name)it.name=String(b.name).trim();if(b.unit)it.unit=String(b.unit);if(!isNaN(num(b.min)))it.min=num(b.min);bump();return send(res,200,{ok:1})}
 if(p==='/api/item/delete'&&req.method==='POST'){if(me.role!=='admin')return send(res,403,{error:'للمدير فقط'});db.items=db.items.filter(i=>i.id!==b.id);db.moves=db.moves.filter(m=>m.itemId!==b.id);bump();return send(res,200,{ok:1})}
 if(p==='/api/move'&&req.method==='POST'){const it=db.items.find(i=>i.id===b.itemId),q=num(b.qty);
  if(!it)return send(res,404,{error:'الصنف غير موجود'});if(!(q>0)&&b.type!=='adjust')return send(res,400,{error:'اكتب كمية صحيحة'});
  if(!['in','out','adjust'].includes(b.type))return send(res,400,{error:'نوع غير صحيح'});
  const cur=qty(it.id);if(b.type==='out'&&q>cur+1e-9)return send(res,400,{error:'الكمية المتاحة في المخزن '+cur+' فقط'});
  let price=it.cost;if(b.type==='in'){const pr=num(b.price);if(pr>=0){price=pr;it.cost=cur+q>0?((cur*it.cost)+(q*pr))/(cur+q):pr}}
  db.moves.push({id:db.seq++,itemId:it.id,type:b.type,qty:b.type==='adjust'?q:q,price,note:String(b.note||'').slice(0,200),dest:b.type==='out'?String(b.dest||'المطبخ'):'',user:me.name,at:now});bump();return send(res,200,{ok:1})}
 if(p==='/api/tx'&&req.method==='POST'){const a=num(b.amount);if(!(a>0))return send(res,400,{error:'اكتب مبلغ صحيح'});
  db.txs.push({id:db.seq++,type:b.type==='sale'?'sale':'expense',cat:String(b.cat||'أخرى'),amount:a,note:String(b.note||'').slice(0,200),user:me.name,at:now});bump();return send(res,200,{ok:1})}
 if(p==='/api/delete'&&req.method==='POST'){if(me.role!=='admin')return send(res,403,{error:'للمدير فقط'});
  db.moves=db.moves.filter(m=>m.id!==b.id);db.txs=db.txs.filter(t=>t.id!==b.id);bump();return send(res,200,{ok:1})}
 if(p==='/api/users'&&req.method==='POST'){if(me.role!=='admin')return send(res,403,{error:'للمدير فقط'});
  const un=String(b.username||'').trim().toLowerCase();if(!un||String(b.password||'').length<6)return send(res,400,{error:'اسم مستخدم وكلمة مرور (٦ أحرف على الأقل)'});
  if(db.users.some(x=>x.username===un))return send(res,400,{error:'اسم المستخدم مستخدم'});addUser(un,b.password,b.role==='admin'?'admin':'staff',b.name);bump();return send(res,200,{ok:1})}
 if(p==='/api/password'&&req.method==='POST'){if(String(b.password||'').length<6)return send(res,400,{error:'٦ أحرف على الأقل'});
  me.salt=crypto.randomBytes(8).toString('hex');me.hash=hash(b.password,me.salt);save();return send(res,200,{ok:1})}
 send(res,404,{error:'not found'});
}).listen(PORT,()=>console.log('up '+PORT));
