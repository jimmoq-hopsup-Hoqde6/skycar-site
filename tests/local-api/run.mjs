import {spawn,execFileSync} from 'node:child_process';
import {openSync,readdirSync,writeFileSync,mkdtempSync,existsSync,cpSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,resolve,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,createHmac} from 'node:crypto';
import net from 'node:net';
if(process.env.SKYCAR_LOCAL_API_TEST!=='1')throw new Error('Set SKYCAR_LOCAL_API_TEST=1 to run disposable loopback services');
const reviewMode=process.env.SKYCAR_LOCAL_REVIEW_MODE||'confirm';
if(!['confirm','issue'].includes(reviewMode))throw new Error('SKYCAR_LOCAL_REVIEW_MODE must be confirm or issue');
const fixture=dirname(fileURLToPath(import.meta.url)),repo=resolve(fixture,'../..');
const root=mkdtempSync(tmpdir()+'/skycar-local-api-');
const pg=process.env.SKYCAR_POSTGRES_BIN,authBin=process.env.SKYCAR_AUTH_BIN,postgrestBin=process.env.SKYCAR_POSTGREST_BIN,storageSource=process.env.SKYCAR_STORAGE_SOURCE;
for(const path of [pg&&pg+'/postgres',authBin,postgrestBin,storageSource&&storageSource+'/dist/start/server.js'])if(!path||!existsSync(path))throw new Error('Set all documented local binary/source paths');
if(!existsSync(repo+'/node_modules/next/dist/bin/next'))throw new Error('Install locked dependencies before local API acceptance');
if(readdirSync(repo).some(name=>name.startsWith('.env')&&name!=='.env.example'))throw new Error('Refusing a checkout with .env files; use a clean disposable checkout');
const app=root+'/app';
cpSync(repo,app,{recursive:true,filter:source=>!['.git','.next','node_modules','.agents','.codex','.aws'].includes(basename(source))});
symlinkSync(repo+'/node_modules',app+'/node_modules','dir');
const jwtSecret=randomBytes(48).toString('base64url');const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
const token=role=>{const payload=enc({alg:'HS256',typ:'JWT'})+'.'+enc({role,iss:'supabase-local',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+7200});return payload+'.'+createHmac('sha256',jwtSecret).update(payload).digest('base64url');};
const keys={jwtSecret,anonKey:token('anon'),serviceKey:token('service_role')};
writeFileSync(root+'/secrets.json',JSON.stringify(keys),{mode:0o600});
const cleanEnv={PATH:process.env.PATH,LANG:'C.UTF-8',TZ:'UTC',HOME:root,TMPDIR:root,SKYCAR_LOCAL_STACK_DIR:root,SKYCAR_LOCAL_API_TEST:'1',SKYCAR_LOCAL_REVIEW_MODE:reviewMode,SKYCAR_POSTGRES_BIN:pg,SKYCAR_STORAGE_SOURCE:storageSource};
const appEnv={SKYCAR_ENV:'demo',FEATURE_CARE:'true',FEATURE_GARAGE:'true',NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:55431',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:keys.anonKey,SUPABASE_SECRET_KEY:keys.serviceKey,NEXT_TELEMETRY_DISABLED:'1'};
const db='postgresql://postgres@127.0.0.1:55433/skycar_api_test';
const children=[];let stopping=false;
function groupSignal(child,signal){if(!Number.isInteger(child.pid))return;try{process.kill(-child.pid,signal);}catch(error){if(error.code!=='ESRCH')console.error('Child-group cleanup failed: '+error.code);}}
async function cleanup(){if(stopping)return;stopping=true;for(const child of [...children].reverse())groupSignal(child,'SIGTERM');await new Promise(r=>setTimeout(r,1000));for(const child of children)groupSignal(child,'SIGKILL');}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{void cleanup().then(()=>process.exit(signal==='SIGINT'?130:143));});
function start(name,cmd,args=[],env={},cwd=repo){const fd=openSync(`${root}/${name}.log`,'w',0o600);const child=spawn(cmd,args,{cwd,detached:true,env:{...cleanEnv,...env},stdio:['ignore',fd,fd]});children.push(child);child.once('error',error=>{console.error(name+' failed to start: '+error.code);void cleanup().then(()=>process.exit(1));});child.on('exit',code=>{if(!stopping&&code!==0)console.error(`${name} exited ${code}; inspect local fixture log`)});return child;}
async function ready(url,name){for(let i=0;i<150;i++){try{const r=await fetch(url,{signal:AbortSignal.timeout(500)});if(r.status<500)return;}catch(e){if(i===149)console.error(name+' readiness error '+e.message+' '+e.cause?.code)}await new Promise(r=>setTimeout(r,200));}throw new Error(name+' failed readiness');}
const sql=q=>execFileSync(pg+'/psql',[db,'-XqAt','-v','ON_ERROR_STOP=1','-c',q],{encoding:'utf8'});
const sqlfile=f=>execFileSync(pg+'/psql',[db,'-XqAt','-v','ON_ERROR_STOP=1','-f',f],{stdio:['ignore','ignore','pipe']});
const data=root+'/postgres';
try{
 for(const port of [3340,55431,55433,55434,55435,55436])await new Promise((ok,fail)=>{const server=net.createServer();server.once('error',()=>fail(new Error('Refusing to reuse occupied local port '+port)));server.listen(port,'127.0.0.1',()=>server.close(ok));});
 execFileSync(pg+'/initdb',['-D',data,'--auth-local=trust','--auth-host=trust','-U','postgres'],{stdio:'ignore'});
 start('postgres',pg+'/postgres',['-D',data,'-h','127.0.0.1','-p','55433','-c',"unix_socket_directories="]);
 for(let i=0;i<50;i++){try{execFileSync(pg+'/pg_isready',['-h','127.0.0.1','-p','55433'],{stdio:'ignore'});break;}catch{await new Promise(r=>setTimeout(r,100));}}
 execFileSync(pg+'/createdb',['-h','127.0.0.1','-p','55433','-U','postgres','skycar_api_test']);
 sql("create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create role authenticator noinherit login; grant anon,authenticated,service_role to authenticator; create schema auth; grant usage on schema public to anon,authenticated,service_role; alter default privileges in schema public grant all on tables to anon,authenticated,service_role; alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;");
 start('auth',authBin,[],{GOTRUE_SITE_URL:'http://127.0.0.1:3340',API_EXTERNAL_URL:'http://127.0.0.1:55431/auth/v1',GOTRUE_API_HOST:'127.0.0.1',PORT:'55435',GOTRUE_DB_DRIVER:'postgres',DB_NAMESPACE:'auth',DATABASE_URL:db+'?sslmode=disable&search_path=auth',GOTRUE_JWT_SECRET:keys.jwtSecret,GOTRUE_JWT_EXP:'3600',GOTRUE_JWT_AUD:'authenticated',GOTRUE_JWT_DEFAULT_GROUP_NAME:'authenticated',GOTRUE_JWT_ADMIN_ROLES:'service_role',GOTRUE_EXTERNAL_EMAIL_ENABLED:'true',GOTRUE_EXTERNAL_PHONE_ENABLED:'false',GOTRUE_MAILER_AUTOCONFIRM:'true',GOTRUE_SMTP_HOST:'127.0.0.1',GOTRUE_SMTP_PORT:'1',GOTRUE_SMTP_ADMIN_EMAIL:'noreply@example.invalid',GOTRUE_DISABLE_SIGNUP:'false',GOTRUE_LOG_LEVEL:'warn'},dirname(authBin));await ready('http://127.0.0.1:55435/health','Auth');
 sql('grant usage on schema auth to anon,authenticated,service_role; grant execute on function auth.uid(),auth.role(),auth.jwt() to anon,authenticated,service_role;');
 start('storage',process.execPath,[fixture+'/storage.mjs']);await ready('http://127.0.0.1:55436/status','Storage');
 sqlfile(fixture+'/storage-grants.sql');
 for(const name of readdirSync(repo+'/supabase/migrations').filter(x=>x.endsWith('.sql')).sort())sqlfile(repo+'/supabase/migrations/'+name);
 sql('insert into public.care_response_policy values(true,60,30);');
 console.log('Real Auth and Storage schemas plus 27 Skycar migrations installed locally');
 start('postgrest',postgrestBin,['+RTS','-N2','-RTS'],{PGRST_DB_URI:'postgresql://authenticator@127.0.0.1:55433/skycar_api_test',PGRST_DB_SCHEMAS:'public',PGRST_DB_ANON_ROLE:'anon',PGRST_JWT_SECRET:keys.jwtSecret,PGRST_SERVER_HOST:'127.0.0.1',PGRST_SERVER_PORT:'55434',PGRST_DB_EXTRA_SEARCH_PATH:'public'});
 await ready('http://127.0.0.1:55434/nonexistent','PostgREST');
 start('gateway',process.execPath,[fixture+'/gateway.mjs']);await ready('http://127.0.0.1:55431/auth/v1/health','gateway');
 const build=start('build',process.execPath,[repo+'/node_modules/next/dist/bin/next','build','--webpack'],appEnv,app);
 const buildCode=await new Promise(r=>build.on('exit',r));if(buildCode!==0)throw new Error('Controlled local-only application build failed');
 start('next',process.execPath,[repo+'/node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3340'],appEnv,app);
 await ready('http://127.0.0.1:3340/api/v1/health','Next');
 const test=spawn(process.execPath,[fixture+'/journey.mjs'],{cwd:repo,detached:true,env:cleanEnv,stdio:'inherit'});children.push(test);test.once('error',error=>{console.error('Journey process failed to start: '+error.code);void cleanup().then(()=>process.exit(1));});const code=await new Promise(r=>test.on('exit',r));if(code!==0)throw new Error('Journey assertions failed');
}catch(e){console.error(e.message);process.exitCode=1;}
finally{console.log('Local fixture artifacts: '+root+' (contains ephemeral credentials; do not publish)');await cleanup();}
