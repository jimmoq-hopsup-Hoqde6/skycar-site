import http from 'node:http';
const routes=[['/auth/v1',55435],['/rest/v1',55434],['/storage/v1',55436]];
http.createServer((req,res)=>{
 const route=routes.find(([prefix])=>req.url===prefix||req.url.startsWith(prefix+'/'));
 if(!route){res.writeHead(404);return res.end();}
 const [prefix,port]=route;
 const upstream=http.request({hostname:'127.0.0.1',port,path:req.url.slice(prefix.length)||'/',method:req.method,headers:{...req.headers,host:`127.0.0.1:${port}`}},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});
 upstream.on('error',()=>{res.writeHead(502);res.end('Local upstream unavailable');});req.pipe(upstream);
}).listen(55431,'127.0.0.1',()=>console.log('Local transparent Supabase gateway ready'));
