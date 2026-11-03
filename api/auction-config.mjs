export default function handler(req,res) {
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET') {res.statusCode=405;res.end();return;}
 const context=new URL(req.url||'/', 'http://localhost').searchParams.get('context');
 const enabled=process.env.AUCTIONS_ENABLED==='true'||(context==='admin'&&process.env.ADMIN_AUTH_ENABLED==='true');
 if(!enabled) {res.statusCode=404;res.end(JSON.stringify({enabled:false}));return;}
 const url=process.env.SUPABASE_URL;
 const key=process.env.SUPABASE_PUBLISHABLE_KEY;
 if(!url || !key?.startsWith('sb_publishable_')) {res.statusCode=503;res.end(JSON.stringify({error:'Auktionsforbindelsen er ikke konfigureret.'}));return;}
 res.setHeader('Content-Type','application/json');
 res.end(JSON.stringify({enabled:true,url,key}));
}
